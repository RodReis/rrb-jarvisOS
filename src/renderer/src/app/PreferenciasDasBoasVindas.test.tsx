import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfiguracaoDasBoasVindas } from '@shared/domain/boas-vindas'
import { PreferenciasDasBoasVindas } from './PreferenciasDasBoasVindas'

const CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS: ConfiguracaoDasBoasVindas = {
  ativa: false,
  janelaInicio: 360,
  janelaFim: 1380,
  tetoDaPersonaMs: 4000,
  frases: { manha: 'Bom dia.', tarde: 'Boa tarde.', noite: 'Boa noite.' },
  midiaAtiva: false,
  midia: null
}

function ambiente() {
  const lerBoasVindas = vi.fn(async () => CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS)
  const salvarBoasVindas = vi.fn(async (config) => config)
  const selecionarMidiaDasBoasVindas = vi.fn(async () => ({
    ...CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS,
    midiaAtiva: true,
    midia: { tipo: 'arquivo' as const, caminho: 'C:\\Musica\\chegada.mp3' }
  }))
  Object.assign(window, {
    jarvis: { lerBoasVindas, salvarBoasVindas, selecionarMidiaDasBoasVindas }
  })
  return { salvarBoasVindas, selecionarMidiaDasBoasVindas }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings do Modo Boas-Vindas', () => {
  it('começa desligado e só ativa após salvar a escolha', async () => {
    const { salvarBoasVindas } = ambiente()
    render(<PreferenciasDasBoasVindas />)
    const chave = await screen.findByRole('switch', { name: /ativar modo boas-vindas/i })
    expect(chave.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(chave)
    expect(salvarBoasVindas).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /salvar boas-vindas/i }))
    expect(salvarBoasVindas).toHaveBeenCalledWith(expect.objectContaining({ ativa: true }))
  })

  it('escolhe mídia por diálogo e mostra apenas o nome do arquivo', async () => {
    const { selecionarMidiaDasBoasVindas } = ambiente()
    render(<PreferenciasDasBoasVindas />)
    await userEvent.click(await screen.findByRole('button', { name: /escolher arquivo/i }))
    expect(selecionarMidiaDasBoasVindas).toHaveBeenCalledWith('arquivo')
    expect(screen.getByText('chegada.mp3')).toBeTruthy()
    expect(screen.queryByText(/C:\\Musica/)).toBeNull()
  })

  it('recusa horário inválido antes de escrever no main', async () => {
    const { salvarBoasVindas } = ambiente()
    render(<PreferenciasDasBoasVindas />)
    const inicio = await screen.findByRole('textbox', { name: /início da janela/i })
    await userEvent.clear(inicio)
    await userEvent.type(inicio, '25:00')
    await userEvent.click(screen.getByRole('button', { name: /salvar boas-vindas/i }))
    expect(salvarBoasVindas).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/confira os horários/i)
  })
})
