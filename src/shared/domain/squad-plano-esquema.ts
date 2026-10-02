/**
 * O JSON Schema que o orquestrador recebe para o `SquadPlan` (SPEC-Squads-02, "saída estruturada").
 *
 * Derivado dos mesmos enums que o validador usa — papéis, camadas, capacidades — para os dois não
 * divergirem: um esquema escrito à mão que aceitasse um papel que o validador recusa faria o
 * modelo "obedecer" ao formato e ainda assim cair na rejeição.
 *
 * O esquema é uma **ajuda**, não a barreira. O Ollama o aplica como `format`, o CLI do Claude como
 * `--json-schema`, e nenhum dos dois garante a forma: quem decide é `lerPlano`, que é estrito e
 * recusa chave a mais (regra 1: texto do agente nunca substitui validação estrutural).
 */

import { CAPACIDADES } from './squad-capacidades'
import { CAMADAS } from './squad-perfil'
import { PAPEIS } from './squad-plano'

const ARRAY_DE_TEXTO = { type: 'array', items: { type: 'string' } } as const

export const ESQUEMA_DO_PLANO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tarefas: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          papel: { enum: [...PAPEIS] },
          capacidade: { enum: [...CAPACIDADES] },
          camada: { enum: [...CAMADAS] },
          escritor: { type: 'string' },
          entradas: ARRAY_DE_TEXTO,
          dependencias: ARRAY_DE_TEXTO,
          paths: ARRAY_DE_TEXTO,
          schemaDeResultado: { type: 'string' },
          limites: {
            type: 'object',
            additionalProperties: false,
            properties: {
              maxTurnos: { type: 'integer' },
              maxMinutos: { type: 'integer' },
              maxTokensEntrada: { type: 'integer' },
              maxTokensSaida: { type: 'integer' }
            },
            required: ['maxTurnos', 'maxMinutos', 'maxTokensEntrada', 'maxTokensSaida']
          },
          fundamento: {
            type: 'object',
            additionalProperties: false,
            properties: { criterio: { type: 'integer' }, risco: { type: 'string' } }
          },
          regraDeConclusao: { type: 'string' }
        },
        required: [
          'id',
          'papel',
          'capacidade',
          'camada',
          'entradas',
          'dependencias',
          'paths',
          'schemaDeResultado',
          'limites',
          'fundamento',
          'regraDeConclusao'
        ]
      }
    }
  },
  required: ['tarefas']
} as const

/** Já serializado: é o que o Ollama (`format`) e o CLI (`--json-schema`) recebem. */
export const ESQUEMA_DO_PLANO_JSON = JSON.stringify(ESQUEMA_DO_PLANO)
