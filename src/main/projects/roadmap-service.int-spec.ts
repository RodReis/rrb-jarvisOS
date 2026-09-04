/**
 * Os gates de aprovação contra o SQLite real (SPEC-Planejamento-06 § gates; SPEC-Jornada-05).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o serviço dizer que recusou — o
 * banco tem de confirmar que nenhuma linha de aprovação foi gravada.
 *
 * **A composição saiu deste serviço** (decisão do PI de 2026-09-03): quem propõe o roadmap agora
 * é o `RoadmapGeradoService`, com suíte própria. O que sobrou aqui é o aceite, e é o que estes
 * testes cobrem:
 *
 *  - **Sem identidade, o gate falha fechado** — e nenhuma linha de aprovação aparece.
 *  - **Mesma revisão não pede novo aceite** (critério 5), medido no caminho que decide.
 *  - **`MVP_ENTRY` promove o MVP que o PI escolheu**, e não o primeiro da ordem topológica
 *    (pergunta 1 da SPEC-Jornada-05, resolvida pelo PI em 2026-09-03).
 *  - **`SLICE_ENTRY` não tem objeto enquanto houver pergunta aberta** (critério 4) — a lista de
 *    revisões vazia é o que faz `aprovar` recusar.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultadoDaVerificacao } from '@shared/domain/marcos'
import type { MvpGerado, RoadmapRegistrado, SpecGerada } from '@shared/domain/roadmap-gerado'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { PacoteRepository } = await import('./pacote-repository')
const { RoadmapRepository } = await import('./roadmap-repository')
const { RoadmapService } = await import('./roadmap-service')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

let dir: string
let raiz: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
let pacotes: InstanceType<typeof PacoteRepository>
let repository: InstanceType<typeof RoadmapRepository>
let service: InstanceType<typeof RoadmapService>
/** O que o dublê do `AnexoService` devolve. */
let anexosDoProjeto: { caminho: string; hash: string }[]
let arquiteturas: { documentos: { caminho: string; hash: string }[] }[]
let identidadeAtual: string | undefined
/** A revisão gerada que os gates do roadmap aprovam. */
let gerado: RoadmapRegistrado | undefined
let marcos: ResultadoDaVerificacao

function mvp(over: Partial<MvpGerado> = {}): MvpGerado {
  return {
    id: 'mvp-1',
    numero: 1,
    titulo: 'Cadastro',
    tese: 'Cadastrar clientes.',
    resultado: 'Um cliente aparece na lista.',
    dependeDe: [],
    origem: 'proposto',
    fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'proposto' }],
    ...over
  }
}

function spec(over: Partial<SpecGerada> = {}): SpecGerada {
  return {
    fatiaId: 'f-1',
    titulo: 'Formulário',
    objetivo: 'Cadastrar um cliente.',
    fluxo: ['Abrir'],
    regras: ['Nome obrigatório'],
    criteriosDeAceite: ['Salvar sem nome mostra erro'],
    testes: ['Unitário'],
    perguntas: [
      {
        id: 'p-1',
        enunciado: 'E-mail é obrigatório?',
        opcoes: [
          { id: 'a', rotulo: 'Sim', impacto: 'Todo cliente tem contato.' },
          { id: 'b', rotulo: 'Não', impacto: 'Cadastro mais rápido.' }
        ],
        recomendada: 'a',
        justificativa: 'O PRD fala em contatar depois.'
      }
    ],
    ...over
  }
}

function revisao(over: Partial<RoadmapRegistrado> = {}): RoadmapRegistrado {
  return {
    id: 'rev-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    pacoteEstruturalId: 'pac-1',
    arquiteturaId: 'arq-1',
    mvps: [
      mvp(),
      mvp({
        id: 'mvp-2',
        numero: 2,
        titulo: 'Relatórios',
        dependeDe: ['mvp-1'],
        fatias: [{ id: 'f-2', numero: 1, titulo: 'Exportar', origem: 'proposto' }]
      })
    ],
    mvpEscolhido: null,
    hash: 'h'.repeat(64),
    commitHash: null,
    contextPackId: null,
    created_at: new Date().toISOString(),
    ...over
  }
}

