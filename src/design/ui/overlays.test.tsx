import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog, Button, Dialog, DropdownMenu, Drawer, IconButton, Popover } from './index'

/**
 * Overlays (SPEC-DesignSystem-03b, critérios 1 e 3; PRD §11.5).
 *
 * O critério 1 pede três garantias por overlay: **focus-trap**, **Escape fecha** e **retorno de
 * foco ao gatilho**. Elas vêm do Radix, mas testá-las não é testar o Radix: é provar que o
 * encapsulamento desta camada não as quebrou. Um `Portal` esquecido, um `onOpenChange` que ignora
 * o `false`, um `Content` trocado por `div` — qualquer um mata as três sem que nada mais falhe.
 *
 * Tudo é consultado por papel, como na F03a: o critério é o que o leitor de tela anuncia.
 */

/**
 * Casca com gatilho real e estado real.
 *
 * O retorno de foco só é observável se existir um elemento **para onde voltar**. Renderizar o
 * overlay já aberto (`aberto={true}` fixo) testaria o focus-trap e mentiria sobre o retorno.
 */
function ComGatilho({
  render: renderOverlay
}: {
  readonly render: (aberto: boolean, fechar: () => void) => React.ReactNode
}): React.JSX.Element {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>
        Abrir
      </button>
      {renderOverlay(aberto, () => setAberto(false))}
    </>
  )
}

describe('Dialog (critério 1)', () => {
  it('prende o foco, fecha por Escape e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup()
    render(
      <ComGatilho
        render={(aberto, fechar) => (
          <Dialog aberto={aberto} onFechar={fechar} titulo="Editar workflow">
            <button type="button">Interno</button>
          </Dialog>
        )}
      />
    )

    const gatilho = screen.getByRole('button', { name: 'Abrir' })
    await user.click(gatilho)

    const dialogo = await screen.findByRole('dialog', { name: 'Editar workflow' })
    // Focus-trap: o Tab circula **dentro** do diálogo. Se o trap não existisse, o foco sairia
    // para o gatilho — que está fora e atrás do backdrop, inalcançável por mouse. É o cenário
    // que deixa quem navega por teclado preso num modal invisível.
    await user.tab()
    await user.tab()
    await user.tab()
    expect(dialogo).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()
  })

  it('o botão de fechar é nomeado e fecha sem perda silenciosa', async () => {
    const user = userEvent.setup()
    const onFechar = vi.fn()
    render(
      <Dialog aberto onFechar={onFechar} titulo="Detalhe" descricao="Impacto da mudança">
        <p>corpo</p>
      </Dialog>
    )

    // `descricao` precisa chegar como descrição acessível: é onde o impacto da ação é
    // anunciado (PRD §7.4). Um `<p>` solto no corpo não seria lido junto com o título.
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Impacto da mudança')

    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onFechar).toHaveBeenCalledTimes(1)
  })
})

describe('Drawer (critério 1)', () => {
  it('prende o foco, fecha por Escape e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup()
    render(
      <ComGatilho
        render={(aberto, fechar) => (
          <Drawer aberto={aberto} onFechar={fechar} titulo="Filtros">
            <button type="button">Interno</button>
          </Drawer>
        )}
      />
    )

    const gatilho = screen.getByRole('button', { name: 'Abrir' })
    await user.click(gatilho)

    const gaveta = await screen.findByRole('dialog', { name: 'Filtros' })
    await user.tab()
    await user.tab()
    expect(gaveta).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()
  })
})

describe('Popover (critério 1)', () => {
  it('abre pelo gatilho, fecha por Escape e devolve o foco', async () => {
    const user = userEvent.setup()
    render(
      <Popover gatilho={<button type="button">Abrir</button>}>
        <button type="button">Interno</button>
      </Popover>
    )

    const gatilho = screen.getByRole('button', { name: 'Abrir' })
    await user.click(gatilho)

    const conteudo = await screen.findByRole('dialog')
    expect(conteudo).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()
  })
})

