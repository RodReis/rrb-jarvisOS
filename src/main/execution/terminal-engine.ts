/**
 * Motor do terminal controlado (SPEC-ExecucaoReal-02).
 *
 * Executa **comandos reais** — o segundo caminho de execução real do MVP-004, depois do
 * filesystem da F01. Reusa a espinha dela (Policy Engine em enforcement + `AuditEvent`
 * antes/depois + fluxo de aprovação humana); o que muda é o entry point: um comando, não uma
 * operação de arquivo.
 *
 * **A ordem das checagens é a política inteira**, e cada passo existe por um motivo distinto:
 *
 *   1. **Elevação** ⇒ `block`. Antes de tudo, porque `sem admin no MVP` é da ARCHITECTURE e
 *      não é contornável por allowlist — permitir `sudo` na lista não deve destravar elevação.
 *   2. **Binário na allowlist?** Fora ⇒ `block`. A 1ª barreira: barra o desconhecido.
 *   3. **cwd na allowlist de diretórios?** Fora ⇒ `block`. Um binário permitido rodando no
 *      lugar errado é tão perigoso quanto um binário proibido.
 *   4. **Denylist de padrões destrutivos?** Casou ⇒ `requires-approval`. A 2ª barreira: o
 *      binário é permitido, mas *este uso* dele não é rotina.
 *   5. **Policy Engine** classifica e decide o resto.
 *
 * As três primeiras bloqueiam; a quarta pausa. A distinção importa: bloquear é dizer "isto
 * não é possível aqui"; pausar é dizer "isto é possível, mas quem decide é você".
 *
 * **Sem shell** (`shell: false`). A UI entrega binário e argumentos separados, então não há
 * linha de comando a interpretar — `;`, `&&`, `|` e `$()` não encadeiam nada porque nada os
 * interpreta. É a diferença entre bloquear metacaracteres (e torcer para a lista estar
 * completa) e não ter metacaracteres.
 */

import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  canonicalizeBinary,
  isCommandAllowed,
  isElevationAttempt,
  isPathAllowed,
  matchDestructivePattern
} from '@shared/policies'
import { redact } from '@shared/contracts/logging-redaction'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ApprovalDecision, ApprovalRequest, ExecutionRun } from '@shared/domain/execution'
import type {
  CommandExecution,
  CommandReason,
  CommandState,
  CommandSubmission
} from '@shared/domain/terminal'
import { log } from '../logging/logger'
import { canonicalize } from '../policy/allowlist-canon'
import type { AllowlistRepository } from '../policy/allowlist-repository'
import type { CommandAllowlistRepository } from '../policy/command-allowlist-repository'
import type { PolicyService } from '../policy/policy-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { ApprovalRepository } from './approval-repository'
import type { ExecutionRepository } from './execution-repository'

/**
 * Teto de tempo de um comando. **Obrigatório** (spec § Dentro + critério 5): um comando sem
 * limite trava o main indefinidamente, e um terminal que pode travar o app não é controlado.
 *
 * 30s é generoso para o uso previsto (`git status`, `npm ci` curto) e curto o bastante para
 * que o estouro seja visivelmente um defeito, não uma espera. Constante nomeada, nunca
 * literal espalhado.
 */
export const TIMEOUT_PADRAO_MS = 30_000

/**
 * Teto de saída capturada, por fluxo. Um comando que despeja megabytes em `stdout` viraria
 * uma linha de auditoria gigante e uma tela travada; truncar é o que mantém os dois usáveis.
 * O truncamento é **visível** na saída — saída cortada em silêncio faria o usuário concluir
 * que o comando produziu menos do que produziu.
 */
export const LIMITE_SAIDA_BYTES = 64 * 1024

/**
 * Teto para o comando cuja saída **é o arquivo do usuário** (`saidaEhConteudo`).
 *
 * O teto de 64 KB existe por dois motivos, e nenhum dos dois vale aqui: a saída não vira linha de
 * auditoria (`semConteudo` a substitui por `SAIDA_OMITIDA` antes de gravar) e não vira texto de
 * tela (quem a pede consome os bytes e descarta). Aplicá-la mesmo assim produziu o defeito da
 * issue #332: `git show` de um documento de 255 KB **abortava** com `ENOBUFS`, e o hash
 * recalculado sobre o pedaço que sobrou marcava como `blob-divergente` um arquivo idêntico ao
 * commit. Todo documento acima do teto ficaria assim para sempre.
 *
 * O limite continua existindo, e é o do processo: sem teto nenhum, um arquivo maior que a memória
 * disponível derrubaria o main. 64 MB cobre documento e protótipo com folga de ordem de grandeza,
 * e ainda recusa o caso patológico.
 */