/** A projeção que o `STATUS.md` e o `SLICE_ENTRY` leem, gravada a partir da revisão. */
function gravarProjecao(): void {
  repository.salvarRoadmap(
    { userId: USER, workspaceId: WS, projectId: PROJETO },
    {
      mvps: (gerado?.mvps ?? []).map((m) => ({
        id: m.id,
        numero: m.numero,
        titulo: m.titulo,
        tese: m.tese,
        estado: 'proposto' as const,
        dependeDe: m.dependeDe,
        origem: { tipo: 'decisao' as const, decisaoId: m.id, perguntaId: 'roadmap-gerado' }
      })),
      slices: (gerado?.mvps ?? []).flatMap((m) =>
        m.fatias.map((f) => ({
          id: f.id,
          mvpId: m.id,
          numero: f.numero,
          titulo: f.titulo,
          specSlug: `docs/spec/spec-${m.id}-0${f.numero}-${f.id}.md`,
          detalhada: f.id === gerado?.spec?.fatiaId,
          origem: { tipo: 'decisao' as const, decisaoId: f.id, perguntaId: 'roadmap-gerado' }
        }))
      )
    }
  )
}

function gravarPrd(): string {
  const id = `pac-${Math.random().toString(36).slice(2)}`
  pacotes.registrarPacote({
    id,
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    documentos: [
      {
        documento: 'PRD',
        caminho: 'docs/PRD.md',
        conteudo: '# PRD',
        hash: 'p'.repeat(64),
        afirmacoes: []
      }
    ],
    hash: `h-${id}`,
    commitHash: null,
    created_at: new Date().toISOString()
  })
  return id
}

function aprovacoesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM approval').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-roadmap-'))
  raiz = join(dir, 'projeto')
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  projects = new ProjectRepository(db)
  pacotes = new PacoteRepository(db)
  repository = new RoadmapRepository(db)
  anexosDoProjeto = [{ caminho: 'docs/prototipos/home.html', hash: 'a'.repeat(64) }]
  arquiteturas = [{ documentos: [{ caminho: 'docs/ARCHITECTURE.md', hash: 'b'.repeat(64) }] }]
  identidadeAtual = 'pi@exemplo'
  gerado = revisao()
  // Marcos em dia é o caso comum: os testes deste arquivo falam sobre os gates, e um repositório
  // sujo por padrão faria todos eles falharem por um motivo que não é o que estão medindo.
  marcos = { ok: true, head: 'abc1234', pendencias: [] }

  projects.save({
    id: PROJETO,
    user_id: USER,
    workspace_id: WS,
    nome: 'Projeto Alfa',
    slug: 'projeto-alfa',
    diretorio: raiz,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })

  service = new RoadmapService({
    repository,
    projects,
    pacotes,
    anexos: {
      listar: () => anexosDoProjeto,
      listarArquiteturas: () => arquiteturas
    } as never,
    audit,
    userId: () => USER,
    identidade: () => identidadeAtual,
    roadmapGerado: () => gerado,
    verificarMarcos: () => marcos
  })

  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('revisoesDoGate — o que cada gate cobre', () => {
  beforeEach(() => {
    gravarPrd()
    gravarProjecao()
  })

  it('PROJECT_PACKAGE lista o PRD, a arquitetura e os anexos', () => {
    const revisoes = service.revisoesDoGate(PROJETO, 'PROJECT_PACKAGE', WS)
    const artefatos = revisoes.map((r) => r.artefato)

    expect(artefatos).toContain('docs/PRD.md')
    expect(artefatos).toContain('docs/ARCHITECTURE.md')
    expect(artefatos).toContain('docs/prototipos/home.html')
  })

  it('MVP_ENTRY sem escolha não tem o que aprovar', () => {
    expect(service.revisoesDoGate(PROJETO, 'MVP_ENTRY', WS)).toEqual([])
  })

  it('MVP_ENTRY cobre só o MVP escolhido, não a lista inteira', () => {
    gerado = revisao({ mvpEscolhido: 'mvp-1' })

    const revisoes = service.revisoesDoGate(PROJETO, 'MVP_ENTRY', WS)

    expect(revisoes).toHaveLength(1)
    expect(revisoes[0]?.artefato).toBe('mvp-1')
  })

  it('mudar a tese do MVP escolhido muda o hash do gate', () => {
    gerado = revisao({ mvpEscolhido: 'mvp-1' })
    const antes = service.revisoesDoGate(PROJETO, 'MVP_ENTRY', WS)[0]?.hash

    gerado = revisao({
      mvpEscolhido: 'mvp-1',
      mvps: [mvp({ tese: 'Outra coisa.' }), ...revisao().mvps.slice(1)]
    })

    expect(service.revisoesDoGate(PROJETO, 'MVP_ENTRY', WS)[0]?.hash).not.toBe(antes)
  })

  it('SLICE_ENTRY sem SPEC não tem o que aprovar', () => {
    gerado = revisao({ mvpEscolhido: 'mvp-1' })

    expect(service.revisoesDoGate(PROJETO, 'SLICE_ENTRY', WS)).toEqual([])
  })

  /** Critério 4 na forma que o gate mede: pergunta aberta ⇒ gate sem objeto. */
  it('SLICE_ENTRY com pergunta aberta não tem o que aprovar', () => {
    gerado = revisao({ mvpEscolhido: 'mvp-1', spec: spec() })
    gravarProjecao()

    expect(service.revisoesDoGate(PROJETO, 'SLICE_ENTRY', WS)).toEqual([])
  })

  it('SLICE_ENTRY com todas as perguntas respondidas cobre a SPEC', () => {
    gerado = revisao({
      mvpEscolhido: 'mvp-1',
      spec: spec({ perguntas: [{ ...spec().perguntas[0]!, resposta: 'a' }] })
    })
    gravarProjecao()

    const revisoes = service.revisoesDoGate(PROJETO, 'SLICE_ENTRY', WS)

    expect(revisoes).toHaveLength(1)
    expect(revisoes[0]?.artefato).toContain('docs/spec/')
  })

  /** Responder **é** mudança da SPEC: um hash cego às respostas aprovaria outro documento. */
  it('a resposta escolhida entra no hash do SLICE_ENTRY', () => {
    gerado = revisao({
      mvpEscolhido: 'mvp-1',
      spec: spec({ perguntas: [{ ...spec().perguntas[0]!, resposta: 'a' }] })
    })
    gravarProjecao()
    const comA = service.revisoesDoGate(PROJETO, 'SLICE_ENTRY', WS)[0]?.hash

    gerado = revisao({
      mvpEscolhido: 'mvp-1',
      spec: spec({ perguntas: [{ ...spec().perguntas[0]!, resposta: 'b' }] })
    })

    expect(service.revisoesDoGate(PROJETO, 'SLICE_ENTRY', WS)[0]?.hash).not.toBe(comA)
  })

  it('sem roadmap gerado, os dois gates ficam sem objeto', () => {
    gerado = undefined

    expect(service.revisoesDoGate(PROJETO, 'MVP_ENTRY', WS)).toEqual([])
    expect(service.revisoesDoGate(PROJETO, 'SLICE_ENTRY', WS)).toEqual([])
  })
})

