import { describe, expect, it } from 'vitest'
import type { Mvp, Slice } from './roadmap'
import {
  CATALOGO_PADRAO,
  VERSAO_DO_CATALOGO,
  caminhosSeSobrepoem,
  conflitosDeTrava,
  descreverRazao,
  fechoDeDependencias,
  MAX_CAMINHOS_NO_WRITE_SET,
  MAX_CONFLITOS_REPORTADOS,
  normalizarCaminho,
  provarIndependencia,
  recursosTocados,
  travasDoWriteSet,
  type FatiaParaProva
} from './independencia'

const fatia = (
  runId: string,
  writeSet: readonly string[] | undefined,
  extra = {}
): FatiaParaProva => ({
  runId,
  sliceId: `s-${runId}`,
  dependeDe: [],
  writeSet,
  ...extra
})

describe('normalizarCaminho', () => {
  it('normaliza separadores, barras duplas e ponto', () => {
    expect(normalizarCaminho('src\\main//pipeline/')).toBe('src/main/pipeline')
    expect(normalizarCaminho('./src/a')).toBe('src/a')
  })

  it('recusa o que não é prefixo relativo: vazio, glob, absoluto, `..` e unidade', () => {
    const controle = String.fromCharCode(10)
    const nulo = String.fromCharCode(0)
    const invalidos = [
      '',
      '   ',
      'src/**',
      'src/*.ts',
      '/etc',
      'C:' + String.fromCharCode(92) + 'x'
    ]
    for (const ruim of [...invalidos, '../fora', 'a/../b', `a${controle}b`, `a${nulo}b`]) {
      expect(normalizarCaminho(ruim), ruim).toBeUndefined()
    }
  })

  it('a raiz é válida e vira "."', () => {
    expect(normalizarCaminho('.')).toBe('.')
  })
})

describe('caminhosSeSobrepoem — por segmento, nos dois sentidos', () => {
  it('prefixo e igual se sobrepõem; irmão e nome parecido não', () => {
    expect(caminhosSeSobrepoem('src/api', 'src/api')).toBe(true)
    expect(caminhosSeSobrepoem('src', 'src/api/x.ts')).toBe(true)
    expect(caminhosSeSobrepoem('src/api/x.ts', 'src')).toBe(true)
    expect(caminhosSeSobrepoem('src/api', 'src/api-v2')).toBe(false)
    expect(caminhosSeSobrepoem('src/a', 'src/b')).toBe(false)
  })

  it('a raiz se sobrepõe a tudo', () => {
    expect(caminhosSeSobrepoem('.', 'qualquer/coisa')).toBe(true)
  })

  it('é simétrica', () => {
    const lista = ['.', 'src', 'src/a', 'src/a/b.ts', 'docs', 'src-x', 'a/b', 'a/b/c']
    for (const a of lista)
      for (const b of lista) {
        expect(caminhosSeSobrepoem(a, b), `${a} ~ ${b}`).toBe(caminhosSeSobrepoem(b, a))
      }
  })
})

describe('catálogo de recursos exclusivos', () => {
  it('é versionado e traz as cinco áreas da SPEC', () => {
    expect(CATALOGO_PADRAO.versao).toBe(VERSAO_DO_CATALOGO)
    const ids = CATALOGO_PADRAO.recursos.map((r) => r.id).sort()
    expect(ids).toEqual(
      ['build-config', 'contrato-arquitetural', 'lockfile', 'migrations', 'schema-publico'].sort()
    )
  })

  it('o lockfile é tocado por escrever nele, por escrever na raiz, e não por um subdiretório', () => {
    expect(recursosTocados('package-lock.json')).toEqual(['lockfile'])
    expect(recursosTocados('.')).toContain('lockfile')
    expect(recursosTocados('src/renderer')).toEqual([])
  })

  it('um diretório que CONTÉM o recurso toca o recurso', () => {
    expect(recursosTocados('src/main/storage')).toContain('migrations')
    expect(recursosTocados('prisma')).toEqual(
      expect.arrayContaining(['migrations', 'schema-publico'])
    )
    expect(recursosTocados('docs')).toContain('contrato-arquitetural')
  })

  it('migration, schema, build e contrato são reconhecidos pelo caminho', () => {
    expect(recursosTocados('prisma/migrations/20260101_x/migration.sql')).toEqual(['migrations'])
    expect(recursosTocados('prisma/schema.prisma')).toEqual(['schema-publico'])
    // O manifesto também é parte da dependência: mudar `package.json` invalida o lockfile.
    expect(recursosTocados('package.json')).toEqual(['build-config', 'lockfile'])
    expect(recursosTocados('docs/ARCHITECTURE.md')).toEqual(['contrato-arquitetural'])
  })

  it('caminho inválido não toca nada (quem recusa é a normalização)', () => {
    expect(recursosTocados('../package-lock.json')).toEqual([])
  })
})

