/**
 * Roteamento persistido e auditado (SPEC-Providers-04, critérios 3, 4, 5, 6 e 7).
 *
 * Banco real, sonda dublada: o que se testa aqui é a **junção** — rota lida do disco, medida
 * pela sonda, decidida pela função pura e registrada na cadeia. A decisão em si tem suíte
 * própria (`routing.spec.ts`), e os adapters têm as deles; um teste que subisse Ollama de
 * verdade mediria a máquina do CI, não o roteamento.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { AI_PROVIDERS, MODELO_PADRAO, type AiProvider } from '@shared/domain/ai'
import { ROTEAMENTO_PADRAO, TASK_TYPES } from '@shared/domain/routing'
import { openDatabase } from '../storage/database'
import { AuditRepository } from '../storage/audit-repository'
import { RoutingRepository } from './routing-repository'
import { RoutingService, SondaDeAdapters, VALIDADE_DO_HEALTHCHECK_MS } from './routing-service'

const USUARIO = 'user-teste'
const ESCOPO = { userId: USUARIO, workspace: 'jarvis' as const }

let dir: string
let db: Db
let repo: RoutingRepository
let audit: InstanceType<typeof AuditRepository>

/** Relógio controlado: o cache do healthcheck tem validade, e esperar 30s seria absurdo. */
let relogio = 1_000_000

/** Uma sonda que responde pela lista dada, contando quantas vezes foi consultada. */
function sondaCom(disponiveis: readonly AiProvider[]): {
  readonly sonda: SondaDeAdapters
  readonly chamadas: () => number
} {
  let chamadas = 0
  const checar = (p: AiProvider) => async (): Promise<boolean> => {
    chamadas += 1
    return disponiveis.includes(p)
  }

  return {
    sonda: new SondaDeAdapters({
      anthropic: checar('anthropic'),
      gemini: checar('gemini'),
      ollama: checar('ollama'),
      'claude-code': checar('claude-code'),
      codex: checar('codex')
    }),
    chamadas: () => chamadas
  }
}

