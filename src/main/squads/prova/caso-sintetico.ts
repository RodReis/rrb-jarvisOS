/**
 * O caso sintético do integrador, no formato da SPEC-Squads-00 § Emenda E1.
 *
 * A primeira medição fabricava o conflito mutando uma linha com `// w2`: o mesmo trecho dos dois
 * lados, e a resposta certa era escolher um. Aqui **cada lado acrescenta um comportamento
 * diferente, com teste próprio, no mesmo ponto** do módulo e do spec; a verdade é o arquivo com os
 * dois. Como a verdade contém tudo que os dois lados escreveram, o piso do manifesto é zero **por
 * construção** — o que a primeira medição não tinha.
 *
 * Três regiões conflitam: o fim do módulo, o ponto depois do último `import` do spec e o fim do
 * spec. Puro: quem escreve em disco e roda a suíte é o harness.
 */

export interface LadoDoCaso {
  /** Uma linha `import { x } from './modulo'`, inserida depois do último import do spec. */
  readonly importacao: string
  /** O comportamento novo, acrescentado ao fim do módulo. */
  readonly codigo: string
  /** O teste do comportamento, acrescentado ao fim do spec. */
  readonly teste: string
}

export interface ArquivosDoCaso {
  readonly modulo: string
  readonly teste: string
}

export function anexarNoFim(texto: string, codigo: string): string {
  return `${texto}${texto.endsWith('\n') ? '' : '\n'}${codigo}`
}

const FIM_DE_IMPORT = /(?:\bfrom\s+['"][^'"]+['"]|^import\s+['"][^'"]+['"])\s*;?\s*$/

/** Depois do último `import` — que pode ocupar várias linhas. */
export function inserirImportacao(spec: string, linha: string): string {
  const linhas = spec.split('\n')
  const ultimo = linhas.findLastIndex((l) => /^import\b/.test(l))
  if (ultimo < 0) throw new Error('spec sem import: o caso não tem onde inserir a importação')
  const fim = linhas.findIndex((l, i) => i >= ultimo && FIM_DE_IMPORT.test(l))
  if (fim < 0) throw new Error('não achei o fim do último import')
  linhas.splice(fim + 1, 0, linha)
  return linhas.join('\n')
}

const NOME_EXPORTADO = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g

/** Os nomes que o lado exporta e o módulo-base já menciona: redefini-los quebraria a base. */
export function colisoesDeNome(moduloBase: string, lado: LadoDoCaso): string[] {
  return [...lado.codigo.matchAll(NOME_EXPORTADO)]
    .map((m) => m[1] as string)
    .filter((nome) =>
      new RegExp(`(?<![\\w$])${nome.replace(/\$/g, '\\$')}(?![\\w$])`).test(moduloBase)
    )
}

export function montarLado(base: ArquivosDoCaso, lado: LadoDoCaso): ArquivosDoCaso {
  return {
    modulo: anexarNoFim(base.modulo, lado.codigo),
    teste: anexarNoFim(inserirImportacao(base.teste, lado.importacao), lado.teste)
  }
}

/** A verdade: a base com os dois lados aplicados, um depois do outro. */
export function montarVerdade(
  base: ArquivosDoCaso,
  lado1: LadoDoCaso,
  lado2: LadoDoCaso
): ArquivosDoCaso {
  return montarLado(montarLado(base, lado1), lado2)
}
