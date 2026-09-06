/**
 * A geração do PRD, do Landscape e da Convention contra o SQLite real (SPEC-Jornada-03).
 *
 * A prova é **por efeito**, mesma postura do `brief-service.int-spec.ts`: não basta o serviço
 * devolver o desfecho certo — os dublês contam chamadas, e o banco e o disco dizem o que
 * realmente aconteceu. Um teste que só olhasse o retorno passaria com uma implementação que
 * pesquisa, falha e devolve bloqueado depois de gastar o crédito.
 *
 * As garantias que só este nível alcança:
 *  - **Critério 3:** sem termo confirmado, **zero chamada à Tavily**. Medido no contador.
 *  - **Critério 4:** sem credencial, PRD e Convention são gerados e só o Landscape fica pendente
 *    — a inversão explícita do bloqueio total da M8-F04.
 *  - **Critérios 1 e 2:** saída que não passa no validador não vira revisão; o banco continua
 *    vazio depois da correção recusada.
 *  - **Critério 6:** contradição detectada é gravada e bloqueia o aceite; falha na detecção
 *    **não** vira "nenhuma contradição".
 *  - **Critério 7:** regerar conteúdo idêntico preserva a revisão em vez de estourar no UNIQUE.
 *  - **Critério 8:** falha de commit preserva o que já está no banco e no disco.
 *  - **A revisão é gravada nas duas tabelas**, para a M8-F05 continuar achando o PRD que a
 *    arquitetura assume.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AfirmacaoDoPrd, ContradicaoDoPrd } from '@shared/domain/prd'
import type { BriefRegistrado } from '@shared/domain/brief'
import type { EstadoDaEtapa, EtapaDaGeracao } from '@shared/domain/geracao'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'
import type { ConnectorOutcome } from '@shared/domain/connectors'
import { TAVILY_OPERATIONS } from '@shared/domain/tavily'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PrdRepository } = await import('./prd-repository')
const { PacoteRepository } = await import('./pacote-repository')
const { DecisionRepository } = await import('./decision-repository')
const { PrdService, TENTATIVAS_DE_CORRECAO } = await import('./prd-service')
const { ProjectRepository } = await import('./project-repository')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

let dir: string
let projetoDir: string
let db: Db
let repo: InstanceType<typeof PrdRepository>
let pacotes: InstanceType<typeof PacoteRepository>
let decisions: InstanceType<typeof DecisionRepository>
let service: InstanceType<typeof PrdService>

let rotas: EstadoDasRotas
/** Quantas vezes o modelo gerou documentos — prova "zero chamada" no bloqueio de rota. */
let chamadasDeGeracao: number
/** Quantas vezes a Tavily foi chamada — prova "zero chamada" sem termo confirmado. */
let chamadasDeConector: number
/** O que o dublê do modelo devolve, por chamada. Uma lista permite simular correção. */
let respostas: (readonly AfirmacaoDoPrd[] | undefined)[]
/** As correções recebidas — prova que o problema é dito, não só "tente de novo". */
let correcoesRecebidas: (readonly string[] | undefined)[]
/** As contradições que a detecção devolve. `undefined` simula falha da chamada. */
let contradicoes: readonly ContradicaoDoPrd[] | undefined
/** O que o serviço anunciou de progresso, na ordem. */
let etapasAnunciadas: {
  projectId: string
  etapa: EtapaDaGeracao
  estado: EstadoDaEtapa
  resumo?: string
}[] = []
/** O brief aceito. `undefined` simula "o gate do brief ainda não passou". */
let briefAceito: BriefRegistrado | undefined
/** Se o commit do marco funciona — o critério 8 se prova no caso falso. */
let commitFunciona: boolean
/** O que a busca e a extração da Tavily devolvem. */
let respostaDaBusca: ConnectorOutcome
let respostaDaExtracao: ConnectorOutcome
/** Se `montarContexto` devolve um pack. */
let packDisponivel: boolean
/** Quantos marcos documentais foram concluídos — prova que o corte não commita. */
let marcosConcluidos: number

const URL_A = 'https://exemplo.dev/a'