describe('aprovar — o aceite do PI', () => {
  beforeEach(() => {
    gravarPrd()
    gravarProjecao()
  })

  it('registra a aprovação com as revisões exatas e a identidade (critério 4)', () => {
    const r = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(r.reason).toBe('aprovado')
    expect(r.approval?.identidade).toBe('pi@exemplo')
    expect(r.approval?.autor).toBe('pi')
    expect(r.approval?.revisoes.every((rev) => rev.hash.length === 64)).toBe(true)
    expect(r.approval?.revisoes.map((rev) => rev.artefato)).toContain('docs/PRD.md')
  })

  /** Critério 5, medido no caminho que decide: o serviço, não a função pura. */
  it('a mesma revisão não pede novo aceite', () => {
    const primeira = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)
    const segunda = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(primeira.reason).toBe('aprovado')
    expect(segunda.reason).toBe('ja-aprovado')
    expect(segunda.vigente?.id).toBe(primeira.approval?.id)
    expect(aprovacoesNoBanco()).toBe(1)
  })

  it('mudar um artefato faz o gate voltar a pedir aceite', () => {
    service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)
    anexosDoProjeto = [{ caminho: 'docs/prototipos/home.html', hash: 'z'.repeat(64) }]

    const r = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(r.reason).toBe('aprovado')
    expect(aprovacoesNoBanco()).toBe(2)
  })

  /**
   * O gate falha fechado — nunca "aprova como anônimo". Uma aprovação sem identidade não
   * responde a pergunta que o critério 4 faz.
   */
  it('sem sessão autenticada, recusa e não grava nada', () => {
    identidadeAtual = undefined

    const r = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(r.reason).toBe('sem-identidade')
    expect(aprovacoesNoBanco()).toBe(0)
  })

  it('identidade vazia também recusa', () => {
    identidadeAtual = '   '

    expect(service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS).reason).toBe('sem-identidade')
  })

  it('projeto inexistente recusa', () => {
    expect(service.aprovar('projeto-inexistente', 'PROJECT_PACKAGE', WS).reason).toBe(
      'projeto-inexistente'
    )
  })

  /** Critério 4 da SPEC-Jornada-05: pergunta sem resposta ⇒ aceite recusado. */
  it('SLICE_ENTRY com pergunta aberta recusa por falta de objeto', () => {
    gerado = revisao({ mvpEscolhido: 'mvp-1', spec: spec() })
    gravarProjecao()

    const r = service.aprovar(PROJETO, 'SLICE_ENTRY', WS)

    expect(r.reason).toBe('sem-revisoes')
    expect(aprovacoesNoBanco()).toBe(0)
  })

  it('SLICE_ENTRY com a pergunta respondida aprova', () => {
    gerado = revisao({
      mvpEscolhido: 'mvp-1',
      spec: spec({ perguntas: [{ ...spec().perguntas[0]!, resposta: 'a' }] })
    })
    gravarProjecao()

    expect(service.aprovar(PROJETO, 'SLICE_ENTRY', WS).reason).toBe('aprovado')
  })

  /**
   * O gate da Construção (SPEC-Fases-04, critério 4).
   *
   * O que estes testes protegem não é a verificação em si — ela tem suíte própria, pura — e sim
   * a **ligação**: que o `SLICE_ENTRY` a consulta, que a recusa não grava `Approval`, e que os
   * outros dois gates não são afetados.
   */
  function specRespondida(): void {
    gerado = revisao({
      mvpEscolhido: 'mvp-1',
      spec: spec({ perguntas: [{ ...spec().perguntas[0]!, resposta: 'a' }] })
    })
    gravarProjecao()
  }

  it('SLICE_ENTRY recusa com marcos-pendentes quando há documento fora do Git', () => {
    specRespondida()
    marcos = {
      ok: false,
      head: 'abc1234',
      pendencias: [
        {
          caminho: 'docs/PRD.md',
          estado: 'revisao-sem-commit',
          mensagem: 'docs/PRD.md foi aceito mas não está commitado.',
          acao: 'Commitar marco docs/PRD.md'
        }
      ]
    }

    const r = service.aprovar(PROJETO, 'SLICE_ENTRY', WS)

    expect(r.reason).toBe('marcos-pendentes')
    // A ação concreta atravessa: sem ela o bloqueio seria um beco, e a spec proíbe o "aceitar
    // mesmo assim" justamente porque o caminho de saída é o remédio, não o bypass.
    expect(r.problemas?.[0]?.acao).toBe('Commitar marco docs/PRD.md')
  })

  it('a recusa por marcos não grava aprovação — a verificação roda antes do Approval', () => {
    specRespondida()
    marcos = {
      ok: false,
      head: 'abc1234',
      pendencias: [
        {
          caminho: 'README.md',
          estado: 'arvore-suja',
          mensagem: 'Há 1 arquivo(s) com alteração não commitada.',
          acao: 'Descartar ou commitar alterações em README.md'
        }
      ]
    }

    service.aprovar(PROJETO, 'SLICE_ENTRY', WS)

    expect(aprovacoesNoBanco()).toBe(0)
  })

  it('os outros gates não consultam marcos: PROJECT_PACKAGE aprova com o repositório sujo', () => {
    marcos = {
      ok: false,
      head: 'abc1234',
      pendencias: [
        { caminho: 'x.md', estado: 'arvore-suja', mensagem: 'sujo', acao: 'commitar x.md' }
      ]
    }

    // A regra do PI é sobre entrar na Construção. Estender o bloqueio aos gates anteriores
    // travaria o planejamento inteiro por trabalho em andamento — que é o estado normal dele.
    expect(service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS).reason).toBe('aprovado')
  })

  /**
   * A promoção segue a **escolha do PI**, e não a ordem topológica: é a pergunta 1 da spec,
   * resolvida em 2026-09-03. Aqui o escolhido é o segundo da ordem, e é ele que entra na fila.
   */
  it('MVP_ENTRY promove o MVP escolhido, não o primeiro da ordem', () => {
    gerado = revisao({ mvpEscolhido: 'mvp-2' })

    service.aprovar(PROJETO, 'MVP_ENTRY', WS)

    const naFila = service.carregar(PROJETO, WS).mvps.filter((m) => m.estado === 'na-fila')

    expect(naFila).toHaveLength(1)
    expect(naFila[0]?.id).toBe('mvp-2')
  })

  it('PROJECT_PACKAGE não promove MVP nenhum', () => {
    service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(service.carregar(PROJETO, WS).mvps.every((m) => m.estado === 'proposto')).toBe(true)
  })

  it('a aprovação gera AuditEvent com o gate e a identidade, sem conteúdo', () => {
    service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    const evento = audit.list(USER).find((e) => e.type === 'approval')
    const payload = JSON.stringify(evento?.payload ?? {})

    expect(payload).toContain('PROJECT_PACKAGE')
    expect(payload).toContain('pi@exemplo')
    // Nunca o conteúdo aprovado (ADR-004).
    expect(payload).not.toContain('# PRD')
  })

  it('a cadeia de auditoria continua íntegra', () => {
    service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(audit.verify(USER).ok).toBe(true)
  })
})

