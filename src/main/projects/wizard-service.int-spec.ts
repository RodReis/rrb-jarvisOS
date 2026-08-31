/**
 * O wizard orientado contra o SQLite real (SPEC-Planejamento-03, categoria Banco).
 *
 * A prova é **por efeito no banco**, como na M8-F01 e na M8-F02: não basta o serviço devolver
 * `contradicao-pendente` — a tabela `decision` tem de confirmar que **nenhuma linha** foi
 * gravada. Verificar só o `RespostaOutcome` provaria que o serviço relata o que pretendia
 * fazer, não o que fez, e o critério 5 é exatamente sobre o que fica escrito.
 *
 * O append-only também só é verificável aqui: que a decisão substituída **continua** na tabela
 * depois da substituição é um fato do banco, não do domínio.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pergunta } from '@shared/domain/wizard'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { DecisionRepository } = await import('./decision-repository')
const { WizardService } = await import('./wizard-service')

const USER = 'u-1'
const PROJETO = 'p-1'

/**
 * Catálogo de teste: duas perguntas ligadas por dependência, mais uma não delegável. É o
 * mínimo que exercita contradição, delegação e recusa — o catálogo de produção tem sua própria
 * prova em `wizard-catalogo.spec.ts`.
 */
const CATALOGO: readonly Pergunta[] = [
  {
    id: 'escopo',
    etapa: 'contexto',
    titulo: 'Escopo',
    enunciado: 'Qual escopo?',
    opcoes: [
      { id: 'estreito', rotulo: 'Estreito', impacto: 'entrega antes' },
      { id: 'amplo', rotulo: 'Amplo', impacto: 'cobre mais' }
    ],
    recomendada: 'estreito',
    justificativa: 'entrega antes',
    aceitaTextoLivre: true,
    delegavel: true,
    dependentes: ['superficie']
  },
  {
    id: 'superficie',
    etapa: 'contexto',
    titulo: 'Superfície',
    enunciado: 'Qual superfície?',
    opcoes: [
      { id: 'ui', rotulo: 'Interface', impacto: 'acessível' },
      { id: 'cli', rotulo: 'Linha de comando', impacto: 'automatizável' }
    ],
    recomendada: 'ui',
    justificativa: 'acessível',
    aceitaTextoLivre: false,
    delegavel: true
  },
  {
    id: 'design',
    etapa: 'contexto',
    titulo: 'Design',
    enunciado: 'De onde vem o design?',
    opcoes: [
      { id: 'anexo', rotulo: 'Anexo do PI', impacto: 'cravado por hash' },
      { id: 'proposta', rotulo: 'Proposta', impacto: 'destrava antes' }
    ],
    recomendada: 'anexo',
    justificativa: 'material do PI',
    aceitaTextoLivre: false,
    delegavel: false
  }
]

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
let decisions: InstanceType<typeof DecisionRepository>
let service: InstanceType<typeof WizardService>

/** O autosave do wizard usa só `salvarRespostas`; o dublê registra o que foi espelhado. */
const salvos: { etapa: string; respostas: Readonly<Record<string, unknown>> }[] = []

function decisoesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM decision').get() as { n: number }).n
}

function eventosDeDecisao(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE type = 'planning-decision'").get() as {
      n: number
    }
  ).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-wizard-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  projects = new ProjectRepository(db)
  decisions = new DecisionRepository(db)
  salvos.length = 0

  projects.save({
    id: PROJETO,
    user_id: USER,
    workspace_id: 'jarvis',
    nome: 'Projeto de teste',
    slug: 'projeto-de-teste',
    diretorio: join(dir, 'projeto'),
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })

  service = new WizardService({
    decisions,
    projects,
    projectService: {
      salvarRespostas: (_id: string, etapa: string, respostas: Record<string, unknown>) => {
        salvos.push({ etapa, respostas })
        return undefined
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

describe('uma decisão de cada vez e retomada (critérios 1 e 6)', () => {
  it('começa na primeira pergunta do catálogo', () => {
    const estado = service.estado(PROJETO)

    expect(estado?.tipo).toBe('pergunta')
    if (estado?.tipo !== 'pergunta') throw new Error('esperado pergunta')
    expect(estado.pergunta.id).toBe('escopo')
  })

  it('avança para a próxima depois de gravar', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )

    const estado = service.estado(PROJETO)
    if (estado?.tipo !== 'pergunta') throw new Error('esperado pergunta')
    expect(estado.pergunta.id).toBe('superficie')
  })

  it('um serviço novo sobre o mesmo banco retoma onde parou', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )

    const outro = new WizardService({
      decisions: new DecisionRepository(db),
      projects,
      projectService: { salvarRespostas: () => undefined } as never,
      audit,
      userId: () => USER,
      catalogo: CATALOGO
    })

    const estado = outro.estado(PROJETO)
    if (estado?.tipo !== 'pergunta') throw new Error('esperado pergunta')
    expect(estado.pergunta.id).toBe('superficie')
  })

  it('conclui quando todas as perguntas têm decisão', () => {
    for (const [perguntaId, escolha] of [
      ['escopo', 'estreito'],
      ['superficie', 'ui'],
      ['design', 'anexo']
    ]) {
      service.responder(PROJETO, { perguntaId, escolha, texto: null, autor: 'pi' }, 'jarvis')
    }

    expect(service.estado(PROJETO)?.tipo).toBe('concluido')
  })
})