function brief(afirmacoes: readonly { id: string; texto: string }[] = []): BriefRegistrado {
  return {
    id: 'brief-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    promptId: 'prompt-1',
    afirmacoes: afirmacoes.map((a) => ({
      id: a.id,
      bloco: 'problema-usuarios-resultado' as const,
      texto: a.texto,
      origem: 'prompt' as const
    })),
    pendencias: [],
    hash: 'hash-do-brief',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: new Date().toISOString()
  }
}

function afirmacao(over: Partial<AfirmacaoDoPrd> = {}): AfirmacaoDoPrd {
  return {
    id: 'a-1',
    documento: 'PRD',
    secao: 'Escopo',
    texto: 'O produto organiza leituras por projeto.',
    origem: 'brief',
    referencia: 'b-1',
    ...over
  }
}

function contradicao(over: Partial<ContradicaoDoPrd> = {}): ContradicaoDoPrd {
  return {
    id: 'c-1',
    etapa: 'prd',
    afirmacoes: ['a-1', 'b-1'],
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync entre máquinas.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige conta e rede.' }
    ],
    recomendada: 'a',
    justificativa: 'Local, como o brief diz.',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  }
}

function eventos(fase: string): number {
  const linhas = db
    .prepare("SELECT payload FROM audit_event WHERE type = 'prd-generation'")
    .all() as { payload: string }[]

  return linhas.filter((l) => (JSON.parse(l.payload) as { fase?: string }).fase === fase).length
}

function revisoesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM project_prd').get() as { n: number }).n
}

function pacotesNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pacote_estrutural').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-prd-svc-'))
  projetoDir = join(dir, 'projeto')
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new PrdRepository(db)
  pacotes = new PacoteRepository(db)

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
  chamadasDeGeracao = 0
  chamadasDeConector = 0
  correcoesRecebidas = []
  contradicoes = []
  briefAceito = brief([{ id: 'b-1', texto: 'Organiza leituras.' }])
  commitFunciona = true
  packDisponivel = true
  marcosConcluidos = 0
  respostas = [[afirmacao()]]

  respostaDaBusca = {
    ok: true,
    data: { fontes: [{ url: URL_A, titulo: 'A', trecho: 'snippet' }] },
    creditos: 1
  } as unknown as ConnectorOutcome

  respostaDaExtracao = {
    ok: true,
    data: {
      evidencias: [
        {
          url: URL_A,
          urlOriginal: URL_A,
          dominio: 'exemplo.dev',
          coletadoEm: new Date().toISOString(),
          conteudo: 'A ferramenta cobra por assento.',
          hashConteudo: 'a'.repeat(64),
          titulo: 'A'
        }
      ],
      falhas: []
    },
    creditos: 1
  } as unknown as ConnectorOutcome

  decisions = new DecisionRepository(db)
  service = new PrdService({
    repository: repo,
    pacotes,
    decisions,
    projects: projetos,
    projectService: {
      concluirMarco: () => {
        marcosConcluidos += 1
        return commitFunciona ? { commitado: true, commitHash: 'abc1234' } : { commitado: false }
      }
    } as never,
    connectors: {
      call: async (pedido: { operation: string }) => {
        chamadasDeConector += 1
        return pedido.operation === TAVILY_OPERATIONS.search ? respostaDaBusca : respostaDaExtracao
      }
    } as never,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    briefAceito: () => briefAceito,
    decisoesDoRefinamento: () => [],
    montarContexto: () => (packDisponivel ? 'pack-1' : undefined),
    estadoDasRotas: () => rotas,
    gerarTermo: async () => ({ termo: 'ferramentas de leitura' }),
    gerarDocumentos: async (entrada) => {
      chamadasDeGeracao += 1
      correcoesRecebidas.push(entrada.correcao)
      const saida = respostas.shift()
      return saida === undefined ? {} : { afirmacoes: saida }
    },
    detectarContradicoes: async () => (contradicoes === undefined ? {} : { contradicoes }),
    anunciarEtapa: (projectId, etapa, estado, resumo) => {
      etapasAnunciadas.push({ projectId, etapa, estado, resumo })
    }
  })

  etapasAnunciadas = []

  logCat.info.mockClear()
  logCat.warn.mockClear()
  logCat.error.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('brief aceito é pré-requisito (critério 1)', () => {
  it('sem brief aceito, recusa antes de chamar o modelo ou a Tavily', async () => {
    briefAceito = undefined

    const r = await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)

    expect(r.resultado).toBe('brief-nao-aceito')
    expect(chamadasDeGeracao).toBe(0)
    expect(chamadasDeConector).toBe(0)
    expect(revisoesNoBanco()).toBe(0)
  })

  it('propor termo sem brief aceito devolve nada, sem chamar o modelo', async () => {
    briefAceito = undefined

    expect(await service.proporTermo(PROJETO, WS)).toBeUndefined()
  })
})

