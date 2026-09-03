import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RefinamentoDoProjeto } from './RefinamentoDoProjeto'

/**
 * A etapa do refinamento (SPEC-Jornada-02, categoria Tela).
 *
 * O que estes testes protegem:
 *  - **Gerar e responder são atos separados.** Ler o estado não pode gerar: reabrir a tela
 *    chamaria o modelo a cada F5, e cada chamada custa.
 *  - **Critério 6 na tela:** o bloqueio aparece antes do clique, e o botão não gera.
 *  - **Com pergunta pendente, o próximo passo é respondê-la** — oferecer "gerar mais" ali
 *    convidaria a acumular perguntas sem responder nenhuma.
 */

const estadoDoRefinamento = vi.fn()
const rotaDaGeracao = vi.fn()
const gerarPerguntasDeRefinamento = vi.fn()

function pergunta(restantes = 3): Record<string, unknown> {
  return {
    tipo: 'pergunta',
    restantes,
    pergunta: {
      id: 'q-1',
      etapa: 'refinamento',
      titulo: 'Alcance',
      enunciado: 'Até onde vai?',
      opcoes: [
        { id: 'a', rotulo: 'Fatia', impacto: 'ponta a ponta' },
        { id: 'b', rotulo: 'Fundação', impacto: 'base ampla' }
      ],
      recomendada: 'a',
      justificativa: 'Valida antes de investir.',
      aceitaTextoLivre: true,
      delegavel: true
    }
  }
}

beforeEach(() => {
  estadoDoRefinamento.mockReset().mockResolvedValue(null)
  rotaDaGeracao.mockReset().mockResolvedValue({ decisao: 'assinatura' })
  gerarPerguntasDeRefinamento
    .mockReset()
    .mockResolvedValue({ resultado: 'geradas', mensagem: 'ok' })

  Object.defineProperty(window, 'jarvis', {
    value: {
      estadoDoRefinamento,
      rotaDaGeracao,
      gerarPerguntasDeRefinamento,
      sendLog: vi.fn()
    },
    configurable: true,
    writable: true
  })
})

describe('RefinamentoDoProjeto', () => {
  it('sem perguntas, oferece gerar', async () => {
    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    expect(await screen.findByRole('button', { name: /Gerar as perguntas/ })).toBeInTheDocument()
  })

  it('ler o estado não gera — a geração é ato do PI', async () => {
    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    await screen.findByRole('button', { name: /Gerar as perguntas/ })

    // Reabrir a tela chamaria o modelo a cada F5, e cada chamada custa.
    expect(gerarPerguntasDeRefinamento).not.toHaveBeenCalled()
  })

  it('com pergunta pendente, o próximo passo é respondê-la', async () => {
    estadoDoRefinamento.mockResolvedValue(pergunta())

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    // Oferecer "gerar mais" com uma pergunta na fila convidaria a acumular sem responder.
    expect(await screen.findByRole('button', { name: /Responder a próxima/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar as perguntas/ })).toBeNull()
  })

  it('diz quantas decisões faltam, não só que faltam', async () => {
    estadoDoRefinamento.mockResolvedValue(pergunta(4))

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    // Um botão sem essa conta pediria um compromisso de duração desconhecida.
    expect(await screen.findByText(/4 decisões pendentes/)).toBeInTheDocument()
  })

  it('responder abre o pop-up, não gera nada', async () => {
    const usuario = userEvent.setup()
    const onResponder = vi.fn()
    estadoDoRefinamento.mockResolvedValue(pergunta())

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={onResponder}
        onRecarregar={vi.fn()}
      />
    )

    await usuario.click(await screen.findByRole('button', { name: /Responder a próxima/ }))

    expect(onResponder).toHaveBeenCalled()
    expect(gerarPerguntasDeRefinamento).not.toHaveBeenCalled()
  })

  it('mostra o bloqueio de rota antes do clique, com a ação (critério 6)', async () => {
    rotaDaGeracao.mockResolvedValue({
      decisao: 'bloqueado',
      motivo: 'sem-rota-alguma',
      acao: 'Conecte a assinatura do Claude em Providers.'
    })

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    expect(
      await screen.findByText('Conecte a assinatura do Claude em Providers.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gerar as perguntas/ })).toBeDisabled()
  })

  it('bloqueado, o botão não chama a geração', async () => {
    rotaDaGeracao.mockResolvedValue({
      decisao: 'bloqueado',
      motivo: 'sem-rota-alguma',
      acao: 'Conecte a assinatura.'
    })

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    await screen.findByText('Conecte a assinatura.')

    expect(gerarPerguntasDeRefinamento).not.toHaveBeenCalled()
  })

  it('gerar recarrega a jornada — a etapa pode ter mudado', async () => {
    const usuario = userEvent.setup()
    const onRecarregar = vi.fn()

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={onRecarregar}
      />
    )

    await usuario.click(await screen.findByRole('button', { name: /Gerar as perguntas/ }))

    await waitFor(() => expect(onRecarregar).toHaveBeenCalled())
  })

  it('recusa da geração vira mensagem com a ação, não erro cru', async () => {
    const usuario = userEvent.setup()
    gerarPerguntasDeRefinamento.mockResolvedValue({
      resultado: 'bloqueado-sem-rota',
      mensagem: 'A geração não aconteceu.',
      acao: 'Habilite a rota paga.'
    })

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    await usuario.click(await screen.findByRole('button', { name: /Gerar as perguntas/ }))

    expect(await screen.findByText(/Habilite a rota paga/)).toBeInTheDocument()
  })

  it('concluído, oferece procurar o que ainda falta', async () => {
    estadoDoRefinamento.mockResolvedValue({ tipo: 'concluido', decisoes: [] })

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={vi.fn()}
      />
    )

    expect(await screen.findByText('Todas as perguntas foram respondidas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Procurar o que ainda falta/ })).toBeInTheDocument()
  })
})
