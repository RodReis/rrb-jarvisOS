/**
 * O pacote estrutural contra o SQLite e o disco reais (SPEC-Planejamento-04, categoria Banco).
 *
 * A prova é **por efeito**, como nas fatias anteriores do MVP-008: não basta o serviço dizer que
 * bloqueou — o disco tem de confirmar que nenhum arquivo foi escrito e o banco que nenhuma linha
 * foi gravada. Verificar só o `PacoteOutcome` provaria que o serviço relata o que pretendia
 * fazer, não o que fez, e o critério 3 é exatamente sobre o que **não** acontece quando a
 * pesquisa falha.
 *
 * **O conector é dublado, e a fronteira do dublê é declarada.** O que se exercita aqui é a
 * decisão desta fatia — bloquear, compor, escrever, hashear —, não a Tavily: a chamada real tem
 * suíte própria na M6-F05/F06, com smoke contra a API. O dublê fica no `ConnectorService`
 * inteiro, e não no adapter, porque é a resposta do `call()` que este serviço consome.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pergunta } from '@shared/domain/wizard'
import type { ConnectorOutcome } from '@shared/domain/connectors'
import { TAVILY_OPERATIONS } from '@shared/domain/tavily'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { DecisionRepository } = await import('./decision-repository')
const { PacoteRepository } = await import('./pacote-repository')
const { PacoteService, hashDoPacote } = await import('./pacote-service')

const USER = 'u-1'
const PROJETO = 'p-1'

/** Catálogo de teste com as três perguntas que o PRD usa. */
const CATALOGO: readonly Pergunta[] = ['escopo', 'publico', 'superficie'].map((id) => ({
  id,
  etapa: 'contexto',
  titulo: `Título ${id}`,
  enunciado: 'Enunciado',
  opcoes: [
    { id: 'a', rotulo: 'Opção A', impacto: 'impacto de A' },
    { id: 'b', rotulo: 'Opção B', impacto: 'impacto de B' }
  ],
  recomendada: 'a',
  justificativa: 'porque sim',
  aceitaTextoLivre: true,
  delegavel: true
}))

let dir: string
let raiz: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
let decisions: InstanceType<typeof DecisionRepository>
let repository: InstanceType<typeof PacoteRepository>
let service: InstanceType<typeof PacoteService>

/** As respostas que o dublê do conector dará, por operação. */
let respostas: Record<string, ConnectorOutcome>
let chamadas: { operation: string }[]
/** Os marcos que o `ProjectService` dublê registrou. */
let marcos: string[]
let commitFalha = false

function sucessoDaBusca(urls: readonly string[]): ConnectorOutcome {
  return {
    ok: true,
    data: {
      query: 'concorrentes',
      fontes: urls.map((url) => ({
        titulo: `Fonte ${url}`,
        url,
        urlOriginal: url,
        dominio: 'exemplo.test',
        trecho: 'snippet da busca — não sustenta afirmação',
        coletadoEm: '2026-08-30T10:00:00.000Z'
      })),
      duplicadasDescartadas: 0
    },
    provenance: {
      connector: 'tavily',
      operation: 'search.query',
      obtidoEm: '2026-08-30T10:00:00.000Z'
    },
    usage: { creditos: 1 }
  } as ConnectorOutcome
}

function sucessoDaExtracao(urls: readonly string[]): ConnectorOutcome {
  return {
    ok: true,
    data: {
      evidencias: urls.map((url) => ({
        url,
        urlOriginal: url,
        dominio: 'exemplo.test',
        titulo: `Alternativa em ${url}`,
        coletadoEm: '2026-08-30T10:00:00.000Z',
        conteudo: `Conteúdo extraído de ${url}, bem maior que o snippet.`,
        hashConteudo: 'a'.repeat(64),
        trecho: `A alternativa de ${url} cobre parte do caso.`,
        hashTrecho: 'b'.repeat(64)
      })),
      falhas: [],
      duplicadasDescartadas: 0
    },
    provenance: {
      connector: 'tavily',
      operation: 'extract.content',
      obtidoEm: '2026-08-30T10:00:00.000Z'
    },
    usage: { creditos: 1 }
  } as ConnectorOutcome
}

