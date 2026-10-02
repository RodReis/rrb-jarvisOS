/**
 * O snapshot do perfil de um Squad e a auditoria dele (SPEC-Squads-01, critério 1 e regra 4).
 *
 * A pergunta que este arquivo responde: **com qual perfil, em que ambiente e com que resolução
 * este Squad foi montado?** O snapshot congela as três coisas no instante da montagem. Mudar o
 * perfil depois não o toca (regra 4), e `reproduzirSnapshot` refaz a resolução só a partir dele —
 * é isso que torna a decisão reproduzível pela *revisão registrada*, o hash do perfil.
 *
 * Mora em `src/main` porque o hash usa `node:crypto`; a regra de resolução continua em
 * `src/shared` e pura. A persistência no run é da F02, que é quem instancia o run — aqui só o que
 * a F01 sabe provar: o registro, o hash e o evento de auditoria.
 */

import { createHash } from 'node:crypto'
import type { AuditEventInput, WorkspaceId } from '../../shared/domain/entities'
import type { ModeloEscolhido } from '../../shared/domain/modelo-da-fase'
import type { PerfilDeSquad } from '../../shared/domain/squad-perfil'
import type { AmbienteDeResolucao, ResolucaoDoPerfil } from '../../shared/domain/squad-resolucao'
import { VERSAO_DO_REGISTRO_DE_CAPACIDADES } from '../../shared/domain/squad-capacidades'
import { congelar } from '../../shared/domain/squad-perfil'
import { resolverPerfil } from '../../shared/domain/squad-resolucao'

export interface SnapshotDoSquad {
  readonly registroDeCapacidades: number
  readonly perfil: PerfilDeSquad
  /** SHA-256 do perfil canônico. É a "revisão registrada". */
  readonly revisao: string
  readonly ambiente: AmbienteDeResolucao
  readonly modeloDaFase: ModeloEscolhido
  readonly resolucao: ResolucaoDoPerfil
}

/** JSON com as chaves ordenadas: a mesma árvore dá os mesmos bytes, qualquer que seja a ordem. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
  if (typeof valor === 'object' && valor !== null) {
    const chaves = Object.keys(valor).sort()
    const campos = chaves
      .filter((k) => (valor as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico((valor as Record<string, unknown>)[k])}`)
    return `{${campos.join(',')}}`
  }
  return JSON.stringify(valor)
}

export function revisaoDoPerfil(perfil: PerfilDeSquad): string {
  return createHash('sha256').update(canonico(perfil)).digest('hex')
}

/**
 * Resolve e congela. Copia o perfil, o ambiente e o modelo da fase: o snapshot não compartilha
 * referência com quem o pediu, então nada que o chamador faça depois o altera.
 */
export function criarSnapshotDoSquad(
  perfil: PerfilDeSquad,
  ambiente: AmbienteDeResolucao,
  modeloDaFase: ModeloEscolhido
): SnapshotDoSquad {
  const perfilCopia = structuredClone(perfil)
  const ambienteCopia = structuredClone(ambiente)
  const faseCopia = structuredClone(modeloDaFase)

  return congelar({
    registroDeCapacidades: VERSAO_DO_REGISTRO_DE_CAPACIDADES,
    perfil: perfilCopia,
    revisao: revisaoDoPerfil(perfilCopia),
    ambiente: ambienteCopia,
    modeloDaFase: faseCopia,
    resolucao: resolverPerfil(perfilCopia, ambienteCopia, faseCopia)
  })
}

/** Refaz a resolução só com o que o snapshot guarda. Igual à registrada = reproduzível. */
export function reproduzirSnapshot(snapshot: SnapshotDoSquad): ResolucaoDoPerfil {
  return resolverPerfil(snapshot.perfil, snapshot.ambiente, snapshot.modeloDaFase)
}

/** O que o `AuditRepository` expõe e esta função usa — só o `append`. */
export interface DestinoDeAuditoria {
  append(input: AuditEventInput): unknown
}

export interface EscopoDaAuditoria {
  readonly userId: string
  readonly workspaceId: WorkspaceId
}

/**
 * Registra o snapshot usado. O payload leva a revisão, não o perfil: o perfil é recuperável pela
 * revisão, e a auditoria não vira cópia dele. Os **fallbacks entram** — a troca de camada (Ollama
 * fora do ar → modelo da fase) é exatamente o fato que não pode ser silencioso.
 */
export function auditarSnapshotDoSquad(
  destino: DestinoDeAuditoria,
  escopo: EscopoDaAuditoria,
  snapshot: SnapshotDoSquad
): void {
  const fallbacks = Object.values(snapshot.resolucao.camadas)
    .filter((c) => c.estado !== 'configurado')
    .map((c) => ({ camada: c.camada, estado: c.estado, motivo: c.motivo }))

  destino.append({
    user_id: escopo.userId,
    workspace_id: escopo.workspaceId,
    type: 'squad-snapshot',
    payload: {
      revisao: snapshot.revisao,
      tipoDeFatia: snapshot.perfil.tipoDeFatia,
      versaoDoPerfil: snapshot.perfil.versao,
      registroDeCapacidades: snapshot.registroDeCapacidades,
      elegivel: snapshot.resolucao.elegivel,
      motivosDeInelegibilidade: snapshot.resolucao.motivosDeInelegibilidade,
      fallbacks
    }
  })
}