describe('travasDoWriteSet', () => {
  it('uma trava por caminho e uma por recurso, sem repetição e em ordem estável', () => {
    const t = travasDoWriteSet(['src/b', 'src/a', 'src/a/', 'package-lock.json'])
    expect(t?.caminhos).toEqual(['package-lock.json', 'src/a', 'src/b'])
    expect(t?.recursos).toEqual(['lockfile'])
  })

  it('caminho inválido invalida o conjunto inteiro', () => {
    expect(travasDoWriteSet(['src/a', 'src/**'])).toBeUndefined()
  })

  it('conjunto vazio não é "nada a travar": é desconhecido', () => {
    expect(travasDoWriteSet([])).toBeUndefined()
  })
})

describe('conflitosDeTrava', () => {
  const existentes = [
    { runId: 'a', tipo: 'caminho' as const, chave: 'src/api' },
    { runId: 'a', tipo: 'recurso' as const, chave: 'lockfile' }
  ]

  it('sobreposição de caminho e recurso igual conflitam; o próprio dono não', () => {
    const c = conflitosDeTrava(
      'b',
      { caminhos: ['src/api/x.ts'], recursos: ['lockfile'] },
      existentes
    )
    expect(c).toEqual([
      { tipo: 'caminho', chave: 'src/api/x.ts', comRunId: 'a', comChave: 'src/api' },
      { tipo: 'recurso', chave: 'lockfile', comRunId: 'a', comChave: 'lockfile' }
    ])
    expect(
      conflitosDeTrava('a', { caminhos: ['src/api'], recursos: ['lockfile'] }, existentes)
    ).toEqual([])
  })

  it('conjuntos disjuntos não conflitam', () => {
    expect(conflitosDeTrava('b', { caminhos: ['src/web'], recursos: [] }, existentes)).toEqual([])
  })
})

