import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TabPanel, Tabs } from './Tabs'

/**
 * Abas (PRD §11.3, categoria Tela).
 *
 * O que se prova: o padrão ARIA (tablist nomeada, seleção anunciada) e o contrato de conteúdo —
 * **só o painel ativo existe no DOM**. A segunda parte é a que importa para o Settings: as
 * seções escopadas ao espaço buscam dados ao montar, e montar as cinco abas de uma vez faria a
 * tela disparar toda busca de todas as abas na abertura, que é o custo que as abas existem para
 * evitar.
 */

function Exemplo(): React.JSX.Element {
  return (
    <Tabs
      padrao="um"
      rotulo="Exemplo"
      abas={[
        { valor: 'um', rotulo: 'Primeira' },
        { valor: 'dois', rotulo: 'Segunda' }
      ]}
    >
      <TabPanel valor="um">
        <p>Conteúdo da primeira</p>
      </TabPanel>
      <TabPanel valor="dois">
        <p>Conteúdo da segunda</p>
      </TabPanel>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('expõe tablist nomeada com a aba padrão selecionada', () => {
    render(<Exemplo />)

    expect(screen.getByRole('tablist', { name: 'Exemplo' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Primeira' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveAttribute('aria-selected', 'false')
  })

  it('mostra só o painel ativo — o inativo não está no DOM', async () => {
    const usuario = userEvent.setup()
    render(<Exemplo />)

    expect(screen.getByText('Conteúdo da primeira')).toBeInTheDocument()
    // Ausente do DOM, não escondido por CSS: é o que garante que uma seção com busca de dados
    // só busca quando a aba dela abre.
    expect(screen.queryByText('Conteúdo da segunda')).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('tab', { name: 'Segunda' }))

    expect(screen.getByText('Conteúdo da segunda')).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo da primeira')).not.toBeInTheDocument()
  })

  it('navega entre abas pelo teclado (setas do padrão ARIA)', async () => {
    const usuario = userEvent.setup()
    render(<Exemplo />)

    screen.getByRole('tab', { name: 'Primeira' }).focus()
    await usuario.keyboard('{ArrowRight}')

    // Radix ativa ao mover o foco (activation automática do padrão) — a seta já troca o painel.
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Conteúdo da segunda')).toBeInTheDocument()
  })
})