export const LIMITE_CONTEUDO_BYTES = 64 * 1024 * 1024

/**
 * Ambiente entregue ao processo filho — **lista de permissão, não o `process.env` inteiro**.
 *
 * O env do main carrega o que o app precisa para funcionar, e parte disso é segredo (chaves
 * de API, tokens do vault, credenciais de sync). Repassá-lo daria a qualquer comando
 * allowlistado acesso a tudo que o app conhece — a allowlist de binários não protege contra
 * isso, porque o binário é legítimo; o que vaza é o ambiente.
 *
 * Só passam as variáveis sem as quais um processo comum não roda: onde achar executáveis,
 * onde é o home, e o mínimo de identidade do SO.
 */
const VARIAVEIS_DE_AMBIENTE_PERMITIDAS: readonly string[] = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'COMSPEC',
  'PATHEXT'
]

/**
 * Exportada desde a F04 do MVP-005: o adapter do Claude Code CLI também roda subprocess e
 * precisa da **mesma** lista de permissão. Duas cópias divergiriam, e a que divergisse seria a
 * que vaza — a lição da M4-F02 (`process.env` do main não pode alcançar o processo filho) vale
 * igual para um binário que o app invoca como sua própria dependência.
 */
export function ambienteControlado(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const chave of VARIAVEIS_DE_AMBIENTE_PERMITIDAS) {
    const valor = process.env[chave]
    if (valor !== undefined) env[chave] = valor
  }
  return env
}

/**
 * Os argumentos como eles podem ir para a auditoria.
 *
 * Um argumento pode carregar segredo — a M9-F01 trouxe o caso concreto: o push da publicação leva o
 * token na URL, porque `ambienteControlado()` não deixa variável de ambiente alcançar o subprocess.
 * O `AuditRepository` grava o payload **cru**, então sem esta passagem o token entra no banco em
 * claro e fica lá, encadeado no hash, sem como remover.
 *
 * A redação acontece aqui e não no chamador porque este é o ponto por onde todo comando passa:
 * quem chamar o terminal de outra fatia herda a proteção sem saber que precisava dela. E acontece
 * **só na auditoria** — a `ApprovalRequest` guarda o argumento real, porque é dela que a retomada
 * reconstrói o comando, e um argumento redigido seria retomado quebrado.
 */
function argsSeguros(args: readonly string[]): string[] {
  return args.map((arg) => {
    const redigido = redact(arg)
    return typeof redigido === 'string' ? redigido : String(redigido)
  })
}

/**
 * O que aparece no lugar do corpo do arquivo, quando ele não pode virar evidência.
 *
 * Um marcador, e não string vazia: quem lê a auditoria precisa distinguir "o comando não
 * imprimiu nada" de "o que ele imprimiu foi omitido de propósito". As duas leituras levam a
 * investigações diferentes.
 */
export const SAIDA_OMITIDA = '[conteúdo de arquivo omitido da evidência]'

/**
 * A execução como a auditoria deve guardá-la.
 *
 * Só o `stdout` sai, e só quando o chamador declarou `saidaEhConteudo`. Binário, argumentos,
 * cwd, exit code, duração, `stderr` e o par antes/depois continuam — o que se protege é o corpo
 * do arquivo do usuário (ADR-004), não o rastro de que o comando rodou.
 */
function semConteudo(execucao: CommandExecution, submission: CommandSubmission): CommandExecution {
  if (submission.saidaEhConteudo !== true) return execucao
  return { ...execucao, stdout: SAIDA_OMITIDA }
}

/**
 * Redige e trunca uma saída antes de ela virar evidência ou chegar à tela.
 *
 * A ordem importa: **redige primeiro, trunca depois**. Truncar antes poderia cortar um token
 * ao meio e deixar o pedaço passar pela redação, que casa padrões inteiros — o segredo
 * vazaria justamente por ter sido cortado.
 */
