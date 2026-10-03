/**
 * Persistência dos achados da revisão independente e das voltas do retrabalho (SPEC-Squads-04).
 *
 * A garantia de "o mesmo problema é uma assinatura só" é a `PRIMARY KEY (run_id, assinatura)`, não
 * um `if` do serviço. O repositório também **recusa a transição que o ciclo de vida não permite**:
 * um achado `superseded` nunca volta a `open`, qualquer que seja o chamador.
 */

import type { Database } from 'better-sqlite3'
import {
  transicaoDoAchadoAlcancavel,
  type AchadoRegistrado,
  type CategoriaDeAchado,
  type EstadoDoAchado,
  type Severidade
} from '@shared/domain/squad-achado'

interface AchadoRow {
  readonly run_id: string
  readonly assinatura: string
  readonly estado: EstadoDoAchado
  readonly severidade: Severidade
  readonly categoria: CategoriaDeAchado
  readonly titulo: string
  readonly arquivo: string
  readonly trecho: string
  readonly impacto: string
  readonly correcao: string
  readonly fora_da_spec: 0 | 1
  readonly justificativa_severidade: string | null
  readonly visto_por: string
  readonly contestado_por: string
  readonly delta_primeira_vista: string
  readonly delta_ultima_vista: string
  readonly delta_fechamento: string | null
  readonly motivo_estado: string | null
  readonly reaberturas: number
}

interface VoltaRow {
  readonly tentativa: number
  readonly origem: 'teste' | 'revisao'
  readonly decisao: 'voltar' | 'parar'
  readonly motivo: string | null
  readonly assinaturas: string
  readonly em: string
}

function toAchado(row: AchadoRow): AchadoRegistrado {
  return {
    categoria: row.categoria,
    severidade: row.severidade,
    titulo: row.titulo,
    arquivo: row.arquivo,
    trecho: row.trecho,
    impacto: row.impacto,
    correcao: row.correcao,
    foraDaSpec: row.fora_da_spec === 1,
    assinatura: row.assinatura,
    estado: row.estado,
    vistoPor: JSON.parse(row.visto_por) as string[],
    contestadoPor: JSON.parse(row.contestado_por) as string[],
    deltaDaPrimeiraVista: row.delta_primeira_vista,
    deltaDaUltimaVista: row.delta_ultima_vista,
    ...(row.justificativa_severidade === null
      ? {}
      : { justificativaDeSeveridade: row.justificativa_severidade }),
    ...(row.delta_fechamento === null ? {} : { deltaDoFechamento: row.delta_fechamento }),
    ...(row.motivo_estado === null ? {} : { motivoDoEstado: row.motivo_estado }),
    ...(row.reaberturas === 0 ? {} : { reaberturas: row.reaberturas })
  }
}

export interface EscopoDoRun {
  readonly userId: string
  readonly workspaceId: string
  readonly runId: string
}

export interface VoltaDoRetrabalho {
  /** A tentativa do DEVELOPER que foi reprovada. */
  readonly tentativa: number
  readonly origem: 'teste' | 'revisao'
  readonly decisao: 'voltar' | 'parar'
  readonly motivo?: string
  readonly assinaturas: readonly string[]
  readonly em: string
}