describe('provarIndependencia — critérios 1, 2 e 4', () => {
  it('write sets disjuntos e sem recurso global: independentes', () => {
    const p = provarIndependencia(fatia('b', ['src/web']), [fatia('a', ['src/api'])])
    expect(p.independente).toBe(true)
    expect(p.razoes).toEqual([])
    expect(p.versaoDoCatalogo).toBe(VERSAO_DO_CATALOGO)
  })

  it('lockfile comum: sem dependência entre as fatias, mesmo assim não executam juntas (critério 1)', () => {
    const p = provarIndependencia(fatia('b', ['src/web', 'package-lock.json']), [
      fatia('a', ['src/api', 'package-lock.json'])
    ])
    expect(p.independente).toBe(false)
    expect(p.razoes).toHaveLength(2)
    expect(p.razoes).toEqual(
      expect.arrayContaining([
        { tipo: 'recurso-exclusivo', runId: 'b', contraRunId: 'a', recurso: 'lockfile' },
        {
          tipo: 'sobreposicao-de-path',
          runId: 'b',
          contraRunId: 'a',
          caminho: 'package-lock.json',
          contraCaminho: 'package-lock.json'
        }
      ])
    )
  })

  it('a caixa não distingue caminho: `Src/Api` e `src/api` são o mesmo diretório no Windows', () => {
    expect(caminhosSeSobrepoem('Src/Api', 'src/api/x.ts')).toBe(true)
    expect(
      provarIndependencia(fatia('b', ['Src/Api']), [fatia('a', ['src/api'])]).independente
    ).toBe(false)
  })

  it('um diretório que contém as migrations conflita com quem escreve uma migration', () => {
    const p = provarIndependencia(fatia('b', ['prisma/migrations/2026_nova']), [
      fatia('a', ['prisma'])
    ])
    expect(p.independente).toBe(false)
    expect(p.razoes.map((r) => r.tipo)).toContain('recurso-exclusivo')
  })

  it('sobreposição de prefixos bloqueia', () => {
    const p = provarIndependencia(fatia('b', ['src/api/x.ts']), [fatia('a', ['src/api'])])
    expect(p.independente).toBe(false)
    expect(p.razoes[0].tipo).toBe('sobreposicao-de-path')
  })

  it('regra 1: write set desconhecido (candidato ou ativo) torna a prova incompleta', () => {
    const semConjunto = provarIndependencia(fatia('b', undefined), [fatia('a', ['src/api'])])
    expect(semConjunto.independente).toBe(false)
    expect(semConjunto.razoes).toEqual([{ tipo: 'write-set-desconhecido', runId: 'b' }])

    const ativoSem = provarIndependencia(fatia('b', ['src/web']), [fatia('a', undefined)])
    expect(ativoSem.razoes).toEqual([{ tipo: 'write-set-desconhecido', runId: 'a' }])
  })

  it('regra 1: caminho inválido no conjunto também é desconhecido', () => {
    const p = provarIndependencia(fatia('b', ['src/**']), [fatia('a', ['src/api'])])
    expect(p.independente).toBe(false)
    expect(p.razoes).toEqual([{ tipo: 'write-set-desconhecido', runId: 'b' }])
  })

  it('regra 1: dependências desconhecidas também forçam sequencial', () => {
    const p = provarIndependencia(fatia('b', ['src/web'], { dependeDe: undefined }), [
      fatia('a', ['src/api'])
    ])
    expect(p.independente).toBe(false)
    expect(p.razoes).toEqual([{ tipo: 'dependencias-desconhecidas', runId: 'b' }])
  })

  it('dependência direta ou transitiva, em qualquer sentido, bloqueia; o DAG sozinho não autoriza', () => {
    const a = fatia('a', ['src/api'])
    const bDepende = fatia('b', ['src/web'], { dependeDe: ['s-a'] })
    expect(provarIndependencia(bDepende, [a]).razoes).toEqual([
      { tipo: 'dependencia', runId: 'b', aposRunId: 'a' }
    ])
    const aDepende = fatia('a', ['src/api'], { dependeDe: ['s-b'] })
    expect(provarIndependencia(fatia('b', ['src/web']), [aDepende]).razoes).toEqual([
      { tipo: 'dependencia', runId: 'a', aposRunId: 'b' }
    ])
    // Sem aresta e com write set em comum: o DAG não prova nada.
    expect(provarIndependencia(fatia('b', ['src/api']), [a]).independente).toBe(false)
  })

  it('duas execuções da mesma fatia nunca são independentes', () => {
    const p = provarIndependencia(fatia('b', ['src/web'], { sliceId: 's-a' }), [
      fatia('a', ['src/api'])
    ])
    expect(p.razoes).toEqual([{ tipo: 'mesma-fatia', runId: 'b', contraRunId: 'a' }])
  })

  it('só é independente se for de TODOS os ativos', () => {
    const p = provarIndependencia(fatia('c', ['src/web']), [
      fatia('a', ['src/api']),
      fatia('b', ['src/web/x'])
    ])
    expect(p.independente).toBe(false)
    expect(p.razoes.every((r) => 'contraRunId' in r && r.contraRunId === 'b')).toBe(true)
  })

  it('catálogo trocado entra na prova', () => {
    const catalogo = { versao: 7, recursos: [{ id: 'gerado', descricao: 'x', caminhos: ['gen'] }] }
    const p = provarIndependencia(fatia('b', ['gen/b']), [fatia('a', ['gen/a'])], catalogo)
    expect(p.versaoDoCatalogo).toBe(7)
    expect(p.razoes).toEqual([
      { tipo: 'recurso-exclusivo', runId: 'b', contraRunId: 'a', recurso: 'gerado' }
    ])
  })

  it('critério 4: o mesmo snapshot dá a mesma prova e a mesma entrada canônica, em qualquer ordem', () => {
    const a = fatia('a', ['src/api', 'package-lock.json'])
    const x = fatia('x', ['docs/guia'])
    const b = fatia('b', ['src/web', 'package-lock.json'])
    const p1 = provarIndependencia(b, [a, x])
    const p2 = provarIndependencia(fatia('b', ['package-lock.json', 'src/web']), [x, a])
    expect(p2).toEqual(p1)
    expect(p1.entradaCanonica).toBe(p2.entradaCanonica)
  })

  it('entrada diferente muda a entrada canônica', () => {
    const base = provarIndependencia(fatia('b', ['src/web']), [fatia('a', ['src/api'])])
    const outra = provarIndependencia(fatia('b', ['src/web2']), [fatia('a', ['src/api'])])
    expect(outra.entradaCanonica).not.toBe(base.entradaCanonica)
  })
})

