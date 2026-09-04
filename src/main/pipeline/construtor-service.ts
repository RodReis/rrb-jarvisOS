/**
 * O orquestrador da construção e recuperação (SPEC-Entrega-04).
 *
 * A pergunta que este serviço responde: **dado um sandbox pronto, o que rodar, na ordem certa,
 * até três vezes, e para onde levar o run quando parar?**
 *
 * Roda **depois** do preflight (M9-F03, que já entrega `SandboxPreparado`) e **não** fala com o
 * `AiCallService` diretamente — o `claude` roda **dentro** do container via `docker exec`, e é o
 * próprio binário lá dentro que fala HTTP com o `ExecutorProxy` do host (`ANTHROPIC_BASE_URL`,
 * já injetado pelo `DockerRunner.subir()`). É isso que faz o critério 1 valer: nenhum prompt sai
 * do host como chamada de IA — só como `docker exec` de um binário que já está lá.
 *
 * **O que este serviço não faz:** não sobe container (M9-F03), não abre PR nem mergeia (M9-F05),
 * não decide o prompt de recuperação em detalhe — monta um resumo simples do diff/erro/histórico,
 * a instrução completa de "como corrigir" é trabalho do próprio Claude Code a partir disso.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { ComandosDeValidacao } from '@shared/domain/ci-workflow'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import { fugasDoEscopo, type SandboxPreparado } from '@shared/domain/preflight'
import {
  classificarFalha,
  proximaTentativaPermitida,
  type ClassificacaoDeFalha,
  type Tentativa
} from '@shared/domain/attempt'
import type { AuditRepository } from '../storage/audit-repository'
import { log } from '../logging/logger'
import type { DockerRunner, ExecucaoNoContainer } from './docker-runner'
import type { PipelineRepository } from './pipeline-repository'

/**
 * Os quatro comandos de validação, no vocabulário do projeto-alvo (spec: "test/lint/type/build").
 *
 * Definidos em `@shared/domain/ci-workflow` porque o gerador do workflow de CI (M9-F05) também
 * os consome, e `src/shared` não pode importar de `src/main`. Reexportados aqui para quem já
 * os importava deste módulo.
 */
export type { ComandosDeValidacao } from '@shared/domain/ci-workflow'

export interface PedidoDeConstrucao {
  readonly runId: string
  readonly sandbox: SandboxPreparado
  /** O prompt da tentativa inicial — SPEC/hashes, ContextPack, paths, orçamento (spec § Entrada). */
  readonly promptInicial: string
  readonly comandosDeValidacao: ComandosDeValidacao
  /** Cancelamento cooperativo: checado entre passos (critério 5). Ausente = não cancelável. */
  readonly signal?: AbortSignal
}

export interface ResultadoDaConstrucao {
  readonly estadoFinal: 'PR_CI' | 'BLOCKED'
  readonly tentativas: readonly Tentativa[]
  readonly bloqueio?: {
    readonly causa: ClassificacaoDeFalha
    readonly evidencia: string
    readonly retomada: string
  }
}

export class ConstrutorService {
  constructor(
    private readonly docker: DockerRunner,
    private readonly pipeline: PipelineRepository,
    private readonly audit: AuditRepository,
    private readonly userId: () => string,
    private readonly workspaceId: () => WorkspaceId,
    private readonly agora: () => Date = () => new Date()
  ) {}

