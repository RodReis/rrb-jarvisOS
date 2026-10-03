import { describe, expect, it } from 'vitest'
import { auditarIntegracao, extrairHunks } from './manifesto-hunks'

const diffDoEscritorA = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1
+const dobro = x * 2
 export { x }
@@ -10,2 +11,2 @@
-const antigo = 'a'
+const novo = 'a'
`

const diffDoEscritorB = `diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1,2 @@
 export const b = 1
+export const c = 2
`

const manifesto = [...extrairHunks(diffDoEscritorA), ...extrairHunks(diffDoEscritorB)]

const arquivosIntegrados: Record<string, string> = {
  'src/a.ts': "const x = 1\nconst dobro = x * 2\nexport { x }\nconst novo = 'a'\n",
  'src/b.ts': 'export const b = 1\nexport const c = 2\n'
}
const lerFinal = (arquivo: string): string | undefined => arquivosIntegrados[arquivo]

describe('extrairHunks', () => {
  it('separa os hunks por arquivo e por bloco @@', () => {
    expect(manifesto.map((h) => [h.arquivo, h.adicionadas.length, h.removidas.length])).toEqual([
      ['src/a.ts', 1, 0],
      ['src/a.ts', 1, 1],
      ['src/b.ts', 1, 0]
    ])
  })

  it('a identidade independe da posição do hunk', () => {
    const deslocado = diffDoEscritorB.replace('@@ -1 +1,2 @@', '@@ -40 +40,2 @@')
    expect(extrairHunks(deslocado)[0]?.id).toBe(extrairHunks(diffDoEscritorB)[0]?.id)
  })
})

describe('auditarIntegracao', () => {
  it('integração completa: todos preservados, nenhum perdido', () => {
    const auditoria = auditarIntegracao(manifesto, lerFinal, [])
    expect(auditoria.preservados).toHaveLength(3)
    expect(auditoria.perdidosSemRegistro).toHaveLength(0)
  })

  it('NEGATIVO: detecta o hunk removido de propósito', () => {
    const semOHunk = {
      ...arquivosIntegrados,
      'src/b.ts': 'export const b = 1\n'
    }
    const auditoria = auditarIntegracao(manifesto, (a) => semOHunk[a], [])
    expect(auditoria.perdidosSemRegistro.map((h) => h.arquivo)).toEqual(['src/b.ts'])
  })

  it('NEGATIVO: arquivo inteiro sumiu', () => {
    const auditoria = auditarIntegracao(
      manifesto,
      (a) => (a === 'src/b.ts' ? undefined : lerFinal(a)),
      []
    )
    expect(auditoria.perdidosSemRegistro).toHaveLength(1)
  })

  it('NEGATIVO: remoção que não aconteceu conta como perda', () => {
    const aindaTemAntigo = {
      ...arquivosIntegrados,
      'src/a.ts': arquivosIntegrados['src/a.ts'] + "const antigo = 'a'\n"
    }
    const auditoria = auditarIntegracao(manifesto, (a) => aindaTemAntigo[a], [])
    expect(auditoria.perdidosSemRegistro).toHaveLength(1)
  })

  it('hunk ausente com motivo registrado é descartado, não perdido', () => {
    const semOHunk = { ...arquivosIntegrados, 'src/b.ts': 'export const b = 1\n' }
    const hunkB = manifesto[2]!
    const auditoria = auditarIntegracao(manifesto, (a) => semOHunk[a], [
      { hunk: hunkB.id, motivo: 'a mesma constante já existe em outro módulo' }
    ])
    expect(auditoria.descartadosComMotivo).toHaveLength(1)
    expect(auditoria.perdidosSemRegistro).toHaveLength(0)
  })

  it('motivo em branco não protege o hunk', () => {
    const semOHunk = { ...arquivosIntegrados, 'src/b.ts': 'export const b = 1\n' }
    const auditoria = auditarIntegracao(manifesto, (a) => semOHunk[a], [
      { hunk: manifesto[2]!.id, motivo: '  ' }
    ])
    expect(auditoria.perdidosSemRegistro).toHaveLength(1)
  })
})

describe('auditarIntegracao — bloco não resolvido (SPEC-Squads-00 § E1)', () => {
  // As duas versões ficam no arquivo entre marcadores: o texto do hunk "está lá", e é exatamente
  // por isso que a primeira medição o contou como preservado.
  const comMarcadores = (corpo: string): string =>
    `export const b = 1\n<<<<<<< sem resolução\n${corpo}=======\nexport const d = 3\n>>>>>>>\n`

  it('NEGATIVO: hunk que só existe dentro do bloco em conflito é falha, não preservado', () => {
    const final = { ...arquivosIntegrados, 'src/b.ts': comMarcadores('export const c = 2\n') }
    const auditoria = auditarIntegracao(manifesto, (a) => final[a], [])
    expect(auditoria.naoResolvidos.map((h) => h.arquivo)).toEqual(['src/b.ts'])
    expect(auditoria.preservados.map((h) => h.arquivo)).not.toContain('src/b.ts')
    expect(auditoria.perdidosSemRegistro).toHaveLength(0)
  })

  it('o resolvido do mesmo arquivo segue preservado quando está fora do conflito', () => {
    const final = {
      ...arquivosIntegrados,
      'src/b.ts': `export const c = 2\n${comMarcadores('export const e = 5\n')}`
    }
    const auditoria = auditarIntegracao(manifesto, (a) => final[a], [])
    expect(auditoria.preservados.map((h) => h.arquivo)).toContain('src/b.ts')
    expect(auditoria.naoResolvidos).toHaveLength(0)
  })

  it('motivo registrado não redime bloco não resolvido', () => {
    const final = { ...arquivosIntegrados, 'src/b.ts': comMarcadores('export const c = 2\n') }
    const auditoria = auditarIntegracao(manifesto, (a) => final[a], [
      { hunk: manifesto[2]!.id, motivo: 'redundante' }
    ])
    expect(auditoria.naoResolvidos).toHaveLength(1)
    expect(auditoria.descartadosComMotivo).toHaveLength(0)
  })

  it('`=======` fora de um bloco aberto não é marcador', () => {
    const final = {
      ...arquivosIntegrados,
      'src/b.ts': 'export const b = 1\n=======\nexport const c = 2\n'
    }
    const auditoria = auditarIntegracao(manifesto, (a) => final[a], [])
    expect(auditoria.naoResolvidos).toHaveLength(0)
    expect(auditoria.preservados).toHaveLength(3)
  })
})
