/**
 * O refinamento contra o SQLite real (SPEC-Jornada-02, § Refinamento).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o serviço devolver o desfecho — o
 * banco tem de confirmar o que ficou gravado, e o dublê do modelo, quantas vezes foi chamado.
 *
 * As garantias que só este nível alcança:
 *  - **Critério 3:** pergunta que fere o contrato **não chega ao PI** — e a recusa é auditada,
 *    não engolida. Com catálogo estático o CI barrava isso; com texto gerado, só o runtime pode.
 *  - **Critério 8:** retomar não regera. As perguntas ficam no banco, e reabrir lê as pendentes.
 *  - **Critério 6:** sem rota autorizada, zero chamada.
 *  - **A mecânica da M8-F03 vale igual**: contradição volta sem gravar, delegação é recusada
 *    onde o domínio a proíbe.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PerguntaBruta } from '@shared/domain/brief-schema'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { DecisionRepository } = await import('./decision-repository')
const { PerguntaGeradaRepository } = await import('./pergunta-gerada-repository')
const { ProjectRepository } = await import('./project-repository')
const { RefinamentoService } = await import('./refinamento-service')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

let dir: string
let db: Db
let perguntasRepo: InstanceType<typeof PerguntaGeradaRepository>
let decisionsRepo: InstanceType<typeof DecisionRepository>
let service: InstanceType<typeof RefinamentoService>

let rotas: EstadoDasRotas
let chamadas: number
let packDisponivel: boolean
let promptAtual: string | undefined
/** O que o dublê do modelo devolve. `undefined` simula saída ilegível. */
let saidaDoModelo: readonly PerguntaBruta[] | undefined
/** Os blocos que o dublê recebeu — prova que só os em aberto entram no pedido. */
let blocosPedidos: string[]

function perguntaBruta(over: Partial<PerguntaBruta> = {}): PerguntaBruta {
  return {
    bloco: 'escopo-e-metricas',
    porQue: 'O prompt não diz onde a primeira versão para.',
    titulo: 'Alcance',
    enunciado: 'Até onde vai o primeiro corte?',
    opcoes: [
      { id: 'a', rotulo: 'Fatia vertical', impacto: 'Entrega ponta a ponta.' },
      { id: 'b', rotulo: 'Fundação ampla', impacto: 'Base sólida, valor mais tarde.' }
    ],
    recomendada: 'a',
    justificativa: 'Valida a hipótese antes de investir na base.',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  }
}