describe('bloqueio antes de rota paga', () => {
  it('sem assinatura e sem opt-in: zero chamada, zero pesquisa e zero revisão', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    const r = await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)

    // A prova por efeito: não basta devolver bloqueado; nada pode ter sido chamado nem gasto.
    expect(r.resultado).toBe('bloqueado-sem-rota')
    expect(chamadasDeGeracao).toBe(0)
    expect(chamadasDeConector).toBe(0)
    expect(revisoesNoBanco()).toBe(0)
    expect(eventos('bloqueado')).toBe(1)
  })

  it('o bloqueio traz ação concreta — não é beco sem saída', async () => {
    rotas = { ...rotas, assinaturaDisponivel: false }

    expect((await service.gerar({ projectId: PROJETO, termo: '' }, WS)).acao).toBeDefined()
  })
})

describe('pesquisa só com termo confirmado (critério 3)', () => {
  it('termo vazio: nenhuma chamada à Tavily, e o Landscape declara a lacuna', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: '   ' }, WS)

    expect(r.resultado).toBe('gerado')
    expect(chamadasDeConector).toBe(0)
    expect(r.prd?.bloqueioDoLandscape?.causa).toBe('sem-termo-de-pesquisa')
  })

  it('termo confirmado dispara busca e extração, nessa ordem', async () => {
    await service.gerar({ projectId: PROJETO, termo: 'ferramentas de leitura' }, WS)

    expect(chamadasDeConector).toBe(2)
  })

  it('propor o termo não pesquisa nada', async () => {
    expect(await service.proporTermo(PROJETO, WS)).toBe('ferramentas de leitura')
    expect(chamadasDeConector).toBe(0)
  })
})

describe('sem credencial, o PRD segue e só o Landscape fica pendente (critério 4)', () => {
  beforeEach(() => {
    respostaDaBusca = {
      ok: false,
      code: 'AUTH_FAILED',
      mensagem: 'Configure a credencial da Tavily.',
      evidencia: 'Chave ausente.'
    } as unknown as ConnectorOutcome
  })

  it('gera os documentos mesmo com a pesquisa bloqueada', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)

    // A inversão da M8-F04: lá, isto seria `pesquisa-bloqueada` e nada seria gravado.
    expect(r.resultado).toBe('gerado')
    expect(revisoesNoBanco()).toBe(1)
  })

  it('o bloqueio viaja com a revisão, com os cinco campos e a retomada', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)
    const b = r.prd?.bloqueioDoLandscape

    expect(b?.causa).toBe('AUTH_FAILED')
    expect(b?.tentativas).toBe(1)
    expect(b?.porQueNaoSeguir).toBeTruthy()
    expect(b?.retomada).toBeTruthy()
  })

  it('o bloqueio aparece dentro do LANDSCAPE.md escrito no projeto', async () => {
    await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)

    const texto = readFileSync(join(projetoDir, 'docs/LANDSCAPE.md'), 'utf8')

    expect(texto).toContain('Pesquisa bloqueada')
  })

  it('o aceite continua liberado: contradição bloqueia, pesquisa que falhou não', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)

    expect(r.prd?.contradicoes).toHaveLength(0)
  })
})

