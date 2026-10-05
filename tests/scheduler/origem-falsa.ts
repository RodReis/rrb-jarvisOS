/**
 * O GitHub falso do E2E concorrente (SPEC-Scheduler-05, PR-C): um repositório com **estado**.
 *
 * Os dublês das fatias anteriores respondem a uma sequência; este responde ao que a origem real
 * responderia a **dois PRs ao mesmo tempo**, e é isso que torna as garantias observáveis de fora:
 *
 *  - a base é uma só e **anda** a cada squash merge (o commit do merge vira a base);
 *  - um PR que não contém a base atual **é mergeado mesmo assim**, e fica registrado em
 *    `mergesAtrasados`: o merge autônomo roda como o dono (`enforce_admins: false`) e o admin passa
 *    pela exigência `strict`. A origem não protege — quem impede o merge sobre uma base que o CI do
 *    PR nunca viu é a pipeline, e o teste a pega pela lista;
 *  - o CI é do **commit**: atualizar a branch dá outro head, e o CI dele recomeça;
 *  - `mergesEmVoo` mede quantos merges estiveram ao mesmo tempo na origem (a serialização é
 *    afirmada pelo máximo, não por ordem de chegada).
 *
 * As respostas têm o formato exato do adapter real (`github-operations.ts`): `checks.for-head`
 * devolve o **array**, `pr.merge-state` só traz `mergeSha` quando `merged` é `true`.
 */

import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import { NOME_DO_JOB_DE_CI } from '@shared/domain/ci-workflow'
import {
  GITHUB_OPERATIONS,
  MENSAGEM_DE_CONFLITO_NA_ATUALIZACAO
} from '@shared/domain/github-automation'

export interface PrFalso {
  readonly numero: number
  readonly head: string
  headSha: string
  /** A base que o PR contém. Diferente da base da origem, o PR está atrás dela. */
  baseContida: string
  estado: 'open' | 'closed'
  merged: boolean
  mergeSha?: string
  rascunho: boolean
  /** Os commits cujo CI fechou verde. */
  readonly ciVerde: Set<string>
  /** Os commits com CI em curso: quantas consultas faltam para fechar verde. */
  readonly ciEmCurso: Map<string, number>
  conflitoNaAtualizacao: boolean
}

export type Falha = 'indisponivel' | 'credencial'

const proveniencia = (operation: string): ConnectorOutcome['provenance'] =>
  ({ connector: 'github', operation, obtidoEm: 'agora' }) as ConnectorOutcome['provenance']

const ok = (operation: string, data: unknown): ConnectorOutcome =>
  ({
    ok: true,
    data,
    criado: false,
    provenance: proveniencia(operation),
    usage: { creditos: 0, latenciaMs: 1 }
  }) as unknown as ConnectorOutcome

const recusa = (
  operation: string,
  code: string,
  mensagem: string,
  retryable: boolean,
  acao: string
): ConnectorOutcome =>
  ({
    ok: false,
    code,
    mensagem,
    retryable,
    acao,
    provenance: proveniencia(operation)
  }) as unknown as ConnectorOutcome

/** Quantas consultas o CI de um commit novo leva para fechar: ele não nasce verde. */
const CONSULTAS_DO_CI_NOVO = 2

export class OrigemFalsa {
  /** Declarado antes de `baseSha`: o inicializador dela já gera um sha. */
  private contador = 0
  baseSha = this.novoSha()
  readonly prs = new Map<number, PrFalso>()
  readonly chamadas: { readonly operation: string; readonly input: Record<string, unknown> }[] = []
  /** Os merges na ordem em que a origem os aplicou. */
  readonly merges: { readonly numero: number; readonly mergeSha: string }[] = []
  /** Os PRs mergeados sem conter a base que a origem tinha na hora: o merge que ninguém testou. */
  readonly mergesAtrasados: number[] = []
  mergesEmVoo = 0
  maxMergesEmVoo = 0
  /** Falhas injetadas: a próxima N chamadas da operação respondem com o erro. */
  private readonly falhas = new Map<string, { restantes: number; tipo: Falha }>()
  /** CI verde no ato, para os cenários em que o CI não é o assunto. */
  ciAutomatico = false
  private readonly prPorHead = new Map<string, number>()

  novoSha(): string {
    this.contador += 1
    return this.contador.toString(16).padStart(40, '0')
  }

  /** As próximas `vezes` chamadas de `operation` falham (a origem fora do ar, a credencial recusada). */
  falhar(operation: string, tipo: Falha = 'indisponivel', vezes = 1): void {
    this.falhas.set(operation, { restantes: vezes, tipo })
  }