export class AchadoRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava o estado atual dos achados do run. Texto do achado (título, trecho, impacto, correção)
   * é o da **primeira vista** e não muda: a assinatura o ancora. Muda o que o ciclo de vida muda.
   * Recusa, sem gravar nada, a transição que o ciclo de vida não permite.
   */
  salvar(
    escopo: EscopoDoRun,
    achados: readonly AchadoRegistrado[],
    agora: () => string = () => new Date().toISOString()
  ): void {
    const atuais = new Map(this.listar(escopo.userId, escopo.runId).map((a) => [a.assinatura, a]))
    for (const achado of achados) {
      const atual = atuais.get(achado.assinatura)
      if (
        atual !== undefined &&
        atual.estado !== achado.estado &&
        !transicaoDoAchadoAlcancavel(atual.estado, achado.estado)
      ) {
        throw new Error(`Transição de achado não permitida: ${atual.estado} → ${achado.estado}.`)
      }
    }

    const upsert = this.db.prepare(
      `INSERT INTO squad_achado
         (run_id, assinatura, user_id, workspace_id, estado, severidade, categoria, titulo, arquivo,
          trecho, impacto, correcao, fora_da_spec, justificativa_severidade, visto_por,
          contestado_por, delta_primeira_vista, delta_ultima_vista, delta_fechamento,
          motivo_estado, reaberturas, atualizado_em)
       VALUES (@run_id, @assinatura, @user_id, @workspace_id, @estado, @severidade, @categoria,
          @titulo, @arquivo, @trecho, @impacto, @correcao, @fora_da_spec, @justificativa_severidade,
          @visto_por, @contestado_por, @delta_primeira_vista, @delta_ultima_vista,
          @delta_fechamento, @motivo_estado, @reaberturas, @atualizado_em)
       ON CONFLICT(run_id, assinatura) DO UPDATE SET
         estado = excluded.estado,
         severidade = excluded.severidade,
         justificativa_severidade = excluded.justificativa_severidade,
         visto_por = excluded.visto_por,
         contestado_por = excluded.contestado_por,
         delta_ultima_vista = excluded.delta_ultima_vista,
         delta_fechamento = excluded.delta_fechamento,
         motivo_estado = excluded.motivo_estado,
         reaberturas = excluded.reaberturas,
         atualizado_em = excluded.atualizado_em
       WHERE squad_achado.user_id = excluded.user_id`
    )
    const momento = agora()
    this.db.transaction(() => {
      for (const a of achados) {
        upsert.run({
          run_id: escopo.runId,
          assinatura: a.assinatura,
          user_id: escopo.userId,
          workspace_id: escopo.workspaceId,
          estado: a.estado,
          severidade: a.severidade,
          categoria: a.categoria,
          titulo: a.titulo,
          arquivo: a.arquivo,
          trecho: a.trecho,
          impacto: a.impacto,
          correcao: a.correcao,
          fora_da_spec: a.foraDaSpec ? 1 : 0,
          justificativa_severidade: a.justificativaDeSeveridade ?? null,
          visto_por: JSON.stringify(a.vistoPor),
          contestado_por: JSON.stringify(a.contestadoPor),
          delta_primeira_vista: a.deltaDaPrimeiraVista,
          delta_ultima_vista: a.deltaDaUltimaVista,
          delta_fechamento: a.deltaDoFechamento ?? null,
          motivo_estado: a.motivoDoEstado ?? null,
          reaberturas: a.reaberturas ?? 0,
          atualizado_em: momento
        })
      }
    })()
  }

  listar(userId: string, runId: string): readonly AchadoRegistrado[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM squad_achado WHERE user_id = ? AND run_id = ? ORDER BY delta_primeira_vista, assinatura'
      )
      .all(userId, runId) as AchadoRow[]
    return rows.map(toAchado)
  }

  /** Registra uma volta do retrabalho. Duas voltas com a mesma chave são um erro, não um retry. */
  registrarVolta(
    escopo: EscopoDoRun,
    volta: Omit<VoltaDoRetrabalho, 'em'>,
    agora: () => string = () => new Date().toISOString()
  ): void {
    this.db
      .prepare(
        `INSERT INTO squad_retrabalho
           (run_id, tentativa, user_id, workspace_id, origem, decisao, motivo, assinaturas, em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        escopo.runId,
        volta.tentativa,
        escopo.userId,
        escopo.workspaceId,
        volta.origem,
        volta.decisao,
        volta.motivo ?? null,
        JSON.stringify(volta.assinaturas),
        agora()
      )
  }

  listarVoltas(userId: string, runId: string): readonly VoltaDoRetrabalho[] {
    const rows = this.db
      .prepare(
        'SELECT tentativa, origem, decisao, motivo, assinaturas, em FROM squad_retrabalho WHERE user_id = ? AND run_id = ? ORDER BY tentativa, em'
      )
      .all(userId, runId) as VoltaRow[]
    return rows.map((r) => ({
      tentativa: r.tentativa,
      origem: r.origem,
      decisao: r.decisao,
      ...(r.motivo === null ? {} : { motivo: r.motivo }),
      assinaturas: JSON.parse(r.assinaturas) as string[],
      em: r.em
    }))
  }
}