  async construir(pedido: PedidoDeConstrucao): Promise<ResultadoDaConstrucao> {
    const tentativas: Tentativa[] = []
    let promptDaVez = pedido.promptInicial
    let numero = 1

    for (;;) {
      if (pedido.signal?.aborted === true) {
        this.docker.matarProcesso(pedido.sandbox.containerNome, pedido.sandbox.worktreeNoHost)
        return this.bloquear(
          pedido.runId,
          'RUNNING',
          tentativas,
          'externo',
          'Cancelado pelo usuário.'
        )
      }

      // (1) Invoca o `claude` dentro do container — o único ponto por onde o prompt entra.
      //
      // `--model` carrega o modelo da fase Construção (SPEC-Fases-05, critério 1). O id vem do
      // sandbox, **congelado pelo preflight** e já validado contra o catálogo — nunca de entrada
      // do usuário, e nunca resolvido aqui: resolver por tentativa faria uma edição de política
      // no meio do run trocar o modelo entre a tentativa 1 e a 2, e o ledger descreveria um run
      // que não aconteceu (critério 3). Por variável de ambiente não é possível: o
      // `ambienteControlado()` do MVP-004 não deixa variável alcançar o subprocess.
      const execucaoClaude = this.docker.exec(
        pedido.sandbox.containerNome,
        ['claude', '--model', pedido.sandbox.modeloDaConstrucao.modelo, '--print', promptDaVez],
        pedido.sandbox.worktreeNoHost
      )

      if (!execucaoClaude.ok) {
        const causa = classificarFalha(execucaoClaude)
        tentativas.push({
          numero,
          runId: pedido.runId,
          classificacao: causa,
          diagnostico: execucaoClaude.stderr
        })
        // Ainda em RUNNING aqui: a transição para VALIDATING (abaixo) não aconteceu.
        return this.bloquear(pedido.runId, 'RUNNING', tentativas, causa, execucaoClaude.stderr)
      }

      // (2) Move para VALIDATING e roda test/lint/type/build — **sempre no container** (critério 11).
      this.transicionar(pedido.runId, 'RUNNING', 'VALIDATING')
      const validacao = this.validar(pedido.sandbox, pedido.comandosDeValidacao, pedido.signal)

      if (validacao.ok) {
        const escopo = this.verificarEscopo(pedido.sandbox)
        if (!escopo.ok) {
          // Escopo lido com fuga é `risco-usuario` (o agente escreveu fora do declarado); escopo
          // que não pôde ser lido é `externo` (a ferramenta falhou). A distinção governa a
          // retomada, e trocá-las mandaria procurar um arquivo indevido que não existe.
          const causa: ClassificacaoDeFalha = escopo.verificavel ? 'risco-usuario' : 'externo'
          tentativas.push({
            numero,
            runId: pedido.runId,
            classificacao: causa,
            diagnostico: escopo.evidencia
          })
          return this.bloquear(pedido.runId, 'VALIDATING', tentativas, causa, escopo.evidencia)
        }

        tentativas.push({ numero, runId: pedido.runId })
        this.transicionar(pedido.runId, 'VALIDATING', 'PR_CI')
        return { estadoFinal: 'PR_CI', tentativas }
      }

      if (validacao.cancelado) {
        return this.bloquear(
          pedido.runId,
          'VALIDATING',
          tentativas,
          'externo',
          'Cancelado pelo usuário.'
        )
      }

      const causa = classificarFalha(validacao.falha)
      tentativas.push({
        numero,
        runId: pedido.runId,
        classificacao: causa,
        diagnostico: validacao.falha.stderr
      })

      // Falha externa não gasta ciclo de correção: recuperar com o mesmo código não muda o
      // desfecho de um serviço fora do ar (spec § Classificação).
      if (causa !== 'corrigivel') {
        return this.bloquear(pedido.runId, 'VALIDATING', tentativas, causa, validacao.falha.stderr)
      }

      if (!proximaTentativaPermitida(numero)) {
        return this.bloquear(pedido.runId, 'VALIDATING', tentativas, causa, validacao.falha.stderr)
      }

      // (3) Recuperação: volta a RUNNING com prompt resumido (delta + erro novo), nunca releitura
      // integral do repositório (spec § Regras: "não relê o repositório inteiro por padrão").
      this.transicionar(pedido.runId, 'VALIDATING', 'RUNNING')
      promptDaVez = promptDeRecuperacao(validacao.falha, tentativas)
      numero += 1
    }
  }

  private validar(
    sandbox: SandboxPreparado,
    comandos: ComandosDeValidacao,
    signal?: AbortSignal
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly cancelado: true }
    | { readonly ok: false; readonly cancelado?: false; readonly falha: ExecucaoNoContainer } {
    const passos: readonly (readonly string[])[] = [
      comandos.test,
      comandos.lint,
      comandos.typecheck,
      comandos.build
    ]

    for (const passo of passos) {
      if (signal?.aborted === true) {
        this.docker.matarProcesso(sandbox.containerNome, sandbox.worktreeNoHost)
        return { ok: false, cancelado: true }
      }
      const execucao = this.docker.exec(sandbox.containerNome, passo, sandbox.worktreeNoHost)
      if (!execucao.ok) return { ok: false, falha: execucao }
    }

    return { ok: true }
  }

  /**
   * Cancela a construção em andamento: mata os processos do container, sem parar o sandbox.
   * O laço em `construir` também checa `signal` entre passos — este método é para quem não
   * está esperando o próximo passo (ex.: handler de IPC do botão "Cancelar" na tela).
   */
  cancelar(_runId: string, sandbox: SandboxPreparado): void {
    this.docker.matarProcesso(sandbox.containerNome, sandbox.worktreeNoHost)
  }