function saidaSegura(raw: string, limite: number = LIMITE_SAIDA_BYTES): string {
  const redigido = redact(raw)
  const texto = typeof redigido === 'string' ? redigido : String(redigido)

  if (Buffer.byteLength(texto, 'utf8') <= limite) return texto

  return `${texto.slice(0, limite)}\n[saída truncada em ${limite} bytes]`
}

/**
 * O teto que vale para esta submissão.
 *
 * Só o `stdout` de um comando `saidaEhConteudo` recebe o teto largo; o `stderr` continua com o de
 * evidência em todos os casos, porque é evidência em todos os casos — inclusive no comando que
 * despeja arquivo, onde a mensagem de erro do Git é exatamente o que precisa caber na linha de
 * auditoria.
 */
function limiteDaSaida(submission: CommandSubmission): number {
  return submission.saidaEhConteudo === true ? LIMITE_CONTEUDO_BYTES : LIMITE_SAIDA_BYTES
}

/** O payload da operação guardado na `ApprovalRequest`, para retomar depois da decisão. */
function operationPayload(submission: CommandSubmission): Readonly<Record<string, unknown>> {
  return {
    kind: 'comando',
    binary: submission.binary,
    args: [...submission.args],
    cwd: submission.cwd
  }
}

/** Reconstrói a submissão a partir do que ficou guardado na aprovação. */
function submissionFromStored(
  raw: Readonly<Record<string, unknown>>
): CommandSubmission | undefined {
  const binary = raw['binary']
  const cwd = raw['cwd']
  const args = raw['args']

  if (typeof binary !== 'string' || typeof cwd !== 'string') return undefined

  return {
    binary,
    cwd,
    args: Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : []
  }
}

export class TerminalEngine {
  constructor(
    private readonly policy: PolicyService,
    private readonly commands: CommandAllowlistRepository,
    private readonly directories: AllowlistRepository,
    private readonly runs: ExecutionRepository,
    private readonly approvals: ApprovalRepository,
    private readonly audit: AuditRepository,
    private readonly userId: () => string,
    /** Injetável só para o teste de timeout não precisar esperar 30 segundos de verdade. */
    private readonly timeoutMs: number = TIMEOUT_PADRAO_MS
  ) {}

