import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * SPEC-Release-02, "Dentro": `.env.local` ignorado pelo Git e `.env.example` versionado. Sem este
 * teste, apagar a regra do `.gitignore` deixaria um segredo local a um `git add .` de distância.
 */

function ignorado(caminho: string): boolean {
  const r = spawnSync('git', ['check-ignore', '-q', caminho], {
    cwd: process.cwd(),
    windowsHide: true
  })
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore falhou para ${caminho}`)
  return r.status === 0
}

describe('higiene dos arquivos de ambiente', () => {
  it('.env.local e variantes por ambiente são ignorados pelo Git', () => {
    for (const nome of ['.env.local', '.env.production', '.env.staging.local', '.env']) {
      expect(ignorado(nome), nome).toBe(true)
    }
  })

  it('.env.example é versionado', () => {
    expect(ignorado('.env.example')).toBe(false)
  })
})
