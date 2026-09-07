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
import { faseDaEtapa } from '@shared/domain/fase'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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

/**
 * O resumo que o card da tela Projetos consome (SPEC-Fases-01, critérios 2 a 5 e 7).
 *
 * A garantia que só este nível alcança é a do **critério 7**: um card, uma leitura. O card
 * mostra quatro fatos que nasceram em lugares diferentes (etapa, aprovações, rota, modelo), e a
 * tentação natural é o renderer buscar cada um no seu canal. Isso daria quatro viagens por card
 * e, pior, permitiria que dois deles discordassem — a rota do selo diferente da rota do card é
 * exatamente o que o critério 4 proíbe. Aqui o main compõe uma vez e entrega pronto.
 */
describe('resumo do projeto para o card (SPEC-Fases-01)', () => {
  const ROTAS_OK = {
    assinaturaDisponivel: true,
    assinaturaEsgotada: false,
    rotaPagaConfigurada: false,
    optInDeRotaPaga: false
  } as const

  const ROTAS_BLOQUEADAS = { ...ROTAS_OK, assinaturaDisponivel: false } as const

  function servicoCom(
    rotas: typeof ROTAS_OK | typeof ROTAS_BLOQUEADAS,
    modelo = 'claude-sonnet-5'
  ): InstanceType<typeof JornadaService> {
    return new JornadaService({
      repository: projects,
      roadmap,
      audit,
      userId: () => USER,
      estadoDasRotas: () => rotas,
      modeloAtivo: () => modelo
    })
  }

  it('dá fase e etapa coerentes com a etapa derivada (critério 2)', () => {
    criarProjetoComSessao()
    responderWizard()

    const resumo = servicoCom(ROTAS_OK).resumoDoProjeto(PROJETO, WS)

    expect(resumo?.etapa).toBe('brief-aceito')
    expect(resumo?.fase).toBe('planejamento')
    expect(resumo?.rotuloDaFase).toBe('Planejamento')
    expect(resumo?.progresso).toEqual({ posicao: 3, total: 8 })
  })

  it('mantém fase e etapa de acordo conforme o projeto anda (critério 2)', () => {
    // O teto observável da jornada hoje é `prd-aceito`: os aceites documentais não deixam
    // evidência em `eventosObservados`, e `etapaDerivada` para no primeiro buraco. Este teste
    // prova o acoplamento entre fase e etapa **derivada** dentro do que os fatos sustentam; a
    // cobertura das três fases é do teste puro em `fase.spec.ts`, onde toda etapa é alcançável.
    criarProjetoComSessao()
    responderWizard()
    db.prepare('UPDATE planning_session SET ultimo_marco = ? WHERE project_id = ?').run(
      'prd-aprovado',
      PROJETO
    )

    const resumo = servicoCom(ROTAS_OK).resumoDoProjeto(PROJETO, WS)

    expect(resumo?.etapa).toBe('prd-aceito')
    expect(resumo?.fase).toBe(faseDaEtapa(resumo!.etapa))
    expect(resumo?.rotuloDaFase).toBe('Planejamento')
    expect(resumo?.progresso).toEqual({ posicao: 5, total: 8 })
  })

  it('conta só os gates de aceite aprovados, e a data vem do último evento (critério 3)', () => {
    criarProjetoComSessao()
    responderWizard()
    aprovar('PROJECT_PACKAGE')

    const resumo = servicoCom(ROTAS_OK).resumoDoProjeto(PROJETO, WS)

    expect(resumo?.gates).toEqual({ aceitos: 1, total: 5 })
    expect(resumo?.dataDoUltimoEvento).toBeTruthy()
  })

  it('não conta gate nenhum em projeto sem aprovação (critério 3)', () => {
    criarProjetoComSessao()

    expect(servicoCom(ROTAS_OK).resumoDoProjeto(PROJETO, WS)?.gates).toEqual({
      aceitos: 0,
      total: 5
    })
  })

  it('devolve a rota e o modelo do provider dela — a mesma fonte do selo (critério 4)', () => {
    criarProjetoComSessao()

    const resumo = servicoCom(ROTAS_OK, 'claude-opus-5').resumoDoProjeto(PROJETO, WS)

    expect(resumo?.rota?.decisao).toBe('assinatura')
    expect(resumo?.modelo).toBe('claude-opus-5')
  })

  it('mostra motivo e ação quando a rota bloqueia, e não anuncia modelo (critério 5)', () => {
    criarProjetoComSessao()

    const resumo = servicoCom(ROTAS_BLOQUEADAS).resumoDoProjeto(PROJETO, WS)

    expect(resumo?.rota?.decisao).toBe('bloqueado')
    expect(resumo?.bloqueio?.motivo).toBeTruthy()
    expect(resumo?.bloqueio?.acao).toContain('Providers')
    // Rota bloqueada não gera: anunciar o modelo descreveria uma chamada que não vai acontecer.
    expect(resumo?.modelo).toBeNull()
  })

  it('não inventa bloqueio quando a rota resolve (critério 5)', () => {
    criarProjetoComSessao()

    expect(servicoCom(ROTAS_OK).resumoDoProjeto(PROJETO, WS)?.bloqueio).toBeNull()
  })

  it('resume vários projetos numa leitura só (critério 7)', () => {
    criarProjetoComSessao()

    const resumos = servicoCom(ROTAS_OK).resumoDeVarios([PROJETO, 'inexistente'], WS)

    expect(resumos).toHaveLength(1)
    expect(resumos[0].projectId).toBe(PROJETO)
  })

  it('projeto sem sessão não vira resumo em vez de estourar', () => {
    expect(servicoCom(ROTAS_OK).resumoDoProjeto('nao-existe', WS)).toBeUndefined()
  })
})

