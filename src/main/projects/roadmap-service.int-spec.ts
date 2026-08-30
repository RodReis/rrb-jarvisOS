/**
 * O roadmap e os gates contra o SQLite e o disco reais (SPEC-Planejamento-06, Banco).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o serviço dizer que recusou — o
 * disco tem de confirmar que nenhum arquivo foi escrito e o banco que nenhuma linha foi gravada.
 *
 * As garantias que só este nível alcança:
 *  - **DAG inválido não escreve nada** (critério 1) — a recusa acontece antes do disco.
 *  - **Gerar não promove nem aprova** (critérios 3 e 7): os MVPs continuam `proposto` e não há
 *    `approval` no banco depois de gerar.
 *  - **Sem identidade, o gate falha fechado** — e nenhuma linha de aprovação aparece.
 *  - **Mesma revisão não pede novo aceite** (critério 5), medido no caminho que decide.
 *
 * O `AnexoService` é dublado porque o que se exercita aqui é a decisão desta fatia, não a
 * validação de protótipo — que tem suíte própria na M8-F05.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
const { PacoteRepository } = await import('./pacote-repository')
const { RoadmapRepository } = await import('./roadmap-repository')
const { RoadmapService } = await import('./roadmap-service')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

const CATALOGO: readonly Pergunta[] = [
  {
    id: 'escopo',
    etapa: 'contexto',
    titulo: 'Escopo do projeto',
    enunciado: 'Como começar?',
    opcoes: [
      { id: 'fatia-vertical', rotulo: 'Fatia vertical', impacto: 'impacto A' },
      { id: 'fundacao-ampla', rotulo: 'Fundação ampla', impacto: 'impacto B' }
    ],
    recomendada: 'fatia-vertical',
    justificativa: 'porque sim',
    aceitaTextoLivre: true,
    delegavel: true
  }
]

let dir: string
let raiz: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
let decisions: InstanceType<typeof DecisionRepository>
let pacotes: InstanceType<typeof PacoteRepository>
let repository: InstanceType<typeof RoadmapRepository>
let service: InstanceType<typeof RoadmapService>
let marcos: string[]
/** O que o dublê do `AnexoService` devolve. */
let jornadas: string[]
let anexosDoProjeto: { caminho: string; hash: string }[]
let arquiteturas: { documentos: { caminho: string; hash: string }[] }[]
let identidadeAtual: string | undefined

