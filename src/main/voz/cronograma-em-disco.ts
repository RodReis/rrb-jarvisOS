import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConfiguracaoDoCronograma, ResultadoDoCronograma } from '@shared/domain/cronograma'
import { validarCronograma } from './validar-cronograma'

export const CRONOGRAMA_INICIAL: ConfiguracaoDoCronograma = {
  versao: 1,
  ativa: false,
  sequencias: []
}

function resultadosValidos(valor: unknown): valor is ResultadoDoCronograma[] {
  return (
    Array.isArray(valor) &&
    valor.length <= 100 &&
    valor.every(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        typeof r.id === 'string' &&
        typeof r.sequenciaId === 'string' &&
        typeof r.nome === 'string' &&
        typeof r.iniciadoEm === 'string' &&
        (r.gatilho === 'evento' || r.gatilho === 'horario') &&
        Array.isArray(r.atividades) &&
        r.atividades.length <= 20 &&
        r.atividades.every(
          (a: unknown) =>
            typeof a === 'object' &&
            a !== null &&
            typeof (a as Record<string, unknown>).id === 'string' &&
            ((a as Record<string, unknown>).tipo === 'falar' ||
              (a as Record<string, unknown>).tipo === 'tocar-midia-local') &&
            ((a as Record<string, unknown>).estado === 'executada' ||
              (a as Record<string, unknown>).estado === 'nao-executada')
        )
    )
  )
}

export function criarCronogramaEmDisco(
  caminho: string,
  userId: string
): {
  readonly ler: () => ConfiguracaoDoCronograma
  readonly salvar: (config: ConfiguracaoDoCronograma) => void
  readonly historico: () => readonly ResultadoDoCronograma[]
  readonly registrar: (resultado: ResultadoDoCronograma) => void
} {
  let atual: { configuracao: ConfiguracaoDoCronograma; resultados: ResultadoDoCronograma[] } = {
    configuracao: CRONOGRAMA_INICIAL,
    resultados: []
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(caminho, 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      const c = raw as Record<string, unknown>
      if (
        c.user_id === userId &&
        c.workspace_id === 'jarvis' &&
        validarCronograma(c.configuracao) &&
        resultadosValidos(c.resultados)
      ) {
        atual = { configuracao: c.configuracao, resultados: c.resultados }
      }
    }
  } catch {
    /* ausente ou inválido: cronograma desligado */
  }
  function persistir(novo: typeof atual): void {
    mkdirSync(dirname(caminho), { recursive: true })
    const temporario = `${caminho}.tmp`
    writeFileSync(temporario, JSON.stringify({ user_id: userId, workspace_id: 'jarvis', ...novo }))
    renameSync(temporario, caminho)
    atual = novo
  }
  return {
    ler: () => atual.configuracao,
    salvar(configuracao) {
      if (!validarCronograma(configuracao)) throw new Error('Cronograma inválido')
      persistir({ ...atual, configuracao })
    },
    historico: () => atual.resultados,
    registrar(resultado) {
      persistir({ ...atual, resultados: [resultado, ...atual.resultados].slice(0, 100) })
    }
  }
}