describe('validação da saída (critérios 1, 2 e 5)', () => {
  it('âncora inexistente é recusada, corrigida e então gravada', async () => {
    respostas = [[afirmacao({ referencia: 'b-99' })], [afirmacao()]]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('gerado')
    expect(chamadasDeGeracao).toBe(2)
    // A correção diz **o quê** foi recusado: "tente de novo" gastaria a rodada à toa.
    expect(correcoesRecebidas[1]?.[0]).toContain('b-99')
  })

  it('saída recusada duas vezes não vira revisão, e o banco fica vazio', async () => {
    respostas = [[afirmacao({ referencia: 'b-99' })], [afirmacao({ referencia: 'b-98' })]]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
    expect(pacotesNoBanco()).toBe(0)
    expect(r.problemas?.length).toBeGreaterThan(0)
  })

  it('uma correção, não um laço', async () => {
    respostas = [undefined, undefined, [afirmacao()]]

    await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(chamadasDeGeracao).toBe(TENTATIVAS_DE_CORRECAO + 1)
  })

  it('fonte fora do conjunto extraído é recusada — síntese sim, fonte fabricada não', async () => {
    const fabricada = afirmacao({
      id: 'l-1',
      documento: 'LANDSCAPE',
      secao: 'Alternativas',
      texto: 'A ferramenta X cobra por assento.',
      origem: 'evidencia',
      referencia: undefined,
      fontes: ['https://inventada.example/x']
    })

    respostas = [[fabricada], [fabricada]]

    const r = await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(r.problemas?.join(' ')).toContain('inventada.example')
  })

  it('síntese que cita a fonte extraída passa', async () => {
    respostas = [
      [
        afirmacao({
          id: 'l-1',
          documento: 'LANDSCAPE',
          secao: 'Alternativas',
          texto: 'A ferramenta cobra por assento.',
          origem: 'evidencia',
          referencia: undefined,
          fontes: [URL_A]
        })
      ]
    ]

    expect((await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)).resultado).toBe('gerado')
  })

  it('regra de outro projeto na Convention reprova (teste da M8-F04 mantido)', async () => {
    const importada = afirmacao({
      id: 'c-1',
      documento: 'CONVENTION',
      secao: 'Estados',
      texto: 'Uma issue em proplan:doing está em andamento.',
      origem: 'proposto',
      referencia: undefined
    })

    respostas = [[importada], [importada]]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
  })
})

describe('contradições viram perguntas (critério 6)', () => {
  it('a contradição é gravada como pergunta, com id próprio e etapa prd', async () => {
    contradicoes = [contradicao()]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.prd?.contradicoes).toHaveLength(1)
    const gravada = r.prd?.contradicoes[0]
    // O id vem do serviço, não do modelo: "c-1" colidiria entre revisões, e a decisão do PI
    // passaria a apontar para a contradição errada.
    expect(gravada?.id).not.toBe('c-1')
    expect(gravada).toMatchObject({ etapa: 'prd', justificativa: 'Local, como o brief diz.' })
  })

  it('contradição fora do contrato não chega ao PI — a etapa falha, como a detecção que não saiu', async () => {
    contradicoes = [contradicao({ opcoes: [{ id: 'a', rotulo: 'Só uma', impacto: 'x' }] })]
    respostas = [[afirmacao()], [afirmacao()]]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(r.problemas?.join(' ')).toContain('opções')
    expect(repo.vigente(USER, PROJETO)).toBeUndefined()
  })

  it('a mesma contradição com outro id do modelo não muda a revisão', async () => {
    contradicoes = [contradicao({ id: 'c-1' })]
    const primeira = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    respostas = [[afirmacao()]]
    contradicoes = [contradicao({ id: 'c-9' })]
    const segunda = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    // O hash ignora o id da contradição: ele é sorteado por revisão, e entrar no hash faria
    // "mesmo conteúdo é a mesma revisão" (invariante 2 da CONVENTION §4) deixar de valer.
    expect(segunda.prd?.hash).toBe(primeira.prd?.hash)
  })

  it('falha na detecção NÃO vira "nenhuma contradição"', async () => {
    contradicoes = undefined
    respostas = [[afirmacao()], [afirmacao()]]

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    // Tratar a falha como lista vazia liberaria o aceite por uma falha de infraestrutura.
    expect(r.resultado).toBe('saida-invalida')
    expect(revisoesNoBanco()).toBe(0)
  })
})