describe('provarIndependencia — propriedades', () => {
  // PRNG com semente: o mesmo estado dá o mesmo resultado, e um falso positivo se reproduz.
  const prng = (semente: number) => () => {
    semente = (semente * 1664525 + 1013904223) >>> 0
    return semente / 0x100000000
  }
  const PARTES = [
    'src',
    'docs',
    'prisma',
    'migrations',
    'api',
    'web',
    'a',
    'b',
    'package.json',
    'yarn.lock'
  ]
  const caminhoAleatorio = (r: () => number): string =>
    Array.from(
      { length: 1 + Math.floor(r() * 3) },
      () => PARTES[Math.floor(r() * PARTES.length)]
    ).join('/')

  it('independente ⇒ nenhum par de caminhos se sobrepõe e nenhum recurso é compartilhado', () => {
    const r = prng(42)
    let independentes = 0
    for (let i = 0; i < 1200; i++) {
      const a = Array.from({ length: 1 + Math.floor(r() * 3) }, () => caminhoAleatorio(r))
      const b = Array.from({ length: 1 + Math.floor(r() * 3) }, () => caminhoAleatorio(r))
      const p = provarIndependencia(fatia('b', b), [fatia('a', a)])
      if (!p.independente) continue
      independentes++
      for (const x of a)
        for (const y of b) {
          expect(caminhosSeSobrepoem(x, y), `${x} ~ ${y}`).toBe(false)
          const comuns = recursosTocados(x).filter((id) => recursosTocados(y).includes(id))
          expect(comuns, `${x} / ${y}`).toEqual([])
        }
    }
    // Sem isso o teste passaria vazio: precisa existir ao menos um caso independente.
    expect(independentes).toBeGreaterThan(20)
  })

  it('é simétrica em quem é candidato e quem é ativo (no veredito)', () => {
    const r = prng(7)
    for (let i = 0; i < 500; i++) {
      const a = [caminhoAleatorio(r), caminhoAleatorio(r)]
      const b = [caminhoAleatorio(r)]
      const ab = provarIndependencia(fatia('b', b), [fatia('a', a)]).independente
      const ba = provarIndependencia(fatia('a', a), [fatia('b', b)]).independente
      expect(ab).toBe(ba)
    }
  })
})

