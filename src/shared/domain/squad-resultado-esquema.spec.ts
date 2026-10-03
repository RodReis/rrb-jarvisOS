import { describe, expect, it } from 'vitest'
import { avaliarResultado, CONFIANCAS, EVIDENCIA_EXIGIDA } from './squad-execucao'
import {
  ehSchemaDeResultado,
  esquemaDoResultado,
  SCHEMAS_DE_RESULTADO
} from './squad-resultado-esquema'

type Propriedades = Record<string, { enum?: string[]; items?: { properties: Propriedades } }>

describe('esquema do resultado da tarefa', () => {
  it('há um esquema para cada schema que o leitor conhece, e só para eles', () => {
    expect(SCHEMAS_DE_RESULTADO.sort()).toEqual(Object.keys(EVIDENCIA_EXIGIDA).sort())
    expect(ehSchemaDeResultado('achados@1')).toBe(true)
    expect(ehSchemaDeResultado('qualquer@9')).toBe(false)
    expect(ehSchemaDeResultado('toString')).toBe(false)
  })

  it('tem exatamente as chaves do leitor estrito — e nenhuma assinatura', () => {
    for (const schema of SCHEMAS_DE_RESULTADO) {
      const e = esquemaDoResultado(schema) as { properties: Propriedades; required: string[] }

      expect(Object.keys(e.properties).sort()).toEqual(
        ['confianca', 'conclusao', 'evidencia', 'lacunas', 'schema'].sort()
      )
      expect(e.required.sort()).toEqual(Object.keys(e.properties).sort())
      expect(e).toMatchObject({ additionalProperties: false })
    }
  })

  it('cada esquema impõe o próprio id e só os tipos de evidência que o schema aceita', () => {
    for (const schema of SCHEMAS_DE_RESULTADO) {
      const e = esquemaDoResultado(schema) as { properties: Propriedades }

      expect(e.properties.schema.enum).toEqual([schema])
      expect(e.properties.evidencia.items?.properties.tipo.enum).toEqual([
        ...EVIDENCIA_EXIGIDA[schema]
      ])
      expect(e.properties.confianca.enum).toEqual([...CONFIANCAS])
    }
  })

  it('a evidência exige tipo e referência, e o detalhe é opcional', () => {
    const e = esquemaDoResultado('achados@1') as {
      properties: { evidencia: { items: { required: string[]; additionalProperties: boolean } } }
    }

    expect(e.properties.evidencia.items.required).toEqual(['tipo', 'referencia'])
    expect(e.properties.evidencia.items.additionalProperties).toBe(false)
  })

  it('é JSON puro: o CLI e o Ollama o recebem como texto', () => {
    for (const schema of SCHEMAS_DE_RESULTADO) {
      const e = esquemaDoResultado(schema)

      expect(JSON.parse(JSON.stringify(e))).toEqual(e)
    }
  })

  it('um resultado no formato do esquema passa no leitor estrito', () => {
    for (const schema of SCHEMAS_DE_RESULTADO) {
      const tipo = EVIDENCIA_EXIGIDA[schema][0]
      const r = avaliarResultado(
        {
          schema,
          conclusao: 'ok',
          evidencia: [{ tipo, referencia: 'src/a.ts' }],
          confianca: 'media',
          lacunas: []
        },
        { schemaEsperado: schema, fontesDoPack: new Set(['src/a.ts']) }
      )

      expect(r.estado).toBe('concluida')
    }
  })
})
