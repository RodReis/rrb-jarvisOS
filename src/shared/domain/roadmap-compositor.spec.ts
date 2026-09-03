/**
 * Os arquivos que o roadmap gerado escreve (SPEC-Jornada-05).
 *
 * O que estes testes protegem: **o `STATUS.md` continua sendo a fonte única do par Fatia ↔ SPEC**
 * (invariante 1, herdada da M8-F06 e mantida pelo critério 5), e os documentos novos — o do MVP,
 * com o checklist de fatias, e a SPEC, com as perguntas abertas — dizem em texto o que os gates
 * exigem: a origem de cada item e o que ainda falta decidir.
 *
 * A composição da M8-F06 **saiu** (decisão do PI de 2026-09-03): quem propõe MVP agora é o
 * modelo, verificado por `roadmap-gerado.ts`. O que sobrou aqui é a renderização.
 */

import { describe, expect, it } from 'vitest'
import type { Roadmap } from './roadmap'
import type { MvpGerado, SpecGerada } from './roadmap-gerado'
import {
  ARQUIVO_DO_STATUS,
  DIRETORIO_DOS_MVPS,
  arquivoDoMvp,
  mvpsNaOrdem,
  primeiraFatiaDo,
  renderizarArquivoHistorico,
  renderizarDocumentoDoMvp,
  renderizarSpecGerada,
  renderizarStatus
} from './roadmap-compositor'

const MVP_UM: MvpGerado = {
  id: 'mvp-1',
  numero: 1,
  titulo: 'Cadastro de cliente',
  tese: 'Cadastrar, listar e editar clientes.',
  resultado: 'Um operador cadastra um cliente e o encontra na lista.',
  dependeDe: [],
  origem: 'prd',
  referencia: 'a-1',
  fatias: [
    { id: 'f-1', numero: 1, titulo: 'Formulário de cadastro', origem: 'prd', referencia: 'a-1' },
    { id: 'f-2', numero: 2, titulo: 'Lista com busca', origem: 'proposto' }
  ]
}

const MVP_DOIS: MvpGerado = {
  id: 'mvp-2',
  numero: 2,
  titulo: 'Relatórios',
  tese: 'Exportar o que foi cadastrado.',
  resultado: 'O operador baixa o relatório do mês.',
  dependeDe: ['mvp-1'],
  origem: 'arquitetura',
  referencia: 'arq-3',
  fatias: [
    {
      id: 'f-3',
      numero: 1,
      titulo: 'Exportação em CSV',
      origem: 'arquitetura',
      referencia: 'arq-3'
    }
  ]
}

const ROADMAP: Roadmap = {
  mvps: [
    {
      id: 'mvp-1',
      numero: 1,
      titulo: 'Cadastro de cliente',
      tese: 'Cadastrar, listar e editar clientes.',
      estado: 'na-fila',
      dependeDe: [],
      origem: { tipo: 'decisao', decisaoId: 'mvp-1', perguntaId: 'roadmap-gerado' }
    },
    {
      id: 'mvp-2',
      numero: 2,
      titulo: 'Relatórios',
      tese: 'Exportar o que foi cadastrado.',
      estado: 'proposto',
      dependeDe: ['mvp-1'],
      origem: { tipo: 'decisao', decisaoId: 'mvp-2', perguntaId: 'roadmap-gerado' }
    }
  ],
  slices: [
    {
      id: 'f-1',
      mvpId: 'mvp-1',
      numero: 1,
      titulo: 'Formulário de cadastro',
      specSlug: 'docs/spec/spec-cadastro-de-cliente-01-formulario-de-cadastro.md',
      detalhada: true,
      origem: { tipo: 'decisao', decisaoId: 'f-1', perguntaId: 'roadmap-gerado' }
    },
    {
      id: 'f-3',
      mvpId: 'mvp-2',
      numero: 1,
      titulo: 'Exportação em CSV',
      specSlug: 'docs/spec/spec-relatorios-01-exportacao-em-csv.md',
      detalhada: false,
      origem: { tipo: 'decisao', decisaoId: 'f-3', perguntaId: 'roadmap-gerado' }
    }
  ]
}

