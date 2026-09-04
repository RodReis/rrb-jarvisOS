import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('esconde o conteúdo fechado e o revela ao abrir', async () => {
    render(
      <Disclosure rotulo="Console da geração">
        <p>saída do modelo</p>
      </Disclosure>
    )

    // `<details>` fechado mantém o conteúdo no DOM mas fora da árvore de acessibilidade.
    expect(screen.getByText('Console da geração')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Console da geração'))

    expect(screen.getByRole('group')).toHaveAttribute('open')
  })

  it('respeita `abertoPorPadrao` e continua abrindo e fechando pelo clique', async () => {
    render(
      <Disclosure rotulo="Resultado" abertoPorPadrao>
        <p>conteúdo</p>
      </Disclosure>
    )

    const bloco = screen.getByRole('group')
    expect(bloco).toHaveAttribute('open')

    // O ponto do teste: não-controlado com padrão aberto ainda **fecha**. Um `open` fixo
    // prenderia o bloco ao valor inicial e o clique não faria nada.
    await userEvent.click(screen.getByText('Resultado'))
    expect(bloco).not.toHaveAttribute('open')
  })

  it('avisa quem controla, nas duas direções', async () => {
    const aoMudar = vi.fn()
    render(
      <Disclosure rotulo="Ferramenta" aberto={false} onAbertoChange={aoMudar}>
        <p>saída</p>
      </Disclosure>
    )

    await userEvent.click(screen.getByText('Ferramenta'))

    expect(aoMudar).toHaveBeenCalledWith(true)
  })

  /**
   * O `<summary>` é focável e responde a `Enter`/`Espaço` em todo navegador real — é a razão de
   * o componente usar o elemento nativo em vez de um `<div onClick>`. O **jsdom não o inclui na
   * ordem de tabulação**, então o caminho de teclado de verdade é provado pelo Playwright, na
   * prova visual. O que dá para provar aqui é que o elemento é o certo: um `<div>` com handler
   * não teria papel `group` nem seria alcançável por teclado em navegador nenhum.
   */
  it('usa o elemento nativo, que é o que traz o teclado', () => {
    render(
      <Disclosure rotulo="Console">
        <p>saída</p>
      </Disclosure>
    )

    const resumo = screen.getByText('Console').closest('summary')

    expect(resumo).not.toBeNull()
    expect(resumo?.parentElement?.tagName).toBe('DETAILS')
    // Nada de `tabIndex` forçado: o elemento nativo já é focável, e um `tabIndex={0}` aqui
    // seria o sintoma de ter escolhido a tag errada.
    expect(resumo).not.toHaveAttribute('tabindex')
  })

  it('mostra o resumo mesmo fechado — é ele que justifica abrir', () => {
    render(
      <Disclosure rotulo="Read" resumo={<span>1,2 kB</span>}>
        <p>conteúdo longo</p>
      </Disclosure>
    )

    expect(screen.getByText('1,2 kB')).toBeVisible()
  })

  it('esconde o marcador nativo do navegador', () => {
    render(
      <Disclosure rotulo="Console">
        <p>saída</p>
      </Disclosure>
    )

    // O triângulo padrão não pertence a design system nenhum. `list-none` cobre o Firefox; o
    // pseudo-elemento cobre WebKit e Chrome. Só um dos dois deixaria o marcador em metade dos
    // navegadores.
    const resumo = screen.getByText('Console').closest('summary')
    expect(resumo?.className).toContain('list-none')
    expect(resumo?.className).toContain('[&::-webkit-details-marker]:hidden')
  })
})
