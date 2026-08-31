/**
 * O catálogo do wizard (SPEC-Planejamento-03 § Regras e Contrato da pergunta).
 *
 * O teste central deste arquivo é o da **invariante 9** do `CONVENTION.md` §4: a varredura por
 * termos proibidos. Ela é estrutural de propósito — enquanto a proibição viver só na cabeça de
 * quem escreve a pergunta, a primeira pergunta nova que oferecer "aceite dos termos" entra sem
 * nada falhar. Aqui, falha.
 */

import { describe, expect, it } from 'vitest'

import { CATALOGO_DO_CONTEXTO, ETAPA_DO_CONTEXTO } from './wizard-catalogo'
import { decidirPorMim, opcoesOrdenadas, proximaPergunta } from './wizard'

/**
 * Os requisitos que a pipeline **não** inventa (invariante 9, citada literalmente na spec).
 * Casados sem acento e em minúsculas para não depender de grafia.
 */
const TERMOS_PROIBIDOS = [
  'lgpd',
  'gdpr',
  'consentimento',
  'aceite duplo',
  'duplo aceite',
  'termos de uso',
  'politica de privacidade',
  'dados pessoais',
  'dados sensiveis',
  'compliance',
  'juridic'
]

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Todo texto que o PI lê numa pergunta — é a superfície onde um requisito inventado apareceria. */
function textoVisivel(): string {
  return CATALOGO_DO_CONTEXTO.flatMap((p) => [
    p.titulo,
    p.enunciado,
    p.justificativa,
    ...p.opcoes.flatMap((o) => [o.rotulo, o.impacto])
  ])
    .map(normalizar)
    .join(' | ')
}

describe('invariante 9 — requisito ausente não é inferido', () => {
  it.each(TERMOS_PROIBIDOS)('nenhuma pergunta oferece %s', (termo) => {
    expect(textoVisivel()).not.toContain(termo)
  })

  it('nenhuma opção é classificação por domínio de negócio', () => {
    const ids = CATALOGO_DO_CONTEXTO.flatMap((p) => p.opcoes.map((o) => normalizar(o.id)))

    for (const proibido of ['saude', 'financeiro', 'educacao', 'governo', 'juridico']) {
      expect(ids).not.toContain(proibido)
    }
  })
})

describe('contrato da pergunta (spec § Contrato da pergunta)', () => {
  it('toda pergunta tem duas ou três opções mutuamente exclusivas', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      expect(p.opcoes.length).toBeGreaterThanOrEqual(2)
      expect(p.opcoes.length).toBeLessThanOrEqual(3)
      expect(new Set(p.opcoes.map((o) => o.id)).size).toBe(p.opcoes.length)
    }
  })

  it('toda opção declara impacto', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      for (const opcao of p.opcoes) {
        expect(opcao.impacto.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('a recomendada existe entre as opções e vem primeiro', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      expect(p.opcoes.some((o) => o.id === p.recomendada)).toBe(true)
      expect(opcoesOrdenadas(p)[0]?.id).toBe(p.recomendada)
    }
  })

  it('toda pergunta justifica a recomendação', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      expect(p.justificativa.trim().length).toBeGreaterThan(0)
    }
  })

  it('só delega quando há recomendação a delegar', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      if (!p.delegavel) continue
      expect(decidirPorMim(p)).not.toBeNull()
    }
  })
})

describe('integridade do grafo', () => {
  it('ids são únicos', () => {
    const ids = CATALOGO_DO_CONTEXTO.map((p) => p.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('toda dependente declarada existe no catálogo', () => {
    const ids = new Set(CATALOGO_DO_CONTEXTO.map((p) => p.id))

    for (const p of CATALOGO_DO_CONTEXTO) {
      for (const dependente of p.dependentes ?? []) {
        expect(ids).toContain(dependente)
      }
    }
  })

  it('nenhuma pergunta depende de si mesma', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      expect(p.dependentes ?? []).not.toContain(p.id)
    }
  })

  it('toda pergunta pertence à etapa do contexto', () => {
    for (const p of CATALOGO_DO_CONTEXTO) {
      expect(p.etapa).toBe(ETAPA_DO_CONTEXTO)
    }
  })

  it('o catálogo começa por uma pergunta sem decisão anterior', () => {
    expect(proximaPergunta(CATALOGO_DO_CONTEXTO, {})?.id).toBe('escopo')
  })
})

describe('anexo de design não é delegável (decisão 6 do MVP-008)', () => {
  it('a origem do design exige ato do PI', () => {
    const design = CATALOGO_DO_CONTEXTO.find((p) => p.id === 'design-de-origem')

    expect(design?.delegavel).toBe(false)
    expect(decidirPorMim(design!)).toBeNull()
  })
})