describe('contradição não é corrigida silenciosamente (critério 5)', () => {
  beforeEach(() => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )
    service.responder(
      PROJETO,
      { perguntaId: 'superficie', escolha: 'ui', texto: null, autor: 'pi' },
      'jarvis'
    )
  })

  it('devolve a decisão anterior em vez de sobrescrever', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'amplo', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('contradicao-pendente')
    expect(resultado.contradicoes?.[0]?.anterior.perguntaId).toBe('superficie')
    expect(resultado.contradicoes?.[0]?.anterior.escolha).toBe('ui')
  })

  it('nada é gravado enquanto o PI não aceita', () => {
    const antes = decisoesNoBanco()

    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'amplo', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(decisoesNoBanco()).toBe(antes)
  })

  it('com aceite explícito grava e a decisão anterior continua na tabela', () => {
    const resultado = service.responder(
      PROJETO,
      {
        perguntaId: 'escopo',
        escolha: 'amplo',
        texto: null,
        autor: 'pi',
        aceitarSubstituicao: true
      },
      'jarvis'
    )

    expect(resultado.reason).toBe('registrada')
    // Três linhas: escopo original, superfície, escopo substituto. Append-only.
    expect(decisoesNoBanco()).toBe(3)
    const historico = service.historico(PROJETO)
    expect(historico.filter((d) => d.perguntaId === 'escopo')).toHaveLength(2)
  })

  it('a substituta aponta para a decisão que trocou', () => {
    const original = service.historico(PROJETO).find((d) => d.perguntaId === 'escopo')

    service.responder(
      PROJETO,
      {
        perguntaId: 'escopo',
        escolha: 'amplo',
        texto: null,
        autor: 'pi',
        aceitarSubstituicao: true
      },
      'jarvis'
    )

    const substituta = service
      .historico(PROJETO)
      .find((d) => d.perguntaId === 'escopo' && d.substituiu !== null)
    expect(substituta?.substituiu).toBe(original?.id)
    expect(substituta?.motivo).toBe('substituida')
  })
})

describe('delegação deixa trilha auditável (critério 3)', () => {
  it('grava o agente como autor, não o PI', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )

    expect(resultado.decisao?.autor).toBe('agente')
    expect(resultado.decisao?.motivo).toBe('delegada')
  })

  it('a delegação escolhe a recomendação da pergunta', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )

    expect(resultado.decisao?.escolha).toBe('estreito')
    expect(resultado.decisao?.justificativa).toBe('entrega antes')
  })

  it('o evento de auditoria distingue o autor', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )

    const evento = db
      .prepare("SELECT payload FROM audit_event WHERE type = 'planning-decision'")
      .get() as { payload: string }
    expect(JSON.parse(evento.payload).autor).toBe('agente')
  })

  it('recusa delegar pergunta que exige o PI, sem gravar', () => {
    const antes = decisoesNoBanco()

    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'design', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )

    expect(resultado.reason).toBe('nao-delegavel')
    expect(decisoesNoBanco()).toBe(antes)
  })
})

describe('fronteira: o renderer não é confiável', () => {
  it('recusa pergunta que não existe no catálogo', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'inventada', escolha: 'x', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('pergunta-desconhecida')
    expect(decisoesNoBanco()).toBe(0)
  })

  it('recusa escolha que não é opção da pergunta', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'inexistente', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('escolha-invalida')
    expect(decisoesNoBanco()).toBe(0)
  })

  it('recusa texto livre em pergunta que não o aceita', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'superficie', escolha: null, texto: 'outra coisa', autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('escolha-invalida')
    expect(decisoesNoBanco()).toBe(0)
  })

  it('aceita texto livre onde a pergunta permite', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: null, texto: 'um recorte próprio', autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('registrada')
    expect(resultado.decisao?.motivo).toBe('texto-livre')
    expect(resultado.decisao?.texto).toBe('um recorte próprio')
  })

  it('recusa texto livre vazio', () => {
    const resultado = service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: null, texto: '   ', autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('escolha-invalida')
  })

  it('projeto inexistente não grava nada', () => {
    const resultado = service.responder(
      'p-que-nao-existe',
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(resultado.reason).toBe('projeto-inexistente')
    expect(decisoesNoBanco()).toBe(0)
  })
})

describe('auditoria e autosave', () => {
  it('cada decisão gravada gera exatamente um evento', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )
    service.responder(
      PROJETO,
      { perguntaId: 'superficie', escolha: 'ui', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(eventosDeDecisao()).toBe(2)
  })

  it('recusa não gera evento de auditoria', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'inventada', escolha: 'x', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(eventosDeDecisao()).toBe(0)
  })

  it('espelha as decisões vigentes no rascunho da sessão', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(salvos.at(-1)?.respostas).toEqual({ escopo: 'estreito' })
  })

  it('o rascunho reflete a substituição, não a decisão antiga', () => {
    service.responder(
      PROJETO,
      { perguntaId: 'escopo', escolha: 'estreito', texto: null, autor: 'pi' },
      'jarvis'
    )
    service.responder(
      PROJETO,
      {
        perguntaId: 'escopo',
        escolha: 'amplo',
        texto: null,
        autor: 'pi',
        aceitarSubstituicao: true
      },
      'jarvis'
    )

    expect(salvos.at(-1)?.respostas).toEqual({ escopo: 'amplo' })
  })
})
