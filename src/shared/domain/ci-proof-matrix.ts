import type { PerfilDeCi } from './ci-profile'

export const CATEGORIAS_DE_PROVA = ['regra', 'banco', 'tela', 'e2e'] as const

export interface MatrizDeProva {
  readonly criterios: readonly {
    readonly numero: number
    readonly validacoes: readonly string[]
  }[]
  readonly categorias: readonly {
    readonly nome: (typeof CATEGORIAS_DE_PROVA)[number]
    readonly estado: 'aplicavel' | 'nao-aplicavel'
    readonly validacoes: readonly string[]
    readonly justificativa?: string
  }[]
}

export interface EstadoDaMatrizDeProva {
  readonly ok: boolean
  readonly mensagem: string
  readonly criterios: readonly string[]
  readonly validacoes: readonly { readonly id: string; readonly nome: string }[]
  readonly matriz?: MatrizDeProva
}

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor)

/** A SPEC leva dados estruturados num bloco legível e versionável, sem segundo arquivo autoridade. */
export function lerMatrizDeProva(spec: string): MatrizDeProva | undefined {
  const bloco = spec.match(/^## Matriz de prova\s*\r?\n+```json\s*\r?\n([\s\S]*?)\r?\n```/m)?.[1]
  if (bloco === undefined) return undefined
  try {
    const valor: unknown = JSON.parse(bloco)
    return ehMatrizDeProva(valor) ? valor : undefined
  } catch {
    return undefined
  }
}

export function ehMatrizDeProva(valor: unknown): valor is MatrizDeProva {
  return (
    ehObjeto(valor) &&
    Array.isArray(valor.criterios) &&
    Array.isArray(valor.categorias) &&
    valor.criterios.every(
      (linha: unknown) =>
        ehObjeto(linha) &&
        Number.isInteger(linha.numero) &&
        Array.isArray(linha.validacoes) &&
        linha.validacoes.every((id: unknown) => typeof id === 'string')
    ) &&
    valor.categorias.every(
      (linha: unknown) =>
        ehObjeto(linha) &&
        typeof linha.nome === 'string' &&
        (linha.estado === 'aplicavel' || linha.estado === 'nao-aplicavel') &&
        Array.isArray(linha.validacoes) &&
        linha.validacoes.every((id: unknown) => typeof id === 'string') &&
        (linha.justificativa === undefined || typeof linha.justificativa === 'string')
    )
  )
}

export function escreverMatrizDeProva(matriz: MatrizDeProva): string {
  return ['## Matriz de prova', '', '```json', JSON.stringify(matriz, null, 2), '```', ''].join(
    '\n'
  )
}

/**
 * Confere somente vínculos verificáveis. O PI ainda julga se uma validação realmente prova o
 * critério que a matriz lhe atribui; nenhum nome de comando permite inferir essa semântica.
 */
export function problemasDaMatrizDeProva(
  criterios: readonly string[],
  perfil: PerfilDeCi,
  matriz: MatrizDeProva
): readonly string[] {
  const problemas: string[] = []
  const ids = new Set(perfil.validacoes.map((v) => v.id))
  const obrigatorias = new Set(
    perfil.validacoes.filter((v) => v.obrigatoria !== false).map((v) => v.id)
  )
  const usadas = new Set<string>()
  const numeros = new Set<number>()

  for (const linha of matriz.criterios) {
    if (!Number.isInteger(linha.numero) || linha.numero < 1 || linha.numero > criterios.length) {
      problemas.push(`Critério ${linha.numero} não existe na SPEC.`)
      continue
    }
    if (numeros.has(linha.numero)) problemas.push(`Critério ${linha.numero} está repetido.`)
    numeros.add(linha.numero)
    if (linha.validacoes.length === 0) problemas.push(`Critério ${linha.numero} não tem validação.`)
    for (const id of linha.validacoes) {
      if (!ids.has(id)) problemas.push(`Validação ${id} não existe no perfil.`)
      else usadas.add(id)
    }
  }

  for (let numero = 1; numero <= criterios.length; numero++) {
    if (!numeros.has(numero)) problemas.push(`Critério ${numero} está sem prova.`)
  }
  for (const id of obrigatorias) {
    if (!usadas.has(id)) problemas.push(`Validação obrigatória ${id} não cobre nenhum critério.`)
  }

  const categorias = new Set<string>()
  for (const linha of matriz.categorias) {
    if (!CATEGORIAS_DE_PROVA.includes(linha.nome)) {
      problemas.push(`Categoria ${linha.nome} não é reconhecida.`)
      continue
    }
    if (categorias.has(linha.nome)) problemas.push(`Categoria ${linha.nome} está repetida.`)
    categorias.add(linha.nome)
    if (linha.estado === 'nao-aplicavel') {
      if (!linha.justificativa?.trim())
        problemas.push(`Categoria ${linha.nome} requer justificativa.`)
      if (linha.validacoes.length > 0)
        problemas.push(`Categoria ${linha.nome} é não aplicável, mas lista validações.`)
    } else if (linha.estado === 'aplicavel') {
      if (linha.validacoes.length === 0)
        problemas.push(`Categoria ${linha.nome} não tem validação.`)
      for (const id of linha.validacoes) {
        if (!ids.has(id)) problemas.push(`Validação ${id} não existe no perfil.`)
      }
    } else {
      problemas.push(`Categoria ${linha.nome} tem estado inválido.`)
    }
  }
  for (const nome of CATEGORIAS_DE_PROVA) {
    if (!categorias.has(nome)) problemas.push(`Categoria ${nome} não foi classificada.`)
  }

  return problemas
}