/**
 * O aceite documental deixa marco (#259).
 *
 * O defeito que estes testes fecham: `brief-aceito` e `prd-aceito` moviam a coluna e **a leitura
 * seguinte desfazia**, porque `eventosObservados` não tinha como vê-los — não há marco nem gate
 * que os comprove. Na prática nenhum projeto passava de `prd-aceito`, e as fases Especificação e
 * Construção eram inalcançáveis.
 *
 * A correção decidida pelo PI (2026-09-04) é dar **marco documental** aos dois, de modo que a
 * evidência exista no Git como já existe para os outros cinco. Foram descartados o gate próprio
 * em `aprovacoes.ts` (contraria a decisão da SPEC-Jornada-01 de manter três gates fechados) e a
 * coluna prevalecer nesses dois casos (abriria exceção no critério 2, que é o que impede a
 * coluna de virar segunda fonte de verdade).
 *
 * O que se mede é a **sobrevivência ao recálculo**: avançar e reler tem de devolver a etapa
 * nova. Um teste que só olhasse o retorno de `aplicarEvento` passaria com o defeito presente —
 * ele sempre devolveu `avancou`; quem desfazia era a leitura seguinte.
 */
describe('aceite documental deixa marco (#259)', () => {
  /** Registra o marco como o `ProjectService` faria, sem Git: aqui o alvo é a jornada. */
  function servicoComMarco(): {
    servico: InstanceType<typeof JornadaService>
    marcados: string[]
  } {
    const marcados: string[] = []

    const servico = new JornadaService({
      repository: projects,
      roadmap,
      audit,
      userId: () => USER,
      concluirMarco: (projectId, marco) => {
        marcados.push(marco)
        projects.marcarMarco(USER, projectId, marco)
        return true
      }
    })

    return { servico, marcados }
  }

  it('o aceite do brief sobrevive ao recálculo da leitura seguinte', () => {
    criarProjetoComSessao()
    responderWizard()

    const { servico, marcados } = servicoComMarco()
    expect(servico.estado(PROJETO, WS)?.etapa).toBe('brief-aceito')

    const outcome = servico.aplicarEvento(PROJETO, 'brief-aceito', WS)

    expect(outcome?.resultado).toBe('avancou')
    expect(marcados).toContain('brief-aceito-pelo-pi')
    // A prova do defeito: antes, esta releitura devolvia `brief-aceito` de novo.
    expect(servico.estado(PROJETO, WS)?.etapa).toBe('prd')
  })

  it('o aceite do PRD sobrevive ao recálculo, e a jornada alcança a Especificação', () => {
    criarProjetoComSessao()
    responderWizard()
    db.prepare('UPDATE planning_session SET ultimo_marco = ? WHERE project_id = ?').run(
      'roadmap-aprovado',
      PROJETO
    )
    aprovar('PROJECT_PACKAGE')

    const { servico } = servicoComMarco()
    // `estado()` sincroniza a coluna com os fatos; `aplicarEvento` lê a coluna, não a derivada.
    servico.estado(PROJETO, WS)
    servico.aplicarEvento(PROJETO, 'brief-aceito', WS)
    servico.aplicarEvento(PROJETO, 'prd-aceito', WS)

    // O teto que o defeito impunha era `prd-aceito`; agora a cadeia segue até onde os fatos
    // sustentam, e a fase acompanha.
    const etapa = servico.estado(PROJETO, WS)?.etapa
    expect(etapa).toBeDefined()
    expect(faseDaEtapa(etapa!)).toBe('especificacao')
  })

  it('transição recusada não commita marco: não há aceite a registrar', () => {
    criarProjetoComSessao()

    const { servico, marcados } = servicoComMarco()
    // O projeto está em `prompt`; `prd-aceito` sai de outra etapa.
    const outcome = servico.aplicarEvento(PROJETO, 'prd-aceito', WS)

    expect(outcome?.resultado).toBe('evento-fora-de-ordem')
    expect(marcados).toEqual([])
  })

  it('evento sem marco correspondente não inventa commit', () => {
    criarProjetoComSessao()

    const { servico, marcados } = servicoComMarco()
    servico.aplicarEvento(PROJETO, 'prompt-salvo', WS)

    // `prompt-salvo` não é aceite documental: quem o comprova são as respostas do wizard.
    expect(marcados).toEqual([])
  })

  it('falha ao commitar o marco não move a jornada', () => {
    criarProjetoComSessao()
    responderWizard()

    const servico = new JornadaService({
      repository: projects,
      roadmap,
      audit,
      userId: () => USER,
      // Git indisponível, disco cheio, repositório travado: o commit não sai.
      concluirMarco: () => false
    })

    servico.estado(PROJETO, WS)
    const outcome = servico.aplicarEvento(PROJETO, 'brief-aceito', WS)

    // Mover a etapa sem a evidência produziria exatamente o estado que este FIX conserta: uma
    // coluna adiante dos fatos, desfeita na leitura seguinte. Recusar é o desfecho honesto.
    expect(outcome?.resultado).toBe('marco-nao-commitado')
    expect(etapaNoBanco()).toBe('brief-aceito')
  })

  it('sem a dep de marco o aceite documental é recusado, não silenciosamente perdido', () => {
    criarProjetoComSessao()
    responderWizard()

    // Serviço montado sem `concluirMarco` — o caso de um call site que só lê a jornada.
    service.estado(PROJETO, WS)
    const outcome = service.aplicarEvento(PROJETO, 'brief-aceito', WS)

    expect(outcome?.resultado).toBe('marco-nao-commitado')
    expect(etapaNoBanco()).toBe('brief-aceito')
  })
})