function decidirEscopo(escolha = 'fatia-vertical'): void {
  decisions.registrar({
    id: 'd-escopo',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    perguntaId: 'escopo',
    etapa: 'contexto',
    escolha,
    texto: null,
    recomendacao: 'fatia-vertical',
    justificativa: 'porque sim',
    autor: 'pi',
    motivo: 'escolhida',
    substituiu: null,
    created_at: '2026-08-30T10:00:00.000Z'
  })
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

function mvpsNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM mvp').get() as { n: number }).n
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
  decisions = new DecisionRepository(db)
  pacotes = new PacoteRepository(db)
  repository = new RoadmapRepository(db)
  marcos = []
  jornadas = ['Cadastro de cliente', 'Relatórios']
  anexosDoProjeto = [{ caminho: 'docs/prototipos/home.html', hash: 'a'.repeat(64) }]
  arquiteturas = [{ documentos: [{ caminho: 'docs/ARCHITECTURE.md', hash: 'b'.repeat(64) }] }]
  identidadeAtual = 'pi@exemplo'

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
    projectService: {
      concluirMarco: (_id: string, marco: string) => {
        marcos.push(marco)
        return { marco, commitado: true, mensagem: 'ok', commitHash: 'c0ffee' }
      }
    } as never,
    decisions,
    pacotes,
    anexos: {
      // As jornadas chegam pelo mesmo caminho da M8-F05: a validação dos protótipos.
      validar: () =>
        Promise.resolve(
          jornadas.map((j) => ({ prototipo: 'x', jornadasCobertas: [j], achados: [] }))
        ),
      listar: () => anexosDoProjeto,
      listarArquiteturas: () => arquiteturas
    } as never,
    audit,
    userId: () => USER,
    identidade: () => identidadeAtual,
    catalogo: CATALOGO
  })
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('gerar o roadmap', () => {
  it('escreve STATUS, histórico e a SPEC da próxima fatia', async () => {
    decidirEscopo()

    const r = await service.gerar(PROJETO, WS)

    expect(r.reason).toBe('gerado')
    expect(existsSync(join(raiz, 'docs/STATUS.md'))).toBe(true)
    expect(existsSync(join(raiz, 'docs/STATUS-ARQUIVO.md'))).toBe(true)
    expect(existsSync(join(raiz, r.proxima?.specSlug ?? ''))).toBe(true)
  })

  it('o STATUS traz o índice Fatia ↔ SPEC de todas as fatias (invariante 1)', async () => {
    decidirEscopo()

    const r = await service.gerar(PROJETO, WS)
    const status = readFileSync(join(raiz, 'docs/STATUS.md'), 'utf8')

    expect(status).toContain('Índice Fatia ↔ SPEC')
    for (const slice of r.roadmap?.slices ?? []) {
      expect(status).toContain(slice.specSlug)
    }
  })

  /** § Saídas literal: SPEC executável **somente** da próxima fatia. */
  it('detalha uma fatia só, mesmo com várias no roadmap', async () => {
    decidirEscopo()

    const r = await service.gerar(PROJETO, WS)

    expect((r.roadmap?.slices.length ?? 0) > 1).toBe(true)
    expect(r.roadmap?.slices.filter((s) => s.detalhada)).toHaveLength(1)
  })

  /**
   * O critério 3: gerar propõe, nunca promove. Se a geração pusesse um MVP na fila, ela estaria
   * aprovando o que ela mesma propôs.
   */
  it('os MVPs nascem propostos, e gerar não cria aprovação nenhuma', async () => {
    decidirEscopo()

    await service.gerar(PROJETO, WS)

    expect(service.carregar(PROJETO, WS).mvps.every((m) => m.estado === 'proposto')).toBe(true)
    expect(aprovacoesNoBanco()).toBe(0)
  })

  it('conclui o marco roadmap-aprovado', async () => {
    decidirEscopo()

    await service.gerar(PROJETO, WS)

    expect(marcos).toEqual(['roadmap-aprovado'])
  })

  it('sem decisão de escopo, recusa sem escrever nada', async () => {
    const r = await service.gerar(PROJETO, WS)

    expect(r.reason).toBe('sem-base')
    expect(r.mensagem).toContain('escopo')
    expect(existsSync(join(raiz, 'docs/STATUS.md'))).toBe(false)
    expect(mvpsNoBanco()).toBe(0)
  })

  it('sem jornada prototipada, recusa sem escrever nada', async () => {
    decidirEscopo()
    jornadas = []

    const r = await service.gerar(PROJETO, WS)

    expect(r.reason).toBe('sem-base')
    expect(r.mensagem).toContain('protótipos')
    expect(existsSync(join(raiz, 'docs/STATUS.md'))).toBe(false)
  })

  it('regerar preserva o estado de um MVP já promovido (critério 3)', async () => {
    decidirEscopo()
    await service.gerar(PROJETO, WS)
    service.aprovar(PROJETO, 'MVP_ENTRY', WS)

    const promovidoAntes = service.carregar(PROJETO, WS).mvps.find((m) => m.estado === 'na-fila')
    expect(promovidoAntes).toBeDefined()

    await service.gerar(PROJETO, WS)

    // Apagar a promoção ao regerar faria o roadmap desfazer uma aprovação.
    expect(service.carregar(PROJETO, WS).mvps.some((m) => m.estado === 'na-fila')).toBe(true)
  })

  /**
   * O critério 1 no caminho que decide: DAG inválido recusa **antes de tocar o disco**.
   *
   * O compositor de produção nunca gera ciclo (só produz `[]` ou `['mvp-fundacao']`), então a
   * guarda seria inalcançável sem esta costura. Ela não é código morto: protege contra o
   * compositor mudar e contra roadmap corrompido vindo do banco — o que faltava era só o
   * caminho para provocá-la.
   */
  it('DAG com ciclo recusa sem escrever arquivo nem gravar linha (critério 1)', async () => {
    decidirEscopo()
    const ciclico = new RoadmapService({
      repository,
      projects,
      projectService: { concluirMarco: () => undefined } as never,
      decisions,
      pacotes,
      anexos: {
        validar: () => Promise.resolve([{ prototipo: 'x', jornadasCobertas: ['A'], achados: [] }]),
        listar: () => [],
        listarArquiteturas: () => []
      } as never,
      audit,
      userId: () => USER,
      identidade: () => 'pi@exemplo',
      catalogo: CATALOGO,
      compor: () => ({
        mvps: [
          {
            id: 'a',
            numero: 1,
            titulo: 'A',
            tese: 't',
            estado: 'proposto',
            dependeDe: ['b'],
            origem: { tipo: 'decisao', decisaoId: 'd', perguntaId: 'escopo' }
          },
          {
            id: 'b',
            numero: 2,
            titulo: 'B',
            tese: 't',
            estado: 'proposto',
            dependeDe: ['a'],
            origem: { tipo: 'decisao', decisaoId: 'd', perguntaId: 'escopo' }
          }
        ],
        slices: []
      })
    })

    const r = await ciclico.gerar(PROJETO, WS)

    expect(r.reason).toBe('dag-invalido')
    // A recusa nomeia o problema: "há um ciclo" não é acionável.
    expect(r.problemas?.[0]?.mensagem).toContain('Ciclo')
    // E acontece antes do disco e do banco.
    expect(existsSync(join(raiz, 'docs/STATUS.md'))).toBe(false)
    expect(mvpsNoBanco()).toBe(0)
  })

  it('a fundação ampla produz um DAG em que tudo depende da fundação', async () => {
    decidirEscopo('fundacao-ampla')

    const r = await service.gerar(PROJETO, WS)
    const fundacao = r.roadmap?.mvps.find((m) => m.titulo === 'Fundação')

    expect(fundacao).toBeDefined()
    expect(
      r.roadmap?.mvps.filter((m) => m.id !== fundacao?.id).every((m) => m.dependeDe.length > 0)
    ).toBe(true)
  })
})

