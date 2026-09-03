import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptDoProjeto } from './PromptDoProjeto'
import { BriefDoProjeto } from './BriefDoProjeto'

/**
 * O prompt e o gate do brief (SPEC-Jornada-02, categoria Tela).
 *
 * As telas são testadas **isoladas**, não pelo `App`: o que se investiga é o que elas pedem ao
 * main e o que mostram do que voltou. A ponte é mockada porque o renderer não decide nada —
 * rota, validação e corte são do main, e um mock que decidisse aqui provaria a política do
 * teste, não a do produto.
 *
 * O que estes testes protegem:
 *  - **Critério 6 na tela:** o bloqueio aparece **antes** do clique, e o botão não gera.
 *  - **Critério 4:** os propostos são visíveis como conjunto, não descobertos lendo dez blocos.
 *  - **Critério 5:** só `proposto` oferece corte; o que veio do PI não tem botão.
 *  - **Princípio 2:** a origem é dita em texto, não pintada — verificável por papel.
 */

const lerPromptDoProjeto = vi.fn()
const salvarPromptDoProjeto = vi.fn()
const gerarBrief = vi.fn()
const rotaDaGeracao = vi.fn()
const carregarBrief = vi.fn()
const cortarPropostoDoBrief = vi.fn()
const aplicarEventoDaJornada = vi.fn()

function afirmacao(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    bloco: 'problema-usuarios-resultado',
    texto: 'O leitor perde o fio das leituras.',
    origem: 'prompt',
    ...over
  }
}

function brief(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    promptId: 'pr-1',
    afirmacoes: [afirmacao()],
    pendencias: [],
    hash: 'h',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  }
}

beforeEach(() => {
  lerPromptDoProjeto.mockReset().mockResolvedValue(null)
  salvarPromptDoProjeto.mockReset().mockResolvedValue({ id: 'pr-1' })
  gerarBrief.mockReset().mockResolvedValue({ resultado: 'gerado', mensagem: 'ok' })
  rotaDaGeracao.mockReset().mockResolvedValue({ decisao: 'assinatura' })
  carregarBrief.mockReset().mockResolvedValue(null)
  cortarPropostoDoBrief.mockReset().mockResolvedValue(null)
  aplicarEventoDaJornada.mockReset().mockResolvedValue({ resultado: 'avancou' })

  Object.defineProperty(window, 'jarvis', {
    value: {
      lerPromptDoProjeto,
      salvarPromptDoProjeto,
      gerarBrief,
      rotaDaGeracao,
      carregarBrief,
      cortarPropostoDoBrief,
      aplicarEventoDaJornada,
      sendLog: vi.fn()
    },
    configurable: true,
    writable: true
  })
})

