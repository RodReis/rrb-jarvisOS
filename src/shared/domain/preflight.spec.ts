import { describe, expect, it } from 'vitest'
import {
  caminhoDentroDoEscopo,
  fugasDoEscopo,
  listaDePathsValida,
  nomeDaBranch,
  nomeDoContainer,
  recursoDaPorta,
  recursoDoContainer,
  recursoDoWorktree,
  type PathsPermitidos
} from './preflight'

const escopo = (paths: readonly string[]): PathsPermitidos => ({
  origem: 'spec',
  paths,
  justificativa: 'Seção ## Paths permitidos da SPEC.'
})

describe('listaDePathsValida', () => {
  it('recusa lista ausente, porque sem lista não há escopo declarado', () => {
    expect(listaDePathsValida(undefined)).toBe(false)
  })

  it('recusa lista vazia — vazio é ausência de decisão, nunca "pode tudo"', () => {
    expect(listaDePathsValida(escopo([]))).toBe(false)
  })

  it('recusa path em branco, que passaria por preenchido sem autorizar nada', () => {
    expect(listaDePathsValida(escopo(['src/main', '   ']))).toBe(false)
  })

  it('aceita lista com ao menos um path real', () => {
    expect(listaDePathsValida(escopo(['src/main']))).toBe(true)
  })
})

describe('caminhoDentroDoEscopo', () => {
  it('aceita arquivo sob o diretório permitido', () => {
    expect(caminhoDentroDoEscopo('src/main/pipeline/preflight.ts', escopo(['src/main']))).toBe(true)
  })

  it('aceita o próprio path declarado', () => {
    expect(caminhoDentroDoEscopo('docs/STATUS.md', escopo(['docs/STATUS.md']))).toBe(true)
  })

  it('recusa arquivo fora de todos os prefixos', () => {
    expect(caminhoDentroDoEscopo('src/renderer/App.tsx', escopo(['src/main']))).toBe(false)
  })

  /**
   * A armadilha que motiva a comparação por segmento: `src/app` NÃO autoriza
   * `src/application.ts`. Um `startsWith` de string diria que sim, e o diff escaparia do escopo
   * por coincidência de prefixo.
   */
  it('não deixa prefixo de string autorizar irmão de nome parecido', () => {
    expect(caminhoDentroDoEscopo('src/application.ts', escopo(['src/app']))).toBe(false)
  })

  it('trata separador do Windows como separador, não como parte do nome', () => {
    expect(caminhoDentroDoEscopo('src\\main\\index.ts', escopo(['src/main']))).toBe(true)
  })

  it('ignora "./" no começo do caminho, que git e node emitem indistintamente', () => {
    expect(caminhoDentroDoEscopo('./src/main/index.ts', escopo(['src/main']))).toBe(true)
  })

  it('recusa quando o escopo é mais fundo que o caminho', () => {
    expect(caminhoDentroDoEscopo('src', escopo(['src/main']))).toBe(false)
  })
})

describe('fugasDoEscopo', () => {
  it('devolve vazio quando o diff inteiro está dentro do combinado', () => {
    const fugas = fugasDoEscopo(['src/main/a.ts', 'docs/STATUS.md'], escopo(['src/main', 'docs']))
    expect(fugas).toEqual([])
  })

  it('nomeia exatamente os arquivos que saíram do escopo', () => {
    const fugas = fugasDoEscopo(
      ['src/main/a.ts', 'src/renderer/b.tsx', '.github/workflows/ci.yml'],
      escopo(['src/main'])
    )
    expect(fugas).toEqual(['src/renderer/b.tsx', '.github/workflows/ci.yml'])
  })
})

describe('nomes derivados do run', () => {
  /**
   * O container é do run, não do projeto: dois runs da mesma fatia precisam de nomes distintos,
   * senão o segundo reusa o container do primeiro — a reutilização indevida que a SPEC proíbe.
   */
  it('dá nomes distintos a dois runs da mesma fatia', () => {
    expect(nomeDoContainer('run-A')).not.toBe(nomeDoContainer('run-B'))
    expect(nomeDaBranch('m9-f03', 'run-A')).not.toBe(nomeDaBranch('m9-f03', 'run-B'))
  })

  it('produz nome de container válido para o Docker (minúsculas, sem caractere estranho)', () => {
    expect(nomeDoContainer('Run_42:xyz')).toBe('jarvisos-run-run-42-xyz')
    expect(nomeDoContainer('Run_42:xyz')).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  })

  it('prefixa os recursos de lease por tipo, para o verificador casar por prefixo', () => {
    expect(recursoDoWorktree('r1').startsWith('worktree:')).toBe(true)
    expect(recursoDoContainer('r1').startsWith('container:')).toBe(true)
    expect(recursoDaPorta(5432)).toBe('porta:5432')
  })

  /**
   * Nenhum recurso desta fatia pode colidir com o slot global de WIP: o `UNIQUE(user_id,
   * recurso)` protege duplicata exata, e uma colisão de nome aqui roubaria o slot da fila.
   */
  it('nunca colide com o recurso do slot global', () => {
    expect(recursoDoWorktree('wip')).not.toBe('wip:global')
    expect(recursoDoContainer('global')).not.toBe('wip:global')
  })
})
