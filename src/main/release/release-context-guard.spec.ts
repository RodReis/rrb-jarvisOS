import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { segredosNoContexto } from './release-context-guard'

let ctx = ''
beforeEach(() => {
  ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
})
afterEach(() => rmSync(ctx, { recursive: true, force: true }))

const tocar = (nome: string, texto = 'x'): void => {
  mkdirSync(join(ctx, nome, '..'), { recursive: true })
  writeFileSync(join(ctx, nome), texto)
}

describe('segredosNoContexto', () => {
  it('contexto sem arquivo de ambiente não tem o que vazar', () => {
    tocar('server.js')
    expect(segredosNoContexto(ctx)).toEqual([])
  })

  it('.env.local na raiz do contexto, sem .dockerignore, é um vazamento em potencial', () => {
    tocar('.env.local')
    expect(segredosNoContexto(ctx)).toEqual(['.env.local'])
  })

  it('.env.example é versionado e nunca conta', () => {
    tocar('.env.example')
    expect(segredosNoContexto(ctx)).toEqual([])
  })

  it('o .dockerignore que exclui o arquivo resolve', () => {
    tocar('.env.local')
    tocar('.dockerignore', '# segredos\n.env*\n')
    expect(segredosNoContexto(ctx)).toEqual([])
  })

  it('exceção "!" reabre o arquivo', () => {
    tocar('.env.local')
    tocar('.dockerignore', '.env*\n!.env.local\n')
    expect(segredosNoContexto(ctx)).toEqual(['.env.local'])
  })

  it('o arquivo informado no perfil, dentro do contexto e em subpasta, também conta', () => {
    tocar('config/segredos.env')
    expect(segredosNoContexto(ctx, join(ctx, 'config', 'segredos.env'))).toEqual([
      'config/segredos.env'
    ])
  })

  it('arquivo informado fora do contexto não conta', () => {
    tocar('server.js')
    expect(segredosNoContexto(ctx, join(tmpdir(), 'fora', '.env.local'))).toEqual([])
  })

  it('padrão com ** e barra inicial é entendido', () => {
    tocar('config/segredos.env')
    tocar('.dockerignore', '/**/*.env\n')
    expect(segredosNoContexto(ctx, join(ctx, 'config', 'segredos.env'))).toEqual([])
  })
})
