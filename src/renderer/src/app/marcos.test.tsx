import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinhaDeMarco, VistaDeMarcos } from '@shared/domain/marcos'
import { MarcosDoProjeto } from './MarcosDoProjeto'

/**
 * O painel de marcos (SPEC-Fases-04, critérios 1 a 3).
 *
 * O que esta suíte prova não é que o componente renderiza — é o que a spec exige dele:
 *
 *  - **estado nunca só por cor** (PRD §14): o rótulo diz em palavra o que o tom diz em cor;
 *  - **"Commitar marco" é a retomada da M8-F01** (critério 3): o botão chama `completeMilestone`,
 *    e não existe caminho de commit próprio na ponte;
 *  - **worktree sujo aparece pelo caminho, sem conteúdo** (critério 2).
 */

const marcosDoProjeto = vi.fn()
const completeMilestone = vi.fn()

function linha(over: Partial<LinhaDeMarco> = {}): LinhaDeMarco {
  return {
    caminho: 'docs/PRD.md',
    estado: 'commitado',
    hashDaRevisao: 'a'.repeat(64),
    commit: 'c0ffee1234567890abcdef1234567890abcdef12',
    data: '2026-09-04T10:00:00.000Z',
    hashDoBlob: 'a'.repeat(64),
    ...over
  }
}

function vista(over: Partial<VistaDeMarcos> = {}): VistaDeMarcos {
  return {
    disponivel: true,
    linhas: [linha()],
    repositorio: { sujos: [], headInterrompido: false, head: 'abc1234' },
    ...over
  }
}

beforeEach(() => {
  marcosDoProjeto.mockReset().mockResolvedValue(vista())
  completeMilestone.mockReset().mockResolvedValue({
    marco: 'prd-aprovado',
    commitado: true,
    mensagem: 'docs: PRD aprovado'
  })

  // `stubGlobal` + `unstubAllGlobals`, e não `defineProperty`: é o padrão do
  // `console-da-geracao.test.tsx`, e misturar os dois quebra no CI. Uma ponte definida por
  // `defineProperty` sobrevive ao `unstubAllGlobals` do vizinho, e o stub dele passa a
  // sobrescrever a nossa — a falha aparece só quando os arquivos correm juntos, com o erro num
  // teste que não tem nada a ver (`Cannot read properties of undefined`).
  vi.stubGlobal('jarvis', { marcosDoProjeto, completeMilestone, sendLog: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function montar(): void {
  render(<MarcosDoProjeto projectId="p-1" workspace="jarvis" />)
}

describe('Painel de marcos', () => {
  it('mostra o documento, o hash curto e o estado em palavra', async () => {
    montar()

    expect(await screen.findByText('docs/PRD.md')).toBeInTheDocument()
    // O hash curto é o que o PI compara com o `git log`.
    expect(screen.getByText('c0ffee1')).toBeInTheDocument()
    // Estado em palavra, não só em cor (PRD §14). Aparece duas vezes de propósito: no resumo do
    // cabeçalho (o veredito do projeto, legível com a seção fechada) e no badge da linha.
    expect(screen.getAllByText('versionado')).toHaveLength(2)
  })

  it('nomeia o commit desatualizado sem falar "blob" ao PI', async () => {
    marcosDoProjeto.mockResolvedValue(
      vista({ linhas: [linha({ estado: 'blob-divergente', hashDoBlob: 'b'.repeat(64) })] })
    )
    montar()

    expect(await screen.findByText('commit desatualizado')).toBeInTheDocument()
    expect(
      screen.getByText('O commit guarda uma versão anterior à que foi aceita.')
    ).toBeInTheDocument()
  })

  it('oferece "Commitar marco" só quando falta commit', async () => {
    marcosDoProjeto.mockResolvedValue(vista({ linhas: [linha({ estado: 'revisao-sem-commit' })] }))
    montar()

    expect(await screen.findByRole('button', { name: /commitar marco/i })).toBeInTheDocument()
  })

  it('não oferece "Commitar marco" no que já está versionado', async () => {
    montar()

    await screen.findByText('docs/PRD.md')
    expect(screen.queryByRole('button', { name: /commitar marco/i })).not.toBeInTheDocument()
  })

  /**
   * O critério 3 na forma de teste: o botão usa a **retomada** da M8-F01.
   *
   * A prova de que não há segundo caminho de commit é dupla — o botão chama `completeMilestone`,
   * e a ponte inteira não expõe nenhum outro método capaz de escrever no Git.
   */
  it('"Commitar marco" chama a retomada da M8-F01, e não um commit próprio', async () => {
    marcosDoProjeto.mockResolvedValue(vista({ linhas: [linha({ estado: 'revisao-sem-commit' })] }))
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /commitar marco/i }))

    expect(completeMilestone).toHaveBeenCalledWith('p-1', 'prd-aprovado', 'jarvis')
    // E relê depois: sem isso o painel ficaria mostrando "sem commit" para um marco já commitado.
    await waitFor(() => expect(marcosDoProjeto).toHaveBeenCalledTimes(2))
  })

  it('lista o arquivo sujo pelo caminho, sem mostrar conteúdo', async () => {
    marcosDoProjeto.mockResolvedValue(
      vista({ repositorio: { sujos: ['rascunho.md'], headInterrompido: false, head: 'abc1234' } })
    )
    montar()

    expect(await screen.findByText(/rascunho\.md/)).toBeInTheDocument()
    expect(screen.getByText('árvore suja')).toBeInTheDocument()
  })

  it('avisa do merge interrompido com a ação, não só com o fato', async () => {
    marcosDoProjeto.mockResolvedValue(
      vista({ repositorio: { sujos: [], headInterrompido: true, head: 'abc1234' } })
    )
    montar()

    expect(await screen.findByText(/merge ou rebase interrompido/i)).toBeInTheDocument()
    expect(screen.getByText(/Conclua ou aborte/i)).toBeInTheDocument()
  })

  it('explica em vez de listar vazio quando o Git não está disponível', async () => {
    marcosDoProjeto.mockResolvedValue({
      disponivel: false,
      linhas: [],
      repositorio: { sujos: [], headInterrompido: false, head: '' },
      mensagem: 'O comando `git` não está permitido neste espaço.'
    })
    montar()

    expect(await screen.findByText(/não está permitido neste espaço/i)).toBeInTheDocument()
  })

  it('relê o repositório quando o PI pede "Verificar de novo"', async () => {
    montar()

    await screen.findByText('docs/PRD.md')
    await userEvent.click(screen.getByRole('button', { name: /verificar de novo/i }))

    await waitFor(() => expect(marcosDoProjeto).toHaveBeenCalledTimes(2))
  })

  it('não desenha o painel quando o projeto não tem marco algum', async () => {
    marcosDoProjeto.mockResolvedValue(vista({ linhas: [] }))
    const { container } = render(<MarcosDoProjeto projectId="p-1" workspace="jarvis" />)

    // Painel vazio "Marcos" seria ruído — mesma razão pela qual o console da F03 se omite.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
