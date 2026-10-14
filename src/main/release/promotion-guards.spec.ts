import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CommandOptions, CommandResult, CommandRunner } from './adapters/command-runner'
import {
  ambienteIsoladoDoE2e,
  estaDentroDe,
  exigirCommitMergeado,
  temVercelIgnore
} from './promotion-guards'

const SHA = 'a'.repeat(40)
const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const falha = (code = 1): CommandResult => ({ code, stdout: '', stderr: '', timedOut: false })

interface Chamada {
  binary: string
  args: readonly string[]
  options?: CommandOptions
}

function runnerDe(roteiro: (c: Chamada) => CommandResult): CommandRunner & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = []
  return {
    chamadas,
    async run(binary, args, options) {
      const chamada = { binary, args: [...args], options }
      chamadas.push(chamada)
      return roteiro(chamada)
    }
  }
}

describe('exigirCommitMergeado', () => {
  it('commit ancestral da branch base, depois de atualizar a base, é aceito', async () => {
    const runner = runnerDe(() => ok())
    expect(await exigirCommitMergeado(runner, 'C:/repo', SHA, 'origin/main')).toBe('ok')
    expect(runner.chamadas.map((c) => c.args.slice(0, 2).join(' '))).toEqual([
      'fetch --quiet',
      'merge-base --is-ancestor'
    ])
    expect(runner.chamadas[1]!.args).toEqual(['merge-base', '--is-ancestor', SHA, 'origin/main'])
    expect(runner.chamadas.every((c) => c.options?.cwd === 'C:/repo')).toBe(true)
  })

  it('commit que não está na base (nunca revisado nem mergeado) é recusado', async () => {
    const runner = runnerDe((c) => (c.args[0] === 'merge-base' ? falha(1) : ok()))
    expect(await exigirCommitMergeado(runner, 'C:/repo', SHA, 'origin/main')).toBe('not-merged')
  })

  it('não consegue atualizar a base: não dá para provar, então não promove', async () => {
    const runner = runnerDe((c) => (c.args[0] === 'fetch' ? falha(128) : ok()))
    expect(await exigirCommitMergeado(runner, 'C:/repo', SHA, 'origin/main')).toBe('unverifiable')
  })

  it('erro do git (código >1) não é "não mergeado": é não verificável', async () => {
    const runner = runnerDe((c) => (c.args[0] === 'merge-base' ? falha(128) : ok()))
    expect(await exigirCommitMergeado(runner, 'C:/repo', SHA, 'origin/main')).toBe('unverifiable')
  })

  it.each(['-evil', 'a b', '', '--upload-pack=x'])(
    'recusa referência de base inválida %j',
    async (ref) => {
      const runner = runnerDe(() => ok())
      await expect(exigirCommitMergeado(runner, 'C:/repo', SHA, ref)).rejects.toThrow(TypeError)
      expect(runner.chamadas).toEqual([])
    }
  )

  it('recusa SHA curto: 28 bits se colidem; só o commit completo identifica', async () => {
    const runner = runnerDe(() => ok())
    await expect(exigirCommitMergeado(runner, 'C:/repo', 'abc1234', 'origin/main')).rejects.toThrow(
      TypeError
    )
  })
})

describe('estaDentroDe', () => {
  it('reconhece a pasta, os filhos e rejeita irmãs e pais', () => {
    expect(estaDentroDe('C:/proj/app', 'C:/proj/app')).toBe(true)
    expect(estaDentroDe('C:/proj/app', 'C:/proj/app/e2e/perfil.json')).toBe(true)
    expect(estaDentroDe('C:/proj/app', 'C:/proj/app-outro/perfil.json')).toBe(false)
    expect(estaDentroDe('C:/proj/app', 'C:/proj/perfil.json')).toBe(false)
    expect(estaDentroDe('C:/proj/app', 'C:/proj/app/../fora.json')).toBe(false)
  })
})

describe('temVercelIgnore', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('detecta o .vercelignore, que pode publicar arquivos ignorados pelo Git', () => {
    dir = mkdtempSync(join(tmpdir(), 'vercelignore-'))
    expect(temVercelIgnore(dir)).toBe(false)
    writeFileSync(join(dir, '.vercelignore'), 'node_modules\n')
    expect(temVercelIgnore(dir)).toBe(true)
  })
})

describe('ambienteIsoladoDoE2e', () => {
  it('troca HOME e os diretórios de credencial por uma pasta temporária', () => {
    const env = ambienteIsoladoDoE2e('C:/tmp/e2e', {
      LOCALAPPDATA: 'C:/Users/op/AppData/Local',
      USERPROFILE: 'C:/Users/op'
    })
    for (const chave of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_CONFIG'])
      expect(env[chave]).toContain('C:/tmp/e2e')
    const credenciais = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_CONFIG'].map(
      (chave) => env[chave]
    )
    expect(credenciais.join('|')).not.toContain('C:/Users/op')
  })

  it('mantém o cache de navegadores do Playwright, que precisa existir para o E2E rodar', () => {
    const env = ambienteIsoladoDoE2e('C:/tmp/e2e', { LOCALAPPDATA: 'C:/Users/op/AppData/Local' })
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('C:/Users/op/AppData/Local/ms-playwright')
  })

  it('respeita PLAYWRIGHT_BROWSERS_PATH já definido pelo operador', () => {
    const env = ambienteIsoladoDoE2e('C:/tmp/e2e', { PLAYWRIGHT_BROWSERS_PATH: 'D:/browsers' })
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('D:/browsers')
  })

  it('não repassa token do provedor', () => {
    const env = ambienteIsoladoDoE2e('C:/tmp/e2e', {
      RAILWAY_API_TOKEN: 'segredo',
      VERCEL_TOKEN: 'segredo'
    })
    expect(JSON.stringify(env)).not.toContain('segredo')
  })
})
