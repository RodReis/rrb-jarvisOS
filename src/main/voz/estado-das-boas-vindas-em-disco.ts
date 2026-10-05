/** Configuração e marcadores de chegada em arquivo local, com escrita atômica. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConfiguracaoDasBoasVindas, EstadoDasBoasVindas } from './boas-vindas-service'

export const CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS: ConfiguracaoDasBoasVindas = {
  // A primeira instalação não fala sem o PI configurar o modo (decisão de 2026-10-05).
  ativa: false,
  janelaInicio: 6 * 60,
  janelaFim: 23 * 60,
  tetoDaPersonaMs: 4_000,
  frases: {
    manha: 'Bom dia. Bem-vindo de volta.',
    tarde: 'Boa tarde. Bem-vindo de volta.',
    noite: 'Boa noite. Bem-vindo de volta.'
  },
  midiaAtiva: false,
  midia: null
}

interface ArquivoDasBoasVindas {
  readonly configuracao: ConfiguracaoDasBoasVindas
  readonly estado: EstadoDasBoasVindas
}

function inteiroEntre(v: unknown, minimo: number, maximo: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= minimo && v <= maximo
}

function frase(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 300
}

export function validarConfiguracaoDasBoasVindas(v: unknown): v is ConfiguracaoDasBoasVindas {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (typeof c.frases !== 'object' || c.frases === null) return false
  const f = c.frases as Record<string, unknown>
  const midia = c.midia
  const fonteValida =
    midia === null ||
    (typeof midia === 'object' &&
      midia !== null &&
      ((midia as Record<string, unknown>).tipo === 'arquivo' ||
        (midia as Record<string, unknown>).tipo === 'pasta') &&
      typeof (midia as Record<string, unknown>).caminho === 'string' &&
      ((midia as Record<string, unknown>).caminho as string).length <= 4096)
  return (
    typeof c.ativa === 'boolean' &&
    inteiroEntre(c.janelaInicio, 0, 1439) &&
    inteiroEntre(c.janelaFim, 1, 1440) &&
    c.janelaInicio !== c.janelaFim &&
    inteiroEntre(c.tetoDaPersonaMs, 500, 20_000) &&
    frase(f.manha) &&
    frase(f.tarde) &&
    frase(f.noite) &&
    typeof c.midiaAtiva === 'boolean' &&
    fonteValida &&
    (!c.midiaAtiva || midia !== null)
  )
}

function estadoValido(v: unknown): v is EstadoDasBoasVindas {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    (e.ultimoDiaDesbloqueado === undefined ||
      (typeof e.ultimoDiaDesbloqueado === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.ultimoDiaDesbloqueado))) &&
    (e.ultimoDesbloqueioMs === undefined ||
      (typeof e.ultimoDesbloqueioMs === 'number' && Number.isFinite(e.ultimoDesbloqueioMs))) &&
    (e.ultimoPeriodoSaudado === undefined || typeof e.ultimoPeriodoSaudado === 'string')
  )
}

function decodificar(texto: string): ArquivoDasBoasVindas | undefined {
  try {
    const lido: unknown = JSON.parse(texto)
    if (typeof lido !== 'object' || lido === null) return undefined
    const v = lido as Record<string, unknown>
    if (!validarConfiguracaoDasBoasVindas(v.configuracao) || !estadoValido(v.estado))
      return undefined
    return { configuracao: v.configuracao, estado: v.estado }
  } catch {
    return undefined
  }
}

export function criarEstadoDasBoasVindasEmDisco(caminho: string): {
  readonly configuracao: () => ConfiguracaoDasBoasVindas
  readonly salvarConfiguracao: (config: ConfiguracaoDasBoasVindas) => void
  readonly ler: () => EstadoDasBoasVindas
  readonly gravar: (estado: EstadoDasBoasVindas) => void
} {
  const inicial: ArquivoDasBoasVindas = {
    configuracao: CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS,
    estado: {}
  }
  let atual: ArquivoDasBoasVindas
  try {
    atual = decodificar(readFileSync(caminho, 'utf8')) ?? inicial
  } catch {
    atual = inicial
  }
  function persistir(novo: ArquivoDasBoasVindas): void {
    mkdirSync(dirname(caminho), { recursive: true })
    const temporario = `${caminho}.tmp`
    writeFileSync(temporario, JSON.stringify(novo))
    renameSync(temporario, caminho)
    atual = novo
  }
  return {
    configuracao: () => atual.configuracao,
    salvarConfiguracao(config) {
      if (!validarConfiguracaoDasBoasVindas(config)) throw new Error('Configuração inválida')
      persistir({ ...atual, configuracao: config })
    },
    ler: () => atual.estado,
    gravar(estado) {
      if (!estadoValido(estado)) throw new Error('Estado inválido')
      persistir({ ...atual, estado })
    }
  }
}
