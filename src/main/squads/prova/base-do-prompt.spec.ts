import { describe, expect, it } from 'vitest'
import { arvoreDaBase, blocoDaBase, pilhaDaBase } from './base-do-prompt'

const BASE = [
  'package.json',
  'docs/STATUS.md',
  'docs/spec/a.md',
  'src/main/index.ts',
  'src/main/ai/call-provider.ts',
  'src/shared/domain/ai.ts',
  'src/shared/domain/ai.spec.ts',
  'src/renderer/src/App.tsx',
  'tests/e2e/x.e2e.ts'
]

describe('arvoreDaBase', () => {
  it('lista os arquivos diretos de cada diretório permitido, só pelo nome, em ordem estável', () => {
    const arvore = arvoreDaBase(BASE, ['src/shared/domain', 'docs'])
    expect(arvore).toBe(
      ['docs: STATUS.md; subpastas: spec/', 'src/shared/domain: ai.spec.ts, ai.ts'].join('\n')
    )
  })

  it('diretório permitido mostra as subpastas, porque o validador aceita escrita nelas', () => {
    expect(arvoreDaBase(BASE, ['src/main'])).toBe('src/main: index.ts; subpastas: ai/')
  })

  it('não vaza arquivo fora dos diretórios permitidos', () => {
    const arvore = arvoreDaBase(BASE, ['src/shared/domain'])
    expect(arvore).not.toContain('App.tsx')
    expect(arvore).not.toContain('STATUS.md')
  })

  it('diretório que não existe na base é dito, não omitido', () => {
    expect(arvoreDaBase(BASE, ['src/novo'])).toBe('src/novo: (não existe na base)')
  })

  it('acima do teto declara quantos arquivos omitiu, nunca corta em silêncio', () => {
    const muitos = Array.from({ length: 50 }, (_, i) => `src/x/arquivo-numero-${i}.ts`)
    const arvore = arvoreDaBase(muitos, ['src/x'], 120)
    expect(arvore).toMatch(/\(\+\d+ arquivo\(s\) omitido\(s\)\)/)
    expect(arvore.length).toBeLessThan(240)
  })
})

describe('pilhaDaBase', () => {
  const pacote = JSON.stringify({
    dependencies: { react: '^19', electron: '^40' },
    devDependencies: { vitest: '^4', typescript: '^5', '@playwright/test': '^1' }
  })

  it('nomeia o que a base usa, tirado do package.json', () => {
    const pilha = pilhaDaBase(BASE, pacote)
    for (const nome of ['Electron', 'React', 'Vitest', 'TypeScript', 'Playwright'])
      expect(pilha).toContain(nome)
  })

  it('lista as extensões que a base usa, e só elas — é o que decide se um arquivo novo é plausível', () => {
    const pilha = pilhaDaBase(BASE, pacote, 1)
    expect(pilha).toContain('.ts')
    expect(pilha).toContain('.tsx')
    expect(pilha).toContain('.md')
    expect(pilha).not.toContain('.java')
    expect(pilha).not.toContain('.go')
  })

  it('package.json ilegível não derruba o prompt: fica só a lista de extensões', () => {
    expect(pilhaDaBase(BASE, '{ quebrado', 1)).toContain('.ts')
  })

  it('é determinística', () => {
    expect(pilhaDaBase(BASE, pacote)).toBe(pilhaDaBase([...BASE].reverse(), pacote))
  })
})

describe('blocoDaBase', () => {
  it('junta a stack e a árvore sob títulos fixos', () => {
    const bloco = blocoDaBase({
      arquivosDaBase: BASE,
      pathsPermitidos: ['src/shared/domain'],
      packageJson: '{}'
    })
    expect(bloco).toContain('Stack do projeto:')
    expect(bloco).toContain('Arquivos da base nos diretórios permitidos')
    expect(bloco).toContain('src/shared/domain: ai.spec.ts, ai.ts')
  })
})