  porHead(head: string): PrFalso | undefined {
    const numero = this.prPorHead.get(head)
    return numero === undefined ? undefined : this.prs.get(numero)
  }

  /** O CI do head atual do PR fechou verde. */
  liberarCi(numero: number): void {
    const pr = this.prs.get(numero)
    if (pr !== undefined) pr.ciVerde.add(pr.headSha)
  }

  chamadasDe(operation: string): { readonly input: Record<string, unknown> }[] {
    return this.chamadas.filter((c) => c.operation === operation)
  }

  /** Quantos PRs a origem tem aberto ou mergeado: o que prova que ninguém duplicou. */
  get totalDePrs(): number {
    return this.prs.size
  }

  async responder(request: ConnectorRequest): Promise<ConnectorOutcome> {
    const input = (request.input ?? {}) as Record<string, unknown>
    const operation = request.operation
    this.chamadas.push({ operation, input })

    const injetada = this.falhas.get(operation)
    if (injetada !== undefined && injetada.restantes > 0) {
      injetada.restantes -= 1
      return injetada.tipo === 'credencial'
        ? recusa(operation, 'credencial-recusada', 'x', false, 'reautenticar')
        : recusa(operation, 'indisponivel', 'x', true, 'retentar')
    }

    switch (operation) {
      case GITHUB_OPERATIONS.ensurePullRequest:
        return this.garantirPr(input)
      case GITHUB_OPERATIONS.getRequiredChecks:
        return ok(operation, {
          branch: String(input.branch),
          contexts: [NOME_DO_JOB_DE_CI],
          strict: true,
          protegida: true,
          mergeQueueExigida: false
        })
      case GITHUB_OPERATIONS.ensureBranchProtection:
        return ok(operation, { branch: input.branch, revisoesExigidas: input.revisoesExigidas })
      case GITHUB_OPERATIONS.getRulesForBranch:
        return ok(operation, {
          contextsExigidos: [],
          mergeQueue: false,
          exigePullRequest: false,
          tipos: []
        })
      case GITHUB_OPERATIONS.getCommitSha:
        return this.shaDaRef(String(input.ref))
      case GITHUB_OPERATIONS.getChecksForHead:
        return this.checksDoHead(String(input.sha))
      case GITHUB_OPERATIONS.getMergeState:
        return this.estadoDoPr(Number(input.pullRequest))
      case GITHUB_OPERATIONS.updateBranch:
        return this.atualizarBranch(Number(input.pullRequest), String(input.expectedHeadSha))
      case GITHUB_OPERATIONS.squashMerge:
        return await this.mergear(Number(input.pullRequest), String(input.expectedHeadSha))
      case GITHUB_OPERATIONS.convertToDraft:
        return this.converterEmRascunho(Number(input.pullRequest))
      default:
        return ok(operation, {})
    }
  }

  private garantirPr(input: Record<string, unknown>): ConnectorOutcome {
    const head = String(input.head)
    const existente = this.porHead(head)
    if (existente !== undefined) {
      return ok(GITHUB_OPERATIONS.ensurePullRequest, {
        numero: existente.numero,
        id: 100 + existente.numero,
        titulo: String(input.title),
        criado: false
      })
    }
    const numero = this.prs.size + 1
    this.prPorHead.set(head, numero)
    this.prs.set(numero, {
      numero,
      head,
      headSha: this.novoSha(),
      baseContida: this.baseSha,
      estado: 'open',
      merged: false,
      rascunho: false,
      ciVerde: new Set(),
      ciEmCurso: new Map(),
      conflitoNaAtualizacao: false
    })
    return ok(GITHUB_OPERATIONS.ensurePullRequest, {
      numero,
      id: 100 + numero,
      titulo: String(input.title),
      criado: true
    })
  }

  private shaDaRef(ref: string): ConnectorOutcome {
    const sha = ref === 'main' ? this.baseSha : (this.porHead(ref)?.headSha ?? '')
    return ok(GITHUB_OPERATIONS.getCommitSha, { ref, sha })
  }

  private checksDoHead(sha: string): ConnectorOutcome {
    const pr = [...this.prs.values()].find((p) => p.headSha === sha)
    if (pr === undefined) return ok(GITHUB_OPERATIONS.getChecksForHead, [])

    if (this.ciAutomatico) pr.ciVerde.add(sha)
    const restantes = pr.ciEmCurso.get(sha)
    if (restantes !== undefined) {
      if (restantes <= 1) {
        pr.ciEmCurso.delete(sha)
        pr.ciVerde.add(sha)
      } else {
        pr.ciEmCurso.set(sha, restantes - 1)
      }
    }
    const verde = pr.ciVerde.has(sha)
    return ok(GITHUB_OPERATIONS.getChecksForHead, [
      {
        nome: NOME_DO_JOB_DE_CI,
        headSha: sha,
        status: verde ? 'completed' : 'in_progress',
        ...(verde ? { conclusao: 'success' } : {})
      }
    ])
  }

