/**
 * A geração do roadmap contra o SQLite real (SPEC-Jornada-05).
 *
 * A prova é **por efeito**, mesma postura do `arquitetura-service.int-spec.ts`: não basta o
 * serviço devolver o desfecho certo — os dublês contam chamadas, e o banco e o disco dizem o que
 * realmente aconteceu. Um teste que só olhasse o retorno passaria com uma implementação que chama
 * o modelo antes de conferir a rota e gasta a chamada que a recusa existia para evitar.
 *
 * As garantias que só este nível alcança:
 *  - **Critério 1:** DAG com ciclo **não é gravado**; a IA recebe o diagnóstico e regenera, e o
 *    banco continua vazio quando ela não acerta.
 *  - **Critério 2:** MVP e fatia sem origem válida não viram revisão; `proposto` é listado.
 *  - **Critério 3:** o `MVP_ENTRY` oferece **só os elegíveis**, e a escolha do PI é gravada.
 *  - **Critério 4:** a SPEC nasce com pergunta aberta, e o gate `SLICE_ENTRY` fica sem revisões
 *    enquanto houver pergunta sem resposta.
 *  - **Critério 5:** o `STATUS.md` gerado é a fonte única do índice Fatia ↔ SPEC — medido no
 *    disco, não no retorno.
 *  - **Critério 6:** regerar depois do `MVP_ENTRY` preserva o MVP aceito e suas fatias, mesmo
 *    quando o modelo o reescreve ou o omite.
 *  - **Critério 7:** a entrada que o MVP-009 consome (`mvp`/`slice` + `STATUS.md`) sai da mesma
 *    gravação, sem adaptação manual.
 *  - **Rota:** bloqueada ⇒ zero chamada ao modelo.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AfirmacaoDaArquitetura } from '@shared/domain/arquitetura-gerada'
import type { PrdRegistrado } from '@shared/domain/prd'
import type { MvpGerado, SpecGerada } from '@shared/domain/roadmap-gerado'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { RoadmapRepository } = await import('./roadmap-repository')
const { RoadmapGeradoRepository } = await import('./roadmap-gerado-repository')
const { RoadmapGeradoService } = await import('./roadmap-gerado-service')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const
const PACOTE_ESTRUTURAL = 'pac-1'
const ARQUITETURA = 'arq-rev-1'

let dir: string
let projetoDir: string
let db: Db
let repo: InstanceType<typeof RoadmapGeradoRepository>
let projecao: InstanceType<typeof RoadmapRepository>
let service: InstanceType<typeof RoadmapGeradoService>

let rotas: EstadoDasRotas
/** Quantas vezes o modelo propôs MVPs — prova "zero chamada" nas recusas anteriores. */
let chamadasDoRoadmap: number
/** Quantas vezes a SPEC foi pedida. */
let chamadasDaSpec: number
/** O que o dublê devolve, por chamada. Uma lista permite simular a correção. */
let respostas: (readonly MvpGerado[] | undefined)[]
/** As SPECs que o dublê devolve, por chamada. */
let specs: (SpecGerada | undefined)[]
/** As correções recebidas — prova que o problema é dito, não só "tente de novo". */
let correcoes: (readonly string[] | undefined)[]
/** Os MVPs apresentados como já decididos — prova o critério 6 no pedido. */
let congeladosRecebidos: (readonly { readonly id: string; readonly titulo: string }[])[]
let prdVigente: PrdRegistrado | undefined
let arquiteturaVigente:
  { readonly id: string; readonly afirmacoes: readonly AfirmacaoDaArquitetura[] } | undefined
let commitFunciona: boolean
let packDisponivel: boolean
let marcosConcluidos: number

function prd(): PrdRegistrado {
  return {
    id: 'prd-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    briefHash: 'hash-do-brief',
    afirmacoes: [
      {
        id: 'r-1',
        documento: 'PRD',
        secao: 'Escopo',
        texto: 'Cadastrar cliente.',
        origem: 'brief',
        referencia: 'b-1'
      }
    ],
    contradicoes: [],
    hash: 'hash-do-prd',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: new Date().toISOString()
  }
}

