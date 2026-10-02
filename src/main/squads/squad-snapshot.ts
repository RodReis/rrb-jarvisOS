/**
 * O snapshot do perfil de um Squad e a auditoria dele (SPEC-Squads-01, critério 1 e regra 4).
 *
 * A pergunta que este arquivo responde: **com qual perfil, em que ambiente e com que resolução
 * este Squad foi montado?** O snapshot congela as três coisas no instante da montagem. Mudar o
 * perfil depois não o toca (regra 4), e `verificarSnapshot` confere que a revisão registrada ainda
 * é a do perfil guardado e que a resolução se reproduz só a partir dele.
 *
 * Duas decisões governam o arquivo:
 *
 *  - **Snapshot só nasce de perfil válido.** `criarSnapshotDoSquad` valida antes de resolver: o
 *    tipo `PerfilDeSquad` aceita `git: true`, e um snapshot de perfil assim sairia elegível e
 *    auditado como se estivesse certo.
 *  - **A auditoria leva a revisão, não o perfil** — mas leva os desvios: toda camada que não saiu
 *    como configurada e toda capacidade que não saiu por implementação. O ambiente não é gravado,
 *    então o evento é a única testemunha de qual fallback valeu.
 *
 * Mora em `src/main` porque o hash usa `node:crypto`; a regra de resolução continua em
 * `src/shared` e pura. A persistência no run é da F02, que é quem instancia o run — aqui só o que
 * a F01 sabe provar: o registro, o hash, a verificação e o evento de auditoria.
 */

import { createHash } from 'node:crypto'
import type { AuditEventInput, WorkspaceId } from '@shared/domain/entities'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import type { OpcoesDeValidacao, PerfilDeSquad } from '@shared/domain/squad-perfil'
import type { AmbienteDeResolucao, ResolucaoDoPerfil } from '@shared/domain/squad-resolucao'
import { VERSAO_DO_REGISTRO_DE_CAPACIDADES } from '@shared/domain/squad-capacidades'
import { congelar, validarPerfil } from '@shared/domain/squad-perfil'
import { resolverPerfil } from '@shared/domain/squad-resolucao'

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
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
  if (typeof valor === 'object' && valor !== null) {
    const registro = valor as Record<string, unknown>
    const campos = Object.keys(registro)
      .sort()
      .filter((k) => registro[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico(registro[k])}`)
    return `{${campos.join(',')}}`
  }
  return JSON.stringify(valor)
}

export function revisaoDoPerfil(perfil: PerfilDeSquad): string {
  return createHash('sha256').update(canonico(perfil)).digest('hex')
}

/**
 * Valida, resolve e congela. O perfil que entra é o **validado** (copiado campo a campo), e o
 * ambiente e o modelo da fase são copiados: o snapshot não compartilha referência com quem o
 * pediu, então nada que o chamador faça depois o altera.
 *
 * Perfil inválido lança: montar Squad com um é erro de quem chama, e devolver um snapshot
 * "elegível" de um perfil que o validador recusa é o pior desfecho possível.
 */
export function criarSnapshotDoSquad(
  perfil: PerfilDeSquad,
  ambiente: AmbienteDeResolucao,
  modeloDaFase: ModeloEscolhido,
  opcoes: OpcoesDeValidacao = {}
): SnapshotDoSquad {
  const validado = validarPerfil(perfil, opcoes)
  if (!validado.ok) {
    const codigos = validado.problemas.map((p) => `${p.codigo} (${p.caminho})`).join(', ')
    throw new Error(`perfil de Squad inválido: ${codigos}`)
  }

  const ambienteCopia = structuredClone(ambiente)
  const faseCopia = structuredClone(modeloDaFase)

  return congelar({
    registroDeCapacidades: VERSAO_DO_REGISTRO_DE_CAPACIDADES,
    perfil: validado.perfil,
    revisao: revisaoDoPerfil(validado.perfil),
    ambiente: ambienteCopia,
    modeloDaFase: faseCopia,
    resolucao: resolverPerfil(validado.perfil, ambienteCopia, faseCopia)
  })
}

/** Refaz a resolução só com o que o snapshot guarda. */
export function reproduzirSnapshot(snapshot: SnapshotDoSquad): ResolucaoDoPerfil {
  return resolverPerfil(snapshot.perfil, snapshot.ambiente, snapshot.modeloDaFase)
}

/**
 * O snapshot é o que diz ser? Dois fatos: a revisão registrada é a do perfil guardado, e a
 * resolução registrada é a que o perfil e o ambiente guardados produzem. Para snapshot lido de
 * fora (disco, auditoria), onde ninguém garante que perfil, hash e resolução andaram juntos.
 */
export function verificarSnapshot(snapshot: SnapshotDoSquad): boolean {
  return (
    snapshot.revisao === revisaoDoPerfil(snapshot.perfil) &&
    canonico(snapshot.resolucao) === canonico(reproduzirSnapshot(snapshot))
  )
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
 * revisão, e a auditoria não vira cópia dele. Os desvios entram — a troca de camada (Ollama fora
 * do ar → modelo da fase) e o fallback de capacidade (skill ausente → prompt) são exatamente os
 * fatos que não podem ser silenciosos.
 */
export function auditarSnapshotDoSquad(
  destino: DestinoDeAuditoria,
  escopo: EscopoDaAuditoria,
  snapshot: SnapshotDoSquad
): void {
  const { resolucao } = snapshot

  const fallbacks = Object.values(resolucao.camadas)
    .filter((c) => c.estado !== 'configurado')
    .map((c) => ({ camada: c.camada, estado: c.estado, motivo: c.motivo }))

  const capacidades = resolucao.capacidades.flatMap((cap) =>
    cap.porCamada
      .filter((c) => c.estado !== 'implementacao')
      .map((c) => ({
        capacidade: cap.capacidade,
        camada: c.camada,
        estado: c.estado,
        via: c.via,
        motivo: c.motivo
      }))
  )

  destino.append({
    user_id: escopo.userId,
    workspace_id: escopo.workspaceId,
    type: 'squad-snapshot',
    payload: {
      revisao: snapshot.revisao,
      tipoDeFatia: snapshot.perfil.tipoDeFatia,
      versaoDoPerfil: snapshot.perfil.versao,
      registroDeCapacidades: snapshot.registroDeCapacidades,
      elegivel: resolucao.elegivel,
      motivosDeInelegibilidade: resolucao.motivosDeInelegibilidade,
      fallbacks,
      capacidades
    }
  })
}
