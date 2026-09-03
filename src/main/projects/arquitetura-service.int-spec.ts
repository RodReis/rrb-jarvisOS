/**
 * A geração da arquitetura contra o SQLite real (SPEC-Jornada-04).
 *
 * A prova é **por efeito**, mesma postura do `prd-service.int-spec.ts`: não basta o serviço
 * devolver o desfecho certo — os dublês contam chamadas, e o banco e o disco dizem o que
 * realmente aconteceu. Um teste que só olhasse o retorno passaria com uma implementação que
 * chama o modelo antes de conferir o gate e gasta a chamada que a recusa existia para evitar.
 *
 * As garantias que só este nível alcança:
 *  - **Critério 1:** anexo faltando ⇒ recusa **antes de qualquer chamada**. Medido no contador,
 *    nos dois casos da M8-F05 (sem design system e sem protótipo).
 *  - **Critério 2:** fluxo sem âncora em protótipo não vira revisão; o banco continua vazio
 *    depois da correção recusada, e a correção **nomeia** o problema.
 *  - **Critério 3:** a revisão gravada cita o `pacoteEstruturalId` do PRD vigente.
 *  - **Critério 4:** o ajuste proposto é gravado, e descartá-lo **não** toca o anexo — o hash do
 *    protótipo no banco continua o mesmo. Falha na análise não vira "nenhum ajuste".
 *  - **Critério 5:** a revisão registra os hashes de todos os anexos, e grava nas duas tabelas
 *    para o gate `PROJECT_PACKAGE` continuar achando o que aprovar.
 *  - **Critério 6:** regerar conteúdo idêntico preserva a revisão em vez de estourar no UNIQUE.
 *  - **Critério 7:** rota bloqueada ⇒ zero chamada ao modelo.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Anexo } from '@shared/domain/anexos-de-design'
import type { AfirmacaoDaArquitetura, AjusteProposto } from '@shared/domain/arquitetura-gerada'
import type { PrdRegistrado } from '@shared/domain/prd'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'
import type { ValidacaoDoPrototipo } from '@shared/domain/validacao-de-prototipo'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { AnexoRepository } = await import('./anexo-repository')
const { ArquiteturaRepository } = await import('./arquitetura-repository')
const { ArquiteturaService } = await import('./arquitetura-service')
const { ProjectRepository } = await import('./project-repository')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

const PROTOTIPO = 'docs/prototipos/login.html'
const HASH_PROTOTIPO = 'a'.repeat(64)
const JORNADA = 'Entrar na conta'
const PACOTE_ESTRUTURAL = 'pac-1'

let dir: string
let projetoDir: string
let db: Db
let repo: InstanceType<typeof ArquiteturaRepository>
let anexos: InstanceType<typeof AnexoRepository>
let service: InstanceType<typeof ArquiteturaService>

let rotas: EstadoDasRotas
/** Quantas vezes o modelo gerou documentos — prova "zero chamada" nas recusas anteriores. */
let chamadasDeGeracao: number
/** Quantas vezes a análise de coerência foi chamada. */
let chamadasDeAnalise: number
/** O que o dublê do modelo devolve, por chamada. Uma lista permite simular correção. */
let respostas: (readonly AfirmacaoDaArquitetura[] | undefined)[]
/** As correções recebidas — prova que o problema é dito, não só "tente de novo". */
let correcoesRecebidas: (readonly string[] | undefined)[]
/** Os ajustes que a análise devolve. `undefined` simula falha da chamada. */
let ajustes: readonly AjusteProposto[] | undefined
/** O PRD vigente. `undefined` simula "o PRD ainda não saiu". */
let prdVigente: PrdRegistrado | undefined
/** As validações determinísticas dos protótipos. */
let validacoes: readonly ValidacaoDoPrototipo[]
/** Se o commit do marco funciona. */
let commitFunciona: boolean
/** Se `montarContexto` devolve um pack. */
let packDisponivel: boolean
/** Quantos marcos documentais foram concluídos — prova que o corte não commita. */
let marcosConcluidos: number

