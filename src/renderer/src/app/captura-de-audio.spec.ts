import { describe, expect, it, vi } from 'vitest'
import { capturarPcm } from './captura-de-audio'

describe('captura por dispositivo (SPEC-Voz-05)', () => {
  it('exige o dispositivo escolhido; navegador não pode cair no padrão', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('ausente', 'NotFoundError'))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })

    await expect(capturarPcm('headset-2')).rejects.toThrow()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'headset-2' } })
    })

    vi.unstubAllGlobals()
  })
})
