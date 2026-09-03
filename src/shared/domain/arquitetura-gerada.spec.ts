/**
 * O validador da arquitetura gerada por IA (SPEC-Jornada-04).
 *
 * O que estes testes protegem é a diferença entre "o modelo descreveu" e "alguém desenhou": cada
 * critério da spec vira aqui uma saída que o validador **recusa**, e é a recusa que é o
 * comportamento — um validador que só aprova o caminho feliz não protege nada.
 *
 * O caso central é o critério 2: **fluxo sem âncora em protótipo reprova**. Ele aparece em três
 * formas, porque há três maneiras de a âncora ser falsa — origem errada, anexo que não está no
 * gate e jornada que ninguém desenhou.
 */

import { describe, expect, it } from 'vitest'
import { SECOES_DA_ARQUITETURA } from './arquitetura'
import type {
  AfirmacaoDaArquitetura,
  AjusteProposto,
  ConteudoDaArquitetura,
  ContextoDaValidacaoDaArquitetura
} from './arquitetura-gerada'
import {
  ajustesDoTipo,
  cortarPropostoDaArquitetura,
  descartarAjuste,
  exigeAncoraEmPrototipo,
  propostosDoDocumentoDaArquitetura,
  validarArquitetura
} from './arquitetura-gerada'

const HASH_DO_PROTOTIPO = 'a'.repeat(64)

const CONTEXTO: ContextoDaValidacaoDaArquitetura = {
  afirmacoesDoPrd: ['r-1', 'r-2'],
  anexos: [
    { caminho: 'docs/prototipos/login.html', hash: HASH_DO_PROTOTIPO },
    { caminho: 'DESIGN-SYSTEM.md', hash: 'b'.repeat(64) }
  ],
  jornadas: ['Entrar na conta', 'Lista de tarefas'],
  secoes: SECOES_DA_ARQUITETURA
}

function conteudo(
  afirmacoes: readonly AfirmacaoDaArquitetura[],
  ajustes: readonly AjusteProposto[] = []
): ConteudoDaArquitetura {
  return { projectId: 'p1', afirmacoes, ajustes }
}

const DO_PRD: AfirmacaoDaArquitetura = {
  id: 'a-1',
  documento: 'ARCHITECTURE',
  secao: 'Módulos e fronteiras',
  texto: 'Um módulo de contas isola a autenticação do resto do sistema.',
  origem: 'prd',
  referencia: 'r-1'
}

const DO_PROTOTIPO: AfirmacaoDaArquitetura = {
  id: 'a-2',
  documento: 'ARCHITECTURE',
  secao: 'Fluxos cobertos',
  texto: 'O usuário entra na conta e chega à lista de tarefas.',
  origem: 'prototipo',
  ancora: {
    anexo: 'docs/prototipos/login.html',
    hash: HASH_DO_PROTOTIPO,
    jornada: 'Entrar na conta'
  }
}

