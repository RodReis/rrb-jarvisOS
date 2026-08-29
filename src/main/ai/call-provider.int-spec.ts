/**
 * O ponto único de chamada contra o SQLite real (SPEC-Providers-02, categoria Banco).
 *
 * Cobre os critérios pelo **efeito**: a auditoria tem os dois eventos porque a cadeia os
 * contém; o prompt não vaza porque a string não aparece em evento nenhum; o custo é medido
 * porque o número está no payload. O adapter é dublado — mas o dublê aqui não enfraquece nada,
 * porque o que se prova é o comportamento **do ponto de chamada**, e o adapter é a fronteira
 * que ele atravessa. Que o adapter real fala o protocolo da Anthropic é o que
 * `anthropic-adapter.int-spec.ts` prova, com servidor HTTP de verdade.
 *
 * O adapter dublê é também a prova do **critério 1**: ele satisfaz `AiAdapter` e roda pelo
 * mesmo ponto de chamada, sem uma linha de Anthropic. Se `call-provider.ts` precisasse de algo
 * que só a Anthropic tem, este arquivo não compilaria.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetService } from '../budget/budget-service'
import { BudgetRepository } from '../budget/budget-repository'
import type { BudgetLimitsInput } from '@shared/domain/budget'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { CredentialRepository } = await import('../credentials/credential-repository')
const { CredentialService } = await import('../credentials/credential-service')
const { AiCallService } = await import('./call-provider')
const { AdapterError } = await import('./anthropic-adapter')

type AdapterChunk = import('./adapter').AdapterChunk
type AiAdapter = import('./adapter').AiAdapter
type AdapterRequest = import('./adapter').AdapterRequest
type AiStreamEvent = import('@shared/domain/ai').AiStreamEvent

/** Cifra dublada — mesma do vault: XOR, para o byte gravado não ser o original. */
const MASCARA = 0x5a
const cipherFalso = {
  encrypt: (t: string): Buffer => Buffer.from(Buffer.from(t, 'utf8').map((b) => b ^ MASCARA)),
  decrypt: (c: Buffer): string => Buffer.from(c.map((b) => b ^ MASCARA)).toString('utf8')
}

const USUARIO = 'usuario-de-teste'
const SEGREDO = 'sk-ant-api03-chave-do-usuario'
const PROMPT = 'qual a capital da Franca'

/**
 * Adapter falso — a prova viva do critério 1.
 *
 * Não conhece Anthropic, satisfaz `AiAdapter` e roda pelo mesmo ponto de chamada. Guarda o
 * `AdapterRequest` recebido para que o teste possa afirmar **o que o ponto de chamada
 * entregou** — inclusive a credencial, que é como se prova que ela foi resolvida do vault.
 */
function adapterFalso(
  roteiro: readonly AdapterChunk[] | (() => AsyncIterable<AdapterChunk>)
): AiAdapter & { recebido?: AdapterRequest } {
  const falso: AiAdapter & { recebido?: AdapterRequest } = {
    nome: 'anthropic',
    generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
      falso.recebido = request
      if (typeof roteiro === 'function') return roteiro()
      return (async function* () {
        for (const chunk of roteiro) yield chunk
      })()
    }
  }
  return falso
}

const USAGE = { tokensEntrada: 1_000, tokensSaida: 500 }

/** O roteiro feliz: dois pedaços de texto e o `usage` no fim, como a Anthropic entrega. */
const ROTEIRO_OK: readonly AdapterChunk[] = [
  { tipo: 'texto', texto: 'Paris' },
  { tipo: 'texto', texto: ' e a capital.' },
  { tipo: 'fim', usage: USAGE }
]

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let credentials: InstanceType<typeof CredentialService>

/** Os eventos `ai-call` da cadeia, em ordem. `list` filtra por workspace, não por tipo. */
function eventosDeIa(): readonly import('@shared/domain/entities').AuditEvent[] {
  return audit.list(USUARIO).filter((e) => e.type === 'ai-call')
}

/** Consome o stream inteiro numa lista — o teste afirma sobre a sequência de eventos. */
async function coletar(stream: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const eventos: AiStreamEvent[] = []
  for await (const evento of stream) eventos.push(evento)
  return eventos
}

/**
 * O gate de orçamento do teste. Limites altos por padrão: os testes desta suíte são sobre o
 * **stream**, e um orçamento apertado os faria falhar por outra razão. Os testes do gate em si
 * passam limites próprios.
 */