function arquitetura(): {
  readonly id: string
  readonly afirmacoes: readonly AfirmacaoDaArquitetura[]
} {
  return {
    id: ARQUITETURA,
    afirmacoes: [
      {
        id: 'arq-1',
        documento: 'ARCHITECTURE',
        secao: 'Módulos e fronteiras',
        texto: 'Um módulo de clientes.',
        origem: 'proposto'
      }
    ]
  }
}

function mvp(over: Partial<MvpGerado> = {}): MvpGerado {
  return {
    id: 'mvp-1',
    numero: 1,
    titulo: 'Cadastro',
    tese: 'Cadastrar clientes.',
    resultado: 'Um cliente cadastrado aparece na lista.',
    dependeDe: [],
    origem: 'prd',
    referencia: 'r-1',
    fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'prd', referencia: 'r-1' }],
    ...over
  }
}

function segundoMvp(over: Partial<MvpGerado> = {}): MvpGerado {
  return mvp({
    id: 'mvp-2',
    numero: 2,
    titulo: 'Relatórios',
    tese: 'Exportar o cadastrado.',
    resultado: 'O relatório do mês é baixado.',
    dependeDe: ['mvp-1'],
    origem: 'arquitetura',
    referencia: 'arq-1',
    fatias: [
      { id: 'f-2', numero: 1, titulo: 'Exportar CSV', origem: 'arquitetura', referencia: 'arq-1' }
    ],
    ...over
  })
}