describe('validarArquitetura — origem obrigatória (critério 2)', () => {
  it('aceita afirmação ancorada num requisito existente do PRD', () => {
    const r = validarArquitetura(conteudo([DO_PRD]), CONTEXTO)

    expect(r.valido).toBe(true)
    expect(r.problemas).toHaveLength(0)
  })

  it('aceita fluxo ancorado numa jornada que o protótipo mostrou', () => {
    const r = validarArquitetura(conteudo([DO_PROTOTIPO]), CONTEXTO)

    expect(r.valido).toBe(true)
  })

  it('recusa afirmação sem origem', () => {
    const semOrigem = { ...DO_PRD, origem: undefined } as unknown as AfirmacaoDaArquitetura
    const r = validarArquitetura(conteudo([semOrigem]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('origem-ausente')
  })

  it('recusa origem desconhecida em vez de tratá-la como proposto', () => {
    const inventada = { ...DO_PRD, origem: 'modelo' } as unknown as AfirmacaoDaArquitetura
    const r = validarArquitetura(conteudo([inventada]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('origem-desconhecida')
  })

  it('recusa origem prototipo no DECISIONS, que não a admite', () => {
    const adr: AfirmacaoDaArquitetura = {
      ...DO_PROTOTIPO,
      id: 'a-3',
      documento: 'DECISIONS',
      secao: 'Decisões estruturais'
    }
    const r = validarArquitetura(conteudo([adr]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('origem-desconhecida')
  })

  it('recusa seção que não existe no documento', () => {
    const r = validarArquitetura(conteudo([{ ...DO_PRD, secao: 'Considerações finais' }]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('secao-desconhecida')
  })

  it('devolve todos os problemas, não só o primeiro', () => {
    const r = validarArquitetura(
      conteudo([
        { ...DO_PRD, id: 'a-1', referencia: 'inexistente' },
        { ...DO_PRD, id: 'a-2', texto: '   ' }
      ]),
      CONTEXTO
    )

    expect(r.problemas.length).toBeGreaterThan(1)
  })
})

describe('validarArquitetura — âncora no PRD (critério 3)', () => {
  it('recusa origem prd sem referência', () => {
    const r = validarArquitetura(conteudo([{ ...DO_PRD, referencia: undefined }]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('referencia-ausente')
  })

  it('recusa referência a requisito que não existe na revisão aceita', () => {
    const r = validarArquitetura(conteudo([{ ...DO_PRD, referencia: 'r-99' }]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('ancora-inexistente')
  })
})

describe('validarArquitetura — fluxo sem âncora em protótipo reprova (critério 2)', () => {
  it('recusa fluxo com origem proposto', () => {
    const inventado: AfirmacaoDaArquitetura = {
      id: 'a-9',
      documento: 'ARCHITECTURE',
      secao: 'Fluxos cobertos',
      texto: 'O usuário exporta o relatório em PDF.',
      origem: 'proposto'
    }
    const r = validarArquitetura(conteudo([inventado]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('fluxo-sem-prototipo')
  })

  it('recusa fluxo ancorado no PRD, que descreve requisito e não tela', () => {
    const r = validarArquitetura(
      conteudo([{ ...DO_PRD, id: 'a-9', secao: 'Fluxos cobertos' }]),
      CONTEXTO
    )

    expect(r.problemas[0]?.recusa).toBe('fluxo-sem-prototipo')
  })

  it('recusa a estratégia de teste sem protótipo — a outra seção de fluxo', () => {
    const teste: AfirmacaoDaArquitetura = {
      id: 'a-9',
      documento: 'TESTING',
      secao: 'Estratégia',
      texto: 'Cobrir a exportação de relatórios com teste de ponta a ponta.',
      origem: 'proposto'
    }
    const r = validarArquitetura(conteudo([teste]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('fluxo-sem-prototipo')
  })

  it('aceita módulo proposto: só fluxo exige protótipo', () => {
    const modulo: AfirmacaoDaArquitetura = {
      id: 'a-9',
      documento: 'ARCHITECTURE',
      secao: 'Dados',
      texto: 'As tarefas são guardadas numa tabela com índice por projeto.',
      origem: 'proposto'
    }
    const r = validarArquitetura(conteudo([modulo]), CONTEXTO)

    expect(r.valido).toBe(true)
  })

  it('recusa âncora sem os campos do protótipo', () => {
    const r = validarArquitetura(conteudo([{ ...DO_PROTOTIPO, ancora: undefined }]), CONTEXTO)

    expect(r.problemas[0]?.recusa).toBe('referencia-ausente')
  })

  it('recusa âncora em anexo que não está no gate', () => {
    const r = validarArquitetura(
      conteudo([
        {
          ...DO_PROTOTIPO,
          ancora: { ...DO_PROTOTIPO.ancora!, anexo: 'docs/prototipos/inventado.html' }
        }
      ]),
      CONTEXTO
    )

    expect(r.problemas[0]?.recusa).toBe('prototipo-inexistente')
  })

  it('recusa âncora cujo hash não bate com o do anexo — protótipo trocado depois', () => {
    const r = validarArquitetura(
      conteudo([{ ...DO_PROTOTIPO, ancora: { ...DO_PROTOTIPO.ancora!, hash: 'c'.repeat(64) } }]),
      CONTEXTO
    )

    expect(r.problemas[0]?.recusa).toBe('prototipo-inexistente')
  })

  it('recusa âncora em jornada que nenhum protótipo validado mostrou', () => {
    const r = validarArquitetura(
      conteudo([
        { ...DO_PROTOTIPO, ancora: { ...DO_PROTOTIPO.ancora!, jornada: 'Exportar relatório' } }
      ]),
      CONTEXTO
    )

    expect(r.problemas[0]?.recusa).toBe('jornada-inexistente')
  })
})

describe('validarArquitetura — o que a IA não propõe sozinha', () => {
  it('recusa requisito legal proposto pelo modelo (invariante 9)', () => {
    const legal: AfirmacaoDaArquitetura = {
      id: 'a-9',
      documento: 'DECISIONS',
      secao: 'Decisões estruturais',
      texto: 'O sistema exige consentimento explícito para tratamento de dados pessoais.',
      origem: 'proposto'
    }
    const r = validarArquitetura(conteudo([legal]), CONTEXTO)

    expect(r.problemas.some((p) => p.recusa === 'requisito-sem-origem-humana')).toBe(true)
  })

  it('aceita o mesmo texto quando ele vem do PRD', () => {
    const legal: AfirmacaoDaArquitetura = {
      id: 'a-9',
      documento: 'DECISIONS',
      secao: 'Decisões estruturais',
      texto: 'O sistema exige consentimento explícito para tratamento de dados pessoais.',
      origem: 'prd',
      referencia: 'r-1'
    }
    const r = validarArquitetura(conteudo([legal]), CONTEXTO)

    expect(r.valido).toBe(true)
  })

  it('recusa processo deste repositório vazado para o REVIEW do projeto gerado', () => {
    const vazou: AfirmacaoDaArquitetura = {
      id: 'a-9',
      documento: 'REVIEW',
      secao: 'Como revisar',
      texto: 'Mover o card para proplan:done depois do merge.',
      origem: 'proposto'
    }
    const r = validarArquitetura(conteudo([vazou]), CONTEXTO)

    expect(r.problemas.some((p) => p.recusa === 'regra-de-outro-projeto')).toBe(true)
  })
})

describe('exigeAncoraEmPrototipo', () => {
  it('exige nas seções de fluxo', () => {
    expect(exigeAncoraEmPrototipo('ARCHITECTURE', 'Fluxos cobertos')).toBe(true)
    expect(exigeAncoraEmPrototipo('TESTING', 'Estratégia')).toBe(true)
  })

  it('não exige onde o documento descreve estrutura, não comportamento', () => {
    expect(exigeAncoraEmPrototipo('ARCHITECTURE', 'Dados')).toBe(false)
    expect(exigeAncoraEmPrototipo('DECISIONS', 'Decisões estruturais')).toBe(false)
  })
})

describe('propostos e cortes', () => {
  const PROPOSTO: AfirmacaoDaArquitetura = {
    id: 'a-3',
    documento: 'DECISIONS',
    secao: 'Decisões estruturais',
    texto: 'Guardar o histórico de alterações numa tabela separada.',
    origem: 'proposto'
  }

  it('lista os propostos por documento', () => {
    const c = conteudo([DO_PRD, PROPOSTO])

    expect(propostosDoDocumentoDaArquitetura(c, 'DECISIONS')).toHaveLength(1)
    expect(propostosDoDocumentoDaArquitetura(c, 'ARCHITECTURE')).toHaveLength(0)
  })

  it('corta um proposto', () => {
    const c = cortarPropostoDaArquitetura(conteudo([DO_PRD, PROPOSTO]), 'a-3')

    expect(c.afirmacoes).toHaveLength(1)
    expect(c.afirmacoes[0]?.id).toBe('a-1')
  })

  it('não corta afirmação de outra origem, mesmo com o id certo', () => {
    const c = cortarPropostoDaArquitetura(conteudo([DO_PRD, PROPOSTO]), 'a-1')

    expect(c.afirmacoes).toHaveLength(2)
  })
})

describe('ajustes da análise de coerência (critério 4)', () => {
  const AJUSTE: AjusteProposto = {
    id: 'j-1',
    tipo: 'tela-sem-requisito',
    jornada: 'Entrar na conta',
    observacao: 'A tela existe e nenhum requisito a pede.',
    recomendacao: 'Confirmar se o login entra no escopo desta versão.'
  }

  it('agrupa por tipo', () => {
    const c = conteudo([], [AJUSTE, { ...AJUSTE, id: 'j-2', tipo: 'requisito-sem-tela' }])

    expect(ajustesDoTipo(c, 'tela-sem-requisito')).toHaveLength(1)
    expect(ajustesDoTipo(c, 'estado-ausente')).toHaveLength(0)
  })

  it('descarta um ajuste sem tocar nas afirmações', () => {
    const c = descartarAjuste(conteudo([DO_PRD], [AJUSTE]), 'j-1')

    expect(c.ajustes).toHaveLength(0)
    expect(c.afirmacoes).toHaveLength(1)
  })
})
