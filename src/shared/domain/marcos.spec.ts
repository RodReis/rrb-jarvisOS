import { describe, expect, it } from 'vitest'
import type { EstadoDoRepositorio, FatoDoMarco } from './marcos'
import { estadoDoMarco, linhasDeMarcos, resultadoAindaVale, verificarMarcos } from './marcos'

const LIMPO: EstadoDoRepositorio = { sujos: [], headInterrompido: false, head: 'abc1234' }

function fato(parcial: Partial<FatoDoMarco> = {}): FatoDoMarco {
  return {
    caminho: 'docs/PRD.md',
    hashDaRevisao: 'a'.repeat(64),
    commit: 'c0ffee1',
    data: '2026-09-04T10:00:00.000Z',
    hashDoBlob: 'a'.repeat(64),
    ...parcial
  }
}

describe('estadoDoMarco', () => {
  it('devolve `commitado` quando o blob do commit é exatamente a revisão aceita', () => {
    expect(estadoDoMarco(fato())).toBe('commitado')
  })

  it('devolve `sem-revisao` quando o PI ainda não aceitou nada — não há o que cobrar', () => {
    expect(estadoDoMarco(fato({ hashDaRevisao: undefined }))).toBe('sem-revisao')
  })

  it('devolve `revisao-sem-commit` quando há revisão aceita e nenhum commit do arquivo', () => {
    expect(estadoDoMarco(fato({ commit: undefined, hashDoBlob: undefined }))).toBe(
      'revisao-sem-commit'
    )
  })

  it('devolve `blob-divergente` quando o commit existe mas guarda outra revisão', () => {
    // O caso que "existe commit" mascararia: PRD commitado na versão antiga, PI aceitou depois.
    expect(estadoDoMarco(fato({ hashDoBlob: 'b'.repeat(64) }))).toBe('blob-divergente')
  })

  it('trata blob ausente com commit presente como divergência, não como estado próprio', () => {
    expect(estadoDoMarco(fato({ hashDoBlob: undefined }))).toBe('blob-divergente')
  })
})

describe('verificarMarcos', () => {
  it('libera quando todo marco está commitado e a árvore está limpa', () => {
    const resultado = verificarMarcos([fato()], LIMPO)

    expect(resultado.ok).toBe(true)
    expect(resultado.pendencias).toEqual([])
    expect(resultado.head).toBe('abc1234')
  })

  it('libera quando o documento nunca teve revisão aceita', () => {
    // `sem-revisao` não é pendência: cobrar commit de algo que o PI não aceitou bloquearia o
    // gate por um documento que não existe.
    expect(verificarMarcos([fato({ hashDaRevisao: undefined })], LIMPO).ok).toBe(true)
  })

  it('bloqueia com ação concreta quando falta commit do marco', () => {
    const resultado = verificarMarcos([fato({ commit: undefined, hashDoBlob: undefined })], LIMPO)

    expect(resultado.ok).toBe(false)
    expect(resultado.pendencias).toHaveLength(1)
    expect(resultado.pendencias[0]?.estado).toBe('revisao-sem-commit')
    expect(resultado.pendencias[0]?.acao).toBe('Commitar marco docs/PRD.md')
  })

  it('bloqueia quando o blob commitado diverge da revisão aceita', () => {
    const resultado = verificarMarcos([fato({ hashDoBlob: 'b'.repeat(64) })], LIMPO)

    expect(resultado.ok).toBe(false)
    expect(resultado.pendencias[0]?.estado).toBe('blob-divergente')
    expect(resultado.pendencias[0]?.acao).toBe('Commitar marco docs/PRD.md')
  })

  it('bloqueia com a lista de arquivos quando a árvore está suja', () => {
    const resultado = verificarMarcos([fato()], {
      ...LIMPO,
      sujos: ['docs/PRD.md', 'src/app.ts']
    })

    expect(resultado.ok).toBe(false)
    expect(resultado.pendencias[0]?.estado).toBe('arvore-suja')
    expect(resultado.pendencias[0]?.acao).toBe(
      'Descartar ou commitar alterações em docs/PRD.md, src/app.ts'
    )
  })

  it('bloqueia quando o HEAD está em merge ou rebase interrompido', () => {
    const resultado = verificarMarcos([fato()], { ...LIMPO, headInterrompido: true })

    expect(resultado.ok).toBe(false)
    expect(resultado.pendencias[0]?.estado).toBe('head-interrompido')
    expect(resultado.pendencias[0]?.acao).not.toBe('')
  })

  it('acumula as três condições em vez de parar na primeira', () => {
    // O PI precisa ver tudo o que falta de uma vez: revelar uma pendência por vez faria o
    // usuário resolver, tentar de novo, e descobrir a seguinte.
    const resultado = verificarMarcos(
      [fato({ commit: undefined, hashDoBlob: undefined }), fato({ caminho: 'docs/BRIEF.md' })],
      { ...LIMPO, sujos: ['README.md'], headInterrompido: true }
    )

    expect(resultado.ok).toBe(false)
    expect(resultado.pendencias.map((p) => p.estado)).toEqual([
      'revisao-sem-commit',
      'head-interrompido',
      'arvore-suja'
    ])
  })

  it('não expõe conteúdo — só caminhos — na pendência de árvore suja', () => {
    const resultado = verificarMarcos([fato()], { ...LIMPO, sujos: ['docs/SEGREDO.md'] })

    const texto = JSON.stringify(resultado)
    expect(texto).toContain('docs/SEGREDO.md')
    expect(texto).not.toContain('@@')
  })
})

describe('linhasDeMarcos', () => {
  it('preserva a ordem e anexa o estado a cada fato', () => {
    const linhas = linhasDeMarcos([
      fato({ caminho: 'docs/PROMPT.md' }),
      fato({ caminho: 'docs/PRD.md', commit: undefined, hashDoBlob: undefined })
    ])

    expect(linhas.map((l) => [l.caminho, l.estado])).toEqual([
      ['docs/PROMPT.md', 'commitado'],
      ['docs/PRD.md', 'revisao-sem-commit']
    ])
  })
})

describe('resultadoAindaVale', () => {
  it('vale quando o resultado passou e o HEAD é o mesmo da verificação', () => {
    expect(resultadoAindaVale(verificarMarcos([fato()], LIMPO), 'abc1234')).toBe(true)
  })

  it('não vale quando o HEAD mudou entre a verificação e o aceite (critério 5)', () => {
    expect(resultadoAindaVale(verificarMarcos([fato()], LIMPO), 'outro99')).toBe(false)
  })

  it('não vale quando nunca houve verificação', () => {
    expect(resultadoAindaVale(undefined, 'abc1234')).toBe(false)
  })

  it('não vale quando a verificação bloqueou, mesmo com o HEAD igual', () => {
    const bloqueado = verificarMarcos([fato()], { ...LIMPO, sujos: ['x.md'] })
    expect(resultadoAindaVale(bloqueado, 'abc1234')).toBe(false)
  })
})
