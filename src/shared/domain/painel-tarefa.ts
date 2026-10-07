import type { GenerationEvent, GenerationTrace } from './geracao'
import type { WorkspaceId } from './entities'

export const MAX_BYTES_POR_ARQUIVO_DO_PAINEL = 10 * 1024 * 1024
export const MAX_BYTES_POR_RUN_DO_PAINEL = 50 * 1024 * 1024
export const RETENCAO_DIAS_DO_PAINEL = 30
export const COTA_BYTES_DO_PAINEL = 5 * 1024 ** 3

export type EstadoDoSnapshot = 'disponivel' | 'incompleto' | 'expirado' | 'ausente'

export interface SnapshotDeArquivoDaTarefa {
  readonly id: string
  readonly caminho: string
  readonly sha256: string
  readonly bytes: number
  readonly tipo: 'texto' | 'binario' | 'removido'
  readonly estado: EstadoDoSnapshot
}

export interface SnapshotDoDiffDaTarefa {
  readonly id: string
  readonly caminho: string
  readonly sha256: string
  readonly bytes: number
  readonly estado: EstadoDoSnapshot
}

export interface TarefaDoPainel {
  readonly tarefaId: string
  readonly papel: string
  readonly estado: string
  readonly motivo?: string
  readonly iniciadoEm?: string
  readonly atualizadoEm?: string
  readonly dependencias: readonly string[]
  readonly camada?: string
  readonly escritor?: string
  readonly paths: readonly string[]
  readonly regraDeConclusao?: string
  readonly traces: readonly GenerationTrace[]
  readonly ultimoEventoEm?: string
  readonly snapshots: readonly SnapshotDeArquivoDaTarefa[]
  readonly diffs: readonly SnapshotDoDiffDaTarefa[]
}

export interface PainelDaTarefa {
  readonly projectId: string
  readonly runId: string
  readonly workspace: WorkspaceId
  readonly estado: 'ativo' | 'encerrado' | 'incompleto'
  readonly snapshotsCompletos: boolean
  readonly tarefas: readonly TarefaDoPainel[]
  readonly plano: readonly {
    readonly tarefaId: string
    readonly papel: string
    readonly dependencias: readonly string[]
  }[]
  readonly arquivosDeTeste: readonly (SnapshotDeArquivoDaTarefa & { readonly resumo?: string })[]
  readonly conteudosDeTeste: readonly {
    readonly id: string
    readonly caminho: string
    readonly estado: string
    readonly resumo: string
  }[]
  readonly checks?: {
    readonly estado: string
    readonly checks: readonly {
      readonly nome: string
      readonly status: string
      readonly conclusao?: string
    }[]
    readonly checksPendentes: readonly string[]
    readonly erro?: string
  }
  readonly traces: Readonly<Record<string, readonly GenerationEvent[]>>
  readonly eventosDeTarefa: Readonly<Record<string, readonly GenerationEvent[]>>
  readonly tracesPorTarefa: Readonly<Record<string, readonly GenerationTrace[]>>
  readonly atualizadoEm: string
}

export interface EventoDeTarefaDoSquad {
  readonly runId: string
  readonly tarefaId: string
  readonly traceId: string
  readonly evento: GenerationEvent
}

export interface EntradaDeSnapshot {
  readonly bytesDoConteudo: number
  readonly bytesDoDiff?: number
  readonly bytesDoRunJaGravados: number
}

export type DecisaoDeSnapshot =
  | { readonly permitido: true; readonly bytesReservados: number }
  | {
      readonly permitido: false
      readonly motivo: 'arquivo-acima-do-limite' | 'run-acima-do-limite'
    }

export function decidirSnapshot(entrada: EntradaDeSnapshot): DecisaoDeSnapshot {
  const bytesDoDiff = entrada.bytesDoDiff ?? 0
  if (
    !Number.isSafeInteger(entrada.bytesDoConteudo) ||
    entrada.bytesDoConteudo < 0 ||
    !Number.isSafeInteger(bytesDoDiff) ||
    bytesDoDiff < 0 ||
    !Number.isSafeInteger(entrada.bytesDoRunJaGravados) ||
    entrada.bytesDoRunJaGravados < 0
  ) {
    return { permitido: false, motivo: 'run-acima-do-limite' }
  }
  if (entrada.bytesDoConteudo > MAX_BYTES_POR_ARQUIVO_DO_PAINEL) {
    return { permitido: false, motivo: 'arquivo-acima-do-limite' }
  }
  const bytesReservados = entrada.bytesDoConteudo + bytesDoDiff
  if (
    !Number.isSafeInteger(bytesReservados) ||
    entrada.bytesDoRunJaGravados + bytesReservados > MAX_BYTES_POR_RUN_DO_PAINEL
  ) {
    return { permitido: false, motivo: 'run-acima-do-limite' }
  }
  return { permitido: true, bytesReservados }
}

/** Apenas nomes relativos de repositório; paths absolutos e escapes não atravessam o IPC. */
export function caminhoRelativoDoPainelValido(caminho: string): boolean {
  if (
    caminho.length === 0 ||
    caminho.length > 1024 ||
    caminho.startsWith('/') ||
    /^[A-Za-z]:/.test(caminho)
  ) {
    return false
  }
  if (
    caminho.includes('\\') ||
    Array.from(caminho).some((char) => {
      const code = char.codePointAt(0) ?? 0
      return code < 0x20 || code === 0x7f
    })
  )
    return false
  const partes = caminho.split('/')
  return partes.every((parte) => parte !== '' && parte !== '.' && parte !== '..')
}
