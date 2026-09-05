/**
 * O perfil isolado do Codex, do lado do main (SPEC-Multi-Executor-02, critérios 1, 3, 4, 5 e 6).
 *
 * A pergunta que este serviço responde: **a identidade Codex da pipeline está pronta, e o app
 * pode executar com ela?** — sem nunca tocar no segredo que a sustenta.
 *
 * ## O app não vê o segredo, e não é por disciplina
 *
 * Quem autentica é o PI, com `codex login --device-auth`: o CLI imprime um código, o PI o
 * confirma no navegador, e a credencial nasce **dentro** do `CODEX_HOME` — nunca passa por
 * formulário, IPC, argumento ou stdin deste processo (critério 1). O app faz três coisas com
 * ela: dispara o comando, lê o estado (`login status`), e apaga (`logout`). Não existe caminho
 * aqui que leia `auth.json`, e é por isso que nenhum tipo desta fatia tem campo para token.
 *
 * ## Por que `CODEX_HOME` dedicado, e por que em `userData`
 *
 * A spec pede o perfil "fora do perfil pessoal padrão e fora do repositório". `userData` atende
 * os dois, e um terceiro requisito que só apareceu medindo: o Codex **recusa** criar seus
 * binários auxiliares sob diretório temporário — medido no CLI 0.149.0, que respondeu
 * *"Refusing to create helper binaries under temporary dir"*. Um `CODEX_HOME` em `TEMP` pareceria
 * funcionar e degradaria em silêncio.
 *
 * ## Por que o ambiente é montado à mão aqui
 *
 * `ambienteControlado()` é lista de permissão fechada, e `CODEX_HOME` não está nela — de
 * propósito: ela governa o terminal do usuário, onde nenhum comando deveria herdar o perfil da
 * pipeline. Aqui o app invoca **sua própria dependência** e precisa apontar o perfil, então
 * estende a lista com uma variável só, no ponto de uso. Acrescentá-la à lista global daria a
 * todo comando allowlistado acesso ao perfil do Codex, que é o oposto do isolamento.
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  MODO_DE_COBRANCA_PADRAO,
  QUOTA_DO_CODEX,
  execucaoPermitida,
  modoGastaDinheiro,
  trocaDeModoPermitida,
  type CodexBillingMode,
  type CodexHealthState,
  type CodexProfileState
} from '@shared/domain/codex-profile'
import { redigirSegredos } from '@shared/domain/segredos'
import { ambienteControlado } from '../execution/terminal-engine'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'

/**
 * O binário, **pinado**. Constante e não configuração — a mesma regra do `claude` no
 * `ClaudeCodeAdapter`: o dia em que este nome vier de fora é o dia em que "subprocess
 * app-managed" vira execução arbitrária com outro nome.
 */
export const BINARIO_CODEX = 'codex'

/**
 * Como invocar o CLI **sem abrir mão do `shell: false`** (decisão do PI, 2026-09-05).
 *
 * O smoke real achou o que o dublê escondia: no Windows o `codex` do npm existe só como `.cmd`
 * (não há `.exe` — medido: `codex`, `codex.cmd` e `codex.ps1`, mais `bin/codex.js`), e o Node
 * **recusa** executar `.cmd`/`.bat` sem `shell: true` — responde `EINVAL`, por causa da proteção
 * contra injeção de argumento em scripts de lote. Sem isto, o serviço responderia `offline` numa
 * máquina onde o Codex está instalado e funcionando.
 *
 * As três saídas eram: `shell: true` no Windows (abriria interpolação de string justo no
 * processo que fala com a credencial — a garantia que o `ClaudeCodeAdapter` chama de "a mais
 * importante do arquivo"), exigir um binário nativo (o app diria "indisponível" sobre um CLI que
 * responde), ou **resolver o script e chamá-lo pelo Node**. A terceira mantém `shell: false`
 * intacto: o argumento vira `node <caminho absoluto do .js> <args>`, sem shell no meio.
 *
 * Devolve o binário cru quando a resolução falha — é o caminho normal em Linux e macOS, onde o
 * `codex` é um executável de verdade e o `spawn` o encontra pelo PATH.
 */
export function resolverInvocacao(
  binario: string,
  args: readonly string[],
  resolverScript: () => string | undefined
): { readonly comando: string; readonly args: readonly string[] } {
  const script = resolverScript()
  return script === undefined
    ? { comando: binario, args }
    : { comando: process.execPath, args: [script, ...args] }
}

