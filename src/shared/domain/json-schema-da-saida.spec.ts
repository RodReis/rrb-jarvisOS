/**
 * Os schemas que o CLI valida na saída — e a pergunta que a #280 deixou: **o envelope admite
 * tudo o que o system pede?**
 *
 * Um schema mais estreito que o contrato não falha ruidosamente. `additionalProperties: false`
 * faz o CLI recusar a chave que falta **antes** de o documento existir, e o modelo cumpre a
 * restrição escrevendo o conteúdo onde couber. Foi o que aconteceu com o brief: as pendências
 * viraram afirmações `proposto`, o documento pareceu completo, e o freio que a spec exige
 * (pendência material bloqueia o aceite) simplesmente não existia.
 *
 * Por isso os testes abaixo confrontam cada schema com o **system correspondente**, e não com
 * uma lista de chaves escrita à mão aqui: uma lista à mão seria uma terceira cópia do contrato,
 * divergindo dos outros dois na primeira vez que alguém mexesse só num.
 */

import { describe, expect, it } from 'vitest'
import {
  SCHEMA_DAS_AFIRMACOES,
  SCHEMA_DAS_CONTRADICOES,
  SCHEMA_DAS_PERGUNTAS,
  SCHEMA_DA_SPEC,
  SCHEMA_DOS_AJUSTES,
  SCHEMA_DO_BRIEF,
  SCHEMA_DO_ROADMAP
} from './json-schema-da-saida'
import { SISTEMA_DO_BRIEF, SISTEMA_DAS_PERGUNTAS } from './brief-schema'

interface EnvelopeJson {
  readonly type: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
  readonly additionalProperties: boolean
}

const TODOS: ReadonlyArray<readonly [string, string]> = [
  ['SCHEMA_DAS_PERGUNTAS', SCHEMA_DAS_PERGUNTAS],
  ['SCHEMA_DAS_AFIRMACOES', SCHEMA_DAS_AFIRMACOES],
  ['SCHEMA_DO_BRIEF', SCHEMA_DO_BRIEF],
  ['SCHEMA_DAS_CONTRADICOES', SCHEMA_DAS_CONTRADICOES],
  ['SCHEMA_DOS_AJUSTES', SCHEMA_DOS_AJUSTES],
  ['SCHEMA_DO_ROADMAP', SCHEMA_DO_ROADMAP],
  ['SCHEMA_DA_SPEC', SCHEMA_DA_SPEC]
]

function envelope(schema: string): EnvelopeJson {
  return JSON.parse(schema) as EnvelopeJson
}

/**
 * As chaves de topo que um system pede, lidas do **formato que ele declara**.
 *
 * O system escreve o formato como JSON de exemplo quebrado em linhas, então a leitura é por
 * marca textual: `"chave":[` ou `"chave":{` no começo de um trecho do formato. Frágil se o
 * system mudar de estilo — e é justamente por isso que o teste falha alto em vez de silenciar:
 * um system sem nenhuma chave reconhecível reprova a asserção de sanidade abaixo.
 */
function chavesDoSystem(system: string): readonly string[] {
  const inicio = system.indexOf('Formato:')
  const formato = inicio === -1 ? system : system.slice(inicio)

  /*
   * Só o **primeiro** nível, e a indentação é o que o separa do resto.
   *
   * O formato é JSON de exemplo quebrado em linhas: a chave de topo abre a linha na coluna
   * zero, ou logo depois do `{` que abre o documento. `"opcoes"` e `"titulo"` vivem dentro do
   * array e chegam indentadas — foi o que a primeira versão deste teste confundiu, listando
   * `opcoes` como chave de topo das perguntas.
   */
  return [...formato.matchAll(/^\{"([a-z]+)":|^ "([a-z]+)":/gm)]
    .map((m) => m[1] ?? m[2])
    .filter((c): c is string => c !== undefined)
}

describe('todo envelope é fechado e exige o que declara', () => {
  it.each(TODOS)('%s tem forma de envelope fechado', (_nome, schema) => {
    const json = envelope(schema)

    expect(json.type).toBe('object')
    expect(json.additionalProperties).toBe(false)
    // Fechado **e** obrigatório: um envelope que proíbe chave extra mas não exige a própria
    // aceitaria `{}` como saída válida, e um documento vazio passaria pelo CLI.
    expect(json.required).toEqual(Object.keys(json.properties))
    expect(json.required.length).toBeGreaterThan(0)
  })
})

describe('o schema do brief admite as duas chaves que o system pede (#280)', () => {
  it('o system do brief declara afirmações e pendências', () => {
    // Sanidade da leitura: se esta asserção cair, é o `chavesDoSystem` que quebrou, não o
    // schema — e o teste abaixo estaria comparando contra uma lista vazia sem avisar.
    expect(chavesDoSystem(SISTEMA_DO_BRIEF)).toEqual(['afirmacoes', 'pendencias'])
  })

  it('o envelope do brief carrega exatamente as chaves do system', () => {
    // A prova do defeito: com `SCHEMA_DAS_AFIRMACOES` no lugar deste, `properties` traz só
    // `afirmacoes` e a igualdade reprova.
    expect(Object.keys(envelope(SCHEMA_DO_BRIEF).properties)).toEqual(
      chavesDoSystem(SISTEMA_DO_BRIEF)
    )
  })

  it('pendências são exigidas, não toleradas', () => {
    // Lista vazia é resposta legítima ("nada ficou em aberto"); a chave ausente não é. Sem
    // `required`, o modelo omitiria a chave sob pressão de brevidade e o efeito seria o mesmo
    // que o schema errado produzia.
    expect(envelope(SCHEMA_DO_BRIEF).required).toContain('pendencias')
  })

  it('o schema das afirmações continua de uma chave só', () => {
    // O PRD e a arquitetura seguem com uma chave: alargar aquele envelope "por simetria" faria
    // o CLI aceitar um documento com chave que nenhum leitor de domínio consome.
    expect(Object.keys(envelope(SCHEMA_DAS_AFIRMACOES).properties)).toEqual(['afirmacoes'])
  })
})

describe('o schema das perguntas segue o system do refinamento', () => {
  it('carrega exatamente as chaves do system', () => {
    expect(Object.keys(envelope(SCHEMA_DAS_PERGUNTAS).properties)).toEqual(
      chavesDoSystem(SISTEMA_DAS_PERGUNTAS)
    )
  })
})