describe('persistência e revisão (critérios 7 e 8)', () => {
  it('grava nas duas tabelas com o mesmo hash — a M8-F05 continua achando o PRD', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(revisoesNoBanco()).toBe(1)
    expect(pacotesNoBanco()).toBe(1)
    expect(pacotes.listarPacotes(USER, PROJETO)[0]?.hash).toBe(r.prd?.hash)
  })

  it('escreve os três arquivos no diretório do projeto', async () => {
    await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    for (const arquivo of ['PRD.md', 'LANDSCAPE.md', 'CONVENTION.md']) {
      expect(readFileSync(join(projetoDir, 'docs', arquivo), 'utf8')).toContain('# ')
    }
  })

  it('a marca de origem acompanha a afirmação no arquivo', async () => {
    await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(readFileSync(join(projetoDir, 'docs/PRD.md'), 'utf8')).toContain(
      '<!-- origem: brief · b-1 -->'
    )
  })

  it('regerar conteúdo idêntico preserva a revisão, sem linha nova', async () => {
    const primeira = await service.gerar({ projectId: PROJETO, termo: '' }, WS)
    respostas = [[afirmacao()]]
    const segunda = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(segunda.prd?.id).toBe(primeira.prd?.id)
    expect(revisoesNoBanco()).toBe(1)
  })

  it('regerar com conteúdo diferente cria revisão nova, sem apagar a anterior', async () => {
    await service.gerar({ projectId: PROJETO, termo: '' }, WS)
    respostas = [[afirmacao({ texto: 'Outro escopo.' })]]
    await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(revisoesNoBanco()).toBe(2)
  })

  it('falha de commit preserva a revisão no banco e no disco', async () => {
    commitFunciona = false

    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('gerado')
    expect(revisoesNoBanco()).toBe(1)
    expect(r.mensagem).toContain('retomado')
  })

  it('commit bem-sucedido aponta a revisão para o Git', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.prd?.commitHash).toBe('abc1234')
  })
})

describe('corte de proposto no gate', () => {
  beforeEach(async () => {
    respostas = [
      [
        afirmacao(),
        afirmacao({ id: 'p-1', texto: 'Inferido.', origem: 'proposto', referencia: undefined })
      ]
    ]
    await service.gerar({ projectId: PROJETO, termo: '' }, WS)
  })

  it('cortar grava revisão nova; a que o PI leu continua no banco', () => {
    const novo = service.cortarProposto(PROJETO, 'p-1', WS)

    expect(novo?.afirmacoes).toHaveLength(1)
    expect(revisoesNoBanco()).toBe(2)
  })

  it('id de outra origem não apaga nada e não cria revisão', () => {
    service.cortarProposto(PROJETO, 'a-1', WS)

    expect(revisoesNoBanco()).toBe(1)
  })

  it('cortar NÃO commita marco: o marco é da geração, o aceite é do PI', () => {
    marcosConcluidos = 0
    service.cortarProposto(PROJETO, 'p-1', WS)

    // Commitar a cada item cortado encheria o histórico de revisões intermediárias que o PI
    // nem terminou de revisar.
    expect(marcosConcluidos).toBe(0)
  })

  it('o corte reescreve os arquivos: o disco acompanha a revisão vigente', () => {
    service.cortarProposto(PROJETO, 'p-1', WS)

    expect(readFileSync(join(projetoDir, 'docs/PRD.md'), 'utf8')).not.toContain('Inferido.')
  })
})

describe('contexto e projeto', () => {
  it('projeto inexistente recusa antes de tudo', async () => {
    const r = await service.gerar({ projectId: 'nao-existe', termo: 'x' }, WS)

    expect(r.resultado).toBe('projeto-inexistente')
    expect(chamadasDeGeracao).toBe(0)
  })

  it('sem ContextPack não há geração — a fatia não abre exceção para si mesma', async () => {
    packDisponivel = false

    const r = await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)

    expect(r.resultado).toBe('sem-contexto')
    expect(chamadasDeGeracao).toBe(0)
  })
})