const SPEC: SpecGerada = {
  fatiaId: 'f-1',
  titulo: 'Formulário de cadastro',
  objetivo: 'Permitir cadastrar um cliente com os campos que o PRD pede.',
  fluxo: ['Abrir o formulário', 'Preencher e salvar'],
  regras: ['Nome é obrigatório'],
  criteriosDeAceite: ['Salvar sem nome mostra o erro no campo'],
  testes: ['Unitário da validação'],
  perguntas: [
    {
      id: 'p-1',
      enunciado: 'O cadastro exige e-mail?',
      opcoes: [
        { id: 'a', rotulo: 'Sim, obrigatório', impacto: 'Nenhum cliente sem contato.' },
        { id: 'b', rotulo: 'Não, opcional', impacto: 'Cadastro mais rápido no balcão.' }
      ],
      recomendada: 'a',
      justificativa: 'O PRD fala em contatar o cliente depois.'
    }
  ]
}

describe('renderizarStatus — invariante 1', () => {
  const texto = renderizarStatus('Projeto Alfa', ROADMAP, ROADMAP.slices[0], '2026-09-03')

  it('declara ser a fonte única do par Fatia ↔ SPEC', () => {
    expect(texto).toContain('Índice Fatia ↔ SPEC')
    expect(texto).toContain('Fonte única do par')
  })

  it('lista cada fatia com a SPEC correspondente', () => {
    for (const slice of ROADMAP.slices) {
      expect(texto).toContain(slice.titulo)
      expect(texto).toContain(slice.specSlug)
    }
  })

  it('aponta a próxima fatia no Agora', () => {
    expect(texto).toContain('| Próximo |')
    expect(texto).toContain('Formulário de cadastro')
  })

  it('mostra o estado de cada MVP e as dependências pelo título', () => {
    expect(texto).toContain('na-fila')
    expect(texto).toContain('| 2 | Relatórios | proposto | Cadastro de cliente |')
  })

  it('escreve a ordem de execução quando o DAG é válido', () => {
    expect(texto).toContain('Cadastro de cliente → Relatórios')
  })

  it('diz que não há ordem quando o DAG tem ciclo', () => {
    const ciclico: Roadmap = {
      ...ROADMAP,
      mvps: [
        { ...ROADMAP.mvps[0]!, dependeDe: ['mvp-2'] },
        { ...ROADMAP.mvps[1]!, dependeDe: ['mvp-1'] }
      ]
    }

    expect(renderizarStatus('X', ciclico, undefined, '2026-09-03')).toContain('não há ordem válida')
  })

  it('sem próxima fatia, diz que nenhuma está pendente', () => {
    expect(renderizarStatus('X', ROADMAP, undefined, '2026-09-03')).toContain(
      'Nenhuma fatia pendente'
    )
  })
})

describe('renderizarDocumentoDoMvp — o container com checklist', () => {
  const texto = renderizarDocumentoDoMvp(
    MVP_DOIS,
    'Projeto Alfa',
    [
      { id: 'mvp-1', titulo: 'Cadastro de cliente' },
      { id: 'mvp-2', titulo: 'Relatórios' }
    ],
    '2026-09-03'
  )

  it('traz a tese e o resultado, que são coisas diferentes', () => {
    expect(texto).toContain(MVP_DOIS.tese)
    expect(texto).toContain(MVP_DOIS.resultado)
  })

  it('marca a origem do MVP com a referência que a sustenta', () => {
    expect(texto).toContain('ARQUITETURA (arq-3)')
  })

  it('resolve a dependência pelo título, não pelo id', () => {
    expect(texto).toContain('- Cadastro de cliente')
    expect(texto).not.toContain('- mvp-1')
  })

  it('escreve as fatias como checklist, não como lista', () => {
    expect(texto).toContain('- [ ] Exportação em CSV')
  })

  it('marca a origem de cada fatia', () => {
    const doPrimeiro = renderizarDocumentoDoMvp(MVP_UM, 'Projeto Alfa', [], '2026-09-03')
    expect(doPrimeiro).toContain('- [ ] Lista com busca — _origem: PROPOSTO PELA IA_')
  })

  it('MVP sem dependência diz que pode começar', () => {
    const doPrimeiro = renderizarDocumentoDoMvp(MVP_UM, 'Projeto Alfa', [], '2026-09-03')
    expect(doPrimeiro).toContain('pode começar')
  })
})