function servico(disponiveis: readonly AiProvider[]): RoutingService {
  return new RoutingService(repo, sondaCom(disponiveis).sonda, audit, () => relogio)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-routing-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new RoutingRepository(db)
  audit = new AuditRepository(db, 'chave-de-teste')
  relogio = 1_000_000
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('rotas persistidas (critério 3)', () => {
  it('sem nada gravado, devolve as cinco rotas padrão', () => {
    const rotas = repo.find(USUARIO, 'jarvis').rotas

    expect(Object.keys(rotas).sort()).toEqual([...TASK_TYPES].sort())
    expect(rotas.chat.preferencia).toEqual(ROTEAMENTO_PADRAO.chat.preferencia)
  })

  it('grava e relê uma rota editada', () => {
    repo.save(
      USUARIO,
      'jarvis',
      { taskType: 'chat', preferencia: ['ollama', 'gemini'], preferirLocal: false },
      new Date()
    )

    const rotas = repo.find(USUARIO, 'jarvis').rotas
    expect(rotas.chat.preferencia).toEqual(['ollama', 'gemini'])
    expect(rotas.chat.preferirLocal).toBe(false)
  })

  it('editar uma rota NÃO apaga as outras — a mescla com o padrão é por tipo', () => {
    // Um `find` que devolvesse só o gravado deixaria `code` sem preferência nenhuma depois da
    // primeira edição, e a rota de código pararia de funcionar por ter-se editado o chat.
    repo.save(
      USUARIO,
      'jarvis',
      { taskType: 'chat', preferencia: ['ollama'], preferirLocal: true },
      new Date()
    )

    const rotas = repo.find(USUARIO, 'jarvis').rotas
    expect(rotas.chat.preferencia).toEqual(['ollama'])
    expect(rotas.code.preferencia).toEqual(ROTEAMENTO_PADRAO.code.preferencia)
  })

  it('salvar de novo atualiza a linha, não cria uma segunda', () => {
    const rota = {
      taskType: 'chat' as const,
      preferencia: ['ollama' as const],
      preferirLocal: true
    }
    repo.save(USUARIO, 'jarvis', rota, new Date())
    repo.save(USUARIO, 'jarvis', { ...rota, preferencia: ['gemini'] }, new Date())

    const linhas = db.prepare('SELECT COUNT(*) AS n FROM provider_route').get() as { n: number }
    expect(linhas.n).toBe(1)
    expect(repo.find(USUARIO, 'jarvis').rotas.chat.preferencia).toEqual(['gemini'])
  })

  it('NOA e JARVIS têm rotas próprias', () => {
    repo.save(
      USUARIO,
      'noa',
      { taskType: 'chat', preferencia: ['ollama'], preferirLocal: true },
      new Date()
    )

    expect(repo.find(USUARIO, 'noa').rotas.chat.preferencia).toEqual(['ollama'])
    expect(repo.find(USUARIO, 'jarvis').rotas.chat.preferencia).toEqual(
      ROTEAMENTO_PADRAO.chat.preferencia
    )
  })

  it('linha corrompida no disco cai no padrão em vez de virar rota inválida', () => {
    // O banco é arquivo no disco do usuário. Uma rota apontando para provider inexistente
    // apareceria como "nenhum provider disponível" — sintoma longe da causa.
    db.prepare(
      `INSERT INTO provider_route
         (user_id, workspace_id, task_type, preferencia, preferir_local, updated_at)
       VALUES (?, 'jarvis', 'chat', ?, 1, '2026-08-29T00:00:00.000Z')`
    ).run(USUARIO, JSON.stringify(['skynet']))

    expect(repo.find(USUARIO, 'jarvis').rotas.chat.preferencia).toEqual(
      ROTEAMENTO_PADRAO.chat.preferencia
    )
  })
})

describe('modelo ativo (critério 5)', () => {
  it('sem troca, devolve o modelo padrão do provider', () => {
    expect(repo.modeloAtivo(USUARIO, 'jarvis', 'anthropic')).toBe(MODELO_PADRAO.anthropic)
  })

  it('troca e relê', () => {
    expect(repo.saveModelo(USUARIO, 'jarvis', 'anthropic', 'claude-haiku-4-5', new Date())).toBe(
      true
    )
    expect(repo.modeloAtivo(USUARIO, 'jarvis', 'anthropic')).toBe('claude-haiku-4-5')
  })

  it('recusa modelo fora da tabela de preço na escrita', () => {
    // Um modelo fora da tabela custaria zero na conta da F03 — um orçamento que não vê o gasto
    // é pior que um modelo trocado de volta.
    expect(repo.saveModelo(USUARIO, 'jarvis', 'anthropic', 'gpt-5', new Date())).toBe(false)
    expect(repo.modeloAtivo(USUARIO, 'jarvis', 'anthropic')).toBe(MODELO_PADRAO.anthropic)
  })

  it('modelo inválido que já esteja no disco cai no padrão na leitura', () => {
    // A segunda barreira, para o que a primeira não pegou (gravado por versão anterior).
    db.prepare(
      `INSERT INTO active_model (user_id, workspace_id, provider, model, updated_at)
       VALUES (?, 'jarvis', 'anthropic', 'modelo-que-nao-existe', '2026-08-29T00:00:00.000Z')`
    ).run(USUARIO)

    expect(repo.modeloAtivo(USUARIO, 'jarvis', 'anthropic')).toBe(MODELO_PADRAO.anthropic)
  })

  it('lista os modelos que o provider oferece', () => {
    expect(repo.modelosDisponiveis('anthropic')).toContain('claude-opus-5')
    expect(repo.modelosDisponiveis('ollama')).toContain('llama3.1')
  })
})

describe('seleção auditada (critérios 4 e 7)', () => {
  function selecoes(): readonly Record<string, unknown>[] {
    return audit
      .list(USUARIO)
      .filter((e) => e.type === 'provider-selection')
      .map((e) => e.payload as Record<string, unknown>)
  }

  it('escolhe o preferido quando ele está de pé, e audita', async () => {
    const selecao = await servico(['anthropic', 'gemini', 'ollama']).selecionar(ESCOPO, 'chat')

    // A rota padrão de `chat` prefere local, e o Ollama está de pé.
    expect(selecao).toMatchObject({ provider: 'ollama', motivo: 'preferencia-local' })
    expect(selecoes()[0]).toMatchObject({ taskType: 'chat', decisao: 'escolhido' })
  })

  it('preferido offline cai para o próximo, e o evento registra os pulados', async () => {
    const selecao = await servico(['gemini']).selecionar(ESCOPO, 'chat')

    expect(selecao).toMatchObject({ provider: 'gemini', motivo: 'fallback' })
    expect(selecoes()[0]).toMatchObject({ motivo: 'fallback', pulados: ['anthropic'] })
  })

  it('ninguém de pé devolve indisponível, e isso também é auditado', async () => {
    const selecao = await servico([]).selecionar(ESCOPO, 'chat')

    expect(selecao.decisao).toBe('indisponivel')
    expect(selecoes()[0]).toMatchObject({ decisao: 'indisponivel' })
  })

  it('audita todos os desfechos, não só o fallback', async () => {
    // "A rota nunca caiu" e "a rota nunca rodou" são fatos diferentes — o mesmo argumento do
    // gate de orçamento da F03.
    await servico(['anthropic']).selecionar(ESCOPO, 'chat')
    relogio += VALIDADE_DO_HEALTHCHECK_MS + 1
    await servico(['gemini']).selecionar(ESCOPO, 'chat')
    relogio += VALIDADE_DO_HEALTHCHECK_MS + 1
    await servico([]).selecionar(ESCOPO, 'chat')

    expect(selecoes().map((p) => p.decisao)).toEqual(['escolhido', 'escolhido', 'indisponivel'])
    expect(selecoes().map((p) => p.motivo)).toEqual(['preferido', 'fallback', undefined])
  })

  it('a rota editada muda quem atende', async () => {
    repo.save(
      USUARIO,
      'jarvis',
      { taskType: 'chat', preferencia: ['gemini', 'anthropic'], preferirLocal: false },
      new Date()
    )

    const selecao = await servico(['anthropic', 'gemini']).selecionar(ESCOPO, 'chat')
    expect(selecao).toMatchObject({ provider: 'gemini' })
  })

  it('devolve o modelo ativo do provider escolhido, não o padrão', async () => {
    repo.saveModelo(USUARIO, 'jarvis', 'gemini', 'gemini-2.5-flash', new Date())

    const selecao = await servico(['gemini']).selecionar(ESCOPO, 'summarize')
    expect(selecao).toMatchObject({ provider: 'gemini', modelo: 'gemini-2.5-flash' })
  })

  it('a cadeia de auditoria continua íntegra depois das seleções', async () => {
    const gate = servico(['gemini'])
    await gate.selecionar(ESCOPO, 'chat')
    gate.setRota(ESCOPO, { taskType: 'chat', preferencia: ['gemini'], preferirLocal: false })

    expect(audit.verify(USUARIO).ok).toBe(true)
  })
})

describe('healthcheck e status (critérios 5 e 6)', () => {
  it('reporta estado, origem, modelo e unmetered por provider', async () => {
    const status = await servico(['ollama']).status(ESCOPO)

    const ollama = status.find((s) => s.provider === 'ollama')
    expect(ollama).toMatchObject({ estado: 'online', origem: 'local', unmetered: true })

    const anthropic = status.find((s) => s.provider === 'anthropic')
    expect(anthropic).toMatchObject({ estado: 'offline', origem: 'cloud', unmetered: false })
  })

  /**
   * Cobre **todos** os providers do catálogo, e o número vem de `AI_PROVIDERS`.
   *
   * Era `toHaveLength(4)` cravado, e o 4 virou 5 na SPEC-Fases-06 (entrada do `codex`). Derivar
   * da lista é mais forte que corrigir o número: o teste passa a acusar qualquer provider que
   * alguém acrescente ao catálogo sem ligar à sonda — que é justamente o defeito silencioso, um
   * provider que a tela nunca mostra como online.
   */
  it('cobre todos os providers do catálogo', async () => {
    const status = await servico([]).status(ESCOPO)

    expect(status).toHaveLength(AI_PROVIDERS.length)
    expect(status.map((s) => s.provider).sort()).toEqual([...AI_PROVIDERS].sort())
  })

  it('o cache evita sondar de novo dentro da validade', async () => {
    const { sonda, chamadas } = sondaCom(['ollama'])
    const gate = new RoutingService(repo, sonda, audit, () => relogio)

    await gate.status(ESCOPO)
    const primeira = chamadas()
    await gate.status(ESCOPO)

    // Sondar a cada chamada acrescentaria uma ida à rede no caminho crítico para responder
    // uma pergunta cuja resposta muda raramente.
    expect(chamadas()).toBe(primeira)
  })

  it('passada a validade, sonda de novo', async () => {
    const { sonda, chamadas } = sondaCom(['ollama'])
    const gate = new RoutingService(repo, sonda, audit, () => relogio)

    await gate.status(ESCOPO)
    const primeira = chamadas()
    relogio += VALIDADE_DO_HEALTHCHECK_MS + 1
    await gate.status(ESCOPO)

    expect(chamadas()).toBeGreaterThan(primeira)
  })

  it('invalidar o cache força a próxima medição', async () => {
    const { sonda, chamadas } = sondaCom(['ollama'])
    const gate = new RoutingService(repo, sonda, audit, () => relogio)

    await gate.status(ESCOPO)
    const primeira = chamadas()
    gate.invalidarCache()
    await gate.status(ESCOPO)

    expect(chamadas()).toBeGreaterThan(primeira)
  })

  it('sonda que lança conta como offline — nunca derruba a tela', async () => {
    const sonda = new SondaDeAdapters({
      anthropic: async () => {
        throw new Error('rede caiu')
      },
      gemini: async () => false,
      ollama: async () => false,
      'claude-code': async () => false,
      codex: async () => false
    })
    const gate = new RoutingService(repo, sonda, audit, () => relogio)

    const status = await gate.status(ESCOPO)
    expect(status.find((s) => s.provider === 'anthropic')?.estado).toBe('offline')
  })
})

describe('edição de rotas e modelo, auditadas (critério 7)', () => {
  function mudancas(): readonly Record<string, unknown>[] {
    return audit
      .list(USUARIO)
      .filter((e) => e.type === 'routing-change')
      .map((e) => e.payload as Record<string, unknown>)
  }

  it('editar rota gera `routing-change` com o antes e o depois', () => {
    servico([]).setRota(ESCOPO, {
      taskType: 'chat',
      preferencia: ['gemini'],
      preferirLocal: false
    })

    expect(mudancas()[0]).toMatchObject({
      taskType: 'chat',
      de: { preferencia: ROTEAMENTO_PADRAO.chat.preferencia },
      para: { preferencia: ['gemini'] }
    })
  })

  it('trocar modelo gera `routing-change` com o modelo anterior', () => {
    expect(servico([]).setModelo(ESCOPO, 'anthropic', 'claude-haiku-4-5')).toBe(true)

    expect(mudancas()[0]).toMatchObject({
      provider: 'anthropic',
      modeloDe: MODELO_PADRAO.anthropic,
      modeloPara: 'claude-haiku-4-5'
    })
  })

  it('troca recusada NÃO é auditada: registrar o que não aconteceu faria a auditoria mentir', () => {
    expect(servico([]).setModelo(ESCOPO, 'anthropic', 'gpt-5')).toBe(false)
    expect(mudancas()).toHaveLength(0)
  })
})