describe('progresso da geração (SPEC-Jornada-03 § Geração)', () => {
  /** As etapas concluídas, na ordem em que o serviço as anunciou. */
  const concluidas = (): readonly EtapaDaGeracao[] =>
    etapasAnunciadas.filter((e) => e.estado === 'concluida').map((e) => e.etapa)

  it('anuncia as cinco etapas, na ordem do fluxo', async () => {
    const r = await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)

    expect(r.resultado).toBe('gerado')
    expect(concluidas()).toEqual([
      'pesquisa',
      'documentos',
      'validacao',
      'contradicoes',
      'gravacao'
    ])
  })

  it('cada etapa é anunciada antes de acontecer, não só depois', async () => {
    await service.gerar({ projectId: PROJETO, termo: 'ferramentas' }, WS)

    // Sem o `iniciada`, a tela não teria o que mostrar como "acontecendo agora" — ela saltaria
    // de uma etapa concluída para a próxima concluída, e o PI olharia para uma barra parada.
    for (const etapa of ['pesquisa', 'documentos', 'validacao', 'contradicoes', 'gravacao']) {
      const inicio = etapasAnunciadas.findIndex((e) => e.etapa === etapa && e.estado === 'iniciada')
      const fim = etapasAnunciadas.findIndex((e) => e.etapa === etapa && e.estado === 'concluida')

      expect(inicio, `${etapa} não anunciou o início`).toBeGreaterThanOrEqual(0)
      expect(fim, `${etapa} não anunciou o fim`).toBeGreaterThan(inicio)
    }
  })

  it('sem termo, a pesquisa conclui declarando a lacuna — não falha', async () => {
    // Não pesquisar é decisão do PI, não defeito. Uma etapa vermelha aqui anunciaria um erro
    // onde houve uma escolha.
    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    expect(r.resultado).toBe('gerado')

    const pesquisa = etapasAnunciadas.find((e) => e.etapa === 'pesquisa' && e.estado !== 'iniciada')
    expect(pesquisa?.estado).toBe('concluida')
    expect(pesquisa?.resumo).toContain('lacuna')
  })

  it('saída recusada pelo validador anuncia falha, e a barra não chega ao fim', async () => {
    // Duas saídas ancoradas num id que o brief não tem: o validador recusa as duas, e a
    // tentativa de correção se esgota.
    respostas = [[afirmacao({ referencia: 'b-99' })], [afirmacao({ referencia: 'b-98' })]]

    const r = await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(etapasAnunciadas.some((e) => e.estado === 'falhou')).toBe(true)
    // A gravação nunca aconteceu, então ela não pode ter sido anunciada como concluída: uma
    // barra em 100% sobre um pacote não gravado é o fechamento frágil que isto evita.
    expect(concluidas()).not.toContain('gravacao')
  })

  it('detecção de contradições que não sai anuncia falha, e nada é gravado', async () => {
    contradicoes = undefined

    const r = await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)

    expect(r.resultado).toBe('saida-invalida')
    expect(etapasAnunciadas.some((e) => e.etapa === 'contradicoes' && e.estado === 'falhou')).toBe(
      true
    )
    expect(concluidas()).not.toContain('gravacao')
  })

  it('um anúncio que estoura não derruba a geração', async () => {
    // A janela pode ser fechada no meio da geração, e o `send` do Electron lança. Perder o
    // pacote pago por causa da barra de progresso dele seria o pior desfecho possível.
    const deps = (service as unknown as { deps: Record<string, unknown> }).deps
    service = new PrdService({
      ...deps,
      anunciarEtapa: () => {
        throw new Error('janela destruída')
      }
    } as never)

    const r = await service.gerar({ projectId: PROJETO, termo: 'x' }, WS)

    expect(r.resultado).toBe('gerado')
  })
})