describe('PromptDoProjeto', () => {
  it('mostra o campo vazio quando o projeto ainda não tem prompt', async () => {
    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={vi.fn()}
      />
    )

    expect(await screen.findByRole('textbox')).toHaveValue('')
  })

  it('devolve o texto já escrito — reabrir não custa o rascunho', async () => {
    lerPromptDoProjeto.mockResolvedValue({ texto: 'Um app de leituras.' })

    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={vi.fn()}
      />
    )

    expect(await screen.findByRole('textbox')).toHaveValue('Um app de leituras.')
  })

  it('não gera com o campo vazio, e diz por quê', async () => {
    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={vi.fn()}
      />
    )

    const botao = await screen.findByRole('button', { name: /Gerar o brief/ })

    // Alvo desabilitado sem explicação faz o PI procurar o defeito na própria escrita.
    expect(botao).toBeDisabled()
    expect(screen.getByText('Escreva o prompt para continuar.')).toBeInTheDocument()
  })

  it('salva e gera num ato só', async () => {
    const usuario = userEvent.setup()
    const onAvancar = vi.fn()

    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={onAvancar}
      />
    )

    await usuario.type(await screen.findByRole('textbox'), 'Um app de leituras.')
    await usuario.click(screen.getByRole('button', { name: /Gerar o brief/ }))

    await waitFor(() => expect(onAvancar).toHaveBeenCalled())
    expect(salvarPromptDoProjeto).toHaveBeenCalledWith('p-1', 'Um app de leituras.', 'jarvis')
    expect(gerarBrief).toHaveBeenCalledWith('p-1', 'jarvis')
  })

  it('mostra o bloqueio de rota **antes** do clique, com a ação (critério 6)', async () => {
    rotaDaGeracao.mockResolvedValue({
      decisao: 'bloqueado',
      motivo: 'sem-rota-alguma',
      acao: 'Conecte a assinatura do Claude em Providers.'
    })

    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={vi.fn()}
      />
    )

    // Descobrir que não há rota só ao tentar gerar seria a mesma fricção que o critério evita
    // no custo, repetida na atenção.
    expect(
      await screen.findByText('Conecte a assinatura do Claude em Providers.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gerar o brief/ })).toBeDisabled()
  })

  it('bloqueado, o botão não chama a geração nem com texto escrito', async () => {
    const usuario = userEvent.setup()
    rotaDaGeracao.mockResolvedValue({
      decisao: 'bloqueado',
      motivo: 'sem-rota-alguma',
      acao: 'Conecte a assinatura.'
    })

    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={vi.fn()}
      />
    )

    await usuario.type(await screen.findByRole('textbox'), 'Um app.')

    expect(screen.getByRole('button', { name: /Gerar o brief/ })).toBeDisabled()
    expect(gerarBrief).not.toHaveBeenCalled()
  })

  it('recusa da geração vira mensagem com a ação, não erro cru', async () => {
    const usuario = userEvent.setup()
    gerarBrief.mockResolvedValue({
      resultado: 'bloqueado-sem-rota',
      mensagem: 'A geração não aconteceu.',
      acao: 'Habilite a rota paga.'
    })

    render(
      <PromptDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAvancar={vi.fn()}
      />
    )

    await usuario.type(await screen.findByRole('textbox'), 'Um app.')
    await usuario.click(screen.getByRole('button', { name: /Gerar o brief/ }))

    expect(await screen.findByText(/Habilite a rota paga/)).toBeInTheDocument()
  })
})

