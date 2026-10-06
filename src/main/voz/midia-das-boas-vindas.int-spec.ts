import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lerMidiaDasBoasVindas } from './midia-das-boas-vindas'

const pastas: string[] = []
function pasta(): string {
  const alvo = mkdtempSync(join(tmpdir(), 'midia-chegada-'))
  pastas.push(alvo)
  return alvo
}
afterEach(() => {
  for (const alvo of pastas.splice(0)) rmSync(alvo, { recursive: true, force: true })
})

describe('mídia local da chegada', () => {
  it('lê o arquivo escolhido, sem procurar noutro lugar', async () => {
    const dir = pasta()
    const caminho = join(dir, 'escolhida.wav')
    writeFileSync(caminho, Buffer.from([1, 2, 3]))
    const midia = await lerMidiaDasBoasVindas({ tipo: 'arquivo', caminho })
    expect(midia.tipo).toBe('audio/wav')
    expect([...midia.dados]).toEqual([1, 2, 3])
  })

  it('seleciona um arquivo compatível da pasta em ordem determinística', async () => {
    const dir = pasta()
    writeFileSync(join(dir, 'z.mp3'), Buffer.from([9]))
    writeFileSync(join(dir, 'a.mp3'), Buffer.from([1]))
    writeFileSync(join(dir, 'nota.txt'), 'não é áudio')
    const midia = await lerMidiaDasBoasVindas({ tipo: 'pasta', caminho: dir })
    expect([...midia.dados]).toEqual([1])
  })

  it('recusa pasta sem áudio em vez de tocar arquivo arbitrário', async () => {
    const dir = pasta()
    writeFileSync(join(dir, 'nota.txt'), 'não é áudio')
    await expect(lerMidiaDasBoasVindas({ tipo: 'pasta', caminho: dir })).rejects.toThrow()
  })
})
