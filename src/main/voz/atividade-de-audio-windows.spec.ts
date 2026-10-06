import { describe, expect, it, vi } from 'vitest'
import { atividadeDeAudioNoWindows } from './atividade-de-audio-windows'

describe('guarda nativa de áudio externo', () => {
  it.each([
    ['ATIVO', true],
    ['SILENCIO', false],
    ['INDETERMINADO', undefined],
    ['texto inesperado', undefined]
  ])('interpreta %s como %s', async (saida, esperado) => {
    const executar = vi.fn((_arquivo, _args, _opcoes, concluido) => concluido(null, saida))
    expect(await atividadeDeAudioNoWindows(executar, 'win32', 'medidor.ps1')).toBe(esperado)
    expect(executar).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'medidor.ps1'],
      { windowsHide: true, timeout: 5_000 },
      expect.any(Function)
    )
  })

  it('trata falha da consulta como estado indeterminado', async () => {
    const executar = vi.fn((_arquivo, _args, _opcoes, concluido) =>
      concluido(new Error('falhou'), '')
    )
    expect(await atividadeDeAudioNoWindows(executar, 'win32')).toBeUndefined()
  })

  it('não presume silêncio em plataforma sem Core Audio', async () => {
    const executar = vi.fn()
    expect(await atividadeDeAudioNoWindows(executar, 'linux')).toBeUndefined()
    expect(executar).not.toHaveBeenCalled()
  })
})
