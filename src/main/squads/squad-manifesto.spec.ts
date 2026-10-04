import { describe, expect, it } from 'vitest'
import {
  auditarComDescartes,
  manifestoDosEscritores,
  resumirAuditoria,
  textoDoManifesto
} from './squad-manifesto'

interface Alteracao {
  readonly removidas?: readonly string[]
  readonly adicionadas?: readonly string[]
}

/** Um `git diff -U0` de um arquivo (ou de um rename, quando `de` difere de `arquivo`). */
const diffDe = (arquivo: string, alteracoes: readonly Alteracao[], de: string = arquivo): string =>
  [
    `diff --git a/${de} b/${arquivo}`,
    ...(de === arquivo ? [] : [`rename from ${de}`, `rename to ${arquivo}`]),
    `--- a/${de}`,
    `+++ b/${arquivo}`,
    ...alteracoes.flatMap((a) => [
      '@@ -1 +1 @@',
      ...(a.removidas ?? []).map((l) => `-${l}`),
      ...(a.adicionadas ?? []).map((l) => `+${l}`)
    ])
  ].join('\n')

const A = diffDe('src/a.ts', [
  { removidas: ['export const a = 1'], adicionadas: ['export const a = 10'] }
])
const B = diffDe('src/b.ts', [
  { removidas: ['export const b = 2'], adicionadas: ['export const b = 20'] }
])