  private estadoDoPr(numero: number): ConnectorOutcome {
    const pr = this.prs.get(numero)
    if (pr === undefined) {
      return recusa(
        GITHUB_OPERATIONS.getMergeState,
        'nao-encontrado',
        'x',
        false,
        'corrigir-entrada'
      )
    }
    return ok(GITHUB_OPERATIONS.getMergeState, {
      numero,
      estado: pr.estado,
      merged: pr.merged,
      // `mergeSha` só sai com `merged: true` — em PR aberto seria um *test merge commit*.
      ...(pr.merged && pr.mergeSha !== undefined ? { mergeSha: pr.mergeSha } : {}),
      headSha: pr.headSha,
      // O que a comparação base...head diria: 0 em dia; só em PR aberto, como o adapter.
      ...(pr.estado === 'open' ? { atrasadoPor: pr.baseContida === this.baseSha ? 0 : 1 } : {})
    })
  }

  private atualizarBranch(numero: number, expectedHeadSha: string): ConnectorOutcome {
    const op = GITHUB_OPERATIONS.updateBranch
    const pr = this.prs.get(numero)
    if (pr === undefined) return recusa(op, 'nao-encontrado', 'x', false, 'corrigir-entrada')
    if (pr.conflitoNaAtualizacao) {
      return recusa(
        op,
        'validacao-invalida',
        `${MENSAGEM_DE_CONFLITO_NA_ATUALIZACAO} detalhe`,
        false,
        'corrigir-entrada'
      )
    }
    if (expectedHeadSha !== pr.headSha) {
      return recusa(
        op,
        'validacao-invalida',
        'Head branch was modified.',
        false,
        'corrigir-entrada'
      )
    }
    // A base entra na branch: o head **muda**, e o CI do commit novo recomeça.
    pr.headSha = this.novoSha()
    pr.baseContida = this.baseSha
    pr.ciEmCurso.set(pr.headSha, CONSULTAS_DO_CI_NOVO)
    return ok(op, { aceito: true })
  }

  private async mergear(numero: number, expectedHeadSha: string): Promise<ConnectorOutcome> {
    const op = GITHUB_OPERATIONS.squashMerge
    this.mergesEmVoo += 1
    this.maxMergesEmVoo = Math.max(this.maxMergesEmVoo, this.mergesEmVoo)
    try {
      // Um instante dentro da seção crítica: dois merges simultâneos se sobreporiam aqui.
      await new Promise((resolver) => setTimeout(resolver, 1))

      const pr = this.prs.get(numero)
      if (pr === undefined) return recusa(op, 'nao-encontrado', 'x', false, 'corrigir-entrada')
      if (pr.estado !== 'open')
        return recusa(op, 'validacao-invalida', 'PR not open', false, 'corrigir-entrada')
      if (expectedHeadSha !== pr.headSha) {
        return recusa(
          op,
          'validacao-invalida',
          'Head branch was modified.',
          false,
          'corrigir-entrada'
        )
      }
      if (!pr.ciVerde.has(pr.headSha)) {
        return recusa(
          op,
          'validacao-invalida',
          'Required status check is expected.',
          false,
          'corrigir-entrada'
        )
      }

      if (pr.baseContida !== this.baseSha) this.mergesAtrasados.push(numero)
      pr.merged = true
      pr.estado = 'closed'
      pr.mergeSha = this.novoSha()
      // O squash vira o commit da base: quem estava atrás dela agora está atrás deste também.
      this.baseSha = pr.mergeSha
      this.merges.push({ numero, mergeSha: pr.mergeSha })
      return ok(op, { mergeSha: pr.mergeSha, merged: true })
    } finally {
      this.mergesEmVoo -= 1
    }
  }

  private converterEmRascunho(numero: number): ConnectorOutcome {
    const op = GITHUB_OPERATIONS.convertToDraft
    const pr = this.prs.get(numero)
    if (pr === undefined) return recusa(op, 'nao-encontrado', 'x', false, 'corrigir-entrada')
    if (pr.estado !== 'open' || pr.merged) {
      return ok(op, { rascunho: false, jaEra: false, motivo: 'pr-nao-aberto' })
    }
    const jaEra = pr.rascunho
    pr.rascunho = true
    return ok(op, { rascunho: true, jaEra })
  }
}
