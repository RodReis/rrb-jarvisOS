import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  descartarArtefatosDoSandbox,
  portaLivreNoHost,
  prepararPerfil,
  removerPerfil
} from './isolamento-host'

let dir: string
let servidores: Server[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-host-'))
  servidores = []
})

afterEach(async () => {
  await Promise.all(servidores.map((s) => new Promise((ok) => s.close(ok))))
  rmSync(dir, { recursive: true, force: true })
})

/** Ocupa uma porta de verdade e devolve o número — o que a sonda tem de enxergar. */
async function ocupar(host?: string): Promise<number> {
  const servidor = createServer()
  servidores.push(servidor)
  await new Promise<void>((ok) => servidor.listen(0, host, ok))
  const endereco = servidor.address()
  return typeof endereco === 'object' && endereco !== null ? endereco.port : 0
}

describe('portaLivreNoHost', () => {
  it('vê como ocupada a porta que um processo do host já escuta', async () => {
    const porta = await ocupar('127.0.0.1')

    expect(portaLivreNoHost(porta)).toBe(false)
  })

  it('vê como ocupada a porta publicada em todas as interfaces, como a do Docker', async () => {
    const porta = await ocupar()

    expect(portaLivreNoHost(porta)).toBe(false)
  })

  it('vê como livre a porta que ninguém usa', async () => {
    const porta = await ocupar()
    await new Promise((ok) => servidores.pop()?.close(ok))

    expect(portaLivreNoHost(porta)).toBe(true)
  })

  it('porta inválida não é livre: fail closed', () => {
    expect(portaLivreNoHost(0)).toBe(false)
    expect(portaLivreNoHost(70_000)).toBe(false)
    expect(portaLivreNoHost(Number.NaN)).toBe(false)
  })
})

describe('perfil do run', () => {
  it('cria o diretório do Claude dentro da raiz do perfil', () => {
    const raiz = join(dir, 'jarvisos-run-a-perfil')

    expect(prepararPerfil(raiz)).toBe(true)
    expect(existsSync(join(raiz, 'claude'))).toBe(true)
  })

  it('remove a raiz do perfil inteira', () => {
    const raiz = join(dir, 'jarvisos-run-a-perfil')
    prepararPerfil(raiz)
    writeFileSync(join(raiz, 'claude', 'estado.json'), '{}')

    removerPerfil(raiz)

    expect(existsSync(raiz)).toBe(false)
  })

  it('recusa remover o que não é raiz de perfil: o caminho vem do banco, não é confiável', () => {
    const alvo = join(dir, 'projeto')
    mkdirSync(alvo)

    expect(() => removerPerfil(alvo)).toThrow()
    expect(existsSync(alvo)).toBe(true)
  })

  it('recusa um diretório que só termina em -perfil, e o caminho relativo', () => {
    const parecido = join(dir, 'meu-perfil')
    mkdirSync(parecido)

    expect(() => removerPerfil(parecido)).toThrow()
    expect(() => removerPerfil('jarvisos-run-a-perfil')).toThrow()
    expect(existsSync(parecido)).toBe(true)
  })
})

describe('descartarArtefatosDoSandbox', () => {
  it('descarta o .gitmeta e nada mais', () => {
    const worktree = join(dir, 'jarvisos-run-x')
    mkdirSync(join(worktree, '.gitmeta'), { recursive: true })
    writeFileSync(join(worktree, '.gitmeta', 'HEAD'), 'ref')
    writeFileSync(join(worktree, 'trabalho.ts'), 'x')

    descartarArtefatosDoSandbox(worktree)

    expect(existsSync(join(worktree, '.gitmeta'))).toBe(false)
    expect(existsSync(join(worktree, 'trabalho.ts'))).toBe(true)
  })

  it('recusa o diretório que não tem a forma de um worktree de run, e o caminho relativo', () => {
    mkdirSync(join(dir, '.gitmeta'))

    expect(() => descartarArtefatosDoSandbox(dir)).toThrow()
    expect(() => descartarArtefatosDoSandbox('jarvisos-run-x')).toThrow()
    expect(existsSync(join(dir, '.gitmeta'))).toBe(true)
  })
})
