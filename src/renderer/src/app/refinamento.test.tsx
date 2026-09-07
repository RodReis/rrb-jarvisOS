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
const gerarBrief = vi.fn()

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
  gerarBrief.mockReset().mockResolvedValue({ resultado: 'gerado', mensagem: 'ok' })

  Object.defineProperty(window, 'jarvis', {
    value: {
      estadoDoRefinamento,
      rotaDaGeracao,
      gerarPerguntasDeRefinamento,
      gerarBrief,
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

/**
 * A geração do brief, que a #281 trouxe da tela do prompt para cá.
 *
 * Antes ela acontecia ao salvar o prompt — **antes de qualquer pergunta** —, então
 * `decisoesDoRefinamento` chegava sempre vazio e nenhuma afirmação do brief podia ter origem
 * `decisao`. Aqui as decisões já existem, e gerar o brief é também o que dá à jornada a
 * evidência de que o refinamento terminou.
 */
describe('RefinamentoDoProjeto — a geração do brief (#281)', () => {
  it('com perguntas pendentes, não oferece gerar o brief', async () => {
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

    // O brief só nasce do refinamento **terminado**: gerá-lo com decisão pendente produziria
    // um documento que ignora a resposta que o PI ainda vai dar.
    await screen.findByRole('button', { name: /Responder a próxima/ })
    expect(screen.queryByRole('button', { name: /Gerar o brief/ })).not.toBeInTheDocument()
  })

  it('concluído, oferece gerar o brief', async () => {
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

    expect(await screen.findByRole('button', { name: /Gerar o brief/ })).toBeInTheDocument()
  })

  it('gerar o brief recarrega a jornada — a etapa muda', async () => {
    const usuario = userEvent.setup()
    const onRecarregar = vi.fn()
    estadoDoRefinamento.mockResolvedValue({ tipo: 'concluido', decisoes: [] })

    render(
      <RefinamentoDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onResponder={vi.fn()}
        onRecarregar={onRecarregar}
      />
    )

    await usuario.click(await screen.findByRole('button', { name: /Gerar o brief/ }))

    expect(gerarBrief).toHaveBeenCalledWith('p-1', 'jarvis')
    await waitFor(() => expect(onRecarregar).toHaveBeenCalled())
  })

  it('a recusa não move a jornada', async () => {
    const usuario = userEvent.setup()
    const onRecarregar = vi.fn()
    estadoDoRefinamento.mockResolvedValue({ tipo: 'concluido', decisoes: [] })
    gerarBrief.mockResolvedValue({
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
        onRecarregar={onRecarregar}
      />
    )

    await usuario.click(await screen.findByRole('button', { name: /Gerar o brief/ }))

    // A trilha piscaria para uma etapa que não avançou se `onRecarregar` fosse chamado aqui.
    expect(await screen.findByText(/Habilite a rota paga/)).toBeInTheDocument()
    expect(onRecarregar).not.toHaveBeenCalled()
  })

  /**
   * O defeito que o PI encontrou na tela do prompt, agora travado onde a geração vive.
   *
   * Ele pediu o brief; o modelo respondeu em português que o diretório já continha outro
   * produto e que não ia sobrescrever; a tela mostrou *"a saída não passou no validador"* —
   * verdadeira, e escondendo a única coisa útil da falha.
   */
  it('quando o modelo responde em prosa, o PI lê o que ele disse', async () => {
    const usuario = userEvent.setup()
    estadoDoRefinamento.mockResolvedValue({ tipo: 'concluido', decisoes: [] })
    gerarBrief.mockResolvedValue({
      resultado: 'saida-invalida',
      mensagem: 'Nada foi gravado — nenhum brief, nenhuma alteração no projeto.',
      acao: 'Responda ao ponto no campo do prompt e gere de novo.',
      textoDoModelo:
        'O diretório `rrb-insights` já contém outro produto (AgroInsights). Não vou sobrescrever.',
      problemas: ['O modelo respondeu em texto corrido, e o brief exige saída estruturada.']
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

    await usuario.click(await screen.findByRole('button', { name: /Gerar o brief/ }))

    expect(await screen.findByText(new RegExp('já contém outro produto'))).toBeInTheDocument()
    // E o próximo passo junto: erro sem recuperação é beco (PRD §14).
    expect(screen.getByText(/Responda ao ponto no campo do prompt/)).toBeInTheDocument()
  })

  it('a observação do modelo é aviso, não erro — o alerta não é vermelho', async () => {
    const usuario = userEvent.setup()
    estadoDoRefinamento.mockResolvedValue({ tipo: 'concluido', decisoes: [] })
    gerarBrief.mockResolvedValue({
      resultado: 'saida-invalida',
      mensagem: 'Nada foi gravado.',
      textoDoModelo: 'Confirmo a forma exata antes de gerar.'
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

    await usuario.click(await screen.findByRole('button', { name: /Gerar o brief/ }))

    // O `InlineAlert` prefixa o tom no nome acessível — é assim que quem usa leitor de tela
    // recebe a severidade, e é o que se afirma aqui em vez de uma classe CSS.
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/atenção/i)
    expect(alerta).not.toHaveTextContent(/^erro/i)
  })

  it('sem rota autorizada, o brief não é gerado', async () => {
    estadoDoRefinamento.mockResolvedValue({ tipo: 'concluido', decisoes: [] })
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

    // Critério 6 na tela: o bloqueio aparece antes do clique, e o botão não gera.
    expect(await screen.findByRole('button', { name: /Gerar o brief/ })).toBeDisabled()
    expect(gerarBrief).not.toHaveBeenCalled()
  })
})
