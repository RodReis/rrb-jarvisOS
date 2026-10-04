import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import { DispositivosDeVoz } from './DispositivosDeVoz'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('salva o microfone em Settings com ID e nome para recuperar a escolha após reiniciar', async () => {
  const onSalvar = vi.fn()
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
  const enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'audioinput', deviceId: 'g432', label: 'G432 Gaming Headset' },
    { kind: 'audiooutput', deviceId: 'realtek', label: 'Realtek Audio' }
  ])
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices }
  })
  render(
    <DispositivosDeVoz
      preferencias={{ vozEntradaId: null, vozSaidaId: null } as PreferencesSnapshot}
      onSalvar={onSalvar}
    />
  )

  await userEvent.click(screen.getByRole('button', { name: /permitir e escolher microfone/i }))
  await userEvent.click(screen.getAllByRole('combobox')[0])
  await userEvent.click(await screen.findByText('G432 Gaming Headset'))
  expect(onSalvar).toHaveBeenCalledWith({
    vozEntradaId: 'g432',
    vozEntradaRotulo: 'G432 Gaming Headset'
  })
})
