/**
 * O registro de capacidades de um Squad (SPEC-Squads-01).
 *
 * A pergunta que este arquivo responde: **o que o Squad precisa saber fazer, independente de
 * qual skill ou agente existe nesta máquina?** O plano antigo nomeava skills; skill nominal some
 * do ambiente (outra máquina, outra instalação) e o plano ficava refém do nome. Aqui o contrato é
 * a *capacidade*, e cada uma declara de onde pode vir a implementação e o que a substitui
 * quando ela falta (regra 1: skill ausente não remove a disciplina).
 *
 * Dado versionado, não lógica: o resolvedor (`squad-resolucao.ts`) lê esta tabela. Acrescentar
 * uma capacidade é uma linha aqui e a entrada no teste de completude.
 *
 * Mora em `src/shared/domain` pela razão de sempre: a regra é pura e precisa ser verificável sem
 * carregar o Electron.
 */

/** Sobe quando o conteúdo do registro muda; entra no snapshot do run (critério 1). */
export const VERSAO_DO_REGISTRO_DE_CAPACIDADES = 1

export const CAPACIDADES = [
  'analise',
  'arquitetura',
  'testes',
  'revisao-de-codigo',
  'revisao-de-design',
  'pesquisa-documental'
] as const

export type CapacidadeId = (typeof CAPACIDADES)[number]

export function isCapacidadeId(value: unknown): value is CapacidadeId {
  return typeof value === 'string' && (CAPACIDADES as readonly string[]).includes(value)
}

/** De onde vem a implementação "de verdade": uma skill instalada ou uma ferramenta/MCP. */
export interface ImplementacaoDaCapacidade {
  readonly tipo: 'skill' | 'ferramenta'
  readonly nome: string
}

/**
 * O que substitui a implementação ausente.
 *
 *  - `prompt`: a disciplina da skill reescrita como prompt versionado (`id@versão`). Sempre
 *    disponível, porque mora no produto.
 *  - `modelo-local`: o Ollama executa a capacidade. Só existe com o servidor de pé.
 */
export type FallbackDaCapacidade =
  { readonly tipo: 'prompt'; readonly id: string } | { readonly tipo: 'modelo-local' }

export interface DefinicaoDeCapacidade {
  readonly id: CapacidadeId
  readonly rotulo: string
  /** O schema (`id@versão`) do resultado que o consumidor — orquestrador ou validador — lê. */
  readonly schemaDeResultado: string
  readonly implementacoes: readonly ImplementacaoDaCapacidade[]
  readonly fallbacks: readonly FallbackDaCapacidade[]
}

export const REGISTRO_DE_CAPACIDADES: Readonly<Record<CapacidadeId, DefinicaoDeCapacidade>> = {
  analise: {
    id: 'analise',
    rotulo: 'Análise',
    schemaDeResultado: 'achados@1',
    implementacoes: [{ tipo: 'skill', nome: 'investigate' }],
    fallbacks: [{ tipo: 'prompt', id: 'analise-disciplinada@1' }]
  },
  arquitetura: {
    id: 'arquitetura',
    rotulo: 'Arquitetura',
    schemaDeResultado: 'parecer@1',
    implementacoes: [{ tipo: 'skill', nome: 'plan-eng-review' }],
    fallbacks: [{ tipo: 'prompt', id: 'arquitetura-disciplinada@1' }]
  },
  testes: {
    id: 'testes',
    rotulo: 'Testes',
    schemaDeResultado: 'resultado-de-testes@1',
    implementacoes: [{ tipo: 'skill', nome: 'superpowers:test-driven-development' }],
    // Teste estrutural e repetitivo é o trabalho que o ADR-006 (decisão 4) reserva ao executor
    // barato — por isso, e só aqui, o modelo local é fallback legítimo.
    fallbacks: [{ tipo: 'prompt', id: 'tdd-disciplinado@1' }, { tipo: 'modelo-local' }]
  },
  'revisao-de-codigo': {
    id: 'revisao-de-codigo',
    rotulo: 'Revisão de código',
    schemaDeResultado: 'achados@1',
    implementacoes: [{ tipo: 'skill', nome: 'code-review' }],
    fallbacks: [{ tipo: 'prompt', id: 'revisao-de-codigo-disciplinada@1' }]
  },
  'revisao-de-design': {
    id: 'revisao-de-design',
    rotulo: 'Revisão de design',
    schemaDeResultado: 'achados@1',
    implementacoes: [{ tipo: 'skill', nome: 'design-review' }],
    fallbacks: [{ tipo: 'prompt', id: 'revisao-de-design-disciplinada@1' }]
  },
  'pesquisa-documental': {
    id: 'pesquisa-documental',
    rotulo: 'Pesquisa documental',
    schemaDeResultado: 'parecer@1',
    implementacoes: [{ tipo: 'ferramenta', nome: 'context7' }],
    fallbacks: [{ tipo: 'prompt', id: 'pesquisa-documental-disciplinada@1' }]
  }
}