describe('fechoDeDependencias', () => {
  const mvp = (id: string, numero: number, dependeDe: string[] = []): Mvp =>
    ({
      id,
      numero,
      titulo: id,
      tese: '',
      estado: 'planejado',
      dependeDe,
      origem: 'usuario'
    }) as unknown as Mvp
  const slice = (id: string, mvpId: string, numero: number): Slice =>
    ({
      id,
      mvpId,
      numero,
      titulo: id,
      specSlug: id,
      detalhada: false,
      origem: 'usuario'
    }) as unknown as Slice

  const mvps = [mvp('m1', 1), mvp('m2', 2, ['m1']), mvp('m3', 3, ['m2'])]
  const slices = [
    slice('m1f1', 'm1', 1),
    slice('m1f2', 'm1', 2),
    slice('m2f1', 'm2', 1),
    slice('m2f2', 'm2', 2),
    slice('m3f1', 'm3', 1)
  ]

  it('inclui as fatias anteriores do MVP e todas as dos MVPs de que ele depende, transitivamente', () => {
    expect(fechoDeDependencias(slices[3], mvps, slices)).toEqual(['m1f1', 'm1f2', 'm2f1'])
    expect(fechoDeDependencias(slices[4], mvps, slices)).toEqual(['m1f1', 'm1f2', 'm2f1', 'm2f2'])
  })

  it('a primeira fatia do primeiro MVP não depende de nada', () => {
    expect(fechoDeDependencias(slices[0], mvps, slices)).toEqual([])
  })

  it('DAG inválido ou fatia fora do roadmap: desconhecido', () => {
    const ciclo = [mvp('m1', 1, ['m2']), mvp('m2', 2, ['m1'])]
    expect(fechoDeDependencias(slices[0], ciclo, slices)).toBeUndefined()
    expect(fechoDeDependencias(slice('x', 'm1', 9), [], [])).toBeUndefined()
  })
})

describe('descreverRazao', () => {
  it('cada razão vira uma frase que nomeia o run e o motivo', () => {
    const frases = [
      descreverRazao({ tipo: 'write-set-desconhecido', runId: 'b' }),
      descreverRazao({ tipo: 'dependencias-desconhecidas', runId: 'b' }),
      descreverRazao({ tipo: 'dependencia', runId: 'b', aposRunId: 'a' }),
      descreverRazao({ tipo: 'mesma-fatia', runId: 'b', contraRunId: 'a' }),
      descreverRazao({
        tipo: 'sobreposicao-de-path',
        runId: 'b',
        contraRunId: 'a',
        caminho: 'src/x',
        contraCaminho: 'src'
      }),
      descreverRazao({
        tipo: 'recurso-exclusivo',
        runId: 'b',
        contraRunId: 'a',
        recurso: 'lockfile'
      })
    ]
    expect(new Set(frases).size).toBe(6)
    expect(frases.every((f) => f.includes('b'))).toBe(true)
    expect(frases[5]).toContain('lockfile')
    expect(frases[4]).toContain('src/x')
  })
})

