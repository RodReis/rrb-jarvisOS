import { describe, expect, it } from 'vitest'
import type { PathsPermitidos } from './preflight'
import { avaliarEscopoDoEscritor } from './squad-escopo'

const escopo = (...paths: string[]): PathsPermitidos => ({
  origem: 'derivada',
  paths,
  justificativa: 'write set do escritor'
})

const alt = (caminhos: string[], simbolicos: string[] = []) => ({ caminhos, simbolicos })

describe('prova de escopo do escritor', () => {
  it('o diff dentro do write set é aprovado', () => {
    const v = avaliarEscopoDoEscritor(alt(['src/api/a.ts', 'src/api/b/c.ts']), escopo('src/api'))

    expect(v).toEqual({
      ok: true,
      dentro: ['src/api/a.ts', 'src/api/b/c.ts'],
      fugas: [],
      simbolicos: [],
      invalidos: []
    })
  })

  it('um arquivo fora do write set reprova o escritor inteiro', () => {
    const v = avaliarEscopoDoEscritor(alt(['src/api/a.ts', 'src/ui/b.ts']), escopo('src/api'))

    expect(v.ok).toBe(false)
    expect(v.dentro).toEqual(['src/api/a.ts'])
    expect(v.fugas).toEqual(['src/ui/b.ts'])
  })

  it('o escopo é por segmento: `src/api` não autoriza `src/api-v2` nem `src/apis.ts`', () => {
    const v = avaliarEscopoDoEscritor(alt(['src/api-v2/a.ts', 'src/apis.ts']), escopo('src/api'))

    expect(v.fugas).toEqual(['src/api-v2/a.ts', 'src/apis.ts'])
  })

  it('o arquivo exato também é um escopo', () => {
    const v = avaliarEscopoDoEscritor(alt(['src/a.ts', 'src/b.ts']), escopo('src/a.ts'))

    expect(v.dentro).toEqual(['src/a.ts'])
    expect(v.fugas).toEqual(['src/b.ts'])
  })

  it('a caixa diferente é fuga: o escopo é exato, e o fail closed vale no Windows também', () => {
    const v = avaliarEscopoDoEscritor(alt(['SRC/api/a.ts']), escopo('src/api'))

    expect(v.fugas).toEqual(['SRC/api/a.ts'])
  })

  it('o link simbólico reprova, mesmo dentro do write set', () => {
    const v = avaliarEscopoDoEscritor(
      alt(['src/api/a.ts', 'src/api/atalho'], ['src/api/atalho']),
      escopo('src/api')
    )

    expect(v.ok).toBe(false)
    expect(v.simbolicos).toEqual(['src/api/atalho'])
    expect(v.dentro).toEqual(['src/api/a.ts'])
    expect(v.fugas).toEqual([])
  })

  it('nome que o kernel não commita reprova: segredo, reservado, diretório e começo em "-"', () => {
    const v = avaliarEscopoDoEscritor(
      alt(['src/api/.env', 'src/api/NUL.ts', 'src/api/pasta/', '-f', 'src/api/ok.ts']),
      escopo('src/api', '-f')
    )

    expect(v.ok).toBe(false)
    expect(v.invalidos).toEqual(['src/api/.env', 'src/api/NUL.ts', 'src/api/pasta/', '-f'])
    expect(v.dentro).toEqual(['src/api/ok.ts'])
  })

  it('arquivo que reconfigura o Git (.gitattributes, .gitmodules) em qualquer pasta reprova, mesmo dentro do escopo', () => {
    const v = avaliarEscopoDoEscritor(
      alt(['src/api/.gitattributes', '.gitmodules', 'src/api/ok.ts']),
      escopo('src/api', '.gitmodules')
    )

    expect(v.ok).toBe(false)
    expect(v.invalidos).toEqual(['src/api/.gitattributes', '.gitmodules'])
    expect(v.dentro).toEqual(['src/api/ok.ts'])
  })

  it('cada caminho conta uma vez, na primeira categoria que o pega', () => {
    const v = avaliarEscopoDoEscritor(
      alt(['fora/atalho', '.env', 'fora/x.ts'], ['fora/atalho']),
      escopo('src')
    )

    expect(v.simbolicos).toEqual(['fora/atalho'])
    expect(v.invalidos).toEqual(['.env'])
    expect(v.fugas).toEqual(['fora/x.ts'])
    expect(v.dentro).toEqual([])
  })

  it('sem escopo declarado, o diff inteiro é fuga: ausência de decisão não é "tudo permitido"', () => {
    for (const sem of [undefined, escopo(), escopo(''), escopo('src/*')]) {
      const v = avaliarEscopoDoEscritor(alt(['src/a.ts']), sem)

      expect(v.ok).toBe(false)
      expect(v.fugas).toEqual(['src/a.ts'])
      expect(v.dentro).toEqual([])
    }
  })

  it('sem escopo, o link simbólico e o nome inválido continuam sendo contados', () => {
    const v = avaliarEscopoDoEscritor(alt(['a/l', '.env', 'b.ts'], ['a/l']), undefined)

    expect(v.simbolicos).toEqual(['a/l'])
    expect(v.invalidos).toEqual(['.env'])
    expect(v.fugas).toEqual(['b.ts'])
  })

  it('sem nenhuma alteração está ok, com o conjunto vazio: quem decide o que fazer é o chamador', () => {
    const v = avaliarEscopoDoEscritor(alt([]), escopo('src'))

    expect(v).toEqual({ ok: true, dentro: [], fugas: [], simbolicos: [], invalidos: [] })
  })

  it('o caminho com ".." nunca está dentro, e o separador invertido é tratado', () => {
    const v = avaliarEscopoDoEscritor(alt(['src/../fora.ts']), escopo('src'))

    expect(v.ok).toBe(false)
    expect(v.dentro).toEqual([])
  })
})
