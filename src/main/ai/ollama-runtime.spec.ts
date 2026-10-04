import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { iniciarOllamaLocal } from './ollama-runtime'

describe('início local do Ollama', () => {
  it('preserva um serviço que já estava rodando', async () => {
    const iniciar = vi.fn()
    expect(
      await iniciarOllamaLocal({ disponivel: async () => true }, 'ollama.exe', iniciar as never)
    ).toBeUndefined()
    expect(iniciar).not.toHaveBeenCalled()
  })

  it('inicia sem shell e encerra somente o processo criado pelo app', async () => {
    const processo = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() })
    const iniciar = vi.fn(() => processo)
    const encerrar = await iniciarOllamaLocal(
      { disponivel: async () => false },
      'C:\\Ollama\\ollama.exe',
      iniciar as never
    )
    expect(iniciar).toHaveBeenCalledWith('C:\\Ollama\\ollama.exe', ['serve'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    })
    encerrar?.()
    expect(processo.kill).toHaveBeenCalledOnce()
  })
})
