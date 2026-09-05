/**
 * O combo de modelo por fase, com duas assinaturas (SPEC-Fases-06, critério 7).
 *
 * O que este arquivo prova é o que o PI vê ao escolher: que Sol aparece no Planejamento, que
 * `gpt-5.5` aparece **desabilitado com motivo** na Construção, e que o fornecedor de cada opção é
 * legível — com Claude e Codex na mesma lista, "Opus 5" e "Sol" lado a lado sem o nome do
 * fornecedor faria o PI escolher às cegas.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { politicaDeModeloPadrao } from '@shared/domain/modelo-da-fase'
import { ModelosPorFase } from './ModelosPorFase'

const getPhaseModels = vi.fn()
const setPhaseModel = vi.fn()
const sendLog = vi.fn()

beforeEach(() => {
  getPhaseModels.mockResolvedValue(politicaDeModeloPadrao('u-1', 'jarvis'))
  setPhaseModel.mockResolvedValue(politicaDeModeloPadrao('u-1', 'jarvis'))

  // `stubGlobal` e não `defineProperty`: o segundo sobrevive ao `unstubAllGlobals` de outro
  // arquivo e quebra o vizinho só no CI.
  vi.stubGlobal('jarvis', { getPhaseModels, setPhaseModel, sendLog })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** A combo de uma fase e rota, pelos data-attributes que o componente escreve. */
function comboDe(fase: string, rota: string): HTMLElement {
  const alvo = document.querySelector(`[data-jos-fase="${fase}"][data-jos-rota="${rota}"]`)
  if (alvo === null) throw new Error(`combo ${fase}/${rota} não encontrada`)
  return alvo as HTMLElement
}

/**
 * Abre a combo e devolve a lista de opções.
 *
 * O `Select` do DS é Radix (botão + listbox em portal), não `<select>` nativo: as opções **não
 * existem no DOM** antes de abrir, e o portal as monta fora da subárvore da combo — por isso a
 * busca é em `screen`, não dentro do contêiner.
 */
async function abrirOpcoes(fase: string, rota: string): Promise<HTMLElement> {
  await userEvent.click(comboDe(fase, rota))
  return await screen.findByRole('listbox')
}

describe('ModelosPorFase — as duas assinaturas na mesma combo', () => {
  /**
   * O critério central: **Sol é escolhível no Planejamento**.
   *
   * Sem isto, o catálogo teria o Codex e a tela não o ofereceria — o PI não teria como pedir a
   * geração por Sol, e a fatia inteira ficaria sem superfície.
   */
  it('oferece os modelos do Codex na assinatura do Planejamento', async () => {
    render(<ModelosPorFase workspace="jarvis" />)
    await screen.findByText(/planejamento/i)

    const opcoes = await abrirOpcoes('planejamento', 'assinatura')
    expect(within(opcoes).getByText(/gpt-5\.6-sol/)).toBeInTheDocument()
  })

  /**
   * O fornecedor aparece em cada opção.
   *
   * Com Claude e Codex na mesma lista, um rótulo só com o nome do modelo faria o PI escolher sem
   * saber de quem ele é — e o ledger registraria um fornecedor que ele não decidiu usar.
   */
  it('nomeia o fornecedor de cada opção', async () => {
    render(<ModelosPorFase workspace="jarvis" />)
    await screen.findByText(/planejamento/i)

    const opcoes = await abrirOpcoes('planejamento', 'assinatura')
    expect(within(opcoes).getByText(/Codex CLI .* gpt-5\.6-sol/)).toBeInTheDocument()
    expect(within(opcoes).getByText(/Claude Code CLI .* claude-opus-5/)).toBeInTheDocument()
  })

  /**
   * **Critério 7:** na Construção, o modelo do Codex aparece **desabilitado com o motivo**.
   *
   * Listar e não atender seria fallback que não funciona; omitir seria silêncio — o PI veria a
   * opção sumir sem saber por quê. Desabilitar com motivo é a resposta que a spec pede.
   */
  it('desabilita o modelo do Codex na Construção, e diz por quê', async () => {
    render(<ModelosPorFase workspace="jarvis" />)
    await screen.findByText(/ainda não executa a Construção/i)

    const opcoes = await abrirOpcoes('construcao', 'assinatura')
    const opcao = within(opcoes)
      .getByText(/gpt-5\.5/)
      .closest('[role="option"]')

    expect(opcao).toHaveAttribute('aria-disabled', 'true')
  })

  /**
   * O contrafactual: o mesmo modelo **não** é desabilitado no Planejamento.
   *
   * Sem este caso, uma implementação que desabilitasse todo modelo do Codex em toda fase passaria
   * no teste acima e deixaria a fatia sem serventia.
   */
  it('não desabilita o Codex fora da Construção', async () => {
    render(<ModelosPorFase workspace="jarvis" />)
    await screen.findByText(/planejamento/i)

    const opcoes = await abrirOpcoes('planejamento', 'assinatura')
    const opcao = within(opcoes)
      .getByText(/gpt-5\.6-sol/)
      .closest('[role="option"]')

    expect(opcao).not.toHaveAttribute('aria-disabled', 'true')
  })

  /** A rota paga continua com um provider só — o Codex não entra nela nesta fatia. */
  it('não oferece modelos do Codex na rota paga', async () => {
    render(<ModelosPorFase workspace="jarvis" />)
    await screen.findByText(/planejamento/i)

    const opcoes = await abrirOpcoes('planejamento', 'paga')
    expect(within(opcoes).queryByText(/gpt-5/)).toBeNull()
  })
})