describe('aprovar um gate', () => {
  beforeEach(async () => {
    decidirEscopo()
    gravarPrd()
    await service.gerar(PROJETO, WS)
  })

  it('registra a aprovação com as revisões exatas e a identidade (critério 4)', () => {
    const r = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(r.reason).toBe('aprovado')
    expect(r.approval?.identidade).toBe('pi@exemplo')
    expect(r.approval?.autor).toBe('pi')
    expect(r.approval?.revisoes.every((rev) => rev.hash.length === 64)).toBe(true)
    // O PRD, a arquitetura e os anexos — o gate os lista literalmente.
    expect(r.approval?.revisoes.map((rev) => rev.artefato)).toContain('docs/PRD.md')
    expect(r.approval?.revisoes.map((rev) => rev.artefato)).toContain('docs/ARCHITECTURE.md')
    expect(r.approval?.revisoes.map((rev) => rev.artefato)).toContain('docs/prototipos/home.html')
  })

  /** Critério 5, medido no caminho que decide: o serviço, não a função pura. */
  it('a mesma revisão não pede novo aceite', () => {
    const primeira = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)
    const segunda = service.aprovar(PROJETO, 'PROJECT_PACKAGE', WS)

    expect(primeira.reason).toBe('aprovado')
    expect(segunda.reason).toBe('ja-aprovado')
    expect(segunda.vigente?.id).toBe(primeira.approval?.id)
    // E não gravou uma segunda linha.
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

  it('gate sem objeto recusa em vez de aprovar o vazio', () => {
    // SLICE_ENTRY sem fatia detalhada não teria o que aprovar; aqui há uma, então usamos um
    // projeto sem roadmap para o caso vazio.
    const r = service.aprovar('projeto-inexistente', 'PROJECT_PACKAGE', WS)
    expect(r.reason).toBe('projeto-inexistente')
  })

  it('MVP_ENTRY promove o primeiro MVP da ordem — e só ele (critério 3)', () => {
    service.aprovar(PROJETO, 'MVP_ENTRY', WS)

    const naFila = service.carregar(PROJETO, WS).mvps.filter((m) => m.estado === 'na-fila')
    expect(naFila).toHaveLength(1)
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

describe('simularMudanca — critério 6', () => {
  beforeEach(async () => {
    decidirEscopo()
    gravarPrd()
    await service.gerar(PROJETO, WS)
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