function prd(afirmacoes: readonly { id: string; texto: string }[]): PrdRegistrado {
  return {
    id: 'prd-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    briefHash: 'hash-do-brief',
    afirmacoes: afirmacoes.map((a) => ({
      id: a.id,
      documento: 'PRD' as const,
      secao: 'Escopo',
      texto: a.texto,
      origem: 'brief' as const,
      referencia: 'b-1'
    })),
    contradicoes: [],
    hash: 'hash-do-prd',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: new Date().toISOString()
  }
}

function anexo(over: Partial<Anexo> = {}): Anexo {
  return {
    id: `anexo-${over.caminho ?? PROTOTIPO}`,
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    tipo: 'prototipo',
    caminho: PROTOTIPO,
    origem: 'C:/origem/login.html',
    hash: HASH_PROTOTIPO,
    bytes: 1024,
    anexadoEm: new Date().toISOString(),
    ...over
  }
}

function doPrototipo(over: Partial<AfirmacaoDaArquitetura> = {}): AfirmacaoDaArquitetura {
  return {
    id: 'a-1',
    documento: 'ARCHITECTURE',
    secao: 'Fluxos cobertos',
    texto: 'O usuário entra na conta e chega à lista.',
    origem: 'prototipo',
    ancora: { anexo: PROTOTIPO, hash: HASH_PROTOTIPO, jornada: JORNADA },
    ...over
  }
}

function eventos(fase: string): number {
  const linhas = db
    .prepare("SELECT payload FROM audit_event WHERE type = 'arquitetura-generation'")
    .all() as { payload: string }[]

  return linhas.filter((l) => (JSON.parse(l.payload) as { fase?: string }).fase === fase).length
}

function revisoesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM project_architecture').get() as { n: number }).n
}

function pacotesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pacote_arquitetura').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-arq-svc-'))
  projetoDir = join(dir, 'projeto')
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new ArquiteturaRepository(db)
  anexos = new AnexoRepository(db)

  const projetos = new ProjectRepository(db)
  projetos.save({
    id: PROJETO,
    user_id: USER,
    workspace_id: WS,
    nome: 'Leituras',
    slug: 'leituras',
    diretorio: projetoDir,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })

  // O gate aberto: design system e protótipo, como a M8-F05 exige.
  anexos.registrar(anexo({ tipo: 'design-system', caminho: 'DESIGN-SYSTEM.md', hash: 'b'.repeat(64) }))
  anexos.registrar(anexo())

  rotas = {
    assinaturaDisponivel: true,
    assinaturaEsgotada: false,
    rotaPagaConfigurada: true,
    optInDeRotaPaga: false
  }
  chamadasDeGeracao = 0
  chamadasDeAnalise = 0
  correcoesRecebidas = []
  ajustes = []
  prdVigente = prd([{ id: 'r-1', texto: 'Entrar com e-mail e senha.' }])
  validacoes = [{ prototipo: PROTOTIPO, achados: [], jornadasCobertas: [JORNADA] }]
  commitFunciona = true
  packDisponivel = true
  marcosConcluidos = 0
  respostas = [[doPrototipo()]]

  service = new ArquiteturaService({
    repository: repo,
    anexos,
    projects: projetos,
    projectService: {
      concluirMarco: () => {
        marcosConcluidos += 1
        return commitFunciona ? { commitado: true, commitHash: 'abc1234' } : { commitado: false }
      }
    } as never,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    prdVigente: () => prdVigente,
    pacoteEstruturalId: () => (prdVigente === undefined ? undefined : PACOTE_ESTRUTURAL),
    validarPrototipos: async () => validacoes,
    decisoesDoRefinamento: () => [],
    montarContexto: () => (packDisponivel ? 'pack-1' : undefined),
    estadoDasRotas: () => rotas,
    gerarDocumentos: async (entrada) => {
      chamadasDeGeracao += 1
      correcoesRecebidas.push(entrada.correcao)
      const saida = respostas.shift()
      return saida === undefined ? {} : { afirmacoes: saida }
    },
    analisarCoerencia: async () => {
      chamadasDeAnalise += 1
      return ajustes === undefined ? {} : { ajustes }
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

describe('o gate de anexos da M8-F05 continua fechado (critério 1)', () => {
  it('recusa quando falta o design system, sem chamar o modelo', async () => {
    db.prepare('DELETE FROM design_attachment WHERE tipo = ?').run('design-system')

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('anexos-pendentes')
    expect(r.pendencias).toContain('design-system')
    expect(chamadasDeGeracao).toBe(0)
    expect(revisoesNoBanco()).toBe(0)
  })

  it('recusa quando falta o protótipo, sem chamar o modelo', async () => {
    db.prepare('DELETE FROM design_attachment WHERE tipo = ?').run('prototipo')

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('anexos-pendentes')
    expect(r.pendencias).toContain('prototipo')
    expect(chamadasDeGeracao).toBe(0)
  })

  it('recusa sem PRD: a arquitetura precisa citar a revisão que assume (critério 3)', async () => {
    prdVigente = undefined

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('prd-ausente')
    expect(chamadasDeGeracao).toBe(0)
  })

  it('recusa quando um protótipo não carrega, com as perguntas', async () => {
    validacoes = [
      {
        prototipo: PROTOTIPO,
        achados: [
          {
            id: 'x',
            prototipo: PROTOTIPO,
            severidade: 'impede-arquitetura',
            pergunta: 'A tela abriu em branco. O protótipo está completo?',
            recomendacao: 'Reanexe o protótipo com o conteúdo renderizado.',
            evidencia: 'elementosVisiveis = 0'
          }
        ],
        jornadasCobertas: []
      }
    ]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('prototipos-invalidos')
    expect(r.achados).toHaveLength(1)
    expect(chamadasDeGeracao).toBe(0)
  })
})

describe('a rota é conferida antes de qualquer chamada (critério 7)', () => {
  it('bloqueia sem rota e não chama o modelo', async () => {
    rotas = {
      assinaturaDisponivel: false,
      assinaturaEsgotada: true,
      rotaPagaConfigurada: false,
      optInDeRotaPaga: false
    }

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('bloqueado-sem-rota')
    expect(chamadasDeGeracao).toBe(0)
    expect(eventos('bloqueado')).toBe(1)
  })

  it('recusa sem contexto montado', async () => {
    packDisponivel = false

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('sem-contexto')
    expect(chamadasDeGeracao).toBe(0)
  })
})

describe('fluxo sem âncora em protótipo não vira revisão (critério 2)', () => {
  it('recusa a saída, pede correção nomeando o problema e não grava', async () => {
    const inventado = doPrototipo({ origem: 'proposto', ancora: undefined })
    respostas = [[inventado], [inventado]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
    expect(pacotesNoBanco()).toBe(0)
    expect(chamadasDeGeracao).toBe(2)
    expect(correcoesRecebidas[1]?.join(' ')).toContain('fluxo')
  })

  it('aceita quando a correção devolve a âncora', async () => {
    respostas = [[doPrototipo({ origem: 'proposto', ancora: undefined })], [doPrototipo()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerada')
    expect(revisoesNoBanco()).toBe(1)
  })

  it('recusa âncora numa jornada que nenhum protótipo mostrou', async () => {
    const fantasma = doPrototipo({
      ancora: { anexo: PROTOTIPO, hash: HASH_PROTOTIPO, jornada: 'Exportar relatório' }
    })
    respostas = [[fantasma], [fantasma]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
  })
})

describe('a revisão gravada (critérios 3, 5 e 6)', () => {
  it('grava nas duas tabelas com o mesmo hash', async () => {
    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerada')
    expect(revisoesNoBanco()).toBe(1)
    expect(pacotesNoBanco()).toBe(1)

    const doPacote = anexos.listarArquiteturas(USER, PROJETO)[0]
    expect(doPacote?.hash).toBe(r.arquitetura?.hash)
  })

  it('cita a revisão do PRD que assume', async () => {
    const r = await service.gerar(PROJETO, WS)

    expect(r.arquitetura?.pacoteEstruturalId).toBe(PACOTE_ESTRUTURAL)
  })

  it('congela os hashes de todos os anexos', async () => {
    const r = await service.gerar(PROJETO, WS)

    expect(r.arquitetura?.anexos).toHaveLength(2)
    expect(r.arquitetura?.anexos.map((a) => a.hash)).toContain(HASH_PROTOTIPO)
  })

  it('escreve os quatro documentos no disco, com a marca de origem e o hash do protótipo', async () => {
    await service.gerar(PROJETO, WS)

    const arquitetura = readFileSync(join(projetoDir, 'docs/ARCHITECTURE.md'), 'utf8')
    expect(arquitetura).toContain('origem: prototipo')
    expect(arquitetura).toContain(HASH_PROTOTIPO.slice(0, 16))

    for (const arquivo of ['DECISIONS.md', 'TESTING.md', 'REVIEW.md']) {
      expect(readFileSync(join(projetoDir, 'docs', arquivo), 'utf8')).toContain('#')
    }
  })

  it('regerar conteúdo idêntico preserva a revisão em vez de estourar no UNIQUE', async () => {
    const primeira = await service.gerar(PROJETO, WS)
    respostas = [[doPrototipo()]]
    const segunda = await service.gerar(PROJETO, WS)

    expect(segunda.resultado).toBe('gerada')
    expect(segunda.arquitetura?.id).toBe(primeira.arquitetura?.id)
    expect(revisoesNoBanco()).toBe(1)
  })

  it('regerar com conteúdo diferente cria revisão nova; a anterior continua no banco', async () => {
    await service.gerar(PROJETO, WS)
    respostas = [[doPrototipo({ texto: 'O usuário entra na conta pela tela de login.' })]]
    await service.gerar(PROJETO, WS)

    expect(revisoesNoBanco()).toBe(2)
  })

  it('falha de commit não perde a revisão', async () => {
    commitFunciona = false

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerada')
    expect(revisoesNoBanco()).toBe(1)
    expect(r.mensagem).toContain('retomado')
  })
})

describe('a análise de coerência (critério 4)', () => {
  const AJUSTE: AjusteProposto = {
    id: 'j-1',
    tipo: 'tela-sem-requisito',
    jornada: JORNADA,
    observacao: 'A tela existe e nenhum requisito a pede.',
    recomendacao: 'Confirmar se o login entra nesta versão.'
  }

  it('grava os ajustes propostos junto da revisão', async () => {
    ajustes = [AJUSTE]

    const r = await service.gerar(PROJETO, WS)

    expect(r.arquitetura?.ajustes).toHaveLength(1)
    expect(r.arquitetura?.ajustes[0]?.tipo).toBe('tela-sem-requisito')
  })

  it('falha na análise não vira "nenhum ajuste"', async () => {
    ajustes = undefined
    respostas = [[doPrototipo()], [doPrototipo()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
    expect(chamadasDeAnalise).toBe(2)
  })

  it('descartar um ajuste não toca o anexo: o hash do protótipo continua o mesmo', async () => {
    ajustes = [AJUSTE]
    await service.gerar(PROJETO, WS)

    const depois = service.descartarAjuste(PROJETO, 'j-1', WS)

    expect(depois?.ajustes).toHaveLength(0)
    expect(anexos.listar(USER, PROJETO).find((a) => a.caminho === PROTOTIPO)?.hash).toBe(
      HASH_PROTOTIPO
    )
  })

  it('descartar grava revisão nova e não commita marco', async () => {
    ajustes = [AJUSTE]
    await service.gerar(PROJETO, WS)
    const marcosDepoisDaGeracao = marcosConcluidos

    service.descartarAjuste(PROJETO, 'j-1', WS)

    expect(revisoesNoBanco()).toBe(2)
    expect(marcosConcluidos).toBe(marcosDepoisDaGeracao)
  })
})

describe('o corte de proposto', () => {
  const PROPOSTO = doPrototipo({
    id: 'a-2',
    documento: 'DECISIONS',
    secao: 'Decisões estruturais',
    texto: 'Guardar o histórico numa tabela separada.',
    origem: 'proposto',
    ancora: undefined
  })

  it('grava revisão nova sem o proposto, preservando a anterior', async () => {
    respostas = [[doPrototipo(), PROPOSTO]]
    await service.gerar(PROJETO, WS)

    const depois = service.cortarProposto(PROJETO, 'a-2', WS)

    expect(depois?.afirmacoes).toHaveLength(1)
    expect(revisoesNoBanco()).toBe(2)
  })

  it('não corta afirmação ancorada no protótipo, mesmo com o id certo', async () => {
    respostas = [[doPrototipo(), PROPOSTO]]
    await service.gerar(PROJETO, WS)

    const depois = service.cortarProposto(PROJETO, 'a-1', WS)

    expect(depois?.afirmacoes).toHaveLength(2)
    expect(revisoesNoBanco()).toBe(1)
  })
})
