import { createHash } from 'node:crypto'
import {
  CONTROLES_OPERACIONAIS,
  type AcaoDeControle,
  type ComandoDeControle,
  type ControleOperacional,
  type EscopoDeControle,
  type ResultadoDeControle,
  type SnapshotDeControles
} from '@shared/domain/continuous-controls'
import type { AuditRepository } from '../storage/audit-repository'
import {
  ContinuousControlsRepository,
  type ChaveDeControle
} from './continuous-controls-repository'

export interface ContinuousControlsDeps {
  readonly repository: ContinuousControlsRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly agora?: () => Date
}

export class ContinuousControlsService {
  private readonly agora: () => Date
  private execucao?: {
    readonly ativosDoEscopo: (
      escopo: EscopoDeControle
    ) => readonly { readonly runId: string; readonly projectId: string }[]
    readonly cancelarRun: (
      projectId: string,
      workspaceId: EscopoDeControle['workspaceId'],
      runId: string
    ) => Promise<unknown> | undefined
  }

  constructor(private readonly deps: ContinuousControlsDeps) {
    this.agora = deps.agora ?? (() => new Date())
  }

  configureExecutionCancellation(
    execucao: NonNullable<ContinuousControlsService['execucao']>
  ): void {
    this.execucao = execucao
  }

  snapshot(escopo: EscopoDeControle): SnapshotDeControles {
    const workspace = { userId: escopo.userId, workspaceId: escopo.workspaceId }
    const globais = new Map<ChaveDeControle, { valor: boolean; actor: string; updatedAt: string }>(
      this.deps.repository
        .listarWorkspace(workspace)
        .map((row) => [
          row.chave,
          { valor: row.valor === 1, actor: row.actor, updatedAt: row.updated_at }
        ])
    )
    const locais =
      escopo.projectId === undefined
        ? new Map<ChaveDeControle, { valor: boolean; actor: string; updatedAt: string }>()
        : new Map(
            this.deps.repository
              .listar(escopo)
              .map((row) => [
                row.chave,
                { valor: row.valor === 1, actor: row.actor, updatedAt: row.updated_at }
              ])
          )
    const pausaProjeto = locais.get('pausa')
    const pausaWorkspace = globais.get('pausa')
    const pausada = pausaProjeto?.valor === true || pausaWorkspace?.valor === true
    const controles = Object.fromEntries(
      CONTROLES_OPERACIONAIS.map((chave) => {
        const local = locais.get(chave)
        const global = globais.get(chave)
        return [
          chave,
          {
            enabled: local?.valor ?? global?.valor ?? true,
            ...((local ?? global)
              ? { actor: (local ?? global)!.actor, updatedAt: (local ?? global)!.updatedAt }
              : {}),
            herdado: local === undefined && global !== undefined
          }
        ]
      })
    ) as SnapshotDeControles['controles']
    const latest = [...globais.values(), ...locais.values()]
      .map((row) => row.updatedAt)
      .sort()
      .at(-1)
    return {
      escopo: escopo.projectId === undefined ? 'workspace' : 'projeto',
      ...(escopo.projectId === undefined ? {} : { projetoId: escopo.projectId }),
      pausa: {
        pausada,
        drenando: pausada && (this.execucao?.ativosDoEscopo(escopo).length ?? 0) > 0,
        noEscopoAtual:
          escopo.projectId === undefined
            ? (pausaWorkspace?.valor ?? false)
            : (pausaProjeto?.valor ?? false),
        noWorkspace: pausaWorkspace?.valor ?? false
      },
      controles,
      ...(latest === undefined ? {} : { updatedAt: latest }),
      ativos: this.execucao?.ativosDoEscopo(escopo) ?? []
    }
  }

  habilitado(escopo: EscopoDeControle, controle: ControleOperacional): boolean {
    const projeto =
      escopo.projectId === undefined ? undefined : this.deps.repository.buscar(escopo, controle)
    const workspace = this.deps.repository.buscarWorkspace(
      { userId: escopo.userId, workspaceId: escopo.workspaceId },
      controle
    )
    return projeto?.valor ?? workspace?.valor ?? true
  }

  pausada(escopo: EscopoDeControle): boolean {
    const projeto =
      escopo.projectId === undefined ? undefined : this.deps.repository.buscar(escopo, 'pausa')
    const workspace = this.deps.repository.buscarWorkspace(
      { userId: escopo.userId, workspaceId: escopo.workspaceId },
      'pausa'
    )
    return projeto?.valor === true || workspace?.valor === true
  }