function recusa(code: string, mensagem: string): ConnectorOutcome {
  return {
    ok: false,
    code,
    mensagem,
    retryable: false,
    acao: 'reautenticar',
    provenance: {
      connector: 'tavily',
      operation: 'search.query',
      obtidoEm: '2026-08-30T10:00:00.000Z'
    },
    evidencia: 'HTTP 401'
  } as ConnectorOutcome
}

function decidir(perguntaId: string, escolha = 'a'): void {
  decisions.registrar({
    id: `d-${perguntaId}`,
    user_id: USER,
    workspace_id: 'jarvis',
    projectId: PROJETO,
    perguntaId,
    etapa: 'contexto',
    escolha,
    texto: null,
    recomendacao: 'a',
    justificativa: 'porque sim',
    autor: 'pi',
    motivo: 'escolhida',
    substituiu: null,
    created_at: '2026-08-30T10:00:00.000Z'
  })
}

function decidirTudo(): void {
  for (const id of ['escopo', 'publico', 'superficie']) decidir(id)
}

function pacotesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pacote_estrutural').get() as { n: number }).n
}

function evidenciasNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM evidence').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pacote-'))
  raiz = join(dir, 'projeto')
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  projects = new ProjectRepository(db)
  decisions = new DecisionRepository(db)
  repository = new PacoteRepository(db)
  chamadas = []
  marcos = []
  commitFalha = false

  respostas = {
    [TAVILY_OPERATIONS.search]: sucessoDaBusca(['https://exemplo.test/a']),
    [TAVILY_OPERATIONS.extract]: sucessoDaExtracao(['https://exemplo.test/a'])
  }

  projects.save({
    id: PROJETO,
    user_id: USER,
    workspace_id: 'jarvis',
    nome: 'Projeto Alfa',
    slug: 'projeto-alfa',
    diretorio: raiz,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })

  service = new PacoteService({
    repository,
    projects,
    projectService: {
      concluirMarco: (_id: string, marco: string) => {
        marcos.push(marco)
        return commitFalha
          ? { marco, commitado: false, mensagem: 'falhou' }
          : { marco, commitado: true, mensagem: 'ok', commitHash: 'c0ffee' }
      }
    } as never,
    decisions,
    connectors: {
      call: (request: { operation: string }) => {
        chamadas.push({ operation: request.operation })
        return Promise.resolve(respostas[request.operation])
      }
    } as never,
    audit,
    userId: () => USER,
    catalogo: CATALOGO
  })
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('decisões incompletas bloqueiam o PRD (critério 1)', () => {
  it('recusa nomeando o que falta, em vez de um "complete o wizard"', async () => {
    decidir('escopo')

    const resultado = await service.gerar({ projectId: PROJETO, consulta: 'x' }, 'jarvis')

    expect(resultado.reason).toBe('decisoes-incompletas')
    expect(resultado.pendencias).toEqual(['publico', 'superficie'])
  })

  it('não escreve arquivo nem grava linha', async () => {
    decidir('escopo')

    await service.gerar({ projectId: PROJETO, consulta: 'x' }, 'jarvis')

    expect(existsSync(join(raiz, 'docs', 'PRD.md'))).toBe(false)
    expect(pacotesNoBanco()).toBe(0)
  })

  it('não gasta crédito de pesquisa antes de saber que falta decisão', async () => {
    decidir('escopo')

    await service.gerar({ projectId: PROJETO, consulta: 'x' }, 'jarvis')

    expect(chamadas).toEqual([])
  })
})

