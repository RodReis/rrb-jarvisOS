/**
 * A geração do brief contra o SQLite real (SPEC-Jornada-02, § Testes).
 *
 * A prova é **por efeito**: não basta o serviço devolver `bloqueado` — o dublê do modelo tem de
 * confirmar que **não foi chamado**, e o banco que nada foi gravado. Um teste que só olhasse o
 * retorno passaria com uma implementação que chama, falha e devolve bloqueado.
 *
 * As garantias que só este nível alcança:
 *  - **Critério 6:** sem rota autorizada, zero chamada e zero custo. Medido no contador do dublê.
 *  - **Critérios 3 e 4:** saída que não passa no validador **não vira brief** — o banco continua
 *    vazio depois de duas tentativas recusadas.
 *  - **Uma correção, não um laço:** o dublê conta quantas vezes foi chamado.
 *  - **Regerar conteúdo idêntico preserva a revisão**, em vez de estourar no hash UNIQUE.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Afirmacao } from '@shared/domain/brief'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { BriefRepository } = await import('./brief-repository')
const { BriefService, TENTATIVAS_DE_CORRECAO } = await import('./brief-service')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

let dir: string
let db: Db
let repo: InstanceType<typeof BriefRepository>
let service: InstanceType<typeof BriefService>

/** O estado das rotas que o teste controla. Começa com a assinatura disponível. */
let rotas: EstadoDasRotas
/** Quantas vezes o modelo foi chamado — é o que prova "zero chamada" no bloqueio. */
let chamadas: number
/** O que o dublê devolve, por chamada. Uma lista permite simular correção. */
let respostas: ({ afirmacoes: readonly Afirmacao[]; pendencias: [] } | undefined)[]
/** As correções que o dublê recebeu — prova que o problema é dito, não só "tente de novo". */
let correcoesRecebidas: (readonly string[] | undefined)[]

function afirmacao(over: Partial<Afirmacao> = {}): Afirmacao {
  return {
    id: 'a-1',
    bloco: 'problema-usuarios-resultado',
    texto: 'O leitor perde o fio das leituras.',
    origem: 'prompt',
    ...over
  }
}

function eventos(fase: string): number {
  const linhas = db
    .prepare("SELECT payload FROM audit_event WHERE type = 'brief-generation'")
    .all() as { payload: string }[]

  return linhas.filter((l) => (JSON.parse(l.payload) as { fase?: string }).fase === fase).length
}

function briefsNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM project_brief').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-brief-svc-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new BriefRepository(db)

  rotas = {
    assinaturaDisponivel: true,
    assinaturaEsgotada: false,
    rotaPagaConfigurada: true,
    optInDeRotaPaga: false
  }
  chamadas = 0
  correcoesRecebidas = []
  respostas = [{ afirmacoes: [afirmacao()], pendencias: [] }]

  service = new BriefService({
    repository: repo,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    estadoDasRotas: () => rotas,
    gerar: async (entrada) => {
      chamadas += 1
      correcoesRecebidas.push(entrada.correcao)
      const saida = respostas.shift()
      return saida === undefined ? {} : { saida, contextPackId: 'pack-1' }
    }
  })

  logCat.info.mockClear()
  logCat.warn.mockClear()
  logCat.error.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('prompt (critério 1)', () => {
  it('prompt vazio não avança e não grava nada', () => {
    expect(service.salvarPrompt(PROJETO, '   ', WS)).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) AS n FROM project_prompt').get() as { n: number }).n).toBe(
      0
    )
  })

  it('prompt salvo vira linha com hash do conteúdo', () => {
    const p = service.salvarPrompt(PROJETO, 'Um app de leituras.', WS)

    expect(p?.hash).toHaveLength(64)
    expect(repo.promptVigente(USER, PROJETO)?.texto).toBe('Um app de leituras.')
  })

  it('gerar sem prompt recusa antes de chamar o modelo', async () => {
    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('sem-prompt')
    expect(chamadas).toBe(0)
  })
})