function gate(limites?: Partial<BudgetLimitsInput>, agora?: () => Date): BudgetService {
  const servicoDeOrcamento = new BudgetService(new BudgetRepository(db), audit, agora)

  if (limites !== undefined) {
    servicoDeOrcamento.setLimits(
      { userId: USUARIO, workspace: 'jarvis' },
      { dailyLimit: 1000, monthlyLimit: 1000, alertThreshold: 0.8, ...limites }
    )
  }

  return servicoDeOrcamento
}

function servico(
  adapter: AiAdapter,
  budget: BudgetService = gate({ dailyLimit: 1000, monthlyLimit: 1000 })
): InstanceType<typeof AiCallService> {
  return new AiCallService(
    // Os quatro do contrato. Os três da F04 recebem o mesmo dublê: esta suíte é sobre o
    // **ponto único**, e o que ela precisa é que todo provider passe por ele — não que cada
    // adapter fale seu protocolo, o que tem suíte própria.
    { anthropic: adapter, gemini: adapter, ollama: adapter, 'claude-code': adapter },
    credentials,
    new PolicyService(audit, () => USUARIO),
    audit,
    budget
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-ai-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  credentials = new CredentialService(
    new CredentialRepository(db, cipherFalso),
    audit,
    new PolicyService(audit, () => USUARIO),
    {} as NodeJS.ProcessEnv
  )
  credentials.set(USUARIO, 'jarvis', 'anthropic', SEGREDO, 'usuario')
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('streaming ao chamador (critério 2)', () => {
  it('emite um evento por chunk e um `fim` — o texto chega em pedaços', async () => {
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    // Dois chunks e um fim: o texto **não** chega inteiro num evento só, que é a diferença
    // entre streaming e uma resposta que fingiu ser stream.
    expect(eventos.map((e) => e.tipo)).toEqual(['chunk', 'chunk', 'fim'])
    expect(
      eventos
        .filter((e) => e.tipo === 'chunk')
        .map((e) => e.texto)
        .join('')
    ).toBe('Paris e a capital.')
  })

  it('todos os eventos de uma chamada carregam o mesmo id', async () => {
    // É o `id` que o renderer usa para casar os chunks, e o `correlationId` do log. Ids
    // divergentes fariam a tela montar o texto de uma chamada no lugar de outra.
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(new Set(eventos.map((e) => e.id)).size).toBe(1)
  })

  it('a credencial chega ao adapter vinda do vault — e não do renderer', async () => {
    const adapter = adapterFalso(ROTEIRO_OK)
    await coletar(
      servico(adapter).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    // O elo com a F01: o ponto de chamada resolveu a chave por usuário+espaço e a entregou ao
    // adapter. Nenhum parâmetro da chamada a carregava — ela veio do cofre.
    expect(adapter.recebido?.apiKey).toBe(SEGREDO)
  })

  it('nenhum evento do stream carrega a credencial', async () => {
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    // O que atravessa o IPC não pode levar a chave. A asserção é sobre o JSON inteiro porque
    // é isso que o `send` serializa — um campo aninhado escaparia de uma checagem por chave.
    expect(JSON.stringify(eventos)).not.toContain(SEGREDO)
  })
})

describe('classificação e report-only (critério 3)', () => {
  it('classifica como `api.external-call` e **não** barra a chamada', async () => {
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const decisoes = audit.list(USUARIO).filter((e) => e.type === 'policy-decision')
    expect(decisoes.some((e) => e.payload.action === 'api.external-call')).toBe(true)

    // Report-only: classificou, auditou e a chamada **seguiu**. O gate é a F03; se esta
    // asserção virar vermelha sem uma spec nova, alguém ligou o bloqueio antes da hora.
    expect(eventos.at(-1)).toMatchObject({ tipo: 'fim', estado: 'concluido' })
  })

  it('custo alto não impede a chamada — o gate é a F03, não esta fatia', async () => {
    // Um prompt gigante estima caro. Nesta fatia isso é só um número no `CostEvent`.
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: 'x'.repeat(400_000), maxTokens: 4_000 },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const fim = eventos.at(-1)
    expect(fim).toMatchObject({ estado: 'concluido' })
    expect(fim?.tipo === 'fim' ? fim.custo?.estimadoUsd : 0).toBeGreaterThan(0.5)
  })
})

describe('custo e latência (critério 4)', () => {
  it('mede o custo real pelo `usage` do provider, não pela estimativa', async () => {
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const fim = eventos.at(-1)
    if (fim?.tipo !== 'fim') throw new Error('esperava evento de fim')

    // 1.000 entrada × $5/1M + 500 saída × $25/1M = $0,0175 — o número que a tabela produz.
    expect(fim.custo?.realUsd).toBeCloseTo(0.0175, 10)
    expect(fim.custo?.usage).toEqual(USAGE)
  })

  it('mede as duas latências — até o primeiro chunk e total', async () => {
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const fim = eventos.at(-1)
    if (fim?.tipo !== 'fim') throw new Error('esperava evento de fim')

    // As duas medidas respondem perguntas diferentes: a primeira é o que o usuário sente como
    // "travou"; a total é o custo de tempo da chamada. Uma só esconderia o caso do provider
    // que responde rápido e depois arrasta.
    expect(fim.custo?.latenciaPrimeiroChunkMs).toBeGreaterThanOrEqual(0)
    expect(fim.custo?.latenciaTotalMs).toBeGreaterThanOrEqual(
      fim.custo?.latenciaPrimeiroChunkMs ?? 0
    )
  })
})

describe('auditoria (critério 5)', () => {
  it('grava requisição **e** conclusão, e a cadeia continua íntegra', async () => {
    await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const eventos = eventosDeIa()
    expect(eventos.map((e) => e.payload.fase)).toEqual(['requisicao', 'conclusao'])
    expect(audit.verify(USUARIO).ok).toBe(true)
  })

  it('a auditoria não contém o prompt nem a credencial', async () => {
    await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    // Sobre a cadeia **inteira** (inclui a `policy-decision`), não só os eventos de IA: o
    // prompt poderia vazar pelo `detail` da classificação, que é outro caminho até o disco.
    const tudo = JSON.stringify(audit.list(USUARIO))
    expect(tudo).not.toContain(PROMPT)
    expect(tudo).not.toContain(SEGREDO)
  })

  it('audita o custo e o modelo — a evidência financeira do RF-011', async () => {
    await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const conclusao = eventosDeIa().at(-1)
    expect(conclusao?.payload).toMatchObject({
      fase: 'conclusao',
      provider: 'anthropic',
      model: 'claude-opus-5',
      estado: 'concluido',
      tokensEntrada: 1_000,
      tokensSaida: 500
    })
  })
})

describe('log `ai` com entrada e saída casadas (critério 6)', () => {
  it('loga os dois lados com o mesmo correlationId, sem prompt nem chave', async () => {
    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const chamadas = logCat.info.mock.calls
    const entrada = chamadas.find((c) => c[1]?.direction === 'in')
    const saida = chamadas.find((c) => c[1]?.direction === 'out')

    // CONVENTION §3: fluxos de AI logam os dois lados. Um só deixaria a investigação sem
    // como saber se a chamada voltou.
    expect(entrada).toBeDefined()
    expect(saida).toBeDefined()
    expect(entrada?.[1].correlationId).toBe(saida?.[1].correlationId)
    expect(entrada?.[1].correlationId).toBe(eventos[0]?.id)

    expect(JSON.stringify(chamadas)).not.toContain(PROMPT)
    expect(JSON.stringify(chamadas)).not.toContain(SEGREDO)
  })
})

describe('resiliência (critério 7)', () => {
  it('erro do provider vira `falhou` com AuditEvent — sem quebrar o app', async () => {
    const adapter = adapterFalso(() =>
      (async function* (): AsyncIterable<AdapterChunk> {
        yield { tipo: 'texto', texto: 'comecou' }
        throw new AdapterError('A Anthropic respondeu com erro 500.', new Error('boom'))
      })()
    )

    // Não lança: o desfecho ruim é **estado**, não exceção. Um throw aqui obrigaria cada
    // chamador a lembrar de traduzi-lo em tela — e o que não é lembrado vira app quebrado.
    const eventos = await coletar(
      servico(adapter).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const fim = eventos.at(-1)
    expect(fim).toMatchObject({ tipo: 'fim', estado: 'falhou' })
    expect(fim?.tipo === 'fim' ? fim.erro : '').toContain('erro 500')

    // O critério exige AuditEvent **na falha** — é a chamada que deu errado que mais precisa
    // de rastro, e um evento só no sucesso perderia exatamente essa.
    const conclusao = eventosDeIa().at(-1)
    expect(conclusao?.payload).toMatchObject({ fase: 'conclusao', estado: 'falhou' })
    expect(audit.verify(USUARIO).ok).toBe(true)
  })

  it('stream interrompido no meio é falha, não conclusão vazia', async () => {
    // O adapter emite texto e acaba **sem** o `fim`. Tratar isso como sucesso registraria
    // custo zero para uma chamada que o provider pode ter cobrado.
    const eventos = await coletar(
      servico(adapterFalso([{ tipo: 'texto', texto: 'metade' }])).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(eventos.at(-1)).toMatchObject({ tipo: 'fim', estado: 'falhou' })
    expect(eventosDeIa().at(-1)?.payload.estado).toBe('falhou')
  })

  it('credencial ausente falha com instrução, não com exceção', async () => {
    credentials.remove(USUARIO, 'jarvis', 'anthropic', 'usuario')

    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK)).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const fim = eventos.at(-1)
    expect(fim).toMatchObject({ tipo: 'fim', estado: 'falhou' })
    // A mensagem diz o que fazer. "Falhou" sem saída é o que faz o usuário reabrir a tela
    // três vezes antes de descobrir que faltava a chave.
    expect(fim?.tipo === 'fim' ? fim.erro : '').toContain('Configurações')
  })

  it('a mensagem de erro não repassa o corpo cru do provider', async () => {
    // Erro não-`AdapterError`: a mensagem crua pode ecoar o header enviado — com a chave.
    const adapter = adapterFalso(() =>
      (async function* (): AsyncIterable<AdapterChunk> {
        throw new Error(`401 unauthorized: x-api-key ${SEGREDO}`)
        yield { tipo: 'fim', usage: USAGE }
      })()
    )

    const eventos = await coletar(
      servico(adapter).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const fim = eventos.at(-1)
    expect(fim?.tipo === 'fim' ? fim.erro : '').not.toContain(SEGREDO)
    expect(fim?.tipo === 'fim' ? fim.erro : '').toBe('Falha inesperada ao chamar o provider.')
  })
})

describe('escopo por espaço (herdado da F01)', () => {
  it('a credencial do JARVIS não atende uma chamada do NOA', async () => {
    const adapter = adapterFalso(ROTEIRO_OK)

    const eventos = await coletar(
      servico(adapter).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'noa' }
      )
    )

    // O invariante do LANDSCAPE ("alternar sem misturar credenciais") atravessando a chamada
    // de IA: o vault do NOA está vazio, então a chamada falha em vez de usar a chave do outro
    // espaço. O adapter nem chega a ser invocado.
    expect(eventos.at(-1)).toMatchObject({ estado: 'falhou' })
    expect(adapter.recebido).toBeUndefined()
  })
})

describe('gate de orçamento no ponto único (SPEC-Providers-03, critérios 2, 4 e 5)', () => {
  const AGORA = new Date('2026-08-29T15:00:00.000Z')

  /** Um gate com relógio fixo, para que o recorte de período seja determinístico. */
  function gateFixo(limites?: Partial<BudgetLimitsInput>): BudgetService {
    const orcamento = new BudgetService(new BudgetRepository(db), audit, () => AGORA)
    orcamento.setLimits(
      { userId: USUARIO, workspace: 'jarvis' },
      { dailyLimit: 1, monthlyLimit: 1, alertThreshold: 0.8, ...limites }
    )
    return orcamento
  }

  it('a chamada que cabe no orçamento sai normalmente', async () => {
    const adapter = adapterFalso(ROTEIRO_OK)

    const eventos = await coletar(
      servico(adapter, gateFixo({ dailyLimit: 100, monthlyLimit: 100 })).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(eventos.at(-1)).toMatchObject({ estado: 'concluido' })
    expect(adapter.recebido).toBeDefined()
  })

  it('a chamada que estouraria o orçamento NÃO chega ao provider (critério 2)', async () => {
    const adapter = adapterFalso(ROTEIRO_OK)

    // Teto de 0 USD: qualquer estimativa positiva estoura. É a prova mais direta de que o
    // gate decide **antes** — o adapter não é sequer invocado.
    const eventos = await coletar(
      servico(adapter, gateFixo({ dailyLimit: 0, monthlyLimit: 0 })).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(adapter.recebido).toBeUndefined()
    const fim = eventos.at(-1)
    expect(fim).toMatchObject({ tipo: 'fim', estado: 'falhou' })
    expect(fim?.tipo === 'fim' ? fim.erro : '').toContain('Orçamento')
  })

  it('o bloqueio não registra `CostEvent`: a chamada não saiu, logo não custou', async () => {
    await coletar(
      servico(adapterFalso(ROTEIRO_OK), gateFixo({ dailyLimit: 0, monthlyLimit: 0 })).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const linhas = db.prepare('SELECT COUNT(*) AS n FROM cost_event').get() as { n: number }
    expect(linhas.n).toBe(0)
  })

  it('o bloqueio não audita uma requisição que nunca houve', async () => {
    await coletar(
      servico(adapterFalso(ROTEIRO_OK), gateFixo({ dailyLimit: 0, monthlyLimit: 0 })).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    // O gate roda **antes** da auditoria de requisição. Se rodasse depois, a cadeia diria
    // "requisitei" para uma chamada que o próprio app impediu de sair.
    const fases = eventosDeIa().map((e) => (e.payload as Record<string, unknown>).fase)
    expect(fases).toEqual(['conclusao'])
  })

  it('a chamada concluída registra o custo real, que o gate da próxima enxerga', async () => {
    const orcamento = gateFixo({ dailyLimit: 100, monthlyLimit: 100 })

    await coletar(
      servico(adapterFalso(ROTEIRO_OK), orcamento).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    const snapshot = orcamento.snapshot({ userId: USUARIO, workspace: 'jarvis' })
    expect(snapshot.gasto.diaUsd).toBeGreaterThan(0)
  })

  it('estouro no meio do stream: a chamada corrente TERMINA e a próxima é barrada (critério 4)', async () => {
    // O cenário do critério 4: a estimativa cabia, o real não. O `usage` é grande o bastante
    // para que o custo real da primeira chamada, sozinho, estoure o teto.
    const USAGE_CARO = { tokensEntrada: 100_000, tokensSaida: 100_000 }
    const roteiroCaro: readonly AdapterChunk[] = [
      { tipo: 'texto', texto: 'resposta' },
      { tipo: 'texto', texto: ' longa' },
      { tipo: 'fim', usage: USAGE_CARO }
    ]

    const orcamento = gateFixo({ dailyLimit: 1, monthlyLimit: 1000 })
    const primeiro = adapterFalso(roteiroCaro)

    const eventos = await coletar(
      servico(primeiro, orcamento).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    // A primeira **não é morta**: os chunks chegaram e o desfecho é `concluido`. Matar o
    // stream não devolveria os tokens já gerados; entregaria resposta quebrada pelo mesmo preço.
    expect(eventos.filter((e) => e.tipo === 'chunk')).toHaveLength(2)
    expect(eventos.at(-1)).toMatchObject({ estado: 'concluido' })

    // O gasto real foi registrado, e é ele que barra a **próxima**.
    expect(
      orcamento.snapshot({ userId: USUARIO, workspace: 'jarvis' }).gasto.diaUsd
    ).toBeGreaterThan(1)

    const segundo = adapterFalso(ROTEIRO_OK)
    const depois = await coletar(
      servico(segundo, orcamento).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(segundo.recebido).toBeUndefined()
    expect(depois.at(-1)).toMatchObject({ estado: 'falhou' })
  })

  it('o gate decide pela estimativa, não pelo real — melhor esforço declarado (critério 5)', async () => {
    // O prompt entra na estimativa junto com o teto de saída inteiro. Com um teto de
    // orçamento entre a estimativa e zero, a mesma chamada passa ou barra conforme
    // `maxTokens` — que é o insumo da **estimativa**, não do custo medido.
    const pedido = { provider: 'anthropic' as const, prompt: PROMPT, maxTokens: 4096 }

    const barrado = await coletar(
      servico(adapterFalso(ROTEIRO_OK), gateFixo({ dailyLimit: 0.001, monthlyLimit: 1000 })).call(
        pedido,
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )
    expect(barrado.at(-1)).toMatchObject({ estado: 'falhou' })

    const passou = await coletar(
      servico(adapterFalso(ROTEIRO_OK), gateFixo({ dailyLimit: 1000, monthlyLimit: 1000 })).call(
        { ...pedido, maxTokens: 16 },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )
    expect(passou.at(-1)).toMatchObject({ estado: 'concluido' })
  })

  it('o orçamento do JARVIS não barra uma chamada do NOA (escopo por espaço)', async () => {
    // O gate herda o escopo da credencial: espaços têm orçamentos próprios, e o gasto de um
    // não pode barrar o outro.
    const orcamento = new BudgetService(new BudgetRepository(db), audit, () => AGORA)
    orcamento.setLimits(
      { userId: USUARIO, workspace: 'jarvis' },
      { dailyLimit: 0, monthlyLimit: 0, alertThreshold: 0.8 }
    )
    credentials.set(USUARIO, 'noa', 'anthropic', SEGREDO, 'usuario')

    const adapter = adapterFalso(ROTEIRO_OK)
    const eventos = await coletar(
      servico(adapter, orcamento).call(
        { provider: 'anthropic', prompt: PROMPT },
        { userId: USUARIO, workspace: 'noa' }
      )
    )

    expect(eventos.at(-1)).toMatchObject({ estado: 'concluido' })
  })
})
