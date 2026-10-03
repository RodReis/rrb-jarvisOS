import { describe, expect, it } from 'vitest'
import { auditarComDescartes, manifestoDosEscritores, resumirAuditoria } from './squad-manifesto'

const diff = (arquivo: string, removidas: string[], adicionadas: string[]): string =>
  [
    `diff --git a/${arquivo} b/${arquivo}`,
    `--- a/${arquivo}`,
    `+++ b/${arquivo}`,
    '@@ -1,1 +1,1 @@',
    ...removidas.map((l) => `-${l}`),
    ...adicionadas.map((l) => `+${l}`)
  ].join('\n')

const A = diff('src/a.ts', ['export const a = 1'], ['export const a = 10'])
const B = diff('src/b.ts', ['export const b = 2'], ['export const b = 20'])
const lerCom =
  (arquivos: Record<string, string>) =>
  (caminho: string): string | undefined =>
    arquivos[caminho]

describe('manifestoDosEscritores', () => {
  it('junta os hunks dos diffs dos dois escritores, na ordem', () => {
    const manifesto = manifestoDosEscritores([A, B])

    expect(manifesto.map((h) => h.arquivo)).toEqual(['src/a.ts', 'src/b.ts'])
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

    const { auditoria, resumo } = auditarComDescartes(
      manifesto,
      lerCom({ 'src/a.ts': 'export const a = 10\n', 'src/b.ts': 'export const b = 20\n' }),
      []
    )

    expect(auditoria.preservados).toHaveLength(2)
    expect(resumo).toEqual({
      total: 2,
      preservados: 2,
      descartadosComMotivo: 0,
      perdidosSemRegistro: 0,
      naoResolvidos: 0,
      aprovada: true
    })
  })

  it('hunk removido de propósito pelo integrador, sem registro, é perdido: reprova (critério 1)', () => {
    const manifesto = manifestoDosEscritores([A, B])

    const { resumo } = auditarComDescartes(
      manifesto,
      lerCom({ 'src/a.ts': 'export const a = 10\n', 'src/b.ts': 'export const b = 2\n' }),
      []
    )

    expect(resumo.perdidosSemRegistro).toBe(1)
    expect(resumo.aprovada).toBe(false)
  })

  it('o descarte que cita o trecho perdido, com motivo, explica o hunk', () => {
    const manifesto = manifestoDosEscritores([A, B])

    const { resumo } = auditarComDescartes(
      manifesto,
      lerCom({ 'src/a.ts': 'export const a = 10\n', 'src/b.ts': 'export const b = 2\n' }),
      [{ trecho: 'export const b = 20', motivo: 'incompatível com o outro lado' }]
    )

    expect(resumo.descartadosComMotivo).toBe(1)
    expect(resumo.perdidosSemRegistro).toBe(0)
    expect(resumo.aprovada).toBe(true)
  })

  it('o descarte de OUTRO trecho não explica o hunk perdido', () => {
    const manifesto = manifestoDosEscritores([A, B])

    const { resumo } = auditarComDescartes(
      manifesto,
      lerCom({ 'src/a.ts': 'export const a = 10\n', 'src/b.ts': 'export const b = 2\n' }),
      [{ trecho: 'export const zzz = 99', motivo: 'qualquer coisa' }]
    )

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('perda parcial: citar uma linha do hunk não explica as outras', () => {
    const grande = diff('src/c.ts', [], ['const x = 1', 'const y = 2', 'const z = 3'])
    const manifesto = manifestoDosEscritores([grande])

    const { resumo } = auditarComDescartes(manifesto, lerCom({ 'src/c.ts': 'const x = 1\n' }), [
      { trecho: 'const y = 2', motivo: 'redundante' }
    ])

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('perda parcial explicada por descartes que somam todas as linhas que faltam', () => {
    const grande = diff('src/c.ts', [], ['const x = 1', 'const y = 2', 'const z = 3'])
    const manifesto = manifestoDosEscritores([grande])

    const { resumo } = auditarComDescartes(manifesto, lerCom({ 'src/c.ts': 'const x = 1\n' }), [
      { trecho: 'const y = 2', motivo: 'redundante' },
      { trecho: 'const z = 3', motivo: 'incompatível' }
    ])

    expect(resumo.descartadosComMotivo).toBe(1)
    expect(resumo.aprovada).toBe(true)
  })

  it('remoção de linha que o integrador manteve conta como perdida, e o descarte do trecho a explica', () => {
    const remocao = diff('src/a.ts', ['export const a = 1'], [])
    const manifesto = manifestoDosEscritores([remocao])

    const sem = auditarComDescartes(manifesto, lerCom({ 'src/a.ts': 'export const a = 1\n' }), [])
    const com = auditarComDescartes(manifesto, lerCom({ 'src/a.ts': 'export const a = 1\n' }), [
      { trecho: 'export const a = 1', motivo: 'o outro lado ainda usa a constante' }
    ])

    expect(sem.resumo.perdidosSemRegistro).toBe(1)
    expect(com.resumo.descartadosComMotivo).toBe(1)
  })

  it('descarte com motivo em branco não explica nada', () => {
    const manifesto = manifestoDosEscritores([B])

    const { resumo } = auditarComDescartes(
      manifesto,
      lerCom({ 'src/b.ts': 'export const b = 2\n' }),
      [{ trecho: 'export const b = 20', motivo: '   ' }]
    )

    expect(resumo.perdidosSemRegistro).toBe(1)
  })

  it('marcador de conflito que ficou no arquivo não é preservação', () => {
    const manifesto = manifestoDosEscritores([A])
    const arquivo = [
      '<<<<<<< HEAD',
      'export const a = 10',
      '=======',
      'outra',
      '>>>>>>> x',
      ''
    ].join('\n')

    const { resumo } = auditarComDescartes(manifesto, lerCom({ 'src/a.ts': arquivo }), [
      { trecho: 'export const a = 10', motivo: 'tanto faz' }
    ])

    expect(resumo.naoResolvidos).toBe(1)
    expect(resumo.aprovada).toBe(false)
  })

  it('arquivo apagado no resultado, com hunks dele sem registro, é perda', () => {
    const manifesto = manifestoDosEscritores([A])

    expect(auditarComDescartes(manifesto, () => undefined, []).resumo.aprovada).toBe(false)
  })
})

describe('resumirAuditoria', () => {
  it('só os números: o texto do agente não vai para a auditoria', () => {
    const { auditoria } = auditarComDescartes(
      manifestoDosEscritores([A]),
      lerCom({ 'src/a.ts': 'export const a = 10\n' }),
      []
    )

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