describe('pesquisa bloqueada nunca vira texto inventado (critério 3)', () => {
  it('a busca recusada devolve bloqueio com os cinco campos da CONVENTION §4', async () => {
    decidirTudo()
    respostas[TAVILY_OPERATIONS.search] = recusa('credencial-ausente', 'Configure a chave.')

    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    expect(resultado.reason).toBe('pesquisa-bloqueada')
    const b = resultado.bloqueio
    expect(b?.causa).toBe('credencial-ausente')
    expect(b?.evidencia).toBeTruthy()
    expect(b?.tentativas).toBe(1)
    expect(b?.porQueNaoSeguir).toBeTruthy()
    expect(b?.retomada).toBeTruthy()
  })

  it('bloqueio não escreve documento nenhum', async () => {
    decidirTudo()
    respostas[TAVILY_OPERATIONS.search] = recusa('credencial-ausente', 'Configure a chave.')

    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    expect(existsSync(join(raiz, 'docs', 'LANDSCAPE.md'))).toBe(false)
    expect(pacotesNoBanco()).toBe(0)
  })

  it('a extração recusada bloqueia depois da busca — duas tentativas', async () => {
    decidirTudo()
    respostas[TAVILY_OPERATIONS.extract] = recusa('limite-excedido', 'Cota esgotada.')

    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    expect(resultado.bloqueio?.tentativas).toBe(2)
    expect(resultado.bloqueio?.causa).toBe('limite-excedido')
  })

  it('busca sem fontes bloqueia em vez de compor cenário vazio como se fosse pesquisa', async () => {
    decidirTudo()
    respostas[TAVILY_OPERATIONS.search] = sucessoDaBusca([])

    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    expect(resultado.reason).toBe('pesquisa-bloqueada')
    expect(resultado.bloqueio?.causa).toBe('busca-sem-fontes')
  })

  it('extração sem conteúdo bloqueia e nomeia o que falhou', async () => {
    decidirTudo()
    respostas[TAVILY_OPERATIONS.extract] = {
      ok: true,
      data: {
        evidencias: [],
        falhas: [{ url: 'https://exemplo.test/a', motivo: 'timeout' }],
        duplicadasDescartadas: 0
      },
      provenance: {
        connector: 'tavily',
        operation: 'extract.content',
        obtidoEm: '2026-08-30T10:00:00.000Z'
      },
      usage: { creditos: 0 }
    } as ConnectorOutcome

    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    expect(resultado.reason).toBe('pesquisa-bloqueada')
    expect(resultado.bloqueio?.evidencia).toContain('https://exemplo.test/a')
  })

  it('o bloqueio gera evento de auditoria', async () => {
    decidirTudo()
    respostas[TAVILY_OPERATIONS.search] = recusa('credencial-ausente', 'Configure a chave.')

    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const n = (
      db
        .prepare("SELECT COUNT(*) AS n FROM audit_event WHERE type = 'pacote-estrutural'")
        .get() as { n: number }
    ).n
    expect(n).toBe(1)
  })
})

describe('Search descobre, Extract confirma', () => {
  it('chama busca e extração, nessa ordem', async () => {
    decidirTudo()

    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    expect(chamadas.map((c) => c.operation)).toEqual([
      TAVILY_OPERATIONS.search,
      TAVILY_OPERATIONS.extract
    ])
  })

  it('o Landscape cita o conteúdo extraído, nunca o snippet da busca', async () => {
    decidirTudo()

    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const landscape = readFileSync(join(raiz, 'docs', 'LANDSCAPE.md'), 'utf8')
    expect(landscape).toContain('cobre parte do caso')
    expect(landscape).not.toContain('snippet da busca')
  })

  it('a evidência é persistida antes de virar documento', async () => {
    decidirTudo()

    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    expect(evidenciasNoBanco()).toBe(1)
    expect(service.evidencias(PROJETO)[0]?.hashConteudo).toBe('a'.repeat(64))
  })
})

describe('os três documentos, com origem em cada linha (critérios 1, 4, 5 e 7)', () => {
  beforeEach(() => decidirTudo())

  it('escreve os três arquivos sob docs/', async () => {
    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    for (const nome of ['PRD.md', 'LANDSCAPE.md', 'CONVENTION.md']) {
      expect(existsSync(join(raiz, 'docs', nome))).toBe(true)
    }
  })

  it('o PRD separa escopo de não objetivo', async () => {
    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const prd = readFileSync(join(raiz, 'docs', 'PRD.md'), 'utf8')
    expect(prd).toContain('## Escopo')
    expect(prd).toContain('## Não objetivos')
    expect(prd).toContain('impacto de B')
  })

  it('cada afirmação do PRD carrega a decisão que a originou', async () => {
    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const prd = readFileSync(join(raiz, 'docs', 'PRD.md'), 'utf8')
    expect(prd).toContain('<!-- origem: decisao/escopo · d-escopo -->')
  })

  it('cada afirmação do Landscape carrega URL e hash', async () => {
    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const landscape = readFileSync(join(raiz, 'docs', 'LANDSCAPE.md'), 'utf8')
    expect(landscape).toContain('<!-- origem: evidencia · https://exemplo.test/a')
    expect(landscape).toContain('sha256:' + 'a'.repeat(16))
  })

  it('o Landscape declara gatilhos de revisão (critério 6)', async () => {
    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const landscape = readFileSync(join(raiz, 'docs', 'LANDSCAPE.md'), 'utf8')
    expect(landscape).toContain('## Gatilhos de revisão')
    expect(landscape).toContain('Revisar se o conteúdo')
  })

  it('a Convention não importa política de outro projeto', async () => {
    await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    const convention = readFileSync(join(raiz, 'docs', 'CONVENTION.md'), 'utf8')
    expect(convention).toContain('Nenhuma política de outro projeto é importada')
    // Nada de `proplan:` — as labels deste repositório não vazam para o projeto gerado.
    expect(convention).not.toContain('proplan:')
  })

  it('o hash do documento corresponde ao que foi escrito no disco', async () => {
    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    const doDisco = readFileSync(join(raiz, 'docs', 'PRD.md'), 'utf8')
    const doPacote = resultado.pacote?.documentos.find((d) => d.documento === 'PRD')
    expect(doPacote?.conteudo).toBe(doDisco)
  })
})