  /**
   * Submete um comando: valida, e executa **só** se as duas barreiras e a política deixarem.
   *
   * Devolve sempre um `CommandExecution` — inclusive nas recusas. Recusa não é erro a
   * estourar: é um desfecho legítimo que a UI precisa mostrar e a auditoria precisa guardar.
   * Lançar exceção aqui faria "bloqueado pela política" chegar à tela como falha técnica.
   */
  run(submission: CommandSubmission, workspaceId: WorkspaceId): CommandExecution {
    const userId = this.userId()
    const correlationId = randomUUID()
    const started = Date.now()
    const binarioCanonico = canonicalizeBinary(submission.binary)

    const contexto = {
      userId,
      workspaceId,
      submission,
      correlationId,
      started
    }

    // Passo 1 — elevação. Antes da allowlist de propósito: permitir `sudo` na lista não pode
    // destravar o que a ARCHITECTURE proíbe no MVP.
    if (isElevationAttempt(submission.binary)) {
      return this.recusar(contexto, 'elevacao-negada', 'terminal.run-allowlisted')
    }

    // Passo 2 — 1ª barreira: o binário está permitido?
    const permitidos = this.commands.list(userId, workspaceId)
    if (!isCommandAllowed(submission.binary, permitidos)) {
      return this.recusar(contexto, 'binario-fora-da-allowlist', 'terminal.run-allowlisted')
    }

    // Passo 3 — o cwd está dentro da allowlist de **diretórios** (SPEC-Execucao-03)? A
    // canonicalização é o que impede `..` e symlink de escaparem.
    const cwdCanonico = canonicalize(submission.cwd)
    const cwdPermitido = isPathAllowed(cwdCanonico, this.directories.list(userId))
    if (!cwdPermitido) {
      return this.recusar(contexto, 'cwd-fora-da-allowlist', 'terminal.run-allowlisted')
    }

    // Passo 4 — 2ª barreira: este *uso* do binário permitido é destrutivo?
    const destrutivo = matchDestructivePattern(binarioCanonico, submission.args)
    const action = destrutivo ? 'terminal.run-destructive' : 'terminal.run-allowlisted'

    const classificada = this.policy.classify(action, {
      workspace: workspaceId,
      pathAllowed: cwdPermitido,
      detail: {
        binary: binarioCanonico,
        args: submission.args,
        cwd: cwdCanonico,
        ...(destrutivo ? { padraoDestrutivo: destrutivo.id } : {})
      }
    })

    // **As duas barreiras satisfeitas liberam a execução** — decisão do PI (2026-08-28),
    // seguindo o precedente que a F01 abriu para `fs.write-allowed`.
    //
    // O seed do MVP-002 classifica `terminal.run-allowlisted` como **médio**, e médio
    // deriva `requires-approval`. Aplicado ao pé da letra, `git status` num binário que o
    // usuário permitiu explicitamente abriria um pedido de aprovação — e as duas barreiras
    // colapsariam em uma só, porque o gate humano seria idêntico com ou sem allowlist.
    //
    // O argumento que sustenta a liberação: **permitir o binário já foi a aprovação**.
    // Adicionar um comando à allowlist é ato de alto risco (`permissions.change`),
    // classificado e auditado no `CommandAllowlistRepository`. O usuário decidiu uma vez,
    // deliberadamente, que aquele binário pode rodar naquele espaço; pedir a mesma decisão a
    // cada execução transformaria a aprovação em ruído — e aprovação que vira ruído deixa de
    // ser lida, que é como um gate de segurança morre na prática.
    //
    // O que **não** muda: destrutivo continua pausando (2ª barreira), e a classificação
    // segue sendo registrada acima com o tier real do seed. Não reescrevemos a taxonomia —
    // ela continua dizendo que a ação é médio risco; o que a fatia afirma é que as barreiras
    // dela já cobriram esse risco.
    const decision =
      !destrutivo && classificada.outcome === 'requires-approval'
        ? { ...classificada, outcome: 'allow' as const }
        : classificada

    if (decision.outcome === 'block') {
      return this.recusar(contexto, 'bloqueado-pela-politica', action)
    }

    // Passo 5 — destrutivo (ou qualquer coisa que a política eleve) pausa pelo fluxo da F01.
    if (destrutivo || decision.outcome === 'requires-approval') {
      return this.pausarParaAprovacao(contexto, action, decision.reason, destrutivo?.descricao)
    }

    return this.executar({ ...contexto, cwdCanonico, action })
  }