/**
 * Onde mora o `bin/codex.js` da instalação global, quando ele existe.
 *
 * `npm root -g` e não um caminho fixo: a raiz global muda por gerenciador (npm, pnpm, volta), por
 * SO e por instalação com prefixo. Um caminho cravado aqui funcionaria nesta máquina e falharia
 * na próxima — e o modo de falha seria o pior possível, um `offline` sobre um CLI presente.
 *
 * Nunca lança: qualquer falha devolve `undefined`, e o chamador cai no binário do PATH.
 */
export function localizarScriptDoCodex(
  execSyncImpl: typeof execSync,
  existe: (caminho: string) => boolean
): string | undefined {
  try {
    const raiz = execSyncImpl('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
    if (raiz === '') return undefined

    const script = join(raiz, '@openai', 'codex', 'bin', 'codex.js')
    return existe(script) ? script : undefined
  } catch {
    return undefined
  }
}

/**
 * O nome do diretório do perfil, sob `userData`.
 *
 * Prefixo do app no nome porque ele convive com o `~/.codex` pessoal do PI na mesma máquina:
 * um diretório chamado só `codex` sob `userData` seria ambíguo na primeira inspeção manual.
 */
export const DIRETORIO_DO_PERFIL = 'codex-pipeline'

/** Prazo das consultas de estado. Curto: são leituras locais, não geração. */
const TIMEOUT_CONSULTA_MS = 15_000

/**
 * Prazo do login. Generoso porque o `--device-auth` **espera o PI** confirmar no navegador —
 * o que é lento por natureza, e não um travamento a interromper.
 */
const TIMEOUT_LOGIN_MS = 5 * 60_000

/**
 * O que uma execução do CLI devolveu.
 *
 * **`stderr` entra**, ao contrário do `ClaudeCodeAdapter` — e por um motivo medido, não por
 * conveniência: o `codex login status` escreve `"Not logged in"` no **stderr**, com exit 1. Ler
 * só o stdout faria um perfil sem credencial parecer autenticado, que é o pior modo de falha
 * possível para o critério 6.
 *
 * Ele fica **dentro** deste tipo e nunca vira mensagem para a tela: quem monta diagnóstico é o
 * `diagnosticoSeguro`, a partir do JSON do `doctor`. A distinção é a mesma do adapter do Claude
 * (stderr é diagnóstico, não resposta) — aqui ele também é *sinal de estado*.
 */
interface SaidaDoCli {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
}

export interface CodexProfileDeps {
  /** A raiz do `userData`. O perfil nasce sob ela. */
  readonly userDataDir: string
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /** Injetável só para o teste não depender do binário instalado. */
  readonly spawnImpl?: typeof spawn
  /**
   * Injetáveis pela mesma razão do `spawnImpl`: a resolução do script (ver `resolverInvocacao`)
   * consulta `npm root -g` e o disco, e um teste que dependesse dos dois mediria a máquina em
   * vez da decisão do serviço.
   */
  readonly execSyncImpl?: typeof execSync
  readonly existeImpl?: typeof existsSync
  readonly mkdirImpl?: typeof mkdirSync
  readonly agora?: () => Date
}

export class CodexProfileService {
  private readonly spawnImpl: typeof spawn
  private readonly agora: () => Date
  /** O modo vigente e o teto, em memória — a persistência é do repositório (ver `aplicarModo`). */
  private modo: CodexBillingMode = MODO_DE_COBRANCA_PADRAO
  /**
   * O caminho do `bin/codex.js`, resolvido **uma vez**.
   *
   * `null` distingue "já procurei e não achei" de "ainda não procurei" (`undefined`): sem essa
   * distinção, uma instalação sem o script global rodaria `npm root -g` a cada consulta de
   * estado — um subprocess extra por leitura de tela.
   */
  private scriptResolvido: string | null | undefined

  constructor(private readonly deps: CodexProfileDeps) {
    this.spawnImpl = deps.spawnImpl ?? spawn
    this.agora = deps.agora ?? ((): Date => new Date())
  }

  /**
   * O `CODEX_HOME` da pipeline — a **referência opaca** ao perfil de que a spec fala.
   *
   * Um caminho, nunca o conteúdo. É o que permite provar isolamento (este perfil não é o
   * pessoal) sem expor nada de dentro dele.
   */
  get codexHome(): string {
    return join(this.deps.userDataDir, DIRETORIO_DO_PERFIL)
  }

  /**
   * O estado do perfil (critério 6).
   *
   * Duas perguntas ao CLI, nesta ordem, porque respondem coisas diferentes: `login status` diz
   * se **há credencial**, e é barato; `doctor --json` diz se o **ambiente** está sadio, e é onde
   * o diagnóstico sanitizado nasce. Perguntar só ao doctor bastaria para o estado, mas o
   * `login status` é o que distingue `auth_required` de um doctor que falhou por outra razão.
   */
  async estado(): Promise<CodexProfileState> {
    const status = await this.rodar(['login', 'status'], TIMEOUT_CONSULTA_MS)

    // O binário não respondeu: `offline` é sobre a **ferramenta**, não sobre a conta. Um
    // `auth_required` aqui mandaria o PI fazer login num CLI que não está instalado.
    if (!status.ok && status.exitCode === null) {
      return this.montar('offline', 'O Codex CLI não respondeu.')
    }

    // **As duas saídas**, e não só o stdout: medido no CLI 0.149.0, `login status` escreve
    // `"Not logged in"` no **stderr**, com exit 1. Ler só o stdout faria um perfil sem credencial
    // parecer autenticado — o pior modo de falha possível aqui, porque o run começaria e morreria
    // na primeira chamada, depois de o preflight ter dito que estava tudo bem.
    const resposta = `${status.stdout}\n${status.stderr}`
    if (/not logged in/i.test(resposta)) {
      return this.montar('auth_required', 'Nenhuma credencial no perfil da pipeline.')
    }

    // Saída não-zero que **não** é "not logged in" é problema de ferramenta, não de conta: o CLI
    // rodou e reclamou de outra coisa (config ilegível, perfil corrompido). Chamá-lo de
    // `auth_required` mandaria o PI fazer login para resolver o que login nenhum resolve.
    if (!status.ok) {
      return this.montar('offline', 'O Codex CLI não conseguiu ler o perfil da pipeline.')
    }

    /*
     * **A quota é sempre `quota_unknown` nesta fatia, e isso é medição, não escolha.**
     *
     * Medido no CLI 0.149.0: os 24 checks de `codex doctor --json` não trazem quota, uso, rate
     * limit nem crédito — zero ocorrências. Sem telemetria oficial legível, a regra 2 da spec
     * manda `quota_unknown`, e a regra 1 proíbe inferir o dado de qualquer outra superfície.
     *
     * `ready` fica reservado para o dia em que existir telemetria dizendo que há saldo. Afirmá-lo
     * agora seria dizer "pronto e dentro do limite" sobre um limite que ninguém mediu.
     */
    return this.montar(QUOTA_DO_CODEX, await this.diagnosticoSeguro())
  }

  /**
   * Inicia o login pelo fluxo de dispositivo (critério 1).
   *
   * `--device-auth` e não o login interativo: o CLI imprime um código, o PI confirma no
   * navegador, e **o segredo nasce dentro do `CODEX_HOME`** — este processo nunca o vê. As
   * alternativas eram piores para o critério: `--with-api-key` e `--with-access-token` leem o
   * segredo do **stdin**, o que o faria passar por dentro deste processo.
   *
   * Devolve o que o CLI imprimiu (o código e a URL) para a tela mostrar ao PI. Isso é
   * instrução, não credencial — mas passa por `redigirSegredos` mesmo assim, pela mesma razão
   * que a M26-F03 estabeleceu: o que se afirma sobre uma saída tem de valer para toda ela, e não
   * para o formato que se espera dela.
   */
  async iniciarLogin(): Promise<{ readonly ok: boolean; readonly instrucao: string }> {
    const saida = await this.rodar(['login', '--device-auth'], TIMEOUT_LOGIN_MS)

    this.auditar('login', { ok: saida.ok })

    return {
      ok: saida.ok,
      instrucao: saida.ok
        ? redigirSegredos(saida.stdout.trim())
        : 'Não foi possível iniciar o login do Codex. Conferir se o binário `codex` está instalado e no PATH.'
    }
  }

  /**
   * Encerra a sessão do perfil da pipeline (critério 1; regra 5).
   *
   * A regra 5 é o que este método **não** faz: revogar impede novas execuções e **não apaga
   * evidência anterior**. O `logout` remove a credencial do `CODEX_HOME`; nenhum `AuditEvent`,
   * ledger ou trace é tocado — eles são a prova do que já aconteceu, e apagá-los ao desconectar
   * transformaria o logout numa ferramenta de encobrir rastro.
   */
  async logout(): Promise<boolean> {
    const saida = await this.rodar(['logout'], TIMEOUT_CONSULTA_MS)
    this.auditar('logout', { ok: saida.ok })
    return saida.ok
  }

  /**
   * Troca o modo de cobrança — **decisão do PI, auditada** (regra 4, critério 4).
   *
   * `habilitadoPeloPi` é parâmetro e não consulta interna pela razão que o `ContextPack`
   * estabeleceu no `AiRequest`: a autorização vira **assinatura**. Não existe forma de subir para
   * um modo que gasta dinheiro sem que o chamador declare a habilitação — e a decisão fica
   * legível no call site, em vez de depender de um estado que alguém possa ter deixado ligado.
   *
   * Recusa **não é auditada**, na régua do `RoutingService` e do `PhaseModelService`: registrar
   * uma troca que não aconteceu faria a auditoria mentir sobre o estado do sistema.
   */
  aplicarModo(novo: CodexBillingMode, habilitadoPeloPi: boolean): CodexBillingMode | undefined {
    if (!trocaDeModoPermitida(this.modo, novo, habilitadoPeloPi)) {
      log.ai.warn('Troca de modo de cobrança do Codex recusada: sem habilitação explícita', {
        de: this.modo,
        para: novo
      })
      return undefined
    }

    const anterior = this.modo
    this.modo = novo

    if (anterior !== novo) {
      this.auditar('modo-alterado', {
        de: anterior,
        para: novo,
        gastaDinheiro: modoGastaDinheiro(novo)
      })
    }

    return novo
  }

  get modoAtual(): CodexBillingMode {
    return this.modo
  }

  /**
   * O run pode começar? (critério 5)
   *
   * Delega ao domínio: a regra é pura, e tê-la aqui a tornaria intestável sem construir o
   * serviço inteiro. O que este método acrescenta é o **modo vigente** — o chamador não o
   * escolhe, senão o gate seria contornável passando outro modo.
   */
  podeExecutar(entrada: { readonly tetoUsd?: number; readonly gastoUsd: number }): {
    readonly permitida: boolean
    readonly motivo?: string
  } {
    return execucaoPermitida({ modo: this.modo, ...entrada })
  }

  /**
   * O diagnóstico que a tela pode mostrar (critério 6, e critério 3).
   *
   * Sai do `summary` dos checks do `doctor --json`, que a própria ferramenta emite **já
   * redigido** (medido: `"enabled feature flags": "<redacted>"`). Nunca dos `details`, que
   * carregam caminhos absolutos, nem do `stderr` cru — a mesma postura do `ClaudeCodeAdapter`,
   * onde o stderr fica fora da mensagem porque texto de erro é caminho clássico de vazamento.
   *
   * Falha de parse devolve `undefined`, não o texto cru: uma saída que não é o JSON esperado é
   * exatamente a que não se sabe o que carrega.
   */
  private async diagnosticoSeguro(): Promise<string | undefined> {
    const saida = await this.rodar(['doctor', '--json'], TIMEOUT_CONSULTA_MS)
    if (saida.stdout.trim() === '') return undefined

    try {
      const relatorio = JSON.parse(saida.stdout) as {
        readonly checks?: Record<string, { readonly status?: string; readonly summary?: string }>
      }
      const problemas = Object.values(relatorio.checks ?? {})
        .filter((c) => c.status === 'fail')
        .map((c) => c.summary)
        .filter((s): s is string => typeof s === 'string' && s !== '')

      // Redigido mesmo vindo já sanitizado pela ferramenta: a garantia do critério 3 é nossa, e
      // depender de o fornecedor continuar sanitizando é depender de decisão de terceiro. Custa
      // uma passagem de regex sobre texto curto.
      return problemas.length === 0 ? undefined : redigirSegredos(problemas.join('; '))
    } catch {
      return undefined
    }
  }

  /**
   * Cria o diretório do perfil, se ainda não existir.
   *
   * Idempotente (`recursive: true`) e silencioso na falha: se o disco recusar, o comando seguinte
   * falha com o motivo real do CLI, que é mais informativo do que uma exceção nossa aqui. O que
   * este método **não** faz é escrever qualquer coisa dentro — o conteúdo é da credencial que o
   * `codex login` grava, e que este processo nunca vê.
   */
  private garantirPerfil(): void {
    try {
      ;(this.deps.mkdirImpl ?? mkdirSync)(this.codexHome, { recursive: true })
    } catch {
      // O comando seguinte reporta o problema real.
    }
  }

  /** O script do CLI, resolvido uma vez por instância. Ver `scriptResolvido`. */
  private scriptDoCodex(): string | undefined {
    if (this.scriptResolvido === undefined) {
      this.scriptResolvido =
        localizarScriptDoCodex(this.deps.execSyncImpl ?? execSync, this.deps.existeImpl ?? existsSync) ??
        null
    }
    return this.scriptResolvido ?? undefined
  }

  private montar(saude: CodexHealthState, diagnostico?: string): CodexProfileState {
    return {
      saude,
      codexHome: this.codexHome,
      modo: this.modo,
      ...(diagnostico === undefined ? {} : { diagnostico }),
      verificadoEm: this.agora().toISOString()
    }
  }

  private auditar(acao: string, payload: Record<string, unknown>): void {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'codex-profile',
      // O `codexHome` entra porque é a referência opaca — o que permite auditar *qual* perfil foi
      // tocado. Nada de dentro dele entra, porque nada de dentro dele chega até aqui.
      payload: { acao, codexHome: this.codexHome, ...payload }
    })
  }

  /**
   * Roda o CLI com o perfil da pipeline apontado.
   *
   * As garantias são as mesmas do `ClaudeCodeAdapter`, e pela mesma razão: binário pinado,
   * `shell: false` (sem interpolação, então não há o que escapar), args montados aqui, e timeout
   * com `SIGKILL` pelo SO. A diferença é uma variável a mais no ambiente — `CODEX_HOME` — que é
   * o que faz este processo enxergar o perfil da pipeline e **não** o pessoal do PI.
   *
   * O `stderr` é lido e **descartado**: ele existe para não encher o buffer do pipe e travar o
   * processo, não para virar mensagem. Ver `diagnosticoSeguro`.
   */
  private async rodar(args: readonly string[], timeoutMs: number): Promise<SaidaDoCli> {
    // **O `CODEX_HOME` precisa existir antes** — medido: com o diretório ausente, o CLI responde
    // `Error loading configuration: CODEX_HOME points to ...` e sai com erro em **todo** comando.
    // Em produção o perfil nasce vazio, então sem esta linha a fatia inteira falharia no primeiro
    // uso. Criar é idempotente e não escreve nada dentro: quem povoa o diretório é o `codex
    // login`, com a credencial que este processo nunca vê.
    this.garantirPerfil()

    return await new Promise<SaidaDoCli>((resolve) => {
      let respondido = false
      let stdout = ''
      let stderr = ''

      const responder = (valor: SaidaDoCli): void => {
        if (respondido) return
        respondido = true
        resolve(valor)
      }

      try {
        const invocacao = resolverInvocacao(BINARIO_CODEX, args, () => this.scriptDoCodex())
        const processo = this.spawnImpl(invocacao.comando, [...invocacao.args], {
          cwd: this.deps.userDataDir,
          env: { ...ambienteControlado(), CODEX_HOME: this.codexHome },
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        processo.stdout?.on('data', (pedaco: Buffer) => {
          stdout += pedaco.toString('utf8')
        })
        // Capturado porque **é sinal de estado** neste CLI, não só diagnóstico: ver `SaidaDoCli`.
        processo.stderr?.on('data', (pedaco: Buffer) => {
          stderr += pedaco.toString('utf8')
        })

        const relogio = setTimeout(() => {
          processo.kill('SIGKILL')
          responder({ ok: false, stdout, stderr, exitCode: null })
        }, timeoutMs)

        // `error` cobre o caso mais comum — binário não instalado (ENOENT). Sem este ramo a
        // promessa nunca resolveria, e a tela ficaria carregando para sempre.
        processo.on('error', () => {
          clearTimeout(relogio)
          responder({ ok: false, stdout, stderr, exitCode: null })
        })

        processo.on('close', (codigo) => {
          clearTimeout(relogio)
          responder({ ok: codigo === 0, stdout, stderr, exitCode: codigo })
        })
      } catch {
        responder({ ok: false, stdout: '', stderr: '', exitCode: null })
      }
    })
  }
}