describe('a revisão é imutável e reconhecível (critério 7)', () => {
  beforeEach(() => decidirTudo())

  it('gerar duas vezes com o mesmo conteúdo devolve o mesmo pacote', async () => {
    const primeiro = await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')
    const segundo = await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    expect(segundo.pacote?.hash).toBe(primeiro.pacote?.hash)
    expect(pacotesNoBanco()).toBe(1)
  })

  it('decisão diferente produz revisão diferente', async () => {
    const primeiro = await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    decisions.registrar({
      id: 'd-escopo-2',
      user_id: USER,
      workspace_id: 'jarvis',
      projectId: PROJETO,
      perguntaId: 'escopo',
      etapa: 'contexto',
      escolha: 'b',
      texto: null,
      recomendacao: 'a',
      justificativa: 'mudou',
      autor: 'pi',
      motivo: 'substituida',
      substituiu: 'd-escopo',
      created_at: '2026-08-30T11:00:00.000Z'
    })

    const segundo = await service.gerar({ projectId: PROJETO, consulta: 'concorrentes' }, 'jarvis')

    expect(segundo.pacote?.hash).not.toBe(primeiro.pacote?.hash)
    expect(pacotesNoBanco()).toBe(2)
  })

  it('o pacote vira commit do marco prd-aprovado', async () => {
    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    expect(marcos).toEqual(['prd-aprovado'])
    expect(resultado.pacote?.commitHash).toBe('c0ffee')
  })

  it('falha de commit preserva o pacote e oferece retomada', async () => {
    commitFalha = true

    const resultado = await service.gerar(
      { projectId: PROJETO, consulta: 'concorrentes' },
      'jarvis'
    )

    expect(resultado.reason).toBe('gerado')
    expect(pacotesNoBanco()).toBe(1)
    expect(existsSync(join(raiz, 'docs', 'PRD.md'))).toBe(true)
    expect(resultado.mensagem).toContain('retomado')
  })

  it('o hash deriva do conteúdo, não do instante da geração', () => {
    const docs = [
      {
        documento: 'PRD' as const,
        caminho: 'docs/PRD.md',
        conteudo: 'x',
        hash: 'h1',
        afirmacoes: []
      }
    ]

    expect(hashDoPacote(docs)).toBe(hashDoPacote(docs))
  })
})

describe('consulta vazia: sem cenário, e o documento diz isso', () => {
  it('não chama a pesquisa', async () => {
    decidirTudo()

    await service.gerar({ projectId: PROJETO, consulta: '   ' }, 'jarvis')

    expect(chamadas).toEqual([])
  })

  it('o Landscape declara a seção vazia em vez de omiti-la', async () => {
    decidirTudo()

    await service.gerar({ projectId: PROJETO, consulta: '' }, 'jarvis')

    const landscape = readFileSync(join(raiz, 'docs', 'LANDSCAPE.md'), 'utf8')
    expect(landscape).toContain('## Cenário')
    expect(landscape).toContain('_Sem conteúdo registrado nesta revisão._')
  })
})

describe('projeto inexistente', () => {
  it('recusa sem tocar em nada', async () => {
    const resultado = await service.gerar({ projectId: 'p-fantasma', consulta: 'x' }, 'jarvis')

    expect(resultado.reason).toBe('projeto-inexistente')
    expect(pacotesNoBanco()).toBe(0)
  })
})