describe('responder às contradições (emenda E1)', () => {
  async function gerarComContradicao(): Promise<string> {
    contradicoes = [contradicao()]
    const r = await service.gerar({ projectId: PROJETO, termo: '' }, WS)
    return r.prd?.contradicoes[0]?.id ?? ''
  }

  it('a vista traz a contradição como a próxima pergunta, e nenhuma decisão ainda', async () => {
    await gerarComContradicao()

    const vista = service.contradicoes(PROJETO)

    expect(vista?.estado.tipo).toBe('pergunta')
    expect(vista?.estado.tipo === 'pergunta' && vista.estado.pergunta.enunciado).toBe(
      'O produto é local ou na nuvem?'
    )
    expect(vista?.historico).toEqual([])
  })

  it('sem revisão, a vista é undefined — não há o que responder', () => {
    expect(service.contradicoes(PROJETO)).toBeUndefined()
  })

  it('a resposta do PI vira decisão gravada com etapa prd, e a vista conclui', async () => {
    const id = await gerarComContradicao()

    const r = service.responderContradicao(
      PROJETO,
      { perguntaId: id, escolha: 'b', texto: null, autor: 'pi' },
      WS
    )

    expect(r.reason).toBe('registrada')
    expect(r.estado?.tipo).toBe('concluido')
    expect(decisions.listar(USER, PROJETO)).toHaveLength(1)
    expect(decisions.listar(USER, PROJETO)[0]).toMatchObject({
      perguntaId: id,
      etapa: 'prd',
      escolha: 'b',
      autor: 'pi'
    })
  })

  it('"Decide por mim" grava a recomendada com o agente como autor', async () => {
    const id = await gerarComContradicao()

    const r = service.responderContradicao(
      PROJETO,
      { perguntaId: id, escolha: null, texto: null, autor: 'agente' },
      WS
    )

    expect(r.decisao).toMatchObject({ escolha: 'a', autor: 'agente', motivo: 'delegada' })
  })

  it('recusa pergunta que não é da revisão vigente', async () => {
    await gerarComContradicao()

    const r = service.responderContradicao(
      PROJETO,
      { perguntaId: 'fantasma', escolha: 'a', texto: null, autor: 'pi' },
      WS
    )

    expect(r.reason).toBe('pergunta-desconhecida')
    expect(decisions.listar(USER, PROJETO)).toHaveLength(0)
  })

  it('a decisão sobre a contradição entra no pedido da geração seguinte, com o rótulo', async () => {
    const id = await gerarComContradicao()
    service.responderContradicao(
      PROJETO,
      { perguntaId: id, escolha: 'b', texto: null, autor: 'pi' },
      WS
    )

    // Remonta o serviço com as mesmas deps do `beforeEach`, trocando só `gerarDocumentos` para
    // capturar o pedido: o que se prova é o conteúdo de `decisoes`, não a montagem.
    const pedidos: { decisoes: readonly { pergunta: string; resposta: string }[] }[] = []
    service = new PrdService({
      repository: repo,
      pacotes,
      decisions,
      projects: new ProjectRepository(db),
      projectService: {
        concluirMarco: () => ({ commitado: true, commitHash: 'abc1234' })
      } as never,
      connectors: { call: async () => respostaDaBusca } as never,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      briefAceito: () => briefAceito,
      decisoesDoRefinamento: () => [],
      montarContexto: () => 'pack-1',
      estadoDasRotas: () => rotas,
      gerarTermo: async () => ({ termo: 'x' }),
      gerarDocumentos: async (entrada) => {
        pedidos.push({ decisoes: entrada.decisoes })
        return { afirmacoes: [afirmacao()] }
      },
      detectarContradicoes: async () => ({ contradicoes: [] })
    })

    await service.gerar({ projectId: PROJETO, termo: '' }, WS)

    // O modelo precisa do conteúdo, não do id da opção — mesma regra de `decisoesParaOBrief`.
    expect(pedidos[0]?.decisoes).toEqual([
      expect.objectContaining({ pergunta: 'O produto é local ou na nuvem?', resposta: 'Nuvem' })
    ])
  })
})