describe('bloqueio antes de rota paga (critério 6)', () => {
  beforeEach(() => {
    service.salvarPrompt(PROJETO, 'Um app de leituras.', WS)
  })

  it('sem assinatura e sem opt-in: zero chamada e zero brief', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    const r = await service.gerarBrief(PROJETO, WS)

    // A prova por efeito: não basta devolver bloqueado. O modelo não pode ter sido chamado.
    expect(r.resultado).toBe('bloqueado-sem-rota')
    expect(chamadas).toBe(0)
    expect(briefsNoBanco()).toBe(0)
  })

  it('o bloqueio traz ação concreta — não é beco sem saída', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    expect((await service.gerarBrief(PROJETO, WS)).acao).toBeTruthy()
  })

  it('o bloqueio é auditado: é um fato registrado, não a ausência de um', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }
    await service.gerarBrief(PROJETO, WS)

    expect(eventos('bloqueado')).toBe(1)
    expect(eventos('inicio')).toBe(0)
  })

  it('com opt-in explícito, a rota paga gera', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false, optInDeRotaPaga: true }

    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(chamadas).toBe(1)
  })

  it('a rota é conferida antes de gastar trabalho montando o pedido', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }
    await service.gerarBrief(PROJETO, WS)

    // Nenhuma correção foi enviada porque nenhuma chamada saiu.
    expect(correcoesRecebidas).toEqual([])
  })

  it('rotaAtual antecipa o bloqueio sem gerar nada', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    expect((await service.rotaAtual(PROJETO, WS)).decisao).toBe('bloqueado')
    expect(chamadas).toBe(0)
  })

  it('a disponibilidade da assinatura é aguardada, não avaliada como objeto', async () => {
    // O typecheck pegou isto: com a leitura síncrona, a `Promise` do healthcheck entrava no
    // campo booleano — e objeto é sempre truthy. A assinatura pareceria disponível **sempre**,
    // mesmo com o Claude Code fora do ar, e o bloqueio do critério 6 nunca dispararia.
    const lento = new BriefService({
      repository: repo,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      estadoDasRotas: async () => ({
        assinaturaDisponivel: false,
        assinaturaEsgotada: false,
        rotaPagaConfigurada: true,
        optInDeRotaPaga: false
      }),
      gerar: async () => {
        chamadas += 1
        return {}
      }
    })

    const r = await lento.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('bloqueado-sem-rota')
    expect(chamadas).toBe(0)
  })
})