describe('fechoDeDependencias — propriedades sobre DAGs aleatórios', () => {
  const prng = (semente: number) => () => {
    semente = (semente * 1664525 + 1013904223) >>> 0
    return semente / 0x100000000
  }

  const roadmapAleatorio = (r: () => number) => {
    const nMvps = 2 + Math.floor(r() * 4)
    // Só aponta para MVPs de numero menor: o DAG é válido por construção.
    const mvps = Array.from({ length: nMvps }, (_, i) => ({
      id: `m${i}`,
      numero: i,
      titulo: `m${i}`,
      tese: '',
      estado: 'planejado',
      dependeDe: Array.from({ length: i }, (_, j) => `m${j}`).filter(() => r() < 0.4),
      origem: 'usuario'
    })) as unknown as Mvp[]
    const slices = mvps.flatMap((m) =>
      Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => ({
        id: `${m.id}f${k}`,
        mvpId: m.id,
        numero: k,
        titulo: '',
        specSlug: '',
        detalhada: false,
        origem: 'usuario'
      }))
    ) as unknown as Slice[]
    return { mvps, slices }
  }

  it('o fecho é transitivo: quem está no fecho de S traz o próprio fecho junto', () => {
    const r = prng(99)
    for (let i = 0; i < 200; i++) {
      const { mvps, slices } = roadmapAleatorio(r)
      const fechos = new Map(slices.map((s) => [s.id, fechoDeDependencias(s, mvps, slices)]))
      for (const s of slices) {
        const f = fechos.get(s.id)
        expect(f).toBeDefined()
        expect(f).not.toContain(s.id)
        for (const dep of f ?? []) {
          for (const dd of fechos.get(dep) ?? []) expect(f, `${dd} via ${dep}`).toContain(dd)
        }
      }
    }
  })

  it('nunca há ciclo: se A está no fecho de B, B não está no de A', () => {
    const r = prng(5)
    for (let i = 0; i < 200; i++) {
      const { mvps, slices } = roadmapAleatorio(r)
      for (const a of slices)
        for (const b of slices) {
          const fa = fechoDeDependencias(a, mvps, slices) ?? []
          const fb = fechoDeDependencias(b, mvps, slices) ?? []
          expect(fa.includes(b.id) && fb.includes(a.id)).toBe(false)
        }
    }
  })

  it('duas fatias ligadas por dependência (em qualquer sentido) nunca são independentes', () => {
    const r = prng(11)
    for (let i = 0; i < 100; i++) {
      const { mvps, slices } = roadmapAleatorio(r)
      for (const a of slices) {
        const fa = fechoDeDependencias(a, mvps, slices)
        for (const b of slices) {
          if (a.id === b.id) continue
          const fb = fechoDeDependencias(b, mvps, slices)
          const ligadas = fa?.includes(b.id) === true || fb?.includes(a.id) === true
          const p = provarIndependencia(
            { runId: 'ra', sliceId: a.id, dependeDe: fa, writeSet: ['x/a'] },
            [{ runId: 'rb', sliceId: b.id, dependeDe: fb, writeSet: ['y/b'] }]
          )
          expect(p.independente, `${a.id} ~ ${b.id}`).toBe(!ligadas)
        }
      }
    }
  })
})

