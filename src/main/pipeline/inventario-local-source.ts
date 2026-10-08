import { createHash } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  aprovacaoVigente,
  type Approval,
  type Gate,
  type RevisaoAprovada
} from '@shared/domain/aprovacoes'
import { specPodeSerAceita } from '@shared/domain/roadmap-gerado'
import type { RoadmapService } from '../projects/roadmap-service'
import type { RoadmapGeradoService } from '../projects/roadmap-gerado-service'
import type { ProjecaoLocalDoInventario } from './inventario-global-service'

interface EscopoLocal {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

/** Adapta o roadmap e os gates locais já persistidos para o inventário global. */
export class InventarioLocalFonte {
  constructor(
    private readonly roadmap: Pick<RoadmapService, 'carregar' | 'aprovacoes' | 'revisoesDoGate'>,
    private readonly roadmapGerado: Pick<RoadmapGeradoService, 'carregar'>
  ) {}

  async lerLocal(escopo: EscopoLocal): Promise<ProjecaoLocalDoInventario> {
    const roadmap = this.roadmap.carregar(escopo.projectId, escopo.workspaceId)
    const gerado = this.roadmapGerado.carregar(escopo.projectId)
    const aprovacoes = this.roadmap.aprovacoes(escopo.projectId, escopo.workspaceId)
    const mvpPorId = new Map(roadmap.mvps.map((mvp) => [mvp.id, mvp]))
    const idMvpPorOrigem = new Map(roadmap.mvps.map((mvp) => [mvp.id, `MVP${mvp.numero}`] as const))
    const fatiasPorMvp = new Map<string, typeof roadmap.slices>()
    for (const fatia of roadmap.slices) {
      const fatias = fatiasPorMvp.get(fatia.mvpId) ?? []
      fatiasPorMvp.set(fatia.mvpId, [...fatias, fatia])
    }

    const nos: ProjecaoLocalDoInventario['nos'][number][] = []
    for (const mvp of roadmap.mvps) {
      const id = idMvpPorOrigem.get(mvp.id)!
      const ehEscolhido = gerado?.mvpEscolhido === mvp.id
      const revisoes = ehEscolhido
        ? this.roadmap.revisoesDoGate(escopo.projectId, 'MVP_ENTRY', escopo.workspaceId)
        : []
      const aprovacao = aprovacaoVigente(aprovacoes, 'MVP_ENTRY', revisoes)
      const filhos = fatiasPorMvp.get(mvp.id) ?? []
      nos.push({
        id,
        tipo: 'mvp',
        numero: mvp.numero,
        titulo: mvp.titulo,
        dependeDe: mvp.dependeDe.map(
          (dependencia) => idMvpPorOrigem.get(dependencia) ?? dependencia
        ),
        quantidadeDeFatias: filhos.length,
        estadoTecnico: 'desconhecido',
        spec: { estado: 'ausente' },
        gateAprovado: aprovacao !== undefined,
        bloqueado: false
      })
    }

    for (const [mvpId, fatias] of fatiasPorMvp) {
      const mvp = mvpPorId.get(mvpId)
      if (mvp === undefined) continue
      const ordenadas = [...fatias].sort((a, b) => a.numero - b.numero || compararTexto(a.id, b.id))
      for (let index = 0; index < ordenadas.length; index += 1) {
        const fatia = ordenadas[index]!
        const anterior = ordenadas[index - 1]
        const id = idFatia(mvp.numero, fatia.numero)
        const specVigente = gerado?.spec?.fatiaId === fatia.id ? gerado.spec : undefined
        const podeSerAceita = specPodeSerAceita(specVigente)
        const revisoes = podeSerAceita
          ? this.roadmap.revisoesDoGate(escopo.projectId, 'SLICE_ENTRY', escopo.workspaceId)
          : []
        const aprovacao = aprovacaoVigente(aprovacoes, 'SLICE_ENTRY', revisoes)
        const ultimaAprovacao =
          specVigente === undefined ? undefined : ultimaDoGate(aprovacoes, 'SLICE_ENTRY')
        const dependenciasMvp = mvp.dependeDe.map(
          (dependencia) => idMvpPorOrigem.get(dependencia) ?? dependencia
        )
        nos.push({
          id,
          tipo: 'fatia',
          mvpId: idMvpPorOrigem.get(mvpId) ?? mvpId,
          numero: fatia.numero,
          titulo: fatia.titulo,
          dependeDe:
            anterior === undefined ? dependenciasMvp : [idFatia(mvp.numero, anterior.numero)],
          estadoTecnico: 'desconhecido',
          spec: {
            estado:
              specVigente === undefined
                ? 'ausente'
                : aprovacao !== undefined
                  ? 'aprovada'
                  : 'em-revisao',
            ...(revisoes.length === 0 ? {} : { revisaoAtual: fingerprintRevisoes(revisoes) }),
            ...(ultimaAprovacao === undefined
              ? {}
              : { revisaoAprovada: fingerprintRevisoes(ultimaAprovacao.revisoes) })
          },
          gateAprovado: aprovacao !== undefined,
          bloqueado: false
        })
      }
    }

    const revisao = fingerprintLocal(roadmap.mvps, roadmap.slices, gerado?.hash ?? null, aprovacoes)
    return { nos, revisao }
  }
}

function idFatia(numeroMvp: number, numeroFatia: number): string {
  return `MVP${numeroMvp}-F${String(numeroFatia).padStart(2, '0')}`
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function ultimaDoGate(aprovacoes: readonly Approval[], gate: Gate): Approval | undefined {
  return [...aprovacoes]
    .filter((aprovacao) => aprovacao.gate === gate)
    .sort((a, b) => compararTexto(b.created_at, a.created_at))[0]
}

function fingerprintRevisoes(revisoes: readonly RevisaoAprovada[]): string {
  const canonicas = [...revisoes]
    .map(({ artefato, hash }) => ({ artefato, hash }))
    .sort((a, b) => compararTexto(a.artefato, b.artefato) || compararTexto(a.hash, b.hash))
  return createHash('sha256').update(JSON.stringify(canonicas), 'utf8').digest('hex')
}

function fingerprintLocal(
  mvps: readonly {
    readonly id: string
    readonly numero: number
    readonly titulo: string
    readonly dependeDe: readonly string[]
  }[],
  fatias: readonly {
    readonly id: string
    readonly mvpId: string
    readonly numero: number
    readonly titulo: string
    readonly specSlug: string
    readonly detalhada: boolean
  }[],
  revisaoGerada: string | null,
  aprovacoes: readonly Approval[]
): string {
  const canonico = {
    mvps: [...mvps]
      .map((mvp) => ({ ...mvp, dependeDe: [...mvp.dependeDe].sort(compararTexto) }))
      .sort((a, b) => a.numero - b.numero || compararTexto(a.id, b.id)),
    fatias: [...fatias]
      .map(({ id, mvpId, numero, titulo, specSlug, detalhada }) => ({
        id,
        mvpId,
        numero,
        titulo,
        specSlug,
        detalhada
      }))
      .sort(
        (a, b) =>
          compararTexto(a.mvpId, b.mvpId) || a.numero - b.numero || compararTexto(a.id, b.id)
      ),
    revisaoGerada,
    aprovacoes: [...aprovacoes]
      .map((aprovacao) => ({
        gate: aprovacao.gate,
        revisoes: [...aprovacao.revisoes].sort(
          (a, b) => compararTexto(a.artefato, b.artefato) || compararTexto(a.hash, b.hash)
        )
      }))
      .sort(
        (a, b) =>
          compararTexto(a.gate, b.gate) || compararTexto(JSON.stringify(a), JSON.stringify(b))
      )
  }
  return createHash('sha256').update(JSON.stringify(canonico), 'utf8').digest('hex')
}
