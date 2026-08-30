import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WizardDoProjeto } from './WizardDoProjeto'

/**
 * O wizard orientado (SPEC-Planejamento-03, categoria Tela).
 *
 * O componente é testado **isolado**, não pelo `App`: o que se investiga aqui é o que a tela
 * pede ao main e o que ela mostra do que voltou.
 *
 * A ponte é mockada porque o renderer não decide nada — relevância, delegabilidade e
 * contradição são do main. Um mock que decidisse aqui provaria a política do teste, não a do
 * produto. O que a tela **tem** de fazer é mostrar o que voltou e mandar o que o PI escolheu, e
 * é isso que estas asserções cobram.
 */

const getWizardState = vi.fn()
const answerWizard = vi.fn()

function pergunta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'escopo',
    etapa: 'contexto',
    titulo: 'Escopo do projeto',
    enunciado: 'Qual é o alcance pretendido?',
    opcoes: [
      { id: 'amplo', rotulo: 'Fundação ampla', impacto: 'Reduz retrabalho estrutural' },
      { id: 'estreito', rotulo: 'Fatia vertical', impacto: 'Entrega utilizável mais cedo' }
    ],
    recomendada: 'estreito',
    justificativa: 'a fatia expõe cedo os erros de integração',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  }
}

function decisao(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    perguntaId: 'escopo',
    etapa: 'contexto',
    escolha: 'estreito',
    texto: null,
    recomendacao: 'estreito',
    justificativa: 'porque sim',
    autor: 'pi',
    motivo: 'escolhida',
    substituiu: null,
    created_at: '2026-08-30T10:00:00.000Z',
    ...over
  }
}

function montar(): void {
  render(
    <WizardDoProjeto
      workspace="jarvis"
      projectId="p-1"
      nomeDoProjeto="Projeto Alfa"
      aberto
      onFechar={() => {}}
    />
  )
}

beforeEach(() => {
  getWizardState.mockReset().mockResolvedValue({
    estado: { tipo: 'pergunta', pergunta: pergunta(), restantes: 3 },
    historico: []
  })
  answerWizard.mockReset()

  Object.defineProperty(window, 'jarvis', {
    value: { getWizardState, answerWizard },
    configurable: true,
    writable: true
  })
})

describe('uma pergunta por pop-up (critério 1)', () => {
  it('mostra a pergunta corrente e o enunciado', async () => {
    montar()

    expect(await screen.findByText('Escopo do projeto')).toBeInTheDocument()
    expect(screen.getByText('Qual é o alcance pretendido?')).toBeInTheDocument()
  })

  it('mostra exatamente um grupo de opções', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
  })

  it('cada opção é um radio alcançável por teclado', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    const opcoes = screen.getAllByRole('radio')
    expect(opcoes).toHaveLength(2)
    for (const opcao of opcoes) expect(opcao).toBeEnabled()
  })
})

describe('recomendação distinguível mas não forçada (critério 2)', () => {
  it('a recomendada aparece primeiro, mesmo declarada por último', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    // No catálogo, `amplo` vem antes; `estreito` é a recomendada e sobe.
    const opcoes = screen.getAllByRole('radio')
    expect(within(opcoes[0]!).getByText('Fatia vertical')).toBeInTheDocument()
  })

  it('a recomendada leva selo, as demais não', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    const opcoes = screen.getAllByRole('radio')
    expect(within(opcoes[0]!).getByText('Recomendada')).toBeInTheDocument()
    expect(within(opcoes[1]!).queryByText('Recomendada')).not.toBeInTheDocument()
  })

  it('nenhuma opção vem pré-selecionada — a escolha é do PI', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    for (const opcao of screen.getAllByRole('radio')) {
      expect(opcao).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('confirmar fica indisponível enquanto nada foi escolhido', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('mostra o impacto de cada opção', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    expect(screen.getByText('Entrega utilizável mais cedo')).toBeInTheDocument()
    expect(screen.getByText('Reduz retrabalho estrutural')).toBeInTheDocument()
  })

  it('mostra a justificativa da recomendação', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    expect(screen.getByText(/a fatia expõe cedo os erros de integração/)).toBeInTheDocument()
  })
})

describe('a escolha do PI chega ao main como dele', () => {
  it('manda a opção escolhida com autor pi', async () => {
    answerWizard.mockResolvedValue({ reason: 'registrada', mensagem: 'Decisão registrada.' })
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.click(screen.getByRole('radio', { name: /Fatia vertical/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(answerWizard).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ perguntaId: 'escopo', escolha: 'estreito', autor: 'pi' }),
      'jarvis'
    )
  })
})

describe('delegação (critério 3)', () => {
  it('manda autor agente, sem escolha — quem escolhe é o main', async () => {
    answerWizard.mockResolvedValue({ reason: 'registrada', mensagem: 'Decisão registrada.' })
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.click(screen.getByRole('button', { name: 'Decide por mim' }))

    expect(answerWizard).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ autor: 'agente', escolha: null }),
      'jarvis'
    )
  })

  it('não oferece delegar quando a pergunta exige o PI', async () => {
    getWizardState.mockResolvedValue({
      estado: { tipo: 'pergunta', pergunta: pergunta({ delegavel: false }), restantes: 1 },
      historico: []
    })
    montar()
    await screen.findByText('Escopo do projeto')

    expect(screen.queryByRole('button', { name: 'Decide por mim' })).not.toBeInTheDocument()
  })

  it('o resumo distingue o que foi delegado do que o PI escolheu', async () => {
    getWizardState.mockResolvedValue({
      estado: {
        tipo: 'concluido',
        decisoes: [
          decisao({ id: 'd-1', perguntaId: 'escopo', autor: 'pi' }),
          decisao({ id: 'd-2', perguntaId: 'publico', autor: 'agente', motivo: 'delegada' })
        ]
      },
      historico: []
    })
    montar()
    await screen.findByText('Decisões')

    expect(screen.getByText('Você')).toBeInTheDocument()
    expect(screen.getByText('Delegado')).toBeInTheDocument()
  })
})