  /**
   * O trabalho do agente ficou dentro do escopo declarado no preflight? (critério 4)
   *
   * `git status --porcelain --untracked-files=all` roda **dentro do container** — mesma
   * fronteira do critério 8, sem caminho de leitura no host. Reusa `fugasDoEscopo` (mesma
   * função do preflight) para não ter duas implementações divergentes da mesma regra de match
   * de path.
   *
   * **`-c core.quotepath=false`:** com `core.quotepath` ligado (padrão do Git), um path com
   * caractere non-ASCII sai quotado e escapado em octal (`"src/a\303\247\303\243o.ts"`).
   * `JSON.parse` em `desaspar` não entende esse escape, o `catch` devolve a string crua **com
   * as aspas**, e a aspa vira o primeiro segmento do path — que passa a não bater com nenhum
   * prefixo do escopo e é reportado como fuga espúria. Desligar `quotepath` faz o Git emitir o
   * path cru em UTF-8, sem quoting.
   *
   * **Por que `status`, não `diff`:** o worktree do run nunca passa por `git add` — nada em
   * `ConstrutorService` faz isso. `git diff --name-only` só enxerga arquivo **modificado e
   * rastreado**; um arquivo **novo e não commitado** (o caso mais natural de um agente
   * escrevendo código fora do escopo, ex.: `segredo/backdoor.ts`) fica fora do diff e passaria
   * a checagem sem ser visto. `git status --porcelain` cobre modificado + novo + staged na
   * mesma chamada. Verificado com Git real (ver `construtor-service.int-spec.ts`).
   *
   * **`.gitignore` não é explicitamente excluído** (sem `--ignored`): `git status --porcelain`
   * já omite arquivo ignorado por padrão, então não há flag extra a decidir aqui — ao contrário
   * de `git ls-files --others`, que precisaria de `--exclude-standard` para o mesmo efeito.
   * Isso significa que um agente que escreve no próprio `.gitignore` para esconder um arquivo
   * da checagem escreveria uma alteração no `.gitignore`, e o `.gitignore` em si só está fora
   * de vista se ele próprio estiver dentro do escopo permitido — um escopo como `src` não cobre
   * a raiz do repo, então mexer no `.gitignore` da raiz já cai fora do escopo e bloqueia por
   * essa via.
   */
  private verificarEscopo(sandbox: SandboxPreparado):
    | { readonly ok: true }
    | {
        readonly ok: false
        /** `false` quando o escopo não pôde ser lido; `true` quando foi lido e há fuga. */
        readonly verificavel: boolean
        readonly evidencia: string
      } {
    const status = this.docker.exec(
      sandbox.containerNome,
      ['git', '-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'],
      sandbox.worktreeNoHost
    )
    // **Sem status legível, bloqueia** (decisão do PI, 2026-09-02; era fail-open, pendente desde a
    // M9-F04). A `ARCHITECTURE.md` § Segurança já decidia o princípio — "ação não reconhecida pela
    // política é bloqueada, não permitida" —, e um `git status` que não responde é exatamente isso:
    // não se sabe o que o agente tocou. Fail-open deixava um container degradado publicar sem
    // ninguém ter verificado o escopo, o oposto do critério 1 da M9-F05.
    //
    // Quem classifica como `externo` é o chamador, pelo campo `verificavel`: a ferramenta falhou,
    // o agente não errou. Rotular de `risco-usuario` mandaria procurar um arquivo indevido que não
    // existe.
    if (!status.ok) {
      return {
        ok: false,
        verificavel: false,
        evidencia:
          `Não foi possível verificar o escopo: o git status do container falhou. ${status.stderr}`.trim()
      }
    }

    const arquivos = arquivosTocados(status.stdout)
    const foraDoEscopo = fugasDoEscopo(arquivos, sandbox.pathsPermitidos)

    if (foraDoEscopo.length > 0) {
      return {
        ok: false,
        verificavel: true,
        evidencia: `Alteração fora do escopo declarado: ${foraDoEscopo.join(', ')}`
      }
    }
    return { ok: true }
  }

  private bloquear(
    runId: string,
    de: Parameters<PipelineRepository['transicionar']>[1],
    tentativas: readonly Tentativa[],
    causa: ClassificacaoDeFalha,
    evidencia: string
  ): ResultadoDaConstrucao {
    const retomada = retomadaPara(causa)
    const bloqueio: BloqueioExterno = {
      causa,
      evidencia,
      tentativas: tentativas.length,
      porQueNaoSeguir: porQueNaoSeguirPara(causa),
      retomada
    }
    this.transicionar(runId, de, 'BLOCKED', bloqueio)
    return { estadoFinal: 'BLOCKED', tentativas, bloqueio: { causa, evidencia, retomada } }
  }

