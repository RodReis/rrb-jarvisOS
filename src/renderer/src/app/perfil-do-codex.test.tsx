/**
 * O perfil do Codex na tela (SPEC-Multi-Executor-02, critérios 1, 4 e 6).
 *
 * O que este arquivo prova é o que o PI vê e o que ele **não** pode fazer sem decidir: que não há
 * campo para segredo, que o estado aparece com a ação de destravar, e que subir para um modo pago
 * exige marcar a autorização.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CodexBillingMode, CodexProfileState } from '@shared/domain/codex-profile'
import { PerfilDoCodex } from './PerfilDoCodex'

function estado(over: Partial<CodexProfileState> = {}): CodexProfileState {
  return {
    saude: 'auth_required',
    codexHome: 'C:/Users/pi/AppData/jarvis/codex-pipeline',
    modo: 'subscription_limited',
    verificadoEm: '2026-09-05T00:00:00.000Z',
    ...over
  }
}

function montar(over: Partial<CodexProfileState> = {}, aplicado?: CodexBillingMode | undefined) {
  const onTrocarModo = vi.fn(async () => aplicado)
  const onEntrar = vi.fn(async () => ({
    ok: true,
    instrucao: 'Acesse https://x.test — código ABCD'
  }))
  const onSair = vi.fn(async () => true)
  const onRecarregar = vi.fn()

  render(
    <PerfilDoCodex
      estado={estado(over)}
      onEntrar={onEntrar}
      onSair={onSair}
      onTrocarModo={onTrocarModo}
      onRecarregar={onRecarregar}
    />
  )

  return { onTrocarModo, onEntrar, onSair, onRecarregar }
}

describe('PerfilDoCodex — o segredo não tem onde entrar (critério 1)', () => {
  /**
   * **A garantia central da tela**, e é por ausência: nenhum campo de senha, token ou chave.
   *
   * O login acontece no CLI, por fluxo de dispositivo. Um formulário aqui seria exatamente o que
   * o critério 1 proíbe — e o teste falha se alguém acrescentar um "por conveniência".
   */
  it('não oferece campo de senha, token ou chave de API', () => {
    montar()

    expect(document.querySelector('input[type="password"]')).toBeNull()
    for (const proibido of [/token/i, /senha/i, /password/i, /api ?key/i, /chave/i]) {
      expect(screen.queryByLabelText(proibido)).toBeNull()
    }
  })

  it('mostra a instrução do navegador depois de acionar o login', async () => {
    const { onEntrar } = montar()

    await userEvent.click(screen.getByRole('button', { name: /entrar no codex/i }))

    expect(onEntrar).toHaveBeenCalled()
    expect(await screen.findByText(/código ABCD/)).toBeInTheDocument()
  })
})

describe('PerfilDoCodex — saúde e ação (critério 6)', () => {
  it('nomeia o estado em pt-BR, não pelo enum cru', () => {
    montar({ saude: 'auth_required' })

    expect(screen.getByText(/login necessário/i)).toBeInTheDocument()
    expect(screen.queryByText('auth_required')).toBeNull()
  })

  it('mostra a ação concreta de quem precisa destravar', () => {
    montar({ saude: 'offline' })

    expect(screen.getByText(/instalado e no PATH/i)).toBeInTheDocument()
  })

  /**
   * `quota_unknown` é o estado **normal** deste CLI, e não traz ação.
   *
   * Um alerta permanente ali ensinaria a ignorar alertas — a mesma razão pela qual `ACAO_DA_SAUDE`
   * o deixa `undefined`.
   */
  it('não pede ação em quota desconhecida, que é o estado normal', () => {
    montar({ saude: 'quota_unknown' })

    expect(screen.getByText(/uso não reportado/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /** A referência ao perfil aparece; o conteúdo dele, não — não há conteúdo neste lado. */
  it('mostra o caminho do perfil da pipeline', () => {
    montar()
    expect(screen.getByText(/codex-pipeline/)).toBeInTheDocument()
  })

  /**
   * **O que o gate visual achou:** o caminho é uma palavra só, longa, e `flex-wrap` quebra entre
   * itens — nunca dentro de um token sem espaços.
   *
   * Sem `break-all`, um `C:\Users\...\AppData\Roaming\jarvisOS\codex-pipeline` empurra o painel
   * para fora da largura em tela estreita. Nenhum teste de papel ou de texto pega isso: a árvore
   * fica idêntica, só o layout quebra. É a mesma correção do SHA de 40 caracteres na M26-F04.
   */
  it('quebra o caminho longo do perfil em vez de transbordar o painel', () => {
    montar({ codexHome: 'C:/Users/rodrigo/AppData/Roaming/jarvisOS/perfis/codex-pipeline' })

    const caminho = screen.getByText(/codex-pipeline/)
    expect(caminho.className).toContain('break-all')
  })
})

describe('PerfilDoCodex — modo de cobrança (critério 4, regra 4)', () => {
  /**
   * **A regra 3 na tela:** sem marcar a autorização, a troca é recusada e a tela **diz por quê**.
   *
   * Reverter o combo em silêncio pareceria defeito, não política — e o PI tentaria de novo sem
   * entender o que falta.
   */
  it('recusa a subida sem autorização e explica o motivo', async () => {
    const { onTrocarModo } = montar({}, undefined)

    // O `Select` do DS é Radix (botão + listbox), não `<select>` nativo: abrir e clicar na opção.
    await userEvent.click(screen.getByRole('combobox', { name: /modo de cobrança/i }))
    await userEvent.click(await screen.findByRole('option', { name: /créditos da assinatura/i }))

    expect(onTrocarModo).toHaveBeenCalledWith('subscription_credits', false)
    expect(await screen.findByText(/exigem habilitação explícita/i)).toBeInTheDocument()
  })

  it('passa a autorização quando o PI a marca', async () => {
    const { onTrocarModo } = montar({}, 'subscription_credits')

    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('combobox', { name: /modo de cobrança/i }))
    await userEvent.click(await screen.findByRole('option', { name: /créditos da assinatura/i }))

    expect(onTrocarModo).toHaveBeenCalledWith('subscription_credits', true)
  })

  /** Modo que gasta dinheiro avisa que a execução é barrada sem teto (critério 5). */
  it('avisa sobre o gate de teto quando o modo vigente gasta dinheiro', () => {
    montar({ modo: 'api' })

    expect(screen.getByText(/teto de créditos/i)).toBeInTheDocument()
  })

  it('não avisa sobre gasto no modo de assinatura', () => {
    montar({ modo: 'subscription_limited' })

    expect(screen.queryByText(/este modo gasta dinheiro/i)).toBeNull()
  })
})