describe('contradição nunca é corrigida silenciosamente (critério 5)', () => {
  const contradicao = {
    reason: 'contradicao-pendente',
    mensagem: 'Esta resposta muda decisões já tomadas. Confirme a substituição.',
    contradicoes: [
      {
        anterior: decisao({ perguntaId: 'superficie', escolha: 'interface-grafica' }),
        perguntaAfetada: 'superficie',
        impacto: 'Superfície principal'
      }
    ]
  }

  it('mostra a decisão anterior em vez de aplicar a mudança', async () => {
    answerWizard.mockResolvedValue(contradicao)
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.click(screen.getByRole('radio', { name: /Fundação ampla/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Esta resposta muda decisões já tomadas')).toBeInTheDocument()
    expect(screen.getByText(/Superfície principal/)).toBeInTheDocument()
    expect(screen.getByText(/interface-grafica/)).toBeInTheDocument()
  })

  it('oferece manter ou substituir — nunca decide sozinha', async () => {
    answerWizard.mockResolvedValue(contradicao)
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.click(screen.getByRole('radio', { name: /Fundação ampla/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByRole('button', { name: 'Manter como está' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Substituir' })).toBeInTheDocument()
  })

  it('substituir reenvia com o aceite explícito', async () => {
    answerWizard.mockResolvedValue(contradicao)
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.click(screen.getByRole('radio', { name: /Fundação ampla/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Substituir' }))

    expect(answerWizard).toHaveBeenLastCalledWith(
      'p-1',
      expect.objectContaining({ aceitarSubstituicao: true }),
      'jarvis'
    )
  })

  it('manter como está não manda nada ao main', async () => {
    answerWizard.mockResolvedValue(contradicao)
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.click(screen.getByRole('radio', { name: /Fundação ampla/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    answerWizard.mockClear()
    await userEvent.click(await screen.findByRole('button', { name: 'Manter como está' }))

    expect(answerWizard).not.toHaveBeenCalled()
  })
})

describe('retomada e conclusão (critérios 6 e 7)', () => {
  it('pede o estado ao abrir, em vez de presumir o começo', async () => {
    montar()
    await screen.findByText('Escopo do projeto')

    expect(getWizardState).toHaveBeenCalledWith('p-1', 'jarvis')
  })

  it('mostra as decisões já tomadas ao retomar', async () => {
    getWizardState.mockResolvedValue({
      estado: { tipo: 'pergunta', pergunta: pergunta({ id: 'publico' }), restantes: 2 },
      historico: [decisao()]
    })
    montar()

    expect(await screen.findByText('Já decidido')).toBeInTheDocument()
  })

  it('conclui com o resumo das decisões', async () => {
    getWizardState.mockResolvedValue({
      estado: { tipo: 'concluido', decisoes: [decisao()] },
      historico: [decisao()]
    })
    montar()

    expect(await screen.findByText('Decisões')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('bloqueio explica o motivo e a retomada', async () => {
    getWizardState.mockResolvedValue({
      estado: {
        tipo: 'bloqueado',
        motivo: 'Contexto do projeto indisponível.',
        retomada: 'Monte o contexto e reabra.'
      },
      historico: []
    })
    montar()

    expect(await screen.findByText('Contexto do projeto indisponível.')).toBeInTheDocument()
    expect(screen.getByText('Monte o contexto e reabra.')).toBeInTheDocument()
  })
})

describe('texto livre', () => {
  it('não oferece campo livre quando a pergunta não o aceita', async () => {
    getWizardState.mockResolvedValue({
      estado: { tipo: 'pergunta', pergunta: pergunta({ aceitaTextoLivre: false }), restantes: 1 },
      historico: []
    })
    montar()
    await screen.findByText('Escopo do projeto')

    expect(screen.queryByLabelText('Outra resposta')).not.toBeInTheDocument()
  })

  it('manda o texto quando nenhuma opção foi escolhida', async () => {
    answerWizard.mockResolvedValue({ reason: 'registrada', mensagem: 'Decisão registrada.' })
    montar()
    await screen.findByText('Escopo do projeto')

    await userEvent.type(screen.getByLabelText('Outra resposta'), 'um recorte próprio')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(answerWizard).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ escolha: null, texto: 'um recorte próprio' }),
      'jarvis'
    )
  })
})

describe('falha de leitura não deixa a tela em branco', () => {
  it('avisa quando o estado não pôde ser lido', async () => {
    getWizardState.mockResolvedValue(null)
    montar()

    expect(
      await screen.findByText('Não foi possível abrir o planejamento deste projeto.')
    ).toBeInTheDocument()
  })
})