  async aplicar(comando: ComandoDeControle): Promise<ResultadoDeControle> {
    if (comando.escopo.userId !== this.deps.userId())
      return { status: 'invalid', message: 'Usuário fora do escopo atual.' }
    if (!comando.idempotencyKey.trim() || comando.idempotencyKey.length > 200)
      return { status: 'invalid', message: 'Chave de idempotência inválida.' }
    const { escopo, acao } = comando
    const fingerprint = createHash('sha256').update(JSON.stringify({ escopo, acao })).digest('hex')
    const anterior = this.deps.repository.comando(escopo, comando.idempotencyKey)
    if (anterior !== undefined) {
      if (anterior.fingerprint !== fingerprint)
        return {
          status: 'idempotency-conflict',
          message: 'A chave já foi usada para outro comando.'
        }
      if (acao.tipo === 'switch' && acao.controle === 'execucao' && acao.habilitado === false)
        await this.cancelarRunsAtivos(escopo)
      return this.comAtualizado(JSON.parse(anterior.resultado) as ResultadoDeControle, escopo)
    }
    const chave: ChaveDeControle = acao.tipo === 'pausa' ? 'pausa' : acao.controle
    const valor: boolean | null =
      acao.tipo === 'pausa'
        ? escopo.projectId !== undefined && acao.pausada === false
          ? null
          : acao.pausada
        : acao.habilitado
    const current = this.deps.repository.buscar(escopo, chave)
    const herdado = escopo.projectId !== undefined && current === undefined
    const efetivo =
      acao.tipo === 'pausa' ? this.pausada(escopo) : this.habilitado(escopo, acao.controle)
    const valorJaEfetivo =
      valor === null
        ? current === undefined
        : current?.valor === valor || (herdado && efetivo === valor)
    if (valorJaEfetivo) {
      const resultado: ResultadoDeControle = {
        status: 'unchanged',
        snapshot: this.snapshot(escopo)
      }
      try {
        const aplicado = this.deps.repository.executarIdempotente(
          escopo,
          comando.idempotencyKey,
          fingerprint,
          () => resultado,
          this.agora().toISOString()
        )
        if (acao.tipo === 'switch' && acao.controle === 'execucao' && acao.habilitado === false)
          await this.cancelarRunsAtivos(escopo)
        return this.comAtualizado(aplicado, escopo)
      } catch {
        return {
          status: 'idempotency-conflict',
          message: 'A chave já foi usada para outro comando.'
        }
      }
    }
    const updatedAt = this.agora().toISOString()
    const resultado: ResultadoDeControle = {
      status: 'updated',
      snapshot: this.snapshotProjetado(escopo, acao, updatedAt)
    }
    try {
      this.deps.repository.executarIdempotente(
        escopo,
        comando.idempotencyKey,
        fingerprint,
        () => {
          if (valor === null) this.deps.repository.limpar(escopo, chave)
          else this.deps.repository.salvar(escopo, chave, valor, this.deps.userId(), updatedAt)
          this.deps.audit.append({
            user_id: escopo.userId,
            workspace_id: escopo.workspaceId,
            type: 'pipeline-control-change',
            payload: {
              projectId: escopo.projectId ?? null,
              acao,
              idempotencyKey: comando.idempotencyKey,
              fingerprint
            }
          })
          return resultado
        },
        updatedAt
      )
    } catch (erro) {
      if (erro instanceof Error && erro.message === 'idempotency-conflict')
        return {
          status: 'idempotency-conflict',
          message: 'A chave já foi usada para outro comando.'
        }
      throw erro
    }
    if (acao.tipo === 'switch' && acao.controle === 'execucao' && acao.habilitado === false)
      await this.cancelarRunsAtivos(escopo)
    return { status: 'updated', snapshot: this.snapshot(escopo) }
  }

  private async cancelarRunsAtivos(escopo: EscopoDeControle): Promise<void> {
    for (const ativo of this.execucao?.ativosDoEscopo(escopo) ?? []) {
      await this.execucao?.cancelarRun(
        escopo.projectId ?? ativo.projectId,
        escopo.workspaceId,
        ativo.runId
      )
    }
  }

  private comAtualizado(
    resultado: ResultadoDeControle,
    escopo: EscopoDeControle
  ): ResultadoDeControle {
    return 'snapshot' in resultado ? { ...resultado, snapshot: this.snapshot(escopo) } : resultado
  }

  private snapshotProjetado(
    escopo: EscopoDeControle,
    acao: AcaoDeControle,
    updatedAt: string
  ): SnapshotDeControles {
    // Projeta a alteração para o journal transacional; snapshot final é relido após persistência.
    const base = this.snapshot(escopo)
    if (acao.tipo === 'pausa') {
      const noWorkspace =
        escopo.projectId === undefined ? acao.pausada === true : base.pausa.noWorkspace
      const noEscopoAtual = escopo.projectId === undefined ? noWorkspace : acao.pausada === true
      return {
        ...base,
        pausa: {
          ...base.pausa,
          pausada: noWorkspace || noEscopoAtual,
          drenando: (noWorkspace || noEscopoAtual) && base.pausa.drenando,
          noEscopoAtual,
          noWorkspace
        },
        updatedAt
      }
    }
    const workspace = this.deps.repository.buscarWorkspace(
      { userId: escopo.userId, workspaceId: escopo.workspaceId },
      acao.controle
    )
    const estado =
      acao.habilitado === null
        ? {
            enabled: workspace?.valor ?? true,
            ...(workspace === undefined
              ? {}
              : { actor: workspace.actor, updatedAt: workspace.updatedAt }),
            herdado: workspace !== undefined
          }
        : { enabled: acao.habilitado, actor: this.deps.userId(), updatedAt, herdado: false }
    return { ...base, controles: { ...base.controles, [acao.controle]: estado }, updatedAt }
  }
}