describe('validação da saída (critérios 3 e 4)', () => {
  beforeEach(() => {
    service.salvarPrompt(PROJETO, 'Um app de leituras.', WS)
  })

  it('saída válida vira brief com a procedência registrada', async () => {
    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(r.brief?.contextPackId).toBe('pack-1')
    expect(briefsNoBanco()).toBe(1)
  })

  it('afirmação sem origem não vira brief', async () => {
    const semOrigem = { ...afirmacao(), origem: undefined } as unknown as Afirmacao
    respostas = [
      { afirmacoes: [semOrigem], pendencias: [] },
      { afirmacoes: [semOrigem], pendencias: [] }
    ]

    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(briefsNoBanco()).toBe(0)
  })

  it('requisito legal inferido pelo modelo não vira brief', async () => {
    // A invariante 9 chegando ao efeito: o modelo propôs LGPD por conta própria, e nada foi
    // gravado.
    const inventada = afirmacao({ origem: 'proposto', texto: 'O sistema deve atender à LGPD.' })
    respostas = [
      { afirmacoes: [inventada], pendencias: [] },
      { afirmacoes: [inventada], pendencias: [] }
    ]

    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(briefsNoBanco()).toBe(0)
  })

  it('a correção diz **o quê** corrigir, não só "tente de novo"', async () => {
    const semOrigem = { ...afirmacao(), origem: undefined } as unknown as Afirmacao
    respostas = [
      { afirmacoes: [semOrigem], pendencias: [] },
      { afirmacoes: [afirmacao()], pendencias: [] }
    ]

    await service.gerarBrief(PROJETO, WS)

    expect(correcoesRecebidas[0]).toBeUndefined()
    expect(correcoesRecebidas[1]?.join(' ')).toContain('origem')
  })

  it('a segunda tentativa corrigida vira brief', async () => {
    const semOrigem = { ...afirmacao(), origem: undefined } as unknown as Afirmacao
    respostas = [
      { afirmacoes: [semOrigem], pendencias: [] },
      { afirmacoes: [afirmacao()], pendencias: [] }
    ]

    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(chamadas).toBe(2)
  })

  it('para em duas chamadas — não é um laço até passar', async () => {
    const semOrigem = { ...afirmacao(), origem: undefined } as unknown as Afirmacao
    respostas = Array.from({ length: 10 }, () => ({
      afirmacoes: [semOrigem],
      pendencias: [] as []
    }))

    await service.gerarBrief(PROJETO, WS)

    // **O número é literal de propósito.** Escrever `TENTATIVAS_DE_CORRECAO + 1` faria o teste
    // acompanhar a constante em vez de travá-la: subir o limite para 9 passaria verde, e o
    // teste estaria provando que o código é consistente consigo mesmo, não que o limite é
    // baixo. Foi o que a mutação mostrou.
    //
    // Um modelo que erra o schema duas vezes seguidas não erra por acaso: insistir só gasta.
    expect(chamadas).toBe(2)
  })

  it('a constante declara o limite que o serviço aplica', () => {
    // Guarda separada: se alguém mudar a constante, é aqui que a decisão é reaberta — com o
    // custo de cada tentativa em mente, não por acidente.
    expect(TENTATIVAS_DE_CORRECAO).toBe(1)
  })

  it('chamada que não devolve saída também conta como tentativa', async () => {
    respostas = [undefined, undefined]

    const r = await service.gerarBrief(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(chamadas).toBe(TENTATIVAS_DE_CORRECAO + 1)
  })
})

describe('regeneração idêntica', () => {
  beforeEach(() => {
    service.salvarPrompt(PROJETO, 'Um app de leituras.', WS)
  })

  it('conteúdo idêntico preserva a revisão em vez de estourar no hash UNIQUE', async () => {
    respostas = [
      { afirmacoes: [afirmacao()], pendencias: [] },
      { afirmacoes: [afirmacao()], pendencias: [] }
    ]

    const primeiro = await service.gerarBrief(PROJETO, WS)
    const segundo = await service.gerarBrief(PROJETO, WS)

    expect(segundo.resultado).toBe('gerado')
    expect(segundo.brief?.id).toBe(primeiro.brief?.id)
    expect(briefsNoBanco()).toBe(1)
  })

  it('a ordem das afirmações não muda o hash — ela não é fato sobre o brief', async () => {
    const a = afirmacao({ id: 'a-1' })
    const b = afirmacao({ id: 'a-2', texto: 'Outra coisa.' })
    respostas = [
      { afirmacoes: [a, b], pendencias: [] },
      { afirmacoes: [b, a], pendencias: [] }
    ]

    const primeiro = await service.gerarBrief(PROJETO, WS)
    const segundo = await service.gerarBrief(PROJETO, WS)

    expect(segundo.brief?.id).toBe(primeiro.brief?.id)
    expect(briefsNoBanco()).toBe(1)
  })
})

describe('perguntas geradas (critério 3)', () => {
  it('descarta a que fere o contrato e audita a recusa', () => {
    const boa = {
      id: 'q-1',
      etapa: 'refinamento',
      bloco: 'escopo-e-metricas' as const,
      porQue: 'O prompt não diz onde para.',
      titulo: 'Alcance',
      enunciado: 'Até onde vai?',
      opcoes: [
        { id: 'a', rotulo: 'Fatia', impacto: 'ponta a ponta' },
        { id: 'b', rotulo: 'Fundação', impacto: 'base ampla' }
      ],
      recomendada: 'a',
      justificativa: 'Valida antes de investir.',
      aceitaTextoLivre: true,
      delegavel: true
    }
    const ma = { ...boa, id: 'q-2', enunciado: 'E o consentimento do usuário?' }

    const validas = service.filtrarPerguntas(PROJETO, [boa, ma], WS)

    expect(validas.map((p) => p.id)).toEqual(['q-1'])
    expect(eventos('perguntas-recusadas')).toBe(1)
  })
})
