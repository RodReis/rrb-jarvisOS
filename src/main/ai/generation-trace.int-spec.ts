/**
 * A trilha da geração contra o SQLite real (categoria "Banco" do ADR-003).
 *
 * O que se prova aqui não dá para provar em unidade: que a escrita em lote não perde evento no
 * cancelamento, que o redator roda **antes** de o segredo tocar o disco, e que o trace sem ledger
 * não vira linha. Com um dublê de repositório, os três passariam sem o banco existir.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationEvent } from '@shared/domain/geracao'

const logDb = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logDb }) }))

const { openDatabase } = await import('../storage/database')
const { GenerationTraceRepository, INTERVALO_DE_LOTE_MS, EVENTOS_POR_LOTE } = await import(
  './generation-trace-repository'
)
const { GenerationTraceService } = await import('./generation-trace-service')

const ESCOPO = { userId: 'u1', workspace: 'jarvis' } as const
const ABERTURA = {
  traceId: 't1',
  escopo: ESCOPO,
  projectId: 'p1',
  ledgerEntryId: 'call-abc',
  etapa: 'refinamento',
  provider: 'claude-code',
  modelo: 'claude-fable-5-1'
} as const

let dir: string
let db: Db
let repo: InstanceType<typeof GenerationTraceRepository>
let service: InstanceType<typeof GenerationTraceService>
let publicados: { traceId: string; evento: GenerationEvent }[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-trace-'))
  db = openDatabase(join(dir, 'teste.db'))
  repo = new GenerationTraceRepository(db)
  publicados = []
  service = new GenerationTraceService(repo, (e) => publicados.push({ ...e }))
  logDb.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const texto = (delta: string): GenerationEvent => ({ tipo: 'texto', delta })

describe('trace ligado ao ledger (critério 2)', () => {
  it('grava o trace com o identificador do ledger', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.fechar('concluido')

    const trace = repo.buscar(ESCOPO, 't1')

    expect(trace).toMatchObject({
      id: 't1',
      ledgerEntryId: 'call-abc',
      etapa: 'refinamento',
      // Derivada da etapa, não informada: uma segunda fonte discordaria da jornada.
      fase: 'planejamento',
      status: 'concluido'
    })
    expect(trace?.terminadoEm).toBeDefined()
  })

  it('recusa trace órfão — sem ledger não vira linha', () => {
    expect(() => service.abrir({ ...ABERTURA, ledgerEntryId: '' })).toThrow(/ledger/i)

    expect(db.prepare('SELECT COUNT(*) AS n FROM generation_trace').get()).toEqual({ n: 0 })
  })

  it('não devolve trace de outro usuário', () => {
    service.abrir(ABERTURA).fechar('concluido')

    expect(repo.buscar({ userId: 'outro', workspace: 'jarvis' }, 't1')).toBeUndefined()
    expect(repo.eventos({ userId: 'outro', workspace: 'jarvis' }, 't1')).toEqual([])
  })
})

describe('escrita em lote', () => {
  it('grava os eventos na ordem em que chegaram (critério 1)', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('um'))
    coletor.registrar({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Read',
      resumoDoArgumento: '/tmp/a.ts'
    })
    coletor.registrar({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'conteúdo',
      tamanhoOriginal: 8
    })
    coletor.registrar({ tipo: 'uso', tokensEntrada: 10, tokensSaida: 20, duracaoMs: 500 })
    coletor.fechar('concluido')

    expect(repo.eventos(ESCOPO, 't1').map((e) => e.tipo)).toEqual([
      'texto',
      'ferramenta-inicio',
      'ferramenta-fim',
      'uso'
    ])
  })

  it('não escreve a cada evento — o lote é o ponto', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('a'))
    coletor.registrar(texto('b'))

    // Ainda em memória: o SQLite não levou um commit por delta de texto.
    expect(db.prepare('SELECT COUNT(*) AS n FROM generation_trace_event').get()).toEqual({ n: 0 })

    coletor.fechar('concluido')
    expect(repo.eventos(ESCOPO, 't1')).toHaveLength(2)
  })

  it('escreve sozinho ao encher o lote, sem esperar o fechamento', () => {
    const coletor = service.abrir(ABERTURA)
    for (let i = 0; i < EVENTOS_POR_LOTE; i += 1) coletor.registrar(texto(`${i}`))

    expect(db.prepare('SELECT COUNT(*) AS n FROM generation_trace_event').get()).toEqual({
      n: EVENTOS_POR_LOTE
    })

    coletor.fechar('concluido')
  })

  it('escreve o evento solitário quando o intervalo vence', async () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('sozinho'))

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_DE_LOTE_MS + 60))

    expect(repo.eventos(ESCOPO, 't1')).toHaveLength(1)
    coletor.fechar('concluido')
  })

  it('a numeração continua entre lotes — nada é sobrescrito', () => {
    const coletor = service.abrir(ABERTURA)
    for (let i = 0; i < EVENTOS_POR_LOTE + 5; i += 1) coletor.registrar(texto(`${i}`))
    coletor.fechar('concluido')

    const eventos = repo.eventos(ESCOPO, 't1')

    expect(eventos).toHaveLength(EVENTOS_POR_LOTE + 5)
    expect(eventos.map((e) => (e.tipo === 'texto' ? e.delta : ''))).toEqual(
      Array.from({ length: EVENTOS_POR_LOTE + 5 }, (_, i) => `${i}`)
    )
  })

  it('cancelamento não perde os eventos até ali (critério 8)', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('comecei'))
    coletor.registrar(texto(' e fui interrompido'))
    coletor.fechar('cancelado')

    expect(repo.buscar(ESCOPO, 't1')?.status).toBe('cancelado')
    expect(repo.eventos(ESCOPO, 't1')).toHaveLength(2)
  })

  it('evento depois do fechamento é ignorado, não acrescentado', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.fechar('cancelado')
    coletor.registrar(texto('tarde demais'))

    expect(repo.eventos(ESCOPO, 't1')).toHaveLength(0)
  })

  it('fechar duas vezes não muda o desfecho', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.fechar('cancelado')
    coletor.fechar('concluido')

    expect(repo.buscar(ESCOPO, 't1')?.status).toBe('cancelado')
  })
})

describe('redação antes do disco (critério 3)', () => {
  it('o segredo no argumento da ferramenta não chega ao banco', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Bash',
      resumoDoArgumento: 'curl -H "Authorization: Bearer sk-ant-api03-SEGREDO-REAL" https://api'
    })
    coletor.fechar('concluido')

    const cru = db.prepare('SELECT payload FROM generation_trace_event').all() as {
      payload: string
    }[]

    expect(JSON.stringify(cru)).not.toContain('sk-ant-api03-SEGREDO-REAL')
  })

  it('o segredo no resultado da ferramenta não chega ao banco', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'GITHUB_TOKEN=ghp_TOKENQUEVAZOU0123456789012345678901',
      tamanhoOriginal: 52
    })
    coletor.fechar('concluido')

    const cru = db.prepare('SELECT payload FROM generation_trace_event').all() as {
      payload: string
    }[]

    expect(JSON.stringify(cru)).not.toContain('ghp_TOKENQUEVAZOU0123456789012345678901')
  })

  it('o segredo também não chega à TELA — a redação vale ao vivo', () => {
    // O defeito que este teste trava: a redação morava só na gravação, então o mesmo `Bash` ia
    // redigido para o banco e **em claro para o IPC**. O segredo era exibido durante a geração
    // ao vivo — a superfície que o PI está justamente olhando. Achado pelo E2E.
    const coletor = service.abrir(ABERTURA)
    coletor.registrar({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Bash',
      resumoDoArgumento: 'curl -H "Authorization: ghp_TOKENQUEVAZOU0123456789012345678901" /health'
    })
    coletor.fechar('concluido')

    expect(JSON.stringify(publicados)).not.toContain('ghp_TOKENQUEVAZOU0123456789012345678901')
    // E o resto do comando sobrevive: redigir a linha inteira cegaria a evidência.
    expect(JSON.stringify(publicados)).toContain('curl')
  })

  it('o resultado com segredo também não chega à tela', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuv',
      tamanhoOriginal: 52
    })
    coletor.fechar('concluido')

    expect(JSON.stringify(publicados)).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuv')
  })

  it('o texto do modelo não é redigido — ele é o documento', () => {
    // Redigir o `delta` mutilaria o produto. O que precisa de redação é o que veio de fora.
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('O usuário precisa de um token de acesso para continuar.'))
    coletor.fechar('concluido')

    const [evento] = repo.eventos(ESCOPO, 't1')

    expect(evento).toEqual({
      tipo: 'texto',
      delta: 'O usuário precisa de um token de acesso para continuar.'
    })
  })
})

describe('ao vivo e histórico (critério 6)', () => {
  it('publica cada evento assim que chega, sem esperar o lote', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('ao'))
    coletor.registrar(texto(' vivo'))

    expect(publicados).toEqual([
      { traceId: 't1', evento: { tipo: 'texto', delta: 'ao' } },
      { traceId: 't1', evento: { tipo: 'texto', delta: ' vivo' } }
    ])

    coletor.fechar('concluido')
  })

  it('falha ao publicar não derruba a gravação', () => {
    const quebrado = new GenerationTraceService(repo, () => {
      throw new Error('renderer fechou')
    })

    const coletor = quebrado.abrir(ABERTURA)
    coletor.registrar(texto('resiste'))
    coletor.fechar('concluido')

    expect(repo.eventos(ESCOPO, 't1')).toHaveLength(1)
  })

  it('lista as gerações da etapa, da mais recente para a mais antiga', () => {
    const relogios = ['2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z']
    relogios.forEach((quando, i) => {
      const s = new GenerationTraceService(repo, undefined, () => new Date(quando))
      s.abrir({ ...ABERTURA, traceId: `t${i}`, ledgerEntryId: `call-${i}` }).fechar('concluido')
    })

    expect(service.historico(ESCOPO, 'p1', 'refinamento').map((t) => t.id)).toEqual(['t1', 't0'])
  })

  it('a regeneração não apaga a anterior', () => {
    service.abrir(ABERTURA).fechar('concluido')
    service.abrir({ ...ABERTURA, traceId: 't2', ledgerEntryId: 'call-def' }).fechar('concluido')

    expect(service.historico(ESCOPO, 'p1', 'refinamento')).toHaveLength(2)
  })

  it('não mistura etapas nem projetos', () => {
    service.abrir(ABERTURA).fechar('concluido')
    service
      .abrir({ ...ABERTURA, traceId: 't2', ledgerEntryId: 'c2', etapa: 'prd' })
      .fechar('concluido')
    service
      .abrir({ ...ABERTURA, traceId: 't3', ledgerEntryId: 'c3', projectId: 'p2' })
      .fechar('concluido')

    expect(service.historico(ESCOPO, 'p1', 'refinamento').map((t) => t.id)).toEqual(['t1'])
  })

  it('reabre o trace do histórico com o mesmo conteúdo', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('texto gerado'))
    coletor.registrar({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Grep',
      resumoDoArgumento: 'padrão'
    })
    coletor.fechar('concluido')

    expect(service.eventos(ESCOPO, 't1')).toEqual([
      { tipo: 'texto', delta: 'texto gerado' },
      { tipo: 'ferramenta-inicio', chamadaId: 'c1', nome: 'Grep', resumoDoArgumento: 'padrão' }
    ])
  })

  it('trace que nunca fechou aparece como falhou, não como concluído', () => {
    // A geração morreu com o app. Chamá-la de concluída afirmaria um desfecho que não houve.
    service.abrir(ABERTURA)

    expect(repo.buscar(ESCOPO, 't1')?.status).toBe('falhou')
  })

  it('payload ilegível no banco não derruba a abertura do histórico', () => {
    service.abrir(ABERTURA).fechar('concluido')
    db.prepare(
      `INSERT INTO generation_trace_event (trace_id, seq, tipo, payload) VALUES ('t1', 0, 'texto', '{quebrado')`
    ).run()

    expect(repo.eventos(ESCOPO, 't1')).toEqual([])
    expect(logDb.warn).toHaveBeenCalled()
  })
})

describe('adapter sem ferramentas (critério 7)', () => {
  it('produz trace válido só com texto e uso', () => {
    const coletor = service.abrir({ ...ABERTURA, provider: 'anthropic', modelo: 'claude-opus-5' })
    coletor.registrar(texto('resposta'))
    coletor.registrar({ tipo: 'uso', tokensEntrada: 5, tokensSaida: 9, duracaoMs: 120 })
    coletor.fechar('concluido')

    expect(repo.buscar(ESCOPO, 't1')?.status).toBe('concluido')
    expect(repo.eventos(ESCOPO, 't1').map((e) => e.tipo)).toEqual(['texto', 'uso'])
  })
})

describe('compactação da retenção', () => {
  it('mantém o uso e a contagem por ferramenta, e apaga o resto', () => {
    const antigo = new GenerationTraceService(
      repo,
      undefined,
      () => new Date('2026-01-01T00:00:00.000Z')
    )
    const coletor = antigo.abrir(ABERTURA)
    coletor.registrar(texto('texto que não precisa sobreviver a seis meses'))
    coletor.registrar({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Read',
      resumoDoArgumento: '/tmp/a.ts'
    })
    coletor.registrar({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c2',
      nome: 'Read',
      resumoDoArgumento: '/tmp/b.ts'
    })
    coletor.registrar({ tipo: 'uso', tokensEntrada: 100, tokensSaida: 200, duracaoMs: 900 })
    coletor.fechar('concluido')

    expect(repo.compactar('2026-06-01T00:00:00.000Z')).toBe(1)

    const eventos = repo.eventos(ESCOPO, 't1')

    // O trace **não** é apagado: ele é a prova de que o documento foi gerado.
    expect(repo.buscar(ESCOPO, 't1')).toBeDefined()
    expect(eventos.filter((e) => e.tipo === 'uso')).toHaveLength(1)
    expect(eventos.some((e) => e.tipo === 'texto')).toBe(false)
    expect(JSON.stringify(eventos)).toContain('Read ×2')
  })

  it('não toca trace recente nem trace ainda em andamento', () => {
    const coletor = service.abrir(ABERTURA)
    coletor.registrar(texto('recente'))
    coletor.fechar('concluido')

    service.abrir({ ...ABERTURA, traceId: 't2', ledgerEntryId: 'c2' }).registrar(texto('em voo'))

    expect(repo.compactar('2026-01-01T00:00:00.000Z')).toBe(0)
    expect(repo.eventos(ESCOPO, 't1')).toHaveLength(1)
  })

  it('a regra do trace roda pelo coletor, com a janela do domínio', async () => {
    // Sem dublê de coletor: o `RetencaoService` real, com a regra registrada. É o que prova que
    // as duas pontas casam — um dublê provaria só que o meu dublê casa consigo.
    const { RetencaoService } = await import('../pipeline/retencao-service')

    const velho = new GenerationTraceService(
      repo,
      undefined,
      () => new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    )
    const coletor = velho.abrir(ABERTURA)
    coletor.registrar(texto('de dois meses atrás'))
    coletor.registrar({ tipo: 'uso', tokensEntrada: 1, tokensSaida: 1, duracaoMs: 1 })
    coletor.fechar('concluido')

    // Um trace recente, que a mesma coleta não pode tocar.
    const recente = service.abrir({ ...ABERTURA, traceId: 't2', ledgerEntryId: 'call-2' })
    recente.registrar(texto('de agora'))
    recente.fechar('concluido')

    new RetencaoService({
      ledger: { listarArtefatos: () => [] } as never,
      caminhoDoAnexo: () => '',
      regras: [service.regraDeRetencao()]
    }).coletar(ESCOPO.userId)

    expect(repo.eventos(ESCOPO, 't1').some((e) => e.tipo === 'texto')).toBe(false)
    expect(repo.eventos(ESCOPO, 't2').some((e) => e.tipo === 'texto')).toBe(true)
  })

  it('compactar duas vezes não conta o que já foi compactado', () => {
    const antigo = new GenerationTraceService(
      repo,
      undefined,
      () => new Date('2026-01-01T00:00:00.000Z')
    )
    const coletor = antigo.abrir(ABERTURA)
    coletor.registrar(texto('velho'))
    coletor.registrar({ tipo: 'uso', tokensEntrada: 1, tokensSaida: 1, duracaoMs: 1 })
    coletor.fechar('concluido')

    expect(repo.compactar('2026-06-01T00:00:00.000Z')).toBe(1)
    expect(repo.compactar('2026-06-01T00:00:00.000Z')).toBe(0)
  })
})