describe('DropdownMenu (critério 1)', () => {
  it('é um menu de verdade: setas navegam, Enter aciona, Escape devolve o foco', async () => {
    const user = userEvent.setup()
    const onArquivar = vi.fn()
    const onExcluir = vi.fn()
    render(
      <DropdownMenu
        gatilho={<button type="button">Ações</button>}
        itens={[
          { rotulo: 'Arquivar', onSelecionar: onArquivar },
          { rotulo: 'Excluir', onSelecionar: onExcluir, destrutivo: true }
        ]}
      />
    )

    const gatilho = screen.getByRole('button', { name: 'Ações' })
    await user.click(gatilho)

    // `role="menu"` com `menuitem`s — é o que distingue de uma pilha de `<button>` num `<div>`.
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onExcluir).toHaveBeenCalledTimes(1)
    expect(onArquivar).not.toHaveBeenCalled()
    expect(gatilho).toHaveFocus()
  })

  it('Escape fecha sem selecionar nada', async () => {
    const user = userEvent.setup()
    const onSelecionar = vi.fn()
    render(
      <DropdownMenu
        gatilho={<button type="button">Ações</button>}
        itens={[{ rotulo: 'Arquivar', onSelecionar }]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Ações' }))
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onSelecionar).not.toHaveBeenCalled()
  })
})

describe('composição com `asChild` (correção da F03b)', () => {
  /*
   * O `asChild` do Radix **clona** o filho e injeta `ref`, handlers e atributos de estado nele.
   * O `Button` e o `IconButton` da F03a declaravam props à mão e descartavam o resto — o que
   * jogava tudo isso fora em silêncio.
   *
   * O efeito era invisível em jsdom e só apareceu na prova visual: o `AlertDialog` nunca focava
   * o botão seguro, e um `Tooltip` com `Button` dentro **não abria**. O que denuncia o defeito
   * sem navegador é o atributo de estado — se ele chega ao DOM, o clone funcionou.
   */
  it('o gatilho recebe os atributos que o primitivo injeta', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu
        gatilho={<Button variante="secundaria">Ações</Button>}
        itens={[{ rotulo: 'Arquivar', onSelecionar: vi.fn() }]}
      />
    )

    const gatilho = screen.getByRole('button', { name: 'Ações' })
    // `aria-haspopup` e `aria-expanded` vêm do Radix, não do nosso código. Se o `Button` os
    // descartasse, o leitor de tela anunciaria um botão comum — sem dizer que abre um menu.
    expect(gatilho).toHaveAttribute('aria-haspopup', 'menu')
    expect(gatilho).toHaveAttribute('aria-expanded', 'false')

    await user.click(gatilho)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(gatilho).toHaveAttribute('aria-expanded', 'true')
  })

  it('o IconButton também compõe — é o gatilho natural do menu de ações', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu
        gatilho={<IconButton rotulo="Mais ações">⋯</IconButton>}
        itens={[{ rotulo: 'Arquivar', onSelecionar: vi.fn() }]}
      />
    )

    const gatilho = screen.getByRole('button', { name: 'Mais ações' })
    expect(gatilho).toHaveAttribute('aria-haspopup', 'menu')

    await user.click(gatilho)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('o AlertDialog aciona pelo handler que o primitivo injeta, não só pelo nosso onClick', async () => {
    const user = userEvent.setup()
    const onFechar = vi.fn()
    render(
      <AlertDialog
        aberto
        onFechar={onFechar}
        onConfirmar={vi.fn()}
        titulo="Excluir?"
        descricao="Permanente."
        verboConfirmar="Excluir"
      />
    )

    // `Cancelar` **não** recebe `onClick` nosso: quem fecha é o handler que o `Cancel` injeta
    // via `asChild`. É a asserção que distingue "o botão funciona" de "o clone funcionou" —
    // o teste do critério 3 passava mesmo com o `asChild` quebrado, porque o `onConfirmar`
    // chega por prop explícita.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledTimes(1)
  })
})

