/**
 * O ciclo TESTE → REVIEWER → DEVELOPER (SPEC-Squads-04, critérios 2, 3 e 5).
 *
 * A produção do trabalho, a suíte e o revisor são portas falsas e controláveis — cada uma já tem a
 * sua prova com Git e banco reais —, mas o **repositório de achados e a auditoria são reais**: o
 * que se prova aqui é a ordem das etapas, o limite da M9-F04 contado por run, o registro de cada
 * volta e que só o escritor recebe a correção.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AchadoRegistrado } from '@shared/domain/squad-achado'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { AchadoRepository } = await import('./achado-repository')
const { CicloDeRevisao } = await import('./squad-ciclo')

type Pedido = Parameters<InstanceType<typeof CicloDeRevisao>['executar']>[0]
type Producao = Awaited<ReturnType<ConstructorParameters<typeof CicloDeRevisao>[0]['produzir']>>
type Suite = Awaited<
  ReturnType<ConstructorParameters<typeof CicloDeRevisao>[0]['teste']['executar']>
>
type Revisao = Awaited<
  ReturnType<ConstructorParameters<typeof CicloDeRevisao>[0]['revisor']['revisar']>
>

const USER = 'u-1'

let dir: string
let db: Db
let achados: InstanceType<typeof AchadoRepository>
let ordem: string[]
let produzir: ReturnType<typeof vi.fn>
let teste: ReturnType<typeof vi.fn>
let revisar: ReturnType<typeof vi.fn>
let producoes: Producao[]
let suites: Suite[]
let revisoes: Revisao[]

const pronto = (n: number): Extract<Producao, { estado: 'pronto' }> => ({
  estado: 'pronto',
  commitSha: `${String(n).repeat(40)}`.slice(0, 40),
  manifesto: `manifesto da tentativa ${n}`
})
const verde: Suite = { estado: 'verde', passos: ['test', 'lint', 'typecheck', 'build'] }
const vermelha: Suite = {
  estado: 'vermelha',
  passo: 'test',
  classificacao: 'corrigivel',
  evidencia: '1 teste falhou',
  passos: []
}

const achado = (extra: Partial<AchadoRegistrado> = {}): AchadoRegistrado => ({
  categoria: 'corretude',
  severidade: 'P1',
  titulo: 'O parser perde o último item',
  arquivo: 'src/a.ts',
  trecho: 'items.slice(0, -1)',
  impacto: 'Dado perdido.',
  correcao: 'Usar items.slice().',
  foraDaSpec: false,
  assinatura: 'sig-1',
  estado: 'accepted',
  vistoPor: ['rev-1', 'rev-2'],
  contestadoPor: [],
  deltaDaPrimeiraVista: 'd1',
  deltaDaUltimaVista: 'd1',
  ...extra
})

const pass: Revisao = {
  estado: 'revisada',
  veredito: { resultado: 'PASS' },
  achados: [],
  observacoes: [],
  revisores: [{ id: 'rev-1', estado: 'parecer' }],
  novos: 0
}
const fix = (...a: AchadoRegistrado[]): Revisao => ({
  ...pass,
  veredito: { resultado: 'FIX_REQUIRED' },
  achados: a,
  novos: a.length
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-ciclo-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  achados = new AchadoRepository(db)
  ordem = []
  producoes = []
  suites = []
  revisoes = []
  produzir = vi.fn(async () => {
    ordem.push('produzir')
    return producoes.shift() ?? pronto(1)
  })
  teste = vi.fn(async () => {
    ordem.push('teste')
    return suites.shift() ?? verde
  })
  revisar = vi.fn(async () => {
    ordem.push('revisar')
    return revisoes.shift() ?? pass
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const ciclo = () =>
  new CicloDeRevisao({
    produzir: produzir as never,
    teste: { executar: teste } as never,
    revisor: { revisar } as never,
    achados,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => 'jarvis'
  })

const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  runId: 'run-1',
  projectId: 'p-1',
  sliceId: 's-1',
  repositorio: '/repo',
  baseSha: 'b'.repeat(40),
  comandos: { test: ['t'], lint: ['l'], typecheck: ['c'], build: ['b'] },
  revisao: {
    projectId: 'p-1',
    runId: 'run-1',
    repositorio: '/repo',
    baseSha: 'b'.repeat(40),
    rota: 'claude-code',
    revisores: [{ id: 'rev-1', modelo: { provider: 'anthropic', modelo: 'x' } }],
    spec: { caminho: 'docs/spec/x.md', texto: 'SPEC' },
    contratoDeRevisao: 'REVIEW'
  },
  ...extra
})

const voltas = () => achados.listarVoltas(USER, 'run-1')

describe('o caminho feliz', () => {
  it('produz, testa, revisa e aprova na primeira tentativa, sem volta', async () => {
    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'aprovado', tentativas: 1, commitSha: pronto(1).commitSha })
    expect(voltas()).toEqual([])
  })

  it('TESTE vem antes de REVIEWER, e a revisão recebe o resultado da suíte e o manifesto', async () => {
    await ciclo().executar(pedido())

    expect(ordem).toEqual(['produzir', 'teste', 'revisar'])
    expect(revisar).toHaveBeenCalledWith(
      expect.objectContaining({
        resultadoSha: pronto(1).commitSha,
        testes: 'suíte verde: test, lint, typecheck, build',
        manifesto: 'manifesto da tentativa 1',
        rodada: 1
      })
    )
  })
})

describe('retrabalho depois do TESTE', () => {
  it('suíte vermelha volta ao DEVELOPER com a falha, e o REVIEWER não é chamado', async () => {
    suites = [vermelha, verde]
    producoes = [pronto(1), pronto(2)]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'aprovado', tentativas: 2 })
    expect(ordem).toEqual(['produzir', 'teste', 'produzir', 'teste', 'revisar'])
    expect(produzir).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tentativa: 2,
        correcoes: [],
        falhaDeTeste: { passo: 'test', evidencia: '1 teste falhou' }
      })
    )
    expect(voltas()).toMatchObject([{ tentativa: 1, origem: 'teste', decisao: 'voltar' }])
  })

  it('falha externa da suíte não gasta tentativa do escritor: para com o motivo', async () => {
    suites = [{ ...vermelha, classificacao: 'externo' }]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo: 'falha-externa', tentativas: 1 })
    expect(produzir).toHaveBeenCalledTimes(1)
    expect(revisar).not.toHaveBeenCalled()
    expect(voltas()).toMatchObject([{ tentativa: 1, origem: 'teste', decisao: 'parar' }])
  })

  it('suíte que não rodou para o run: nunca vira verde, e o REVIEWER não é chamado', async () => {
    suites = [{ estado: 'nao-rodou', motivo: 'docker-indisponivel' }]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo: 'suite-nao-rodou' })
    expect(revisar).not.toHaveBeenCalled()
  })
})

describe('retrabalho depois do REVIEWER', () => {
  it('reprovação volta ao DEVELOPER só com os achados aceitos, deduplicados', async () => {
    revisoes = [
      fix(
        achado(),
        achado({ assinatura: 'sig-2', severidade: 'P0' }),
        achado({ assinatura: 'sig-3', estado: 'open' }),
        achado({ assinatura: 'sig-4', estado: 'fixed' }),
        achado({ assinatura: 'sig-1' })
      ),
      pass
    ]
    producoes = [pronto(1), pronto(2)]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'aprovado', tentativas: 2 })
    const segunda = produzir.mock.calls[1]?.[0] as { correcoes: { assinatura: string }[] }
    expect(segunda.correcoes.map((c) => c.assinatura)).toEqual(['sig-2', 'sig-1'])
    // A correção é do escritor: nada de quem achou nem do debate.
    expect(JSON.stringify(segunda.correcoes)).not.toContain('rev-1')
    expect(voltas()).toMatchObject([
      { tentativa: 1, origem: 'revisao', decisao: 'voltar', assinaturas: ['sig-2', 'sig-1'] }
    ])
  })

  it('a rodada da revisão é a tentativa do DEVELOPER: revisão não consome tentativa', async () => {
    revisoes = [fix(achado()), pass]
    producoes = [pronto(1), pronto(2)]

    await ciclo().executar(pedido())

    expect(revisar.mock.calls.map((c) => (c[0] as { rodada: number }).rodada)).toEqual([1, 2])
  })

  it('critério 5: o limite da M9-F04 vale por run — a terceira reprovação para, sem quarta tentativa', async () => {
    revisoes = [fix(achado()), fix(achado()), fix(achado()), pass]
    producoes = [pronto(1), pronto(2), pronto(3), pronto(4)]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo: 'tentativas-esgotadas', tentativas: 3 })
    expect(produzir).toHaveBeenCalledTimes(3)
    expect(revisar).toHaveBeenCalledTimes(3)
  })

  it('critério 5: cada volta fica registrada, inclusive a que parou', async () => {
    revisoes = [fix(achado()), fix(achado()), fix(achado())]

    await ciclo().executar(pedido())

    expect(voltas().map((v) => [v.tentativa, v.origem, v.decisao, v.motivo])).toEqual([
      [1, 'revisao', 'voltar', undefined],
      [2, 'revisao', 'voltar', undefined],
      [3, 'revisao', 'parar', 'tentativas-esgotadas']
    ])
    const eventos = new AuditRepository(db, 'chave-de-teste')
      .list(USER)
      .filter((e) => e.type === 'squad-retrabalho')
    expect(eventos).toHaveLength(3)
  })

  it('a suíte quebra na volta que corrigia um achado: a correção aceita continua pendente para o escritor', async () => {
    revisoes = [fix(achado()), pass]
    suites = [verde, vermelha, verde]
    producoes = [pronto(1), pronto(2), pronto(3)]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'aprovado', tentativas: 3 })
    const terceira = produzir.mock.calls[2]?.[0] as {
      correcoes: { assinatura: string }[]
      falhaDeTeste?: { passo: string }
    }
    expect(terceira.correcoes.map((c) => c.assinatura)).toEqual(['sig-1'])
    expect(terceira.falhaDeTeste).toMatchObject({ passo: 'test' })
  })

  it('o limite é por run: suíte vermelha e reprovação da revisão dividem as mesmas três tentativas', async () => {
    suites = [vermelha, verde, verde]
    revisoes = [fix(achado()), fix(achado())]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo: 'tentativas-esgotadas', tentativas: 3 })
    expect(voltas().map((v) => v.origem)).toEqual(['teste', 'revisao', 'revisao'])
  })

  it('achado repetido nas rodadas não vira falha nova: a mesma assinatura volta uma vez só', async () => {
    revisoes = [fix(achado()), fix(achado()), pass]
    producoes = [pronto(1), pronto(2), pronto(3)]

    await ciclo().executar(pedido())

    const assinaturas = (n: number): string[] =>
      (produzir.mock.calls[n]?.[0] as { correcoes: { assinatura: string }[] }).correcoes.map(
        (c) => c.assinatura
      )
    expect(assinaturas(1)).toEqual(['sig-1'])
    expect(assinaturas(2)).toEqual(['sig-1'])
  })
})

describe('reprovação sem o que corrigir', () => {
  it('FIX_REQUIRED sem nenhum achado aceito: não gasta tentativa de mãos vazias, para para o PI', async () => {
    revisoes = [fix(achado({ estado: 'open' }))]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo: 'sem-correcao-aceita', tentativas: 1 })
    expect(produzir).toHaveBeenCalledTimes(1)
    expect(voltas()).toMatchObject([
      { tentativa: 1, origem: 'revisao', decisao: 'parar', motivo: 'sem-correcao-aceita' }
    ])
  })
})

describe('o que para o run para o PI, sem retrabalho', () => {
  it.each([
    ['conflito-entre-revisores', { resultado: 'BLOCKED', motivo: 'conflito-entre-revisores' }],
    ['revisao-sem-parecer', { resultado: 'BLOCKED', motivo: 'revisao-sem-parecer' }],
    ['revisor-bloqueou', { resultado: 'BLOCKED', motivo: 'revisor-bloqueou' }]
  ] as const)('veredito BLOCKED (%s)', async (motivo, veredito) => {
    revisoes = [{ ...pass, veredito }]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo, tentativas: 1 })
    expect(produzir).toHaveBeenCalledTimes(1)
  })

  it('revisão que não coube (delta grande demais) para o run', async () => {
    revisoes = [{ estado: 'parada', motivo: 'delta-grande-demais' }]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({
      estado: 'parado',
      motivo: 'revisao-parada',
      detalhe: 'delta-grande-demais'
    })
  })

  it('a produção do trabalho parou (integração com hunk perdido): nem testa nem revisa', async () => {
    producoes = [{ estado: 'parado', motivo: 'hunk-perdido-sem-registro' }]

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({
      estado: 'parado',
      motivo: 'producao-parada',
      detalhe: 'hunk-perdido-sem-registro'
    })
    expect(teste).not.toHaveBeenCalled()
    expect(revisar).not.toHaveBeenCalled()
  })

  it('cancelado de fora: para sem produzir', async () => {
    const controle = new AbortController()
    controle.abort()

    const r = await ciclo().executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'cancelada' })
    expect(produzir).not.toHaveBeenCalled()
  })

  it('cancelado entre a suíte e a revisão: não revisa', async () => {
    const controle = new AbortController()
    teste.mockImplementation(async () => {
      controle.abort()
      return verde
    })

    const r = await ciclo().executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'cancelada' })
    expect(revisar).not.toHaveBeenCalled()
  })

  it('porta que lança vira parada com motivo: o ciclo nunca lança', async () => {
    produzir.mockRejectedValue(new TypeError('explodiu'))

    const r = await ciclo().executar(pedido())

    expect(r).toMatchObject({ estado: 'parado', motivo: 'producao-parada' })
  })
})
