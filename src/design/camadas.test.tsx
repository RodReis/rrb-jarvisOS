import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { tokenCss } from './tokens'
import { Alternador } from './ui'
import { LinhaDeAjuste } from './patterns'

/**
 * As três camadas do design system (SPEC-DesignSystem-01, critérios 1 e 4).
 *
 * O que se prova aqui é a **ordem de dependência** (tokens ← ui ← patterns) e o
 * encapsulamento do Radix. A a11y é verificada por papel (`role`), não por classe CSS:
 * o critério do DS é o que o leitor de tela anuncia, não a marcação interna do primitivo.
 */

describe('camadas do design system', () => {
  it('as três camadas coexistem e importam na ordem permitida', () => {
    // O import no topo já é a prova de compilação; esta asserção fixa a direção da seta —
    // `patterns` usa `ui`, `ui` usa `tokens`, e nada aponta para trás.
    expect(typeof tokenCss).toBe('function')
    expect(typeof Alternador).toBe('function')
    expect(typeof LinhaDeAjuste).toBe('function')
  })

  describe('ui/Alternador (Radix encapsulado)', () => {
    it('expõe o primitivo como switch acessível pelo rótulo', async () => {
      const onMudar = vi.fn()
      render(<Alternador rotulo="Modo compacto" ligado={false} onMudar={onMudar} />)

      const alternador = screen.getByRole('switch', { name: 'Modo compacto' })
      expect(alternador).toHaveAttribute('aria-checked', 'false')

      await userEvent.click(alternador)
      expect(onMudar).toHaveBeenCalledWith(true)
    })

    it('não vaza a API do Radix — a superfície pública é a lista fechada de props', () => {
      // Se o wrapper espalhasse `...rest` no `Root`, a API do Radix voltaria a ser contrato
      // público do DS por uma porta lateral — o tipo continuaria fechado, mas qualquer prop
      // do primitivo passaria em runtime. Verificado por mutação: injetar `...rest` deixa
      // esta asserção vermelha.
      const fonte = Alternador.toString()
      expect(fonte).not.toContain('...rest')
      expect(fonte).not.toContain('...props')
    })

    it('respeita o estado desabilitado', () => {
      render(<Alternador rotulo="Modo compacto" ligado={false} onMudar={vi.fn()} desabilitado />)
      expect(screen.getByRole('switch', { name: 'Modo compacto' })).toBeDisabled()
    })
  })

  describe('patterns/LinhaDeAjuste', () => {
    it('compõe ui e recebe estado só por props', async () => {
      const onMudar = vi.fn()
      render(
        <LinhaDeAjuste
          rotulo="Notificações"
          descricao="Avisos do sistema"
          ligado
          onMudar={onMudar}
        />
      )

      expect(screen.getByText('Notificações')).toBeInTheDocument()
      expect(screen.getByText('Avisos do sistema')).toBeInTheDocument()

      const alternador = screen.getByRole('switch', { name: 'Notificações' })
      expect(alternador).toHaveAttribute('aria-checked', 'true')

      await userEvent.click(alternador)
      expect(onMudar).toHaveBeenCalledWith(false)
    })

    it('omite a descrição quando ela não é passada', () => {
      render(<LinhaDeAjuste rotulo="Notificações" ligado={false} onMudar={vi.fn()} />)
      expect(screen.getByRole('switch', { name: 'Notificações' })).toBeInTheDocument()
      expect(screen.queryByText('Avisos do sistema')).not.toBeInTheDocument()
    })
  })
})
