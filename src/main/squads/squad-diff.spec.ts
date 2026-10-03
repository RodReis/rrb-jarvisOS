import { describe, expect, it } from 'vitest'
import { dividirPorArquivo, lerDiff } from './squad-diff'

const secao = (cabecalho: string[], hunks: string[][]): string =>
  [...cabecalho, ...hunks.flatMap((h) => ['@@ -1 +1 @@', ...h])].join('\n')

describe('lerDiff', () => {
  it('arquivo modificado: um hunk por @@, com as linhas removidas e adicionadas', () => {
    const diff = secao(
      ['diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts'],
      [['-const a = 1', '+const a = 10'], ['+const b = 2']]
    )

    const [arquivo] = lerDiff(diff)

    expect(arquivo).toMatchObject({ arquivo: 'src/a.ts', base: 'src/a.ts' })
    expect(arquivo?.hunks.map((h) => [h.removidas, h.adicionadas])).toEqual([
      [['const a = 1'], ['const a = 10']],
      [[], ['const b = 2']]
    ])
  })

  it('o id do hunk é o conteúdo: o mesmo hunk em dois diffs tem o mesmo id', () => {
    const d = secao(['diff --git a/x b/x', '--- a/x', '+++ b/x'], [['-um', '+dois']])

    expect(lerDiff(d)[0]?.hunks[0]?.id).toBe(lerDiff(d)[0]?.hunks[0]?.id)
    expect(lerDiff(d)[0]?.hunks[0]?.id).toMatch(/^[0-9a-f]{12}$/)
  })

  it('arquivo novo: a base é ele mesmo', () => {
    const diff = secao(
      ['diff --git a/n.ts b/n.ts', 'new file mode 100644', '--- /dev/null', '+++ b/n.ts'],
      [['+linha']]
    )

    expect(lerDiff(diff)[0]).toMatchObject({ arquivo: 'n.ts', base: 'n.ts', apagado: false })
  })

  it('arquivo apagado: o caminho é o da base', () => {
    const diff = secao(
      [
        'diff --git a/velho.ts b/velho.ts',
        'deleted file mode 100644',
        '--- a/velho.ts',
        '+++ /dev/null'
      ],
      [['-linha']]
    )

    expect(lerDiff(diff)[0]).toMatchObject({ arquivo: 'velho.ts', base: 'velho.ts', apagado: true })
  })

  it('rename: o arquivo é o novo, a base é a origem — o hunk segue a origem', () => {
    const diff = secao(
      [
        'diff --git a/F.ts b/G.ts',
        'similarity index 80%',
        'rename from F.ts',
        'rename to G.ts',
        '--- a/F.ts',
        '+++ b/G.ts'
      ],
      [['-cinco', '+CINCO']]
    )

    const [arquivo] = lerDiff(diff)

    expect(arquivo).toMatchObject({ arquivo: 'G.ts', base: 'F.ts' })
    expect(arquivo?.hunks[0]).toMatchObject({ arquivo: 'G.ts', base: 'F.ts' })
  })

  it('rename puro, sem hunk, é um arquivo sem hunks', () => {
    const diff = [
      'diff --git a/F.ts b/G.ts',
      'similarity index 100%',
      'rename from F.ts',
      'rename to G.ts'
    ].join('\n')

    expect(lerDiff(diff)).toMatchObject([{ arquivo: 'G.ts', base: 'F.ts', hunks: [] }])
  })

  it('caminho não ASCII com aspas e octal (core.quotePath) é lido', () => {
    const diff = secao(
      [
        'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
        '--- "a/caf\\303\\251.ts"',
        '+++ "b/caf\\303\\251.ts"'
      ],
      [['-a', '+b']]
    )

    expect(lerDiff(diff)[0]).toMatchObject({ arquivo: 'café.ts', base: 'café.ts' })
  })

  it('caminho com espaço (o Git põe TAB no fim do ---/+++) é lido inteiro', () => {
    const diff = secao(
      [
        'diff --git a/meu arquivo.ts b/meu arquivo.ts',
        '--- a/meu arquivo.ts\t',
        '+++ b/meu arquivo.ts\t'
      ],
      [['-a', '+b']]
    )

    expect(lerDiff(diff)[0]?.arquivo).toBe('meu arquivo.ts')
  })

  it('linha de conteúdo que começa com "--" ou "++" não é cabeçalho (comentário SQL, ++i)', () => {
    const diff = secao(
      ['diff --git a/q.sql b/q.sql', '--- a/q.sql', '+++ b/q.sql'],
      [['--- comentario velho', '-- outro', '+++i;', '++x']]
    )

    const [h] = lerDiff(diff)[0]?.hunks ?? []

    expect(h?.removidas).toEqual(['-- comentario velho', '- outro'])
    expect(h?.adicionadas).toEqual(['++i;', '+x'])
  })

  it('"\\ No newline at end of file" não é conteúdo', () => {
    const diff = secao(
      ['diff --git a/x b/x', '--- a/x', '+++ b/x'],
      [['-a', '\\ No newline at end of file', '+b']]
    )

    expect(lerDiff(diff)[0]?.hunks[0]).toMatchObject({ removidas: ['a'], adicionadas: ['b'] })
  })

  it('diff vazio ou binário não gera hunk', () => {
    expect(lerDiff('')).toEqual([])
    expect(
      lerDiff(['diff --git a/i.png b/i.png', 'Binary files a/i.png and b/i.png differ'].join('\n'))
    ).toMatchObject([{ arquivo: 'i.png', hunks: [] }])
  })
})

describe('dividirPorArquivo', () => {
  it('separa o diff por arquivo, com o caminho final e o texto de cada um', () => {
    const diff = [
      secao(['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts'], [['-x', '+y']]),
      secao(['diff --git a/b.ts b/b.ts', '--- a/b.ts', '+++ b/b.ts'], [['-z', '+w']])
    ].join('\n')

    const partes = dividirPorArquivo(diff)

    expect(partes.map((p) => p.arquivo)).toEqual(['a.ts', 'b.ts'])
    expect(partes[0]?.texto).toContain('+y')
    expect(partes[0]?.texto).not.toContain('+w')
  })
})