describe('AlertDialog (critérios 1 e 3)', () => {
  it('usa o papel alertdialog e exige o verbo específico no botão de confirmação', () => {
    render(
      <AlertDialog
        aberto
        onFechar={vi.fn()}
        onConfirmar={vi.fn()}
        titulo="Excluir 3 workflows?"
        descricao="Os workflows e o histórico de execução serão removidos."
        verboConfirmar="Excluir 3 workflows"
      />
    )

    // `alertdialog` e não `dialog`: o leitor de tela anuncia com urgência e não deixa o usuário
    // navegar para fora sem responder.
    const alerta = screen.getByRole('alertdialog', { name: 'Excluir 3 workflows?' })
    expect(alerta).toHaveAccessibleDescription(
      'Os workflows e o histórico de execução serão removidos.'
    )

    // O contrato do critério 3 é o **verbo**: "OK" pede fé, "Excluir 3 workflows" diz o que
    // acontece. Como `verboConfirmar` não tem default, o tipo já obriga — a asserção aqui
    // garante que ele chega ao rótulo acessível, e não é engolido por um texto fixo.
    expect(screen.getByRole('button', { name: 'Excluir 3 workflows' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ok$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('confirmar chama só onConfirmar; cancelar chama só onFechar', async () => {
    const user = userEvent.setup()
    const onConfirmar = vi.fn()
    const onFechar = vi.fn()
    const { rerender } = render(
      <AlertDialog
        aberto
        onFechar={onFechar}
        onConfirmar={onConfirmar}
        titulo="Excluir?"
        descricao="Permanente."
        verboConfirmar="Excluir"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledTimes(1)
    expect(onConfirmar).not.toHaveBeenCalled()

    rerender(
      <AlertDialog
        aberto
        onFechar={onFechar}
        onConfirmar={onConfirmar}
        titulo="Excluir?"
        descricao="Permanente."
        verboConfirmar="Excluir"
      />
    )
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(onConfirmar).toHaveBeenCalledTimes(1)
  })

  it('não fecha por clique fora — destrutivo exige resposta explícita', async () => {
    const user = userEvent.setup()
    const onFechar = vi.fn()
    render(
      <>
        <button type="button" data-testid="fora">
          Fora
        </button>
        <AlertDialog
          aberto
          onFechar={onFechar}
          onConfirmar={vi.fn()}
          titulo="Excluir?"
          descricao="Permanente."
          verboConfirmar="Excluir"
        />
      </>
    )

    // A distinção de fundo entre `Dialog` e `AlertDialog`: um clique distraído fora não pode
    // descartar uma pergunta destrutiva. Quem fecha é Cancelar ou Confirmar, nunca o acaso.
    //
    // O conteúdo de trás fica inerte por duas vias, e ambas são a evidência do critério.
    //
    // (a) `aria-hidden` — o botão sai da árvore acessível: `getByRole` não o acha, só
    //     `getByTestId`. Para um leitor de tela, não existe nada fora do diálogo.
    // (b) `pointer-events: none` — o `userEvent` **recusa** clicar num elemento inerte, e essa
    //     recusa é a prova de que o clique fora não chega a lugar nenhum. Forçar por
    //     `fireEvent` furaria a barreira e mediria outra coisa.
    expect(screen.queryByRole('button', { name: 'Fora' })).not.toBeInTheDocument()
    await expect(user.click(screen.getByTestId('fora'))).rejects.toThrow(/pointer-events/)
    expect(onFechar).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('Escape fecha — o critério 1 vale também aqui, e Escape é intenção, não acaso', async () => {
    const user = userEvent.setup()
    const onFechar = vi.fn()
    const onConfirmar = vi.fn()
    render(
      <AlertDialog
        aberto
        onFechar={onFechar}
        onConfirmar={onConfirmar}
        titulo="Excluir?"
        descricao="Permanente."
        verboConfirmar="Excluir"
      />
    )

    // A assimetria é deliberada: clique fora é distração, Escape é uma tecla deliberada com o
    // significado universal de "cancelar". Bloquear os dois deixaria o usuário de teclado preso
    // num diálogo sem saída — o oposto do que o critério 1 exige. O que Escape **nunca** faz é
    // confirmar: sair equivale a cancelar, nunca a executar o destrutivo.
    await user.keyboard('{Escape}')
    expect(onFechar).toHaveBeenCalledTimes(1)
    expect(onConfirmar).not.toHaveBeenCalled()
  })
})