describe('simularMudanca — o custo antes da mudança', () => {
  beforeEach(() => {
    gravarPrd()
    gravarProjecao()
    service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)
  })

  it('mostra o gate que a mudança semântica invalidaria, sem aplicá-la', () => {
    const invalidados = service.simularMudanca(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'z'.repeat(64), natureza: 'semantica' }],
      WS
    )

    expect(invalidados).toEqual(['PROJECT_PACKAGE'])
    // Consulta pura: a aprovação continua lá.
    expect(aprovacoesNoBanco()).toBe(1)
  })

  it('mudança cosmética não invalida nada (invariante 4)', () => {
    const invalidados = service.simularMudanca(
      PROJETO,
      [{ artefato: 'docs/PRD.md', hashNovo: 'z'.repeat(64), natureza: 'cosmetica' }],
      WS
    )

    expect(invalidados).toEqual([])
  })
})

describe('aprovacoes — a leitura', () => {
  it('lista as aprovações do projeto, da mais recente à mais antiga', () => {
    gravarPrd()
    gravarProjecao()
    service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(service.aprovacoes(PROJETO, WS)).toHaveLength(1)
  })

  it('projeto sem aprovação devolve lista vazia', () => {
    expect(service.aprovacoes(PROJETO, WS)).toEqual([])
  })
})
