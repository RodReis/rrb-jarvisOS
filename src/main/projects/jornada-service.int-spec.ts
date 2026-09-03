/**
 * A jornada contra o SQLite real (SPEC-Jornada-01, § Testes).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o serviço devolver a etapa certa —
 * o banco tem de confirmar o que foi gravado, e a cadeia de auditoria, o que foi registrado.
 *
 * As garantias que só este nível alcança:
 *  - **Etapa persistida incoerente perde para os fatos** (critério 2), e o desvio vira
 *    `AuditEvent` — medido na linha gravada, não no retorno.
 *  - **Transição recusada não move a coluna** (critério 1): o banco confirma que a etapa velha
 *    continua lá depois de um evento fora de ordem.
 *  - **Recusa também audita**: a tentativa barrada é o fato interessante para quem inspeciona.
 *  - **Projeto existente abre em `prompt`** (critério 6) — o caso do `projeto1`, criado antes
 *    desta fatia, cujas decisões continuam gravadas.
 *  - **Aceite ausente barra a saída da etapa de gate**, e o banco não registra avanço.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval } from '@shared/domain/aprovacoes'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { RoadmapRepository } = await import('./roadmap-repository')
const { JornadaService } = await import('./jornada-service')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
let roadmap: InstanceType<typeof RoadmapRepository>
let service: InstanceType<typeof JornadaService>

/** Cria projeto + sessão direto no banco: o que importa aqui é a jornada, não a criação. */
function criarProjetoComSessao(etapaDaJornada = 'prompt'): void {
  const agora = '2026-09-03T10:00:00.000Z'

  db.prepare(
    `INSERT INTO project (id, user_id, workspace_id, nome, slug, diretorio, origem,
       git_preexistente, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(PROJETO, USER, WS, 'Projeto 1', 'projeto-1', join(dir, 'projeto-1'), 'criado', agora)

  db.prepare(
    `INSERT INTO planning_session (id, user_id, workspace_id, project_id, etapa,
       etapa_da_jornada, motivo_da_regressao, respostas, ultimo_marco, updated_at, created_at)
     VALUES (?, ?, ?, ?, 'inicio', ?, NULL, '{}', NULL, ?, ?)`
  ).run('s-1', USER, WS, PROJETO, etapaDaJornada, agora, agora)
}

function etapaNoBanco(): string {
  return (
    db
      .prepare('SELECT etapa_da_jornada AS e FROM planning_session WHERE project_id = ?')
      .get(PROJETO) as { e: string }
  ).e
}

function eventosDeAuditoria(tipo: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM audit_event WHERE type = ?').get(tipo) as { n: number }
  ).n
}

/** Grava respostas do wizard: é o que comprova prompt e refinamento. */
function responderWizard(): void {
  db.prepare('UPDATE planning_session SET respostas = ? WHERE project_id = ?').run(
    JSON.stringify({ escopo: 'fatia-vertical' }),
    PROJETO
  )
}

function aprovar(gate: Approval['gate']): void {
  roadmap.registrarAprovacao({
    id: `ap-${gate}`,
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    gate,
    revisoes: [{ artefato: 'docs/PRD.md', hash: 'p'.repeat(64) }],
    identidade: 'pi@exemplo',
    autor: 'pi',
    created_at: '2026-09-03T11:00:00.000Z'
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-jornada-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  projects = new ProjectRepository(db)
  roadmap = new RoadmapRepository(db)
  service = new JornadaService({
    repository: projects,
    roadmap,
    audit,
    userId: () => USER
  })
  logCat.info.mockClear()
  logCat.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('migração de projeto existente (critério 6)', () => {
  it('projeto criado antes desta fatia abre na etapa prompt', () => {
    criarProjetoComSessao()

    const estado = service.estado(PROJETO, WS)

    expect(estado?.etapa).toBe('prompt')
    expect(estado?.cta).toBe('Escrever o prompt')
  })

  it('a migração não apaga as respostas já gravadas', () => {
    criarProjetoComSessao()
    responderWizard()

    service.estado(PROJETO, WS)

    const linha = db
      .prepare('SELECT respostas FROM planning_session WHERE project_id = ?')
      .get(PROJETO) as { respostas: string }
    expect(JSON.parse(linha.respostas)).toEqual({ escopo: 'fatia-vertical' })
  })

  it('projeto sem sessão devolve undefined em vez de estourar', () => {
    expect(service.estado('nao-existe', WS)).toBeUndefined()
  })
})

describe('recálculo da etapa incoerente (critério 2)', () => {
  it('o cálculo vence a coluna quando os fatos não a sustentam', () => {
    // A coluna diz `roadmap`, mas não há nenhum evento gravado que sustente isso — é o caso do
    // projeto do fluxo antigo, com artefatos compostos sem brief nem origem de modelo.
    criarProjetoComSessao('roadmap')

    const estado = service.estado(PROJETO, WS)

    expect(estado?.etapa).toBe('prompt')
    expect(estado?.recalculada).toBe(true)
  })

  it('persiste a correção para não repetir o desvio a cada leitura', () => {
    criarProjetoComSessao('roadmap')

    service.estado(PROJETO, WS)

    expect(etapaNoBanco()).toBe('prompt')
    expect(service.estado(PROJETO, WS)?.recalculada).toBe(false)
  })

  it('audita o desvio uma vez, não a cada abertura da tela', () => {
    criarProjetoComSessao('roadmap')

    service.estado(PROJETO, WS)
    service.estado(PROJETO, WS)

    expect(eventosDeAuditoria('journey-stage-recalculated')).toBe(1)
  })

  it('coluna coerente com os fatos não gera recálculo nem evento', () => {
    criarProjetoComSessao()

    expect(service.estado(PROJETO, WS)?.recalculada).toBe(false)
    expect(eventosDeAuditoria('journey-stage-recalculated')).toBe(0)
  })

  it('respostas do wizard sustentam prompt e refinamento', () => {
    criarProjetoComSessao()
    responderWizard()

    // Com respostas gravadas, os dois primeiros eventos constam e a jornada chega ao aceite do
    // brief — que é onde ela para, porque aceitar é ato do PI.
    expect(service.estado(PROJETO, WS)?.etapa).toBe('brief-aceito')
  })
})

describe('transição por evento nomeado (critério 1)', () => {
  it('avança e grava a etapa nova', () => {
    criarProjetoComSessao()

    const outcome = service.aplicarEvento(PROJETO, 'prompt-salvo', WS)

    expect(outcome?.resultado).toBe('avancou')
    expect(etapaNoBanco()).toBe('refinamento')
  })

  it('evento fora de ordem não move a coluna', () => {
    criarProjetoComSessao()

    const outcome = service.aplicarEvento(PROJETO, 'roadmap-gerado', WS)

    expect(outcome?.resultado).toBe('evento-fora-de-ordem')
    expect(etapaNoBanco()).toBe('prompt')
  })

  it('evento desconhecido não move a coluna', () => {
    criarProjetoComSessao()

    const outcome = service.aplicarEvento(PROJETO, 'etapa-setada-na-mao', WS)

    expect(outcome?.resultado).toBe('evento-desconhecido')
    expect(etapaNoBanco()).toBe('prompt')
  })

  it('a recusa também audita — a tentativa barrada é o fato interessante', () => {
    criarProjetoComSessao()

    service.aplicarEvento(PROJETO, 'roadmap-gerado', WS)

    expect(eventosDeAuditoria('journey-transition')).toBe(1)
  })

  it('recusa não grava nada: o motivo da regressão sobrevive à tentativa barrada', () => {
    // A etapa em si não distingue as duas defesas — `avancar` devolve a etapa de entrada
    // quando recusa, então gravá-la gravaria o mesmo valor. O `motivoDaRegressao` distingue:
    // só o caminho de avanço o limpa. Sem esta asserção, remover a guarda de recusa apagaria
    // silenciosamente o motivo que a tela precisa mostrar, e nenhum teste acusaria.
    criarProjetoComSessao('roadmap')
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    service.invalidar(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'x'.repeat(64), natureza: 'semantica' }],
      'PRD mudou',
      WS
    )

    service.aplicarEvento(PROJETO, 'roadmap-gerado', WS)

    const linha = db
      .prepare('SELECT motivo_da_regressao AS m FROM planning_session WHERE project_id = ?')
      .get(PROJETO) as { m: string | null }
    expect(linha.m).toBe('PRD mudou')
  })
})

describe('aceite do PI nas etapas de gate', () => {
  it('barra a saída de pacote-aceito sem Approval, e a coluna não se move', () => {
    criarProjetoComSessao('pacote-aceito')
    responderWizard()

    const outcome = service.aplicarEvento(PROJETO, 'pacote-aceito', WS)

    expect(outcome?.resultado).toBe('aceite-ausente')
    expect(etapaNoBanco()).toBe('pacote-aceito')
  })

  it('libera a saída quando a aprovação do gate está registrada', () => {
    criarProjetoComSessao('pacote-aceito')
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    const outcome = service.aplicarEvento(PROJETO, 'pacote-aceito', WS)

    expect(outcome?.resultado).toBe('avancou')
    expect(etapaNoBanco()).toBe('roadmap')
  })
})

describe('regressão por invalidação de gate (critério 7)', () => {
  it('regride e grava o motivo para a tela poder mostrá-lo', () => {
    criarProjetoComSessao('roadmap')
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    const estado = service.invalidar(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'x'.repeat(64), natureza: 'semantica' }],
      'PRD mudou semanticamente',
      WS
    )

    expect(estado?.etapa).toBe('pacote-aceito')
    expect(estado?.motivoDaRegressao).toBe('PRD mudou semanticamente')
    expect(etapaNoBanco()).toBe('pacote-aceito')
  })

  it('mudança cosmética não regride: o motivo existe, a etapa fica', () => {
    criarProjetoComSessao('roadmap')
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    service.invalidar(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'p'.repeat(64), natureza: 'cosmetica' }],
      'correção textual',
      WS
    )

    expect(eventosDeAuditoria('journey-stage-regressed')).toBe(0)
  })

  it('audita a regressão como desvio próprio, não como transição', () => {
    criarProjetoComSessao('roadmap')
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    service.invalidar(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'x'.repeat(64), natureza: 'semantica' }],
      'PRD mudou',
      WS
    )

    expect(eventosDeAuditoria('journey-stage-regressed')).toBe(1)
    expect(eventosDeAuditoria('journey-transition')).toBe(0)
  })

  it('avançar depois de regredir limpa o motivo antigo', () => {
    criarProjetoComSessao('roadmap')
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    service.invalidar(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'x'.repeat(64), natureza: 'semantica' }],
      'PRD mudou',
      WS
    )
    service.aplicarEvento(PROJETO, 'pacote-aceito', WS)

    const linha = db
      .prepare('SELECT motivo_da_regressao AS m FROM planning_session WHERE project_id = ?')
      .get(PROJETO) as { m: string | null }
    expect(linha.m).toBeNull()
  })
})

describe('trilha na tela (critérios 3 e 4)', () => {
  it('oferece exatamente um CTA acionável', () => {
    criarProjetoComSessao()

    const trilha = service.estado(PROJETO, WS)?.trilha ?? []

    expect(trilha.filter((e) => e.acionavel)).toHaveLength(1)
  })

  it('etapa futura não é acionável e diz o que falta', () => {
    criarProjetoComSessao()

    const trilha = service.estado(PROJETO, WS)?.trilha ?? []
    const futuras = trilha.filter((e) => e.posicao === 'futura')

    expect(futuras.length).toBeGreaterThan(0)
    for (const etapa of futuras) {
      expect(etapa.acionavel).toBe(false)
      expect(etapa.oQueFalta).toBeTruthy()
    }
  })

  it('etapa concluída não é acionável e não diz o que falta', () => {
    criarProjetoComSessao()
    responderWizard()

    const trilha = service.estado(PROJETO, WS)?.trilha ?? []
    const concluidas = trilha.filter((e) => e.posicao === 'concluida')

    expect(concluidas.length).toBeGreaterThan(0)
    for (const etapa of concluidas) {
      expect(etapa.acionavel).toBe(false)
      expect(etapa.oQueFalta).toBeNull()
    }
  })
})

describe('lista de projetos (critério 3)', () => {
  it('devolve um estado por projeto e ignora id inexistente', () => {
    criarProjetoComSessao()

    const estados = service.estadoDeVarios([PROJETO, 'nao-existe'], WS)

    expect(estados).toHaveLength(1)
    expect(estados[0]?.cta).toBe('Escrever o prompt')
  })
})
