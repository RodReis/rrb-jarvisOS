/**
 * O JSON Schema que o worker recebe para o resultado da tarefa (SPEC-Squads-03, "saída por schema").
 *
 * Derivado dos mesmos enums que o leitor estrito usa — schemas conhecidos, tipos de evidência,
 * confiança — para os dois não divergirem: um esquema escrito à mão que aceitasse um tipo de
 * evidência que `avaliarResultado` descarta faria o modelo "obedecer" ao formato e ainda assim cair
 * em `incompleta`.
 *
 * O esquema é uma **ajuda**, não a barreira. O CLI o aplica como `--json-schema` e o Ollama como
 * `format`, e nenhum dos dois garante a forma: quem decide é `avaliarResultado`, que é estrito e
 * recusa chave a mais. Sem `assinatura` de propósito — quem a calcula é o kernel.
 */

import {
  CONFIANCAS,
  EVIDENCIA_EXIGIDA,
  type SchemaDeResultado,
  type TipoDeEvidencia
} from './squad-execucao'

export const SCHEMAS_DE_RESULTADO = Object.keys(EVIDENCIA_EXIGIDA) as SchemaDeResultado[]

export const ehSchemaDeResultado = (v: string): v is SchemaDeResultado =>
  Object.hasOwn(EVIDENCIA_EXIGIDA, v)

/** O esquema do resultado de um schema conhecido. */
export function esquemaDoResultado(schema: SchemaDeResultado): Record<string, unknown> {
  const tipos: readonly TipoDeEvidencia[] = EVIDENCIA_EXIGIDA[schema]
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      schema: { enum: [schema] },
      conclusao: { type: 'string' },
      evidencia: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tipo: { enum: [...tipos] },
            referencia: { type: 'string' },
            detalhe: { type: 'string' }
          },
          required: ['tipo', 'referencia']
        }
      },
      confianca: { enum: [...CONFIANCAS] },
      lacunas: { type: 'array', items: { type: 'string' } }
    },
    required: ['schema', 'conclusao', 'evidencia', 'confianca', 'lacunas']
  }
}