describe('renderizarSpecGerada — nasce rascunho, e as perguntas ficam visíveis', () => {
  const texto = renderizarSpecGerada(SPEC, MVP_UM, '2026-09-03')

  it('nasce como rascunho, nunca aprovada', () => {
    expect(texto).toContain('**rascunho**')
    expect(texto).not.toContain('aprovada-pi')
  })

  it('diz que a aprovação é o gate SLICE_ENTRY', () => {
    expect(texto).toContain('SLICE_ENTRY')
  })

  it('numera o fluxo e os critérios, onde a ordem importa', () => {
    expect(texto).toContain('1. Abrir o formulário')
    expect(texto).toContain('1. Salvar sem nome mostra o erro no campo')
  })

  it('escreve a pergunta aberta com as opções, o impacto e a recomendada', () => {
    expect(texto).toContain('### O cadastro exige e-mail?')
    expect(texto).toContain('**Sim, obrigatório** **(recomendada)**')
    expect(texto).toContain('Cadastro mais rápido no balcão.')
    expect(texto).toContain('O PRD fala em contatar o cliente depois.')
  })

  it('pergunta sem resposta diz que a SPEC não pode ser aceita', () => {
    expect(texto).toContain('pendente')
    expect(texto).toContain('não pode ser aceita')
  })

  it('pergunta respondida escreve o rótulo da opção, não o id', () => {
    const respondida = renderizarSpecGerada(
      { ...SPEC, perguntas: [{ ...SPEC.perguntas[0]!, resposta: 'b' }] },
      MVP_UM,
      '2026-09-03'
    )

    expect(respondida).toContain('**Resposta:** Não, opcional')
    expect(respondida).not.toContain('**Resposta:** b')
  })
})

describe('renderizarArquivoHistorico', () => {
  it('aponta para o STATUS como estado corrente', () => {
    expect(renderizarArquivoHistorico('Projeto Alfa', [], '2026-09-03')).toContain(
      ARQUIVO_DO_STATUS
    )
  })

  it('sem entradas, diz que não há nenhuma', () => {
    expect(renderizarArquivoHistorico('X', [], '2026-09-03')).toContain('Nenhuma entrada')
  })

  it('lista as entradas que recebe', () => {
    expect(renderizarArquivoHistorico('X', ['M1 entregue'], '2026-09-03')).toContain('M1 entregue')
  })
})

describe('arquivoDoMvp', () => {
  it('põe o número com dois dígitos, para o diretório ordenar certo', () => {
    expect(arquivoDoMvp({ numero: 2, titulo: 'Relatórios' }, 'relatorios')).toBe(
      `${DIRETORIO_DOS_MVPS}/mvp-02-relatorios.md`
    )
  })

  it('o MVP 10 vem depois do 2 na ordem alfabética do diretório', () => {
    const dois = arquivoDoMvp({ numero: 2, titulo: 'B' }, 'b')
    const dez = arquivoDoMvp({ numero: 10, titulo: 'A' }, 'a')
    expect(dois < dez).toBe(true)
  })
})

describe('primeiraFatiaDo e mvpsNaOrdem', () => {
  it('a primeira fatia é a de menor número, não a primeira do array', () => {
    const foraDeOrdem: MvpGerado = {
      ...MVP_UM,
      fatias: [MVP_UM.fatias[1]!, MVP_UM.fatias[0]!]
    }

    expect(primeiraFatiaDo(foraDeOrdem)?.id).toBe('f-1')
  })

  it('MVP sem fatia não tem primeira', () => {
    expect(primeiraFatiaDo({ ...MVP_UM, fatias: [] })).toBeUndefined()
  })

  it('a ordem segue o DAG, não a numeração', () => {
    const invertido: Roadmap = {
      ...ROADMAP,
      mvps: [
        { ...ROADMAP.mvps[0]!, numero: 2, dependeDe: ['mvp-2'] },
        { ...ROADMAP.mvps[1]!, numero: 1, dependeDe: [] }
      ]
    }

    expect(mvpsNaOrdem(invertido).map((m) => m.id)).toEqual(['mvp-2', 'mvp-1'])
  })

  it('DAG inválido cai na numeração em vez de devolver lista vazia', () => {
    const ciclico: Roadmap = {
      ...ROADMAP,
      mvps: [
        { ...ROADMAP.mvps[0]!, dependeDe: ['mvp-2'] },
        { ...ROADMAP.mvps[1]!, dependeDe: ['mvp-1'] }
      ]
    }

    expect(mvpsNaOrdem(ciclico).map((m) => m.numero)).toEqual([1, 2])
  })
})