function spec(over: Partial<SpecGerada> = {}): SpecGerada {
  return {
    fatiaId: 'f-1',
    titulo: 'Formulário',
    objetivo: 'Cadastrar um cliente.',
    fluxo: ['Abrir', 'Salvar'],
    regras: ['Nome obrigatório'],
    criteriosDeAceite: ['Salvar sem nome mostra erro'],
    testes: ['Unitário da validação'],
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

function eventos(fase: string): number {
  const linhas = db
    .prepare("SELECT payload FROM audit_event WHERE type = 'roadmap-generation'")
    .all() as { payload: string }[]

  return linhas.filter((l) => (JSON.parse(l.payload) as { fase?: string }).fase === fase).length
}

function revisoesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM project_roadmap').get() as { n: number }).n
}

function mvpsNaProjecao(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM mvp').get() as { n: number }).n
}

function lerDoProjeto(caminho: string): string {
  return readFileSync(join(projetoDir, caminho), 'utf8')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-roadmap-svc-'))
  projetoDir = join(dir, 'projeto')
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new RoadmapGeradoRepository(db)
  projecao = new RoadmapRepository(db)

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

  rotas = {
    assinaturaDisponivel: true,
    assinaturaEsgotada: false,
    rotaPagaConfigurada: true,
    optInDeRotaPaga: false
  }
  chamadasDoRoadmap = 0
  chamadasDaSpec = 0
  correcoes = []
  congeladosRecebidos = []
  respostas = [[mvp(), segundoMvp()]]
  specs = [spec()]
  prdVigente = prd()
  arquiteturaVigente = arquitetura()
  commitFunciona = true
  packDisponivel = true
  marcosConcluidos = 0

  service = new RoadmapGeradoService({
    repository: repo,
    projecao,
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
    arquiteturaVigente: () => arquiteturaVigente,
    montarContexto: () => (packDisponivel ? 'pack-1' : undefined),
    estadoDasRotas: () => rotas,
    gerarMvps: async (entrada) => {
      chamadasDoRoadmap += 1
      correcoes.push(entrada.correcao)
      congeladosRecebidos.push(entrada.congelados)
      const saida = respostas.shift()
      return saida === undefined ? {} : { mvps: saida }
    },
    gerarSpec: async (entrada) => {
      chamadasDaSpec += 1
      correcoes.push(entrada.correcao)
      const saida = specs.shift()
      return saida === undefined ? {} : { spec: saida }
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

describe('as guardas anteriores à chamada', () => {
  it('projeto inexistente recusa sem chamar o modelo', async () => {
    const r = await service.gerar('p-fantasma', WS)

    expect(r.resultado).toBe('projeto-inexistente')
    expect(chamadasDoRoadmap).toBe(0)
  })

  it('sem PRD recusa: o roadmap cita a revisão que assume', async () => {
    prdVigente = undefined

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('pacote-ausente')
    expect(chamadasDoRoadmap).toBe(0)
  })

  it('sem arquitetura recusa pelo mesmo motivo', async () => {
    arquiteturaVigente = undefined

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('pacote-ausente')
    expect(chamadasDoRoadmap).toBe(0)
  })

  it('rota bloqueada ⇒ zero chamada, e o bloqueio é auditado', async () => {
    rotas = {
      assinaturaDisponivel: false,
      assinaturaEsgotada: true,
      rotaPagaConfigurada: false,
      optInDeRotaPaga: false
    }

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('bloqueado-sem-rota')
    expect(chamadasDoRoadmap).toBe(0)
    expect(revisoesNoBanco()).toBe(0)
    expect(eventos('bloqueado')).toBe(1)
  })

  it('sem ContextPack recusa antes da chamada', async () => {
    packDisponivel = false

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('sem-contexto')
    expect(chamadasDoRoadmap).toBe(0)
    expect(eventos('sem-contexto')).toBe(1)
  })
})

describe('o validador de DAG é a autoridade sobre o grafo (critério 1)', () => {
  it('ciclo não vira revisão, e a correção nomeia os MVPs envolvidos', async () => {
    const a = mvp({ dependeDe: ['mvp-2'] })
    const b = segundoMvp({ dependeDe: ['mvp-1'] })
    respostas = [
      [a, b],
      [a, b],
      [a, b]
    ]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
    expect(mvpsNaProjecao()).toBe(0)
    expect(r.problemas?.some((p) => p.includes('Ciclo de dependência'))).toBe(true)
  })

  it('regenera com o diagnóstico e grava quando a segunda saída é válida', async () => {
    respostas = [[mvp({ dependeDe: ['mvp-1'] })], [mvp(), segundoMvp()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(chamadasDoRoadmap).toBe(2)
    // A segunda chamada recebe o problema, não um "tente de novo".
    expect(correcoes[1]?.some((c) => c.includes('depende de si mesmo'))).toBe(true)
    expect(revisoesNoBanco()).toBe(1)
  })

  it('dependência ausente também reprova antes de gravar', async () => {
    const solto = mvp({ dependeDe: ['mvp-fantasma'] })
    respostas = [[solto], [solto], [solto]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
    expect(eventos('desistiu')).toBe(1)
  })

  it('MVP com origem inventada não vira revisão (critério 2)', async () => {
    const inventado = mvp({ origem: 'prd', referencia: 'r-99' })
    respostas = [[inventado], [inventado], [inventado]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(r.problemas?.some((p) => p.includes('r-99'))).toBe(true)
    expect(revisoesNoBanco()).toBe(0)
  })

  it('chamada sem saída conta como problema e é corrigida', async () => {
    respostas = [undefined, [mvp()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(correcoes[1]?.[0]).toContain('não devolveu saída')
  })
})

describe('o que a geração grava (critérios 5 e 7)', () => {
  it('grava a revisão com as duas procedências e nenhum MVP escolhido', async () => {
    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(r.roadmap?.pacoteEstruturalId).toBe(PACOTE_ESTRUTURAL)
    expect(r.roadmap?.arquiteturaId).toBe(ARQUITETURA)
    // A geração não escolhe: o `MVP_ENTRY` é ato do PI.
    expect(r.roadmap?.mvpEscolhido).toBeNull()
  })

  it('grava a projeção que o MVP-009 lê, na mesma operação', async () => {
    await service.gerar(PROJETO, WS)

    const projetado = projecao.carregar({ userId: USER, workspaceId: WS, projectId: PROJETO })

    expect(projetado.mvps.map((m) => m.id)).toEqual(['mvp-1', 'mvp-2'])
    expect(projetado.slices.map((s) => s.id)).toEqual(['f-1', 'f-2'])
    // Todos nascem `proposto`: promover é o gate.
    expect(projetado.mvps.every((m) => m.estado === 'proposto')).toBe(true)
  })

  it('escreve o STATUS como fonte única do índice Fatia ↔ SPEC', async () => {
    await service.gerar(PROJETO, WS)

    const status = lerDoProjeto('docs/STATUS.md')

    expect(status).toContain('Índice Fatia ↔ SPEC')
    expect(status).toContain('Fonte única do par')
    expect(status).toContain('Formulário')
    expect(status).toContain('Exportar CSV')
  })

  it('escreve um documento por MVP, com o checklist das fatias', async () => {
    await service.gerar(PROJETO, WS)

    const doc = lerDoProjeto('docs/mvp/mvp-01-cadastro.md')

    expect(doc).toContain('## Tese')
    expect(doc).toContain('## Resultado')
    expect(doc).toContain('- [ ] Formulário')
  })

  it('não escreve SPEC antes do MVP_ENTRY: nenhuma fatia foi escolhida', async () => {
    await service.gerar(PROJETO, WS)

    const projetado = projecao.carregar({ userId: USER, workspaceId: WS, projectId: PROJETO })
    expect(projetado.slices.every((s) => !s.detalhada)).toBe(true)
    expect(chamadasDaSpec).toBe(0)
  })

  it('commita o marco e aponta a revisão para o commit', async () => {
    const r = await service.gerar(PROJETO, WS)

    expect(marcosConcluidos).toBe(1)
    expect(r.roadmap?.commitHash).toBe('abc1234')
  })

  it('falha de commit não perde a revisão', async () => {
    commitFunciona = false

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(revisoesNoBanco()).toBe(1)
    expect(r.mensagem).toContain('commit do marco falhou')
  })

  it('regerar conteúdo idêntico preserva a revisão em vez de estourar no UNIQUE', async () => {
    await service.gerar(PROJETO, WS)
    respostas = [[mvp(), segundoMvp()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.resultado).toBe('gerado')
    expect(revisoesNoBanco()).toBe(1)
    expect(r.mensagem).toContain('idêntico')
  })
})

describe('o MVP_ENTRY: só os elegíveis, e a escolha é do PI (critério 3)', () => {
  beforeEach(async () => {
    await service.gerar(PROJETO, WS)
  })

  it('oferece só o MVP sem dependência pendente', () => {
    expect(service.elegiveis(PROJETO).map((m) => m.id)).toEqual(['mvp-1'])
  })

  it('recusa escolher um MVP bloqueado, sem chamar o modelo', async () => {
    const r = await service.escolherMvp(PROJETO, 'mvp-2', WS)

    expect(r.resultado).toBe('mvp-inelegivel')
    expect(chamadasDaSpec).toBe(0)
  })

  it('recusa um id que não existe', async () => {
    const r = await service.escolherMvp(PROJETO, 'mvp-fantasma', WS)

    expect(r.resultado).toBe('mvp-inelegivel')
    expect(chamadasDaSpec).toBe(0)
  })

  it('grava a escolha, gera a SPEC e promove o MVP na projeção', async () => {
    const r = await service.escolherMvp(PROJETO, 'mvp-1', WS)

    expect(r.resultado).toBe('gerado')
    expect(r.roadmap?.mvpEscolhido).toBe('mvp-1')
    expect(chamadasDaSpec).toBe(1)

    const projetado = projecao.carregar({ userId: USER, workspaceId: WS, projectId: PROJETO })
    expect(projetado.mvps.find((m) => m.id === 'mvp-1')?.estado).toBe('na-fila')
  })

  it('a SPEC é da primeira fatia do MVP escolhido, e escreve no disco', async () => {
    await service.escolherMvp(PROJETO, 'mvp-1', WS)

    const projetado = projecao.carregar({ userId: USER, workspaceId: WS, projectId: PROJETO })
    const detalhada = projetado.slices.find((s) => s.detalhada)

    expect(detalhada?.id).toBe('f-1')
    expect(lerDoProjeto(detalhada?.specSlug ?? '')).toContain('**rascunho**')
  })

  it('SPEC sem pergunta aberta é recusada e não vira revisão (critério 4)', async () => {
    const semPergunta = spec({ perguntas: [] })
    specs = [semPergunta, semPergunta, semPergunta]

    const antes = revisoesNoBanco()
    const r = await service.escolherMvp(PROJETO, 'mvp-1', WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(r.problemas?.some((p) => p.includes('pergunta aberta'))).toBe(true)
    expect(revisoesNoBanco()).toBe(antes)
  })

  it('SPEC recusada é regerada com o diagnóstico', async () => {
    specs = [spec({ criteriosDeAceite: [] }), spec()]

    const r = await service.escolherMvp(PROJETO, 'mvp-1', WS)

    expect(r.resultado).toBe('gerado')
    expect(chamadasDaSpec).toBe(2)
  })
})

describe('as perguntas abertas da SPEC (critério 4)', () => {
  beforeEach(async () => {
    await service.gerar(PROJETO, WS)
    await service.escolherMvp(PROJETO, 'mvp-1', WS)
  })

  it('a SPEC gravada nasce com a pergunta sem resposta', () => {
    expect(service.carregar(PROJETO)?.spec?.perguntas[0]?.resposta).toBeUndefined()
  })

  it('responder grava revisão nova sem editar a anterior', () => {
    const antes = revisoesNoBanco()
    const anterior = service.carregar(PROJETO)

    const r = service.responderPergunta(PROJETO, 'p-1', 'a', WS)

    expect(r.resultado).toBe('gerado')
    expect(revisoesNoBanco()).toBe(antes + 1)
    expect(
      repo.findByHash(USER, anterior?.hash ?? '')?.spec?.perguntas[0]?.resposta
    ).toBeUndefined()
  })

  it('a resposta chega ao arquivo da SPEC no disco', () => {
    service.responderPergunta(PROJETO, 'p-1', 'a', WS)

    const projetado = projecao.carregar({ userId: USER, workspaceId: WS, projectId: PROJETO })
    const detalhada = projetado.slices.find((s) => s.detalhada)

    expect(lerDoProjeto(detalhada?.specSlug ?? '')).toContain('**Resposta:** Sim')
  })

  it('responder não commita marco: é passo dentro da etapa', () => {
    const antes = marcosConcluidos
    service.responderPergunta(PROJETO, 'p-1', 'a', WS)

    expect(marcosConcluidos).toBe(antes)
  })

  it('pergunta desconhecida não grava revisão nova', () => {
    const antes = revisoesNoBanco()
    const r = service.responderPergunta(PROJETO, 'p-99', 'a', WS)

    expect(r.mensagem).toContain('Nada mudou')
    expect(revisoesNoBanco()).toBe(antes)
  })

  it('sem SPEC não há pergunta a responder', () => {
    const outro = new RoadmapGeradoRepository(db)
    db.prepare('UPDATE project_roadmap SET spec = NULL').run()

    const r = service.responderPergunta(PROJETO, 'p-1', 'a', WS)

    expect(r.resultado).toBe('mvp-nao-escolhido')
    expect(outro.vigente(USER, PROJETO)?.spec).toBeUndefined()
  })
})

describe('regenerar depois do MVP_ENTRY preserva o aceito (critério 6)', () => {
  beforeEach(async () => {
    await service.gerar(PROJETO, WS)
    await service.escolherMvp(PROJETO, 'mvp-1', WS)
  })

  it('apresenta o MVP aceito ao modelo como já decidido', async () => {
    respostas = [[mvp(), segundoMvp()]]
    congeladosRecebidos = []

    await service.gerar(PROJETO, WS)

    expect(congeladosRecebidos[0]).toEqual([{ id: 'mvp-1', titulo: 'Cadastro' }])
  })

  it('o modelo reescrevendo a tese do MVP aceito não muda o que o PI aceitou', async () => {
    const reescrito = mvp({ tese: 'Outra coisa completamente diferente.' })
    respostas = [[reescrito, segundoMvp()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.roadmap?.mvps.find((m) => m.id === 'mvp-1')?.tese).toBe('Cadastrar clientes.')
  })

  it('o modelo omitindo o MVP aceito não o remove do roadmap', async () => {
    respostas = [[segundoMvp({ dependeDe: [] })]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.roadmap?.mvps.map((m) => m.id)).toContain('mvp-1')
  })

  it('a escolha sobrevive à regeneração', async () => {
    respostas = [[mvp(), segundoMvp()]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.roadmap?.mvpEscolhido).toBe('mvp-1')
  })

  it('as fatias do MVP aceito sobrevivem à regeneração', async () => {
    respostas = [[mvp({ fatias: [{ id: 'f-9', numero: 1, titulo: 'Outra', origem: 'proposto' }] })]]

    const r = await service.gerar(PROJETO, WS)

    expect(r.roadmap?.mvps.find((m) => m.id === 'mvp-1')?.fatias.map((f) => f.id)).toEqual(['f-1'])
  })
})