describe('segurança — aliases do NTFS, invisíveis, tetos e entrada não-texto', () => {
  const barra = String.fromCharCode(92)
  const recusaOuTrava = (caminho: string, recurso: string): boolean => {
    const t = travasDoWriteSet([caminho])
    return t === undefined || t.recursos.includes(recurso)
  }

  it.each([
    ['package-lock.json::$DATA', 'lockfile'],
    ['package-lock.json.', 'lockfile'],
    ['package-lock.json ', 'lockfile'],
    ['PACKAG~1.JSO', 'lockfile'],
    ['prisma::$INDEX_ALLOCATION/migrations/x.sql', 'migrations'],
    ['prisma/migrations::$INDEX_ALLOCATION/x.sql', 'migrations'],
    ['prisma./migrations/x.sql', 'migrations'],
    ['prisma/MIGRAT~1/x.sql', 'migrations'],
    ['package.json:stream', 'build-config'],
    ['.github./workflows/ci.yml', 'build-config']
  ])('%s: recusado, ou trava %s', (caminho, recurso) => {
    expect(recusaOuTrava(caminho, recurso)).toBe(true)
  })

  it('segmento com ponto ou espaço no fim, 8.3 e stream são recusados', () => {
    for (const ruim of [
      'src./api',
      'src /api',
      'src/api.',
      'a/PROGRA~1/b',
      'a/b:s',
      'a/b?',
      'a/<b>',
      'a/"b"',
      'a/b|c',
      '...'
    ]) {
      expect(normalizarCaminho(ruim), ruim).toBeUndefined()
    }
    expect(normalizarCaminho('.github/workflows')).toBe('.github/workflows')
    expect(normalizarCaminho('.npmrc')).toBe('.npmrc')
    expect(normalizarCaminho('src' + barra + 'api')).toBe('src/api')
  })

  it('direção, largura zero, separadores de linha e C1 são recusados', () => {
    for (const cp of [0x202e, 0x200b, 0x2028, 0x0085, 0x0080, 0xfeff, 0x2066]) {
      expect(
        normalizarCaminho('src/a' + String.fromCodePoint(cp) + 'pi'),
        cp.toString(16)
      ).toBeUndefined()
    }
  })

  it('entrada que não é texto não lança: é desconhecida', () => {
    for (const x of [123, null, undefined, {}, ['a']]) {
      expect(() => travasDoWriteSet([x as unknown as string])).not.toThrow()
      expect(travasDoWriteSet([x as unknown as string])).toBeUndefined()
    }
    expect(travasDoWriteSet('src' as unknown as string[])).toBeUndefined()
  })

  it('write set grande demais e caminho grande demais são recusados, não processados', () => {
    const ws = Array.from({ length: MAX_CAMINHOS_NO_WRITE_SET + 1 }, (_, i) => `src/m${i}/a.ts`)
    expect(travasDoWriteSet(ws)).toBeUndefined()
    expect(travasDoWriteSet(ws.slice(0, MAX_CAMINHOS_NO_WRITE_SET))).toBeDefined()
    expect(travasDoWriteSet(['src/' + 'a'.repeat(1_000_000)])).toBeUndefined()
  })

  it('a chave da trava é a caixa canônica: 2^n grafias do mesmo diretório são uma trava só', () => {
    const base = 'abcdefghij'
    const variantes = Array.from({ length: 1 << 10 }, (_, m) =>
      [...base].map((c, i) => ((m >> i) & 1 ? c.toUpperCase() : c)).join('')
    )
    // 1024 grafias estouram o teto de caminhos; as 100 primeiras cabem e colapsam em uma.
    const t = travasDoWriteSet(variantes.slice(0, MAX_CAMINHOS_NO_WRITE_SET).map((v) => `src/${v}`))
    expect(t?.caminhos).toEqual(['src/abcdefghij'])
  })

  it('milhares de travas alheias não viram milhares de conflitos', () => {
    const existentes = Array.from({ length: 5_000 }, (_, i) => ({
      runId: 'a',
      tipo: 'caminho' as const,
      chave: `src/m${i}`
    }))
    const c = conflitosDeTrava('b', { caminhos: ['src'], recursos: [] }, existentes)
    expect(c).toHaveLength(MAX_CONFLITOS_REPORTADOS)
  })

  it('razões limitadas, e o veredito continua negativo', () => {
    const ativo = Array.from({ length: MAX_CAMINHOS_NO_WRITE_SET }, (_, i) => `src/m${i}`)
    const cand = Array.from({ length: MAX_CAMINHOS_NO_WRITE_SET }, (_, i) => `src/m${i}/x`)
    const p = provarIndependencia({ runId: 'b', sliceId: 'sb', dependeDe: [], writeSet: cand }, [
      { runId: 'a', sliceId: 'sa', dependeDe: [], writeSet: ativo }
    ])
    expect(p.independente).toBe(false)
    expect(p.razoes.length).toBeLessThanOrEqual(MAX_CONFLITOS_REPORTADOS)
  })
})

describe('revisão — NFC e manifesto + lockfile', () => {
  it('F4: NFC e NFD do mesmo nome são o mesmo diretório', () => {
    const nfc = 'src/café'
    const nfd = 'src/café'
    expect(normalizarCaminho(nfd)).toBe(normalizarCaminho(nfc))
    expect(provarIndependencia(fatia('b', [nfd]), [fatia('a', [nfc])]).independente).toBe(false)
  })

  it('F5: manifesto e lockfile de dependências colidem entre si, em qualquer ecossistema', () => {
    const pares = [
      ['package.json', 'package-lock.json'],
      ['pyproject.toml', 'uv.lock'],
      ['Cargo.toml', 'Cargo.lock'],
      ['go.mod', 'go.sum'],
      ['pnpm-workspace.yaml', 'pnpm-lock.yaml']
    ]
    for (const [manifesto, trava] of pares) {
      const p = provarIndependencia(fatia('b', [manifesto, 'src/b']), [
        fatia('a', [trava, 'src/a'])
      ])
      expect(p.independente, `${manifesto} ~ ${trava}`).toBe(false)
    }
  })
})