  private transicionar(
    runId: string,
    de: Parameters<PipelineRepository['transicionar']>[1],
    para: Parameters<PipelineRepository['transicionar']>[2],
    bloqueio?: BloqueioExterno
  ): void {
    const ok = this.pipeline.transicionar(runId, de, para, this.agora(), bloqueio)
    this.audit.append({
      user_id: this.userId(),
      workspace_id: this.workspaceId(),
      type: 'pipeline-transition',
      payload: { runId, de, para, aplicada: ok }
    })
    if (!ok) {
      log.agent.warn('Transição de pipeline recusada pelo compare-and-set', { runId, de, para })
    }
  }
}

/** A ação mínima que destrava o bloqueio, por classificação (critério 7). */
function retomadaPara(causa: ClassificacaoDeFalha): string {
  switch (causa) {
    case 'corrigivel':
      return 'As três tentativas esgotaram sem passar na validação. Revisar o diagnóstico da última tentativa e decidir se a SPEC precisa de ajuste antes de retomar.'
    case 'externo':
      return 'Falha de conectividade, autenticação ou quota externa. Verificar o serviço e retomar a fatia quando ele responder.'
    case 'pi':
      return 'A construção encontrou uma decisão de produto não coberta pela SPEC. Aguardar orientação do PI antes de retomar.'
    case 'risco-usuario':
      return 'A alteração saiu do escopo declarado. Revisar o diff e decidir se o escopo da SPEC precisa mudar, ou se o executor deve ser retomado com o escopo original.'
  }
}

/** Por que seguir em frente seria incorreto, por classificação — o quinto campo do BloqueioExterno. */
function porQueNaoSeguirPara(causa: ClassificacaoDeFalha): string {
  switch (causa) {
    case 'corrigivel':
      return 'Seguir sem passar na validação publicaria código que não atende ao próprio critério que a fatia definiu como pronto.'
    case 'externo':
      return 'Sem o serviço externo respondendo, uma nova tentativa reproduz a mesma falha — não há o que o código consiga corrigir sozinho.'
    case 'pi':
      return 'A decisão pendente é de produto, não de implementação — decidir sozinho aqui seria inventar escopo que a SPEC não definiu.'
    case 'risco-usuario':
      return 'A alteração já saiu do escopo declarado no preflight; continuar arriscaria sobrescrever trabalho fora da fronteira autorizada.'
  }
}

/**
 * O prompt da recuperação: diff atual, erro novo, histórico resumido — nunca releitura integral.
 *
 * Resumo simples de propósito: o `claude` dentro do container já tem o worktree montado e pode
 * inspecionar o próprio diff; o que este prompt precisa dar é o **erro que apareceu agora** e o
 * que já foi tentado, para não repetir descoberta resolvida (critério 3).
 */
function promptDeRecuperacao(falha: ExecucaoNoContainer, historico: readonly Tentativa[]): string {
  const tentativasAnteriores = historico
    .map(
      (t) =>
        `Tentativa ${t.numero}: ${t.classificacao ?? 'validação falhou'} — ${t.diagnostico ?? ''}`
    )
    .join('\n')

  return [
    'A validação da tentativa anterior falhou. Corrija o problema abaixo sem repetir descobertas já registradas.',
    '',
    'Erro atual:',
    falha.stderr || falha.stdout,
    '',
    'Histórico de tentativas nesta fatia:',
    tentativasAnteriores
  ].join('\n')
}

/**
 * Extrai os paths tocados de `git status --porcelain --untracked-files=all`.
 *
 * Formato de cada linha: 2 caracteres de status + espaço + path (`XY path`). Trata dois casos
 * fora do comum:
 * - **Rename** (`R  origem -> destino`): reporta os dois lados — a origem também "tocou" o
 *   diff (deixou de existir onde estava), e é mais seguro nomear os dois do que só o destino.
 * - **Path entre aspas**: o Git aspa e escapa o path quando ele tem caractere especial
 *   (espaço, unicode incomum); `JSON.parse` desfaz o escape porque o formato é o mesmo do C
 *   que o `core.quotepath` do Git usa.
 */
function arquivosTocados(saidaPorcelain: string): readonly string[] {
  const linhas = saidaPorcelain
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l !== '')
  const arquivos: string[] = []

  for (const linha of linhas) {
    // XY + espaço obrigatório antes do path (formato `--porcelain` v1, estável entre versões).
    const resto = linha.slice(3)
    const partes = resto.split(' -> ')
    for (const parte of partes) {
      arquivos.push(desaspar(parte))
    }
  }

  return arquivos
}

function desaspar(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      return JSON.parse(path) as string
    } catch {
      return path
    }
  }
  return path
}