  /**
   * Retoma um comando depois da decisão humana. É o gêmeo de `RealFileSystemEngine.resolveApproval`
   * para o caminho de terminal.
   *
   * **Re-valida as duas barreiras antes de executar.** A aprovação autoriza *este comando*;
   * ela não congela o mundo. Entre a criação do pedido e a decisão, o usuário pode ter
   * revogado o binário ou removido o diretório da allowlist — e nesse caso a autorização
   * humana não deve sobrepor a allowlist vigente. Aprovar é liberar o gate destrutivo, não
   * virar exceção permanente à política.
   */
  resolveApproval(id: string, decision: ApprovalDecision): CommandExecution | undefined {
    const userId = this.userId()
    const approval = this.approvals.findById(userId, id)
    if (!approval) return undefined

    const submission = submissionFromStored(approval.operation)
    if (!submission) return undefined

    const resolvida = this.approvals.resolve(userId, id, decision)
    if (!resolvida) return undefined

    const workspaceId = approval.workspace_id as WorkspaceId
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'approval-request',
      payload: {
        marco: 'resolucao',
        approvalRequestId: approval.id,
        runId: approval.runId,
        decision,
        alvo: 'comando'
      }
    })

    const contexto = {
      userId,
      workspaceId,
      submission,
      correlationId: approval.runId,
      started: Date.now()
    }

    if (decision === 'negado') {
      const execucao = this.montar(contexto, {
        state: 'bloqueado',
        reason: 'aprovacao-negada',
        stdout: '',
        stderr: '',
        exitCode: null
      })
      this.auditar(execucao, 'depois')
      this.finalizarRun(approval.runId, userId, workspaceId, 'falhou')
      return execucao
    }

    // Re-validação: a aprovação não sobrepõe a allowlist vigente.
    if (!isCommandAllowed(submission.binary, this.commands.list(userId, workspaceId))) {
      const execucao = this.recusar(
        contexto,
        'binario-fora-da-allowlist',
        'terminal.run-destructive'
      )
      this.finalizarRun(approval.runId, userId, workspaceId, 'falhou')
      return execucao
    }

    const cwdCanonico = canonicalize(submission.cwd)
    if (!isPathAllowed(cwdCanonico, this.directories.list(userId))) {
      const execucao = this.recusar(contexto, 'cwd-fora-da-allowlist', 'terminal.run-destructive')
      this.finalizarRun(approval.runId, userId, workspaceId, 'falhou')
      return execucao
    }

    const execucao = this.executar({
      ...contexto,
      cwdCanonico,
      action: 'terminal.run-destructive',
      approvedBy: resolvida.resolved_by ?? userId
    })
    this.finalizarRun(
      approval.runId,
      userId,
      workspaceId,
      execucao.state === 'concluido' ? 'concluido' : 'falhou'
    )
    return execucao
  }

  /**
   * Executa o processo de verdade. Só se chega aqui depois de as duas barreiras e a política
   * terem passado — este método não decide nada, só faz.
   */
  private executar(ctx: {
    readonly userId: string
    readonly workspaceId: WorkspaceId
    readonly submission: CommandSubmission
    readonly correlationId: string
    readonly started: number
    readonly cwdCanonico: string
    readonly action: string
    readonly approvedBy?: string
  }): CommandExecution {
    const parcial = this.montar(ctx, {
      state: 'concluido',
      reason: 'executado',
      stdout: '',
      stderr: '',
      exitCode: null
    })

    // `AuditEvent` **antes** — o RF-016 exige o par antes/depois. O evento anterior é o que
    // prova que a intenção existiu mesmo quando o processo morre sem devolver nada.
    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      type: 'terminal-command',
      payload: {
        marco: 'antes',
        executionId: parcial.id,
        binary: canonicalizeBinary(ctx.submission.binary),
        args: argsSeguros(ctx.submission.args),
        cwd: ctx.cwdCanonico,
        correlationId: ctx.correlationId,
        approvedBy: ctx.approvedBy ?? null
      }
    })

    // `spawnSync` e não `spawn`: o modelo é command-runner (submete → devolve saída), e o
    // resultado é síncrono do ponto de vista de quem chamou. `timeout` + `killSignal` são o
    // kill obrigatório do critério 5 — o SO mata o processo, não uma promessa nossa de parar
    // de escutar. `shell: false` é o default e está aqui explícito porque é a garantia de
    // segurança mais importante do arquivo, não um detalhe a inferir.
    const resultado = spawnSync(ctx.submission.binary, [...ctx.submission.args], {
      cwd: ctx.cwdCanonico,
      env: ambienteControlado(),
      shell: false,
      timeout: this.timeoutMs,
      killSignal: 'SIGKILL',
      // O `maxBuffer` não trunca: ele **aborta** a execução com `ENOBUFS` e devolve o pedaço que
      // coube. Para o comando que despeja o arquivo do usuário isso transformava um documento
      // grande em saída cortada no meio — a raiz do defeito da issue #332.
      maxBuffer: limiteDaSaida(ctx.submission),
      encoding: 'utf8',
      windowsHide: true
    })

    const durationMs = Date.now() - ctx.started
    const stdout = saidaSegura(resultado.stdout ?? '', limiteDaSaida(ctx.submission))
    const stderrBruto = resultado.stderr ?? ''

    // Estourou o timeout: o Node marca `error.code === 'ETIMEDOUT'` (ou devolve o sinal com
    // que matou). Vira `falhou`, nunca `concluido` — um comando morto no meio não terminou.
    const porTimeout =
      resultado.error !== undefined &&
      ((resultado.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
        resultado.signal === 'SIGKILL')

    if (porTimeout) {
      const execucao: CommandExecution = {
        ...parcial,
        state: 'falhou',
        reason: 'timeout-excedido',
        stdout,
        stderr: saidaSegura(
          `${stderrBruto}\n[comando encerrado por exceder ${this.timeoutMs} ms]`.trim()
        ),
        exitCode: null,
        durationMs
      }
      this.auditar(execucao, 'depois')
      log.agent.error('Comando encerrado por timeout', {
        executionId: execucao.id,
        durationMs,
        correlationId: ctx.correlationId
      })
      return execucao
    }

    // Falha de spawn (binário inexistente, cwd sumido). O RF-016 é literal em que **erro de
    // execução aparece no terminal E gera `AuditEvent`** — por isso a mensagem vai para
    // `stderr` da execução, e não só para o log.
    if (resultado.error) {
      const execucao: CommandExecution = {
        ...parcial,
        state: 'falhou',
        reason: 'falha-na-execucao',
        stdout,
        stderr: saidaSegura(`${stderrBruto}\n${resultado.error.message}`.trim()),
        exitCode: null,
        durationMs
      }
      this.auditar(execucao, 'erro')
      log.agent.error('Falha ao executar comando', {
        executionId: execucao.id,
        error: resultado.error,
        correlationId: ctx.correlationId
      })
      return execucao
    }

    const exitCode = resultado.status
    // Exit code diferente de zero é **falha do comando, não do terminal**: o processo rodou.
    // Distinguir isso de `falha-na-execucao` importa porque um `npm test` que reprova é um
    // desfecho normal do terminal, e tratá-lo como erro de infraestrutura confundiria a UI.
    const execucao: CommandExecution = {
      ...parcial,
      state: exitCode === 0 ? 'concluido' : 'falhou',
      reason: exitCode === 0 ? 'executado' : 'falha-na-execucao',
      stdout,
      stderr: saidaSegura(stderrBruto),
      exitCode: exitCode ?? null,
      durationMs
    }

    /*
     * A auditoria recebe a execução **sem o corpo do arquivo** quando o chamador declarou que a
     * saída é conteúdo (`saidaEhConteudo`). O retorno acima segue com o texto real, porque é
     * para isso que quem chamou rodou o comando; o que não pode é o documento virar evidência
     * persistida. Ver `CommandSubmission.saidaEhConteudo`.
     */
    this.auditar(semConteudo(execucao, ctx.submission), exitCode === 0 ? 'depois' : 'erro')
    // `debug` (#319): um comando do marco documental são dois `AuditEvent` e esta linha; num
    // commit de PRD isso enchia o console. A execução em si já está auditada logo acima.
    log.agent.debug('Comando executado no terminal controlado', {
      executionId: execucao.id,
      exitCode,
      durationMs,
      correlationId: ctx.correlationId
    })
    return execucao
  }

  /**
   * Recusa o comando sem executar nada, auditando o par antes/depois.
   *
   * O evento **antes** é registrado mesmo na recusa: a tentativa é o fato interessante para a
   * auditoria. Registrar só o que executou faria as tentativas barradas — justo o que RF-019
   * quer ver — não deixarem rastro.
   */
  private recusar(
    ctx: {
      readonly userId: string
      readonly workspaceId: WorkspaceId
      readonly submission: CommandSubmission
      readonly correlationId: string
      readonly started: number
    },
    reason: CommandReason,
    action: string
  ): CommandExecution {
    // Classifica a tentativa recusada: a decisão de política é evidência, e uma recusa sem
    // `policy-decision` seria um bloqueio sem justificativa registrada.
    this.policy.classify(action, {
      workspace: ctx.workspaceId,
      pathAllowed: reason !== 'cwd-fora-da-allowlist',
      detail: {
        binary: canonicalizeBinary(ctx.submission.binary),
        args: ctx.submission.args,
        cwd: ctx.submission.cwd,
        recusa: reason
      }
    })

    const execucao = this.montar(ctx, {
      state: 'bloqueado',
      reason,
      stdout: '',
      stderr: '',
      exitCode: null
    })

    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      type: 'terminal-command',
      payload: {
        marco: 'antes',
        executionId: execucao.id,
        binary: canonicalizeBinary(ctx.submission.binary),
        args: argsSeguros(ctx.submission.args),
        cwd: ctx.submission.cwd,
        correlationId: ctx.correlationId
      }
    })
    this.auditar(execucao, 'depois')

    log.agent.warn('Comando recusado pelo terminal controlado', {
      executionId: execucao.id,
      reason,
      correlationId: ctx.correlationId
    })
    return execucao
  }

  /**
   * Abre a `ApprovalRequest` e pausa — mesmo fluxo, mesma fila e mesma tabela da F01.
   *
   * A fila liga aprovação a `runId`/`stepId`, então cada comando ganha um `ExecutionRun`
   * sintético de uma etapa. Poderia parecer mais limpo dar ao terminal a própria tabela de
   * aprovações, mas seriam **duas filas** para a mesma pergunta ("o que espera por mim?") — e
   * a spec é explícita em reusar o fluxo da F01, não reinventá-lo. O painel de aprovações
   * existente passa a mostrar comando e filesystem sem saber que houve uma fatia nova.
   */
  private pausarParaAprovacao(
    ctx: {
      readonly userId: string
      readonly workspaceId: WorkspaceId
      readonly submission: CommandSubmission
      readonly correlationId: string
      readonly started: number
    },
    action: string,
    reason: string,
    motivoDestrutivo: string | undefined
  ): CommandExecution {
    const runId = ctx.correlationId
    const agora = new Date().toISOString()

    const run: ExecutionRun = {
      id: runId,
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      workflowId: null,
      state: 'aguardando-aprovacao',
      trace: [],
      correlationId: ctx.correlationId,
      startedAt: agora,
      finishedAt: agora,
      created_at: agora
    }
    this.runs.save(run)

    const request: ApprovalRequest = {
      id: randomUUID(),
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      runId,
      stepId: 'comando',
      action,
      status: 'pendente',
      risk: 'alto',
      reason,
      operation: operationPayload(ctx.submission),
      created_at: agora
    }
    this.approvals.create(request)

    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      type: 'approval-request',
      payload: {
        marco: 'criacao',
        approvalRequestId: request.id,
        runId,
        action,
        alvo: 'comando',
        binary: canonicalizeBinary(ctx.submission.binary),
        motivoDestrutivo: motivoDestrutivo ?? null
      }
    })

    const execucao = this.montar(ctx, {
      state: 'aguardando-aprovacao',
      reason: 'aguardando-aprovacao-destrutivo',
      stdout: '',
      stderr: '',
      exitCode: null,
      approvalRequestId: request.id,
      ...(motivoDestrutivo ? { motivoDestrutivo } : {})
    })

    log.agent.info('Comando pausado aguardando aprovação humana', {
      executionId: execucao.id,
      approvalRequestId: request.id,
      correlationId: ctx.correlationId
    })
    return execucao
  }

  /** Marca o run sintético como encerrado, para a fila não guardar pendência fantasma. */
  private finalizarRun(
    runId: string,
    userId: string,
    workspaceId: WorkspaceId,
    state: ExecutionRun['state']
  ): void {
    const run = this.runs.findById(userId, runId)
    if (!run) return
    this.runs.update({ ...run, state, finishedAt: new Date().toISOString() })
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'execution-run',
      payload: { modo: 'terminal', marco: 'fim', runId, state }
    })
  }

  /**
   * O `AuditEvent` de fechamento, com o que o RF-016 exige nominalmente: comando, diretório,
   * saída, erro, duração e exit code. Saída e erro já chegam redigidos de `montar`.
   */
  private auditar(execucao: CommandExecution, marco: 'depois' | 'erro'): void {
    this.audit.append({
      user_id: execucao.user_id,
      workspace_id: execucao.workspace_id as WorkspaceId,
      type: 'terminal-command',
      payload: {
        marco,
        executionId: execucao.id,
        binary: execucao.binary,
        args: argsSeguros(execucao.args),
        cwd: execucao.cwd,
        state: execucao.state,
        reason: execucao.reason,
        stdout: execucao.stdout,
        stderr: execucao.stderr,
        exitCode: execucao.exitCode,
        durationMs: execucao.durationMs,
        correlationId: execucao.correlationId
      }
    })
  }

  /** Monta o `CommandExecution` com o que é comum a todos os desfechos. */
  private montar(
    ctx: {
      readonly userId: string
      readonly workspaceId: WorkspaceId
      readonly submission: CommandSubmission
      readonly correlationId: string
      readonly started: number
    },
    resto: {
      readonly state: CommandState
      readonly reason: CommandReason
      readonly stdout: string
      readonly stderr: string
      readonly exitCode: number | null
      readonly approvalRequestId?: string
      readonly motivoDestrutivo?: string
    }
  ): CommandExecution {
    return {
      id: randomUUID(),
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      binary: canonicalizeBinary(ctx.submission.binary),
      args: [...ctx.submission.args],
      cwd: ctx.submission.cwd,
      durationMs: Date.now() - ctx.started,
      correlationId: ctx.correlationId,
      created_at: new Date().toISOString(),
      ...resto
    }
  }
}
