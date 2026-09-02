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
import type { SandboxPreparado } from '@shared/domain/preflight'
import { classificarFalha, proximaTentativaPermitida, type ClassificacaoDeFalha, type Tentativa } from '@shared/domain/attempt'
import type { AuditRepository } from '../storage/audit-repository'
import { log } from '../logging/logger'
import type { DockerRunner, ExecucaoNoContainer } from './docker-runner'
import type { PipelineRepository } from './pipeline-repository'

/** Os quatro comandos de validação, no vocabulário do projeto-alvo (spec: "test/lint/type/build"). */
export interface ComandosDeValidacao {
  readonly test: readonly string[]
  readonly lint: readonly string[]
  readonly typecheck: readonly string[]
  readonly build: readonly string[]
}

export interface PedidoDeConstrucao {
  readonly runId: string
  readonly sandbox: SandboxPreparado
  /** O prompt da tentativa inicial — SPEC/hashes, ContextPack, paths, orçamento (spec § Entrada). */
  readonly promptInicial: string
  readonly comandosDeValidacao: ComandosDeValidacao
}

export interface ResultadoDaConstrucao {
  readonly estadoFinal: 'PR_CI' | 'BLOCKED'
  readonly tentativas: readonly Tentativa[]
  readonly bloqueio?: { readonly causa: ClassificacaoDeFalha; readonly evidencia: string }
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
      // (1) Invoca o `claude` dentro do container — o único ponto por onde o prompt entra.
      const execucaoClaude = this.docker.exec(
        pedido.sandbox.containerNome,
        ['claude', '--print', promptDaVez],
        pedido.sandbox.worktreeNoHost
      )

      if (!execucaoClaude.ok) {
        const causa = classificarFalha(execucaoClaude)
        tentativas.push({ numero, runId: pedido.runId, classificacao: causa, diagnostico: execucaoClaude.stderr })
        // Ainda em RUNNING aqui: a transição para VALIDATING (abaixo) não aconteceu.
        return this.bloquear(pedido.runId, 'RUNNING', tentativas, causa, execucaoClaude.stderr)
      }

      // (2) Move para VALIDATING e roda test/lint/type/build — **sempre no container** (critério 11).
      this.transicionar(pedido.runId, 'RUNNING', 'VALIDATING')
      const validacao = this.validar(pedido.sandbox, pedido.comandosDeValidacao)

      if (validacao.ok) {
        tentativas.push({ numero, runId: pedido.runId })
        this.transicionar(pedido.runId, 'VALIDATING', 'PR_CI')
        return { estadoFinal: 'PR_CI', tentativas }
      }

      const causa = classificarFalha(validacao.falha)
      tentativas.push({ numero, runId: pedido.runId, classificacao: causa, diagnostico: validacao.falha.stderr })

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
    comandos: ComandosDeValidacao
  ): { readonly ok: true } | { readonly ok: false; readonly falha: ExecucaoNoContainer } {
    const passos: readonly (readonly string[])[] = [comandos.test, comandos.lint, comandos.typecheck, comandos.build]

    for (const passo of passos) {
      const execucao = this.docker.exec(sandbox.containerNome, passo, sandbox.worktreeNoHost)
      if (!execucao.ok) return { ok: false, falha: execucao }
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
    this.transicionar(runId, de, 'BLOCKED')
    return { estadoFinal: 'BLOCKED', tentativas, bloqueio: { causa, evidencia } }
  }

  private transicionar(runId: string, de: Parameters<PipelineRepository['transicionar']>[1], para: Parameters<PipelineRepository['transicionar']>[2]): void {
    const ok = this.pipeline.transicionar(runId, de, para, this.agora())
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

/**
 * O prompt da recuperação: diff atual, erro novo, histórico resumido — nunca releitura integral.
 *
 * Resumo simples de propósito: o `claude` dentro do container já tem o worktree montado e pode
 * inspecionar o próprio diff; o que este prompt precisa dar é o **erro que apareceu agora** e o
 * que já foi tentado, para não repetir descoberta resolvida (critério 3).
 */
function promptDeRecuperacao(falha: ExecucaoNoContainer, historico: readonly Tentativa[]): string {
  const tentativasAnteriores = historico
    .map((t) => `Tentativa ${t.numero}: ${t.classificacao ?? 'validação falhou'} — ${t.diagnostico ?? ''}`)
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