describe('manifestoDosEscritores', () => {
  it('junta os hunks dos diffs dos dois escritores, na ordem', () => {
    expect(manifestoDosEscritores([A, B]).map((h) => h.arquivo)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('o mesmo hunk nos dois escritores conta uma vez: a identidade é o conteúdo', () => {
    expect(manifestoDosEscritores([A, A])).toHaveLength(1)
  })

  it('diff vazio não gera hunk', () => {
    expect(manifestoDosEscritores(['', ''])).toEqual([])
  })
})

describe('auditarComDescartes', () => {
  it('integração limpa: todo hunk preservado, nada a explicar', () => {
    const manifesto = manifestoDosEscritores([A, B])

    const { resumo } = auditarComDescartes(manifesto, [A, B].join('\n'), [])

    expect(resumo).toEqual({
      total: 2,
      preservados: 2,
      descartadosComMotivo: 0,
      perdidosSemRegistro: 0,
      naoResolvidos: 0,
      aprovada: true
    })
  })

  it('critério 1: hunk removido de propósito pelo integrador, sem registro, é perdido', () => {
    const manifesto = manifestoDosEscritores([A, B])

    const { resumo } = auditarComDescartes(manifesto, A, [])

    expect(resumo.perdidosSemRegistro).toBe(1)
    expect(resumo.aprovada).toBe(false)
  })

  it('o descarte que cita o trecho perdido, no arquivo dele, com motivo, explica o hunk', () => {
    const manifesto = manifestoDosEscritores([A, B])

    const { resumo } = auditarComDescartes(manifesto, A, [
      {
        arquivo: 'src/b.ts',
        trecho: 'export const b = 20',
        motivo: 'incompatível com o outro lado'
      }
    ])

    expect(resumo).toMatchObject({
      descartadosComMotivo: 1,
      perdidosSemRegistro: 0,
      aprovada: true
    })
  })

  it('o descarte de OUTRO trecho não explica o hunk perdido', () => {
    const { resumo } = auditarComDescartes(manifestoDosEscritores([A, B]), A, [
      { arquivo: 'src/b.ts', trecho: 'export const zzz = 99', motivo: 'qualquer coisa' }
    ])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('o descarte feito num OUTRO arquivo não explica o hunk (M3)', () => {
    const { resumo } = auditarComDescartes(manifestoDosEscritores([A, B]), A, [
      { arquivo: 'src/a.ts', trecho: 'export const b = 20', motivo: 'tanto faz' }
    ])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('descarte com motivo em branco não explica nada', () => {
    const { resumo } = auditarComDescartes(manifestoDosEscritores([A, B]), A, [
      { arquivo: 'src/b.ts', trecho: 'export const b = 20', motivo: '   ' }
    ])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('perda parcial: citar uma linha do hunk não explica as outras', () => {
    const grande = diffDe('src/c.ts', [
      { adicionadas: ['const x = 1', 'const y = 2', 'const z = 3'] }
    ])
    const resultado = diffDe('src/c.ts', [{ adicionadas: ['const x = 1'] }])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([grande]), resultado, [
      { arquivo: 'src/c.ts', trecho: 'const y = 2', motivo: 'redundante' }
    ])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('perda parcial explicada por descartes que somam todas as linhas que faltam', () => {
    const grande = diffDe('src/c.ts', [
      { adicionadas: ['const x = 1', 'const y = 2', 'const z = 3'] }
    ])
    const resultado = diffDe('src/c.ts', [{ adicionadas: ['const x = 1'] }])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([grande]), resultado, [
      { arquivo: 'src/c.ts', trecho: 'const y = 2', motivo: 'redundante' },
      { arquivo: 'src/c.ts', trecho: 'const z = 3', motivo: 'incompatível' }
    ])

    expect(resumo).toMatchObject({ descartadosComMotivo: 1, aprovada: true })
  })

  it('combinar a mesma linha dos dois lados sem declarar os originais é perda', () => {
    const lado1 = diffDe('src/a.ts', [
      { removidas: ['const a = 1'], adicionadas: ['const a = 10'] }
    ])
    const lado2 = diffDe('src/a.ts', [
      { removidas: ['const a = 1'], adicionadas: ['const a = 20'] }
    ])
    const resultado = diffDe('src/a.ts', [
      { removidas: ['const a = 1'], adicionadas: ['const a = 10 + 20'] }
    ])

    const sem = auditarComDescartes(manifestoDosEscritores([lado1, lado2]), resultado, [])
    const com = auditarComDescartes(manifestoDosEscritores([lado1, lado2]), resultado, [
      { arquivo: 'src/a.ts', trecho: 'const a = 10', motivo: 'combinado' },
      { arquivo: 'src/a.ts', trecho: 'const a = 20', motivo: 'combinado' }
    ])

    expect(sem.resumo.aprovada).toBe(false)
    expect(com.resumo).toMatchObject({ descartadosComMotivo: 2, aprovada: true })
  })

  it('marcador de conflito que ficou no resultado: não resolvido, e o descarte não o redime', () => {
    const resultado = diffDe('src/a.ts', [
      { adicionadas: ['<<<<<<< HEAD', 'export const a = 10', '=======', 'outra', '>>>>>>> x'] }
    ])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([A]), resultado, [
      { arquivo: 'src/a.ts', trecho: 'export const a = 10', motivo: 'tanto faz' }
    ])

    expect(resumo.naoResolvidos).toBe(1)
    expect(resumo.aprovada).toBe(false)
  })

  it('marcador que um escritor escreveu de propósito (fixture de teste) não é conflito aberto', () => {
    const fixture = diffDe('src/fixture.ts', [{ adicionadas: ['>>>>>>> exemplo'] }])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([fixture]), fixture, [])

    expect(resumo.naoResolvidos).toBe(0)
  })
})

describe('o auditor conta ocorrências, não presença (revisão de código, H1)', () => {
  it('uma linha removida que existe também noutro ponto do arquivo não reprova o merge limpo', () => {
    // O arquivo tem dois `return false`; o escritor trocou só um por `return true`.
    const escritor = diffDe('src/f.ts', [
      { removidas: ['  return false'], adicionadas: ['  return true'] }
    ])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([escritor]), escritor, [])

    expect(resumo.aprovada).toBe(true)
  })

  it('uma linha adicionada que já existia noutro ponto não esconde o hunk que o integrador apagou', () => {
    const escritor = diffDe('src/f.ts', [{ adicionadas: ['  return false'] }])
    // O resultado não adiciona nada: o hunk sumiu, mesmo que `return false` exista mais acima.
    const resultado = diffDe('src/f.ts', [{ adicionadas: ['outra coisa'] }])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([escritor]), resultado, [])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('o mesmo texto adicionado em dois hunks distintos precisa aparecer duas vezes', () => {
    const um = diffDe('src/f.ts', [{ removidas: ['x'], adicionadas: ['}'.repeat(1) + ' // fim'] }])
    const dois = diffDe('src/f.ts', [{ removidas: ['y'], adicionadas: ['} // fim'] }])
    const apenasUm = diffDe('src/f.ts', [{ removidas: ['x', 'y'], adicionadas: ['} // fim'] }])

    const { resumo } = auditarComDescartes(manifestoDosEscritores([um, dois]), apenasUm, [])

    // A mesma identidade (mesmo `} // fim` removendo coisas diferentes) não pode ser "paga" uma vez só.
    expect(resumo.aprovada).toBe(false)
  })
})

describe('rename (revisão de código, H2)', () => {
  it('A renomeia F→G e B edita F: o merge limpo não vira hunk perdido', () => {
    const a = diffDe('G.ts', [{ removidas: ['cinco'], adicionadas: ['CINCO'] }], 'F.ts')
    const b = diffDe('F.ts', [{ removidas: ['tres'], adicionadas: ['TRES'] }])
    // O resultado: um rename com as duas edições (`-M`), pelo caminho da base F.ts.
    const resultado = diffDe(
      'G.ts',
      [
        { removidas: ['tres'], adicionadas: ['TRES'] },
        { removidas: ['cinco'], adicionadas: ['CINCO'] }
      ],
      'F.ts'
    )

    const { resumo } = auditarComDescartes(manifestoDosEscritores([a, b]), resultado, [])

    expect(resumo).toMatchObject({ preservados: 2, perdidosSemRegistro: 0, aprovada: true })
  })

  it('e se a edição de B sumiu no rename, é perda', () => {
    const a = diffDe('G.ts', [{ removidas: ['cinco'], adicionadas: ['CINCO'] }], 'F.ts')
    const b = diffDe('F.ts', [{ removidas: ['tres'], adicionadas: ['TRES'] }])
    const resultado = diffDe('G.ts', [{ removidas: ['cinco'], adicionadas: ['CINCO'] }], 'F.ts')

    const { resumo } = auditarComDescartes(manifestoDosEscritores([a, b]), resultado, [])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })
})

describe('textoDoManifesto e resumirAuditoria', () => {
  it('o texto traz as contagens e cada descarte com arquivo e motivo: o revisor e o PI o veem', () => {
    const { auditoria } = auditarComDescartes(manifestoDosEscritores([A, B]), A, [
      { arquivo: 'src/b.ts', trecho: 'export const b = 20', motivo: 'incompatível com o lado A' }
    ])

    const texto = textoDoManifesto(auditoria, 3)

    expect(texto).toContain('1 preservado')
    expect(texto).toContain('1 descartado')
    expect(texto).toContain('src/b.ts')
    expect(texto).toContain('incompatível com o lado A')
    expect(texto).toContain('3 linha')
  })

  it('só os números vão para a auditoria: nada de trecho nem de motivo', () => {
    const { auditoria } = auditarComDescartes(manifestoDosEscritores([A]), A, [])

    expect(Object.keys(resumirAuditoria(auditoria)).sort()).toEqual([
      'aprovada',
      'descartadosComMotivo',
      'naoResolvidos',
      'perdidosSemRegistro',
      'preservados',
      'total'
    ])
  })
})