function criarProjeto(): void {
  db.prepare(
    `INSERT INTO project (id, user_id, workspace_id, nome, slug, diretorio, origem,
       git_preexistente, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    PROJETO,
    USER,
    WS,
    'Projeto 1',
    'projeto-1',
    join(dir, 'projeto-1'),
    'criado',
    '2026-09-03T10:00:00.000Z'
  )
}

function eventos(fase: string): number {
  const linhas = db
    .prepare("SELECT payload FROM audit_event WHERE type = 'brief-generation'")
    .all() as { payload: string }[]

  return linhas.filter((l) => (JSON.parse(l.payload) as { fase?: string }).fase === fase).length
}

function perguntasNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pergunta_gerada').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-refi-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  perguntasRepo = new PerguntaGeradaRepository(db)
  decisionsRepo = new DecisionRepository(db)
  criarProjeto()

  rotas = {
    assinaturaDisponivel: true,
    assinaturaEsgotada: false,
    rotaPagaConfigurada: true,
    optInDeRotaPaga: false
  }
  chamadas = 0
  packDisponivel = true
  promptAtual = 'Quero um app que organize minhas leituras.'
  saidaDoModelo = [perguntaBruta()]
  blocosPedidos = []

  service = new RefinamentoService({
    perguntas: perguntasRepo,
    decisions: decisionsRepo,
    projects: new ProjectRepository(db),
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    promptVigente: () => promptAtual,
    estadoDasRotas: () => rotas,
    montarContexto: () => (packDisponivel ? 'pack-1' : undefined),
    gerar: async (entrada) => {
      chamadas += 1
      blocosPedidos = [...entrada.blocosEmAberto]
      return saidaDoModelo === undefined ? {} : { perguntas: saidaDoModelo }
    }
  })

  logCat.info.mockClear()
  logCat.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('geração das perguntas', () => {
  it('sem prompt, recusa antes de chamar o modelo', async () => {
    promptAtual = undefined

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('sem-prompt')
    expect(chamadas).toBe(0)
  })

  it('grava as perguntas válidas com estado pendente', async () => {
    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('geradas')
    expect(perguntasNoBanco()).toBe(1)
    expect(perguntasRepo.listarPendentes(USER, PROJETO)).toHaveLength(1)
  })

  it('não pergunta sobre os blocos pré-preenchidos (decisão do PI)', async () => {
    await service.gerarPerguntas(PROJETO, WS)

    // Identidade e política saem da criação do projeto e dos defaults — perguntar o que o app
    // já sabe é fricção sem informação nova.
    expect(blocosPedidos).not.toContain('identidade')
    expect(blocosPedidos).not.toContain('politica-git-provider-orcamento')
  })

  it('regenerar não repete bloco já perguntado', async () => {
    await service.gerarPerguntas(PROJETO, WS)
    saidaDoModelo = [perguntaBruta({ bloco: 'jornadas' })]

    await service.gerarPerguntas(PROJETO, WS)

    // O bloco já perguntado não volta ao pedido: é o que impede o PI de responder a mesma
    // coisa duas vezes com palavras diferentes.
    expect(blocosPedidos).not.toContain('escopo-e-metricas')
    expect(perguntasNoBanco()).toBe(2)
  })

  it('quando não há bloco em aberto, não chama o modelo', async () => {
    // Preenche todos os blocos perguntáveis.
    saidaDoModelo = [
      perguntaBruta({ bloco: 'problema-usuarios-resultado' }),
      perguntaBruta({ bloco: 'escopo-e-metricas' }),
      perguntaBruta({ bloco: 'jornadas' }),
      perguntaBruta({ bloco: 'dominio-e-dados' }),
      perguntaBruta({ bloco: 'integracoes' }),
      perguntaBruta({ bloco: 'stack-e-restricoes' }),
      perguntaBruta({ bloco: 'nao-funcionais-e-testes' }),
      perguntaBruta({ bloco: 'riscos-e-decisoes-abertas' })
    ]
    await service.gerarPerguntas(PROJETO, WS)
    const antes = chamadas

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('nada-a-perguntar')
    expect(chamadas).toBe(antes)
  })
})

describe('critério 3 — pergunta que fere o contrato não chega ao PI', () => {
  it('descarta a que menciona requisito legal e audita a recusa', async () => {
    saidaDoModelo = [
      perguntaBruta(),
      perguntaBruta({ bloco: 'jornadas', enunciado: 'Como tratar consentimento do usuário?' })
    ]

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('geradas')
    expect(perguntasNoBanco()).toBe(1)
    expect(eventos('perguntas-recusadas')).toBe(1)
  })

  it('descarta a que oferece uma opção só — uma opção não é escolha', async () => {
    saidaDoModelo = [
      perguntaBruta({ opcoes: [{ id: 'a', rotulo: 'Única', impacto: 'sem trade-off' }] })
    ]

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(perguntasNoBanco()).toBe(0)
  })

  it('saída ilegível não grava nada', async () => {
    saidaDoModelo = undefined

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(perguntasNoBanco()).toBe(0)
  })
})

describe('critério 6 — bloqueio antes de rota paga', () => {
  it('sem assinatura e sem opt-in: zero chamada e zero pergunta', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('bloqueado-sem-rota')
    expect(chamadas).toBe(0)
    expect(perguntasNoBanco()).toBe(0)
  })

  it('o bloqueio traz ação concreta', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    expect((await service.gerarPerguntas(PROJETO, WS)).acao).toBeTruthy()
  })

  it('sem ContextPack, não chama o modelo', async () => {
    packDisponivel = false

    const r = await service.gerarPerguntas(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(chamadas).toBe(0)
  })
})

describe('estado e retomada (critério 8)', () => {
  it('sem perguntas, o estado é bloqueado com a retomada nomeada', () => {
    const estado = service.estado(PROJETO)

    expect(estado?.tipo).toBe('bloqueado')
    if (estado?.tipo === 'bloqueado') expect(estado.retomada).toContain('Gere as perguntas')
  })

  it('com pergunta pendente, o estado devolve a próxima', async () => {
    await service.gerarPerguntas(PROJETO, WS)

    const estado = service.estado(PROJETO)

    expect(estado?.tipo).toBe('pergunta')
    if (estado?.tipo === 'pergunta') expect(estado.pergunta.titulo).toBe('Alcance')
  })

  it('respondida, a próxima pergunta muda — a retomada vem do banco', async () => {
    await service.gerarPerguntas(PROJETO, WS)
    const estado = service.estado(PROJETO)
    const perguntaId = estado?.tipo === 'pergunta' ? estado.pergunta.id : ''

    service.responder(PROJETO, { perguntaId, escolha: 'a', texto: null, autor: 'pi' }, WS)

    // Sessão fechada no meio reabre no lugar certo porque o cálculo depende das decisões
    // gravadas, não de estado que morreu com a janela.
    expect(service.estado(PROJETO)?.tipo).toBe('concluido')
  })

  it('projeto inexistente devolve undefined em vez de estourar', () => {
    expect(service.estado('nao-existe')).toBeUndefined()
  })
})

describe('responder — a mecânica da M8-F03 reaproveitada', () => {
  let perguntaId: string

  beforeEach(async () => {
    await service.gerarPerguntas(PROJETO, WS)
    const estado = service.estado(PROJETO)
    perguntaId = estado?.tipo === 'pergunta' ? estado.pergunta.id : ''
  })

  it('grava a decisão e marca a pergunta como respondida', () => {
    const r = service.responder(PROJETO, { perguntaId, escolha: 'a', texto: null, autor: 'pi' }, WS)

    expect(r.reason).toBe('registrada')
    expect(decisionsRepo.listar(USER, PROJETO)).toHaveLength(1)
    expect(perguntasRepo.findById(USER, perguntaId)?.estado).toBe('respondida')
  })

  it('recusa escolha que não é opção real', () => {
    // Sem isto, o IPC aceitaria qualquer string e o histórico registraria decisão impossível.
    const r = service.responder(
      PROJETO,
      { perguntaId, escolha: 'inexistente', texto: null, autor: 'pi' },
      WS
    )

    expect(r.reason).toBe('escolha-invalida')
    expect(decisionsRepo.listar(USER, PROJETO)).toHaveLength(0)
  })

  it('recusa pergunta desconhecida', () => {
    const r = service.responder(
      PROJETO,
      { perguntaId: 'fantasma', escolha: 'a', texto: null, autor: 'pi' },
      WS
    )

    expect(r.reason).toBe('pergunta-desconhecida')
  })

  it('delegação grava o agente como autor, nunca o PI', () => {
    // Invariante 3 do CONVENTION §4: decisão de agente não aprova gate, e a trilha precisa
    // distinguir quem escolheu.
    const r = service.responder(
      PROJETO,
      { perguntaId, escolha: null, texto: null, autor: 'agente' },
      WS
    )

    expect(r.decisao?.autor).toBe('agente')
    expect(r.decisao?.motivo).toBe('delegada')
  })

  it('recusa delegar o que o domínio não permite delegar', async () => {
    // A regra vem do domínio, não do fato de a tela ter mostrado o botão.
    saidaDoModelo = [perguntaBruta({ bloco: 'jornadas', delegavel: false })]
    await service.gerarPerguntas(PROJETO, WS)
    const naoDelegavel = perguntasRepo.listar(USER, PROJETO).find((p) => p.bloco === 'jornadas')!

    const r = service.responder(
      PROJETO,
      { perguntaId: naoDelegavel.id, escolha: null, texto: null, autor: 'agente' },
      WS
    )

    expect(r.reason).toBe('nao-delegavel')
  })

  it('texto livre grava com o motivo certo', () => {
    const r = service.responder(
      PROJETO,
      { perguntaId, escolha: null, texto: 'Outra coisa.', autor: 'pi' },
      WS
    )

    expect(r.decisao?.motivo).toBe('texto-livre')
    expect(r.decisao?.texto).toBe('Outra coisa.')
  })
})

describe('as decisões que o brief cita', () => {
  it('devolve o rótulo da opção, não o id — o modelo precisa do conteúdo', async () => {
    await service.gerarPerguntas(PROJETO, WS)
    const estado = service.estado(PROJETO)
    const perguntaId = estado?.tipo === 'pergunta' ? estado.pergunta.id : ''
    service.responder(PROJETO, { perguntaId, escolha: 'a', texto: null, autor: 'pi' }, WS)

    const decisoes = service.decisoesParaOBrief(PROJETO)

    // `fatia-vertical` não diz nada fora do catálogo; "Fatia vertical" diz.
    expect(decisoes).toHaveLength(1)
    expect(decisoes[0]?.resposta).toBe('Fatia vertical')
    expect(decisoes[0]?.pergunta).toContain('Até onde vai')
  })

  it('sem decisões, devolve lista vazia', () => {
    expect(service.decisoesParaOBrief(PROJETO)).toEqual([])
  })
})
