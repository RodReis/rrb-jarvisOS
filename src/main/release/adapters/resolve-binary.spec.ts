import { describe, expect, it } from 'vitest'
import { resolverBinario, type AmbienteDeResolucao } from './resolve-binary'

const SHIM_NPM = `@ECHO off
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@railway\\cli\\bin\\railway.js" %*`

function ambiente(
  arquivos: Record<string, string>,
  parcial: Partial<AmbienteDeResolucao> = {}
): AmbienteDeResolucao {
  const chaves = new Set(Object.keys(arquivos).map((k) => k.toLowerCase()))
  return {
    plataforma: 'win32',
    path: 'C:\\Windows\\System32;C:\\Users\\op\\AppData\\Roaming\\npm',
    pathext: '.COM;.EXE;.BAT;.CMD',
    cwd: 'C:\\trabalho\\pr',
    execPath: 'C:\\node\\node.exe',
    existe: (c) => chaves.has(c.toLowerCase()),
    ler: (c) => arquivos[c] ?? '',
    ...parcial
  }
}

describe('resolverBinario (Windows)', () => {
  it('prefere .exe do PATH', () => {
    const env = ambiente({ 'C:\\Windows\\System32\\docker.exe': '' })
    expect(resolverBinario('docker', env)).toEqual({
      comando: 'C:\\Windows\\System32\\docker.exe',
      prefixo: []
    })
  })

  it('shim .cmd do npm vira node + script, sem shell', () => {
    const env = ambiente({
      'C:\\Users\\op\\AppData\\Roaming\\npm\\railway.cmd': SHIM_NPM,
      'C:\\Users\\op\\AppData\\Roaming\\npm\\node_modules\\@railway\\cli\\bin\\railway.js': ''
    })
    const r = resolverBinario('railway', env)!
    expect(r.comando).toBe('C:\\node\\node.exe')
    expect(r.prefixo).toHaveLength(1)
    expect(r.prefixo[0]!.toLowerCase()).toContain('railway.js')
  })

  it('binário plantado no diretório de trabalho nunca é escolhido', () => {
    // O PATH inclui o cwd do PR e o cwd também tem um vercel.exe plantado.
    const env = ambiente(
      { 'C:\\trabalho\\pr\\vercel.exe': '' },
      { path: 'C:\\trabalho\\pr;C:\\Windows\\System32' }
    )
    expect(resolverBinario('vercel', env)).toBeNull()
  })

  it('o cwd com barra final ou outra caixa continua excluído', () => {
    const env = ambiente(
      { 'C:\\Trabalho\\PR\\vercel.exe': '' },
      { path: 'c:\\trabalho\\pr\\;C:\\Windows', cwd: 'C:\\Trabalho\\PR' }
    )
    expect(resolverBinario('vercel', env)).toBeNull()
  })

  it('ignora entrada relativa do PATH (resolveria contra o cwd)', () => {
    const env = ambiente({ 'C:\\trabalho\\pr\\bin\\vercel.exe': '' }, { path: 'bin;.' })
    expect(resolverBinario('vercel', env)).toBeNull()
  })

  it('shim cujo script não existe não é aceito', () => {
    const env = ambiente({ 'C:\\Users\\op\\AppData\\Roaming\\npm\\railway.cmd': SHIM_NPM })
    expect(resolverBinario('railway', env)).toBeNull()
  })

  it('recusa nome com separador ou caractere de controle', () => {
    const env = ambiente({})
    for (const nome of ['..\\docker', 'a/b', 'docker; calc', ''])
      expect(resolverBinario(nome, env)).toBeNull()
  })
})

describe('resolverBinario (POSIX)', () => {
  it('acha no PATH e ignora o cwd', () => {
    const env = ambiente(
      { '/usr/bin/gh': '', '/trabalho/pr/gh': '' },
      { plataforma: 'linux', path: '/trabalho/pr:/usr/bin', cwd: '/trabalho/pr' }
    )
    expect(resolverBinario('gh', env)).toEqual({ comando: '/usr/bin/gh', prefixo: [] })
  })
})