describe('BriefDoProjeto', () => {
  it('mostra o vazio antes de existir brief', async () => {
    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    expect(await screen.findByText('Nenhum brief ainda')).toBeInTheDocument()
  })

  it('diz a origem de cada afirmação em texto, não em cor (princípio 2)', async () => {
    carregarBrief.mockResolvedValue(brief())

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    // Verificável por texto: quem lê em escala de cinza recebe a mesma informação.
    expect(await screen.findByText('do seu prompt')).toBeInTheDocument()
  })

  it('lista os propostos como conjunto, acima do brief (critério 4)', async () => {
    carregarBrief.mockResolvedValue(
      brief({
        afirmacoes: [
          afirmacao({ id: 'a-1', origem: 'prompt' }),
          afirmacao({ id: 'a-2', origem: 'proposto', texto: 'O app deve ter modo offline.' })
        ]
      })
    )

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    // Descobrir os propostos lendo dez blocos seria pedir ao PI a varredura que a lista faz.
    const painel = await screen.findByRole('region', { name: /propostas pela IA/ })
    expect(within(painel).getByText('O app deve ter modo offline.')).toBeInTheDocument()
  })

  it('só o proposto oferece corte — o que veio do PI não tem botão (critério 5)', async () => {
    carregarBrief.mockResolvedValue(
      brief({
        afirmacoes: [
          afirmacao({ id: 'a-1', origem: 'prompt', texto: 'Veio do PI.' }),
          afirmacao({ id: 'a-2', origem: 'proposto', texto: 'Inferido pela IA.' })
        ]
      })
    )

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    await screen.findByText('Veio do PI.')

    expect(screen.queryByRole('button', { name: /Cortar a afirmação: Veio do PI/ })).toBeNull()
    expect(
      screen.getAllByRole('button', { name: /Cortar a afirmação: Inferido pela IA/ }).length
    ).toBeGreaterThan(0)
  })

  it('cortar manda um id só — a tela não decide o conteúdo final', async () => {
    const usuario = userEvent.setup()
    carregarBrief.mockResolvedValue(
      brief({
        afirmacoes: [afirmacao({ id: 'a-2', origem: 'proposto', texto: 'Inferido.' })]
      })
    )
    cortarPropostoDoBrief.mockResolvedValue(brief({ afirmacoes: [] }))

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    const botoes = await screen.findAllByRole('button', { name: /Cortar a afirmação/ })
    await usuario.click(botoes[0]!)

    // Mandar a lista do que sobra faria um erro da tela apagar afirmação vinda do PI.
    expect(cortarPropostoDoBrief).toHaveBeenCalledWith('p-1', 'a-2', 'jarvis')
  })

  it('pendência material avisa **quais** faltam, não só quantas', async () => {
    carregarBrief.mockResolvedValue(
      brief({
        pendencias: [{ bloco: 'dominio-e-dados', pergunta: 'Qual base de dados?', material: true }]
      })
    )

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    // Um número sem os itens obrigaria o PI a caçar os buracos pelos dez blocos.
    expect(await screen.findByText('Qual base de dados?')).toBeInTheDocument()
  })

  it('bloco sem afirmação não vira seção', async () => {
    carregarBrief.mockResolvedValue(brief())

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    await screen.findByText('O leitor perde o fio das leituras.')

    // Dez cabeçalhos com "nenhuma afirmação" seriam ruído que esconde o conteúdo real.
    expect(screen.queryByText('Jornadas')).toBeNull()
    expect(screen.getByText('Problema, usuários e resultado')).toBeInTheDocument()
  })

  /*
   * O gate de aceite (critério 5).
   *
   * Antes destes testes a tela **calculava** `podeAceitar` e não renderizava botão algum: a
   * jornada não tinha como sair do brief pela interface. Um teste de "mostra os propostos"
   * passava verde sobre esse buraco, porque ninguém perguntava pela saída.
   */
  it('oferece o aceite quando nada material está pendente', async () => {
    carregarBrief.mockResolvedValue(brief())

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    expect(await screen.findByRole('button', { name: /Aceitar o brief/ })).toBeEnabled()
  })

  it('pendência material desabilita o aceite e diz por quê', async () => {
    carregarBrief.mockResolvedValue(
      brief({
        pendencias: [{ bloco: 'escopo-e-metricas', pergunta: 'Qual a métrica?', material: true }]
      })
    )

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)

    // Alvo morto sem explicação faria o PI procurar o defeito no próprio brief.
    expect(await screen.findByRole('button', { name: /Aceitar o brief/ })).toBeDisabled()
    expect(screen.getByText(/Resolva as pendências acima/)).toBeInTheDocument()
  })

  it('bloqueado, o aceite não move a jornada', async () => {
    carregarBrief.mockResolvedValue(
      brief({
        pendencias: [{ bloco: 'escopo-e-metricas', pergunta: 'Qual a métrica?', material: true }]
      })
    )

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)
    await screen.findByRole('button', { name: /Aceitar o brief/ })

    expect(aplicarEventoDaJornada).not.toHaveBeenCalled()
  })

  it('aceitar vai pelo canal de evento da jornada, não por um canal próprio', async () => {
    const usuario = userEvent.setup()
    carregarBrief.mockResolvedValue(brief())

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)
    await usuario.click(await screen.findByRole('button', { name: /Aceitar o brief/ }))

    // Uma segunda via de escrita da etapa escaparia da checagem de ordem que o evento faz.
    await waitFor(() =>
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'brief-aceito', 'jarvis')
    )
  })

  it('aceitar avisa o pai — a trilha ficaria na etapa velha', async () => {
    const usuario = userEvent.setup()
    const onAceito = vi.fn()
    carregarBrief.mockResolvedValue(brief())

    render(
      <BriefDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAceito={onAceito}
      />
    )
    await usuario.click(await screen.findByRole('button', { name: /Aceitar o brief/ }))

    await waitFor(() => expect(onAceito).toHaveBeenCalled())
  })

  it('falha técnica no aceite vira mensagem, não silêncio', async () => {
    const usuario = userEvent.setup()
    carregarBrief.mockResolvedValue(brief())
    aplicarEventoDaJornada.mockRejectedValue(new Error('ponte caiu'))

    render(<BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />)
    await usuario.click(await screen.findByRole('button', { name: /Aceitar o brief/ }))

    // Sem isto o PI clica, nada acontece, e ele não sabe se aceitou.
    expect(await screen.findByText(/Não foi possível registrar o aceite/)).toBeInTheDocument()
  })
})