/**
 * O fluxo novo move a jornada (#281).
 *
 * O defeito: `eventosObservados` sustentava `prompt-salvo` e `refinamento-respondido` a partir
 * de **uma única fonte** — as respostas do wizard do MVP-008. O fluxo da M25-F02 não grava
 * `respostas`: ele grava `project_prompt`, o marco `prompt-registrado` e `project_brief`. Um
 * projeto que escrevia o prompt, commitava e gerava o brief ficava em `prompt` para sempre, sem
 * botão que o tirasse dali.
 *
 * Estes testes usam as **duas evidências do fluxo novo**, sem tocar em `respostas`: é isso que
 * os faz reprovar se alguém remover a entrada do marco ou a leitura do brief.
 */
describe('a jornada do fluxo novo, sem respostas do wizard (#281)', () => {
  /** Marca o marco documental, como `ProjectService.concluirMarco` faria depois do commit. */
  function marcar(marco: string): void {
    db.prepare('UPDATE planning_session SET ultimo_marco = ? WHERE project_id = ?').run(
      marco,
      PROJETO
    )
  }

  function servicoCom(temBrief: boolean): InstanceType<typeof JornadaService> {
    return new JornadaService({
      repository: projects,
      roadmap,
      audit,
      userId: () => USER,
      temBrief: () => temBrief
    })
  }

  it('sem prompt commitado, a jornada fica no prompt', () => {
    criarProjetoComSessao()

    // O piso: sem evidência nenhuma, a etapa é a primeira. Sem esta asserção os testes abaixo
    // não provariam que foi o marco que moveu a jornada.
    expect(servicoCom(false).estado(PROJETO, WS)?.etapa).toBe('prompt')
  })

  it('o marco do prompt leva ao refinamento', () => {
    criarProjetoComSessao()
    marcar('prompt-registrado')

    // A prova do defeito: antes da correção isto devolvia `prompt`, porque `prompt-registrado`
    // não estava em `EVENTO_DO_MARCO` e `respostas` estava vazio.
    expect(servicoCom(false).estado(PROJETO, WS)?.etapa).toBe('refinamento')
  })

  it('o brief gerado fecha o refinamento e leva ao aceite', () => {
    criarProjetoComSessao()
    marcar('prompt-registrado')

    // A jornada para em `brief-aceito` porque aceitar é ato do PI — gerar o brief não o aceita.
    expect(servicoCom(true).estado(PROJETO, WS)?.etapa).toBe('brief-aceito')
  })

  it('o brief sozinho não pula o prompt', () => {
    criarProjetoComSessao()

    // Sem o marco do prompt não há `prompt-salvo`, e `etapaDerivada` para no primeiro buraco:
    // um brief não pode fazer a jornada saltar a etapa que não aconteceu.
    expect(servicoCom(true).estado(PROJETO, WS)?.etapa).toBe('prompt')
  })

  /**
   * O defeito latente que a correção do laço fechou.
   *
   * A versão anterior percorria as entradas de `EVENTO_DO_MARCO` e parava quando a chave batia
   * com o `ultimoMarco`. `estrutura-inicial` — o **primeiro** marco de todo projeto — não está
   * nesse mapa, então o `break` nunca disparava e o laço empurrava a cadeia inteira, do brief ao
   * roadmap. Só não virava jornada adiantada porque `etapaDerivada` para no primeiro buraco.
   */
  it('marco fora do mapa não empurra a cadeia inteira de eventos', () => {
    criarProjetoComSessao()
    marcar('estrutura-inicial')

    const estado = servicoCom(false).estado(PROJETO, WS)

    // `estrutura-inicial` não comprova evento nenhum da jornada: a etapa continua no começo.
    expect(estado?.etapa).toBe('prompt')
  })

  it('a etapa derivada é persistida, e a leitura seguinte não a recalcula', () => {
    criarProjetoComSessao()
    marcar('prompt-registrado')

    const servico = servicoCom(false)
    expect(servico.estado(PROJETO, WS)?.recalculada).toBe(true)
    expect(etapaNoBanco()).toBe('refinamento')
    // O desvio é corrigido uma vez, não a cada abertura da tela.
    expect(servico.estado(PROJETO, WS)?.recalculada).toBe(false)
  })

  it('sem a dep de brief, a jornada não passa do refinamento', () => {
    criarProjetoComSessao()
    marcar('prompt-registrado')

    // O caso de um call site que só lê a etapa e não monta o repositório de briefs: ele vê a
    // jornada até onde os fatos que **ele** conhece sustentam, e nunca uma etapa inventada.
    expect(service.estado(PROJETO, WS)?.etapa).toBe('refinamento')
  })
})
