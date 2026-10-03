import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LadoDoCaso } from './caso-sintetico'
import {
  anexarNoFim,
  colisoesDeNome,
  inserirImportacao,
  montarLado,
  montarVerdade
} from './caso-sintetico'

const MODULO = `export function base(x: number): number {
  return x + 1
}
`
const TESTE = `import { describe, expect, it } from 'vitest'
import {
  base
} from './modulo'

describe('base', () => {
  it('soma um', () => {
    expect(base(1)).toBe(2)
  })
})
`

const LADO1: LadoDoCaso = {
  importacao: "import { dobrar } from './modulo'",
  codigo: 'export function dobrar(x: number): number {\n  return x * 2\n}\n',
  teste:
    "describe('dobrar', () => {\n  it('dobra', () => {\n    expect(dobrar(2)).toBe(4)\n  })\n})\n"
}
const LADO2: LadoDoCaso = {
  importacao: "import { negar } from './modulo'",
  codigo: 'export function negar(x: number): number {\n  return -x\n}\n',
  teste:
    "describe('negar', () => {\n  it('nega', () => {\n    expect(negar(2)).toBe(-2)\n  })\n})\n"
}
const BASE = { modulo: MODULO, teste: TESTE }

/** O que o `git` diz de dois lados sobre a mesma base: número de conflitos (0 = merge limpo). */
function conflitosNoGit(base: string, a: string, b: string): number {
  const pasta = mkdtempSync(join(tmpdir(), 'caso-spec-'))
  try {
    for (const [nome, texto] of [
      ['base', base],
      ['a', a],
      ['b', b]
    ] as const)
      writeFileSync(join(pasta, nome), texto)
    try {
      execFileSync('git', ['merge-file', '-p', '--diff3', 'a', 'base', 'b'], {
        cwd: pasta,
        stdio: 'pipe'
      })
      return 0
    } catch (e) {
      return (e as { status: number }).status
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

describe('anexarNoFim', () => {
  it('acrescenta o código depois da última linha, com quebra de linha garantida', () => {
    expect(anexarNoFim('a\nb', 'c\n')).toBe('a\nb\nc\n')
    expect(anexarNoFim('a\n', 'c\n')).toBe('a\nc\n')
  })
})

describe('inserirImportacao', () => {
  it('entra depois do último import, inclusive quando ele ocupa várias linhas', () => {
    const saida = inserirImportacao(TESTE, "import { dobrar } from './modulo'")
    expect(saida.split('\n').slice(0, 6)).toEqual([
      "import { describe, expect, it } from 'vitest'",
      'import {',
      '  base',
      "} from './modulo'",
      "import { dobrar } from './modulo'",
      ''
    ])
  })

  it('arquivo sem import é erro de caso, não texto inventado', () => {
    expect(() => inserirImportacao('const a = 1\n', "import x from 'y'")).toThrow(/sem import/)
  })
})

describe('colisoesDeNome', () => {
  it('acusa o nome que a base já usa — o lado não pode redefinir símbolo existente', () => {
    const colide: LadoDoCaso = { ...LADO1, codigo: 'export function base() {}\n' }
    expect(colisoesDeNome(BASE.modulo, colide)).toEqual(['base'])
  })

  it('lado limpo não colide', () => {
    expect(colisoesDeNome(BASE.modulo, LADO1)).toEqual([])
  })
})

describe('o caso sintético real (SPEC-Squads-00 § E1)', () => {
  const w1 = montarLado(BASE, LADO1)
  const w2 = montarLado(BASE, LADO2)
  const verdade = montarVerdade(BASE, LADO1, LADO2)

  it('os dois lados conflitam de verdade no git, no módulo e no teste', () => {
    expect(conflitosNoGit(BASE.modulo, w1.modulo, w2.modulo)).toBeGreaterThan(0)
    expect(conflitosNoGit(BASE.teste, w1.teste, w2.teste)).toBeGreaterThan(0)
  })

  it('cada lado acrescenta um comportamento diferente do outro, com teste próprio', () => {
    expect(w1.modulo).toContain('dobrar')
    expect(w1.modulo).not.toContain('negar')
    expect(w2.modulo).toContain('negar')
    expect(w1.teste).toContain("describe('dobrar'")
    expect(w2.teste).toContain("describe('negar'")
  })

  it('a verdade preserva os dois comportamentos e os dois testes, e a base original', () => {
    for (const trecho of ['dobrar', 'negar', 'function base'])
      expect(verdade.modulo).toContain(trecho)
    for (const trecho of [
      "describe('dobrar'",
      "describe('negar'",
      "describe('base'",
      LADO1.importacao,
      LADO2.importacao
    ])
      expect(verdade.teste).toContain(trecho)
  })

  it('toda linha acrescentada por qualquer lado está na verdade (piso zero por construção)', () => {
    const linhas = (t: string): Set<string> => new Set(t.split('\n'))
    for (const lado of [w1, w2])
      for (const arquivo of ['modulo', 'teste'] as const) {
        const naBase = linhas(BASE[arquivo])
        const naVerdade = linhas(verdade[arquivo])
        for (const l of lado[arquivo].split('\n'))
          if (!naBase.has(l)) expect(naVerdade.has(l)).toBe(true)
      }
  })

  it('a ordem de aplicação não muda o conjunto de linhas da verdade', () => {
    const invertida = montarVerdade(BASE, LADO2, LADO1)
    const ordenadas = (t: string): string[] => t.split('\n').sort()
    expect(ordenadas(invertida.modulo)).toEqual(ordenadas(verdade.modulo))
    expect(ordenadas(invertida.teste)).toEqual(ordenadas(verdade.teste))
  })
})
