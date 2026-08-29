/**
 * A seleção de provider por tarefa (SPEC-Providers-04, critérios 3, 4 e 6).
 *
 * Testa a **função pura**: dada a rota e quem está de pé, quem atende. Sem healthcheck real,
 * sem adapter, sem banco — a disponibilidade entra como dado, que é justamente o que torna o
 * fallback afirmável sobre a regra em vez de sobre a infraestrutura.
 */

import { describe, expect, it } from 'vitest'
import type { AiProvider } from './ai'
import {
  ROTEAMENTO_PADRAO,
  ROTULO_DO_TASK_TYPE,
  TASK_TYPES,
  isProviderRoute,
  isTaskType,
  roteamentoPadrao,
  selecionarProvider,
  type ProviderRoute
} from './routing'

const rota = (override: Partial<ProviderRoute> = {}): ProviderRoute => ({
  taskType: 'chat',
  preferencia: ['anthropic', 'gemini', 'ollama'],
  preferirLocal: false,
  ...override
})

const disponiveis = (...ps: AiProvider[]): ReadonlySet<AiProvider> => new Set(ps)

describe('seleção pela ordem declarada (critério 3)', () => {
  it('escolhe o primeiro da preferência quando ele está disponível', () => {
    const selecao = selecionarProvider(rota(), disponiveis('anthropic', 'gemini', 'ollama'))

    expect(selecao).toEqual({
      decisao: 'escolhido',
      provider: 'anthropic',
      motivo: 'preferido',
      pulados: []
    })
  })

  it('respeita a ordem: mudar a preferência muda o escolhido', () => {
    const invertida = rota({ preferencia: ['gemini', 'anthropic'] })

    expect(selecionarProvider(invertida, disponiveis('anthropic', 'gemini'))).toMatchObject({
      provider: 'gemini'
    })
  })

  it('rota vazia devolve indisponível — nenhum provider atende este tipo', () => {
    const selecao = selecionarProvider(rota({ preferencia: [] }), disponiveis('anthropic'))

    expect(selecao).toEqual({ decisao: 'indisponivel', pulados: [] })
  })
})

describe('fallback por indisponibilidade (critério 4)', () => {
  it('preferido offline cai para o próximo, e o motivo diz que foi fallback', () => {
    const selecao = selecionarProvider(rota(), disponiveis('gemini', 'ollama'))

    expect(selecao).toEqual({
      decisao: 'escolhido',
      provider: 'gemini',
      motivo: 'fallback',
      pulados: ['anthropic']
    })
  })

  it('registra todos os pulados, não só o primeiro', () => {
    // O rastro completo é o que a auditoria do critério 4 precisa: "caiu para o terceiro" e
    // "caiu para o segundo" são fatos diferentes sobre a saúde do sistema.
    const selecao = selecionarProvider(rota(), disponiveis('ollama'))

    expect(selecao).toMatchObject({
      provider: 'ollama',
      motivo: 'fallback',
      pulados: ['anthropic', 'gemini']
    })
  })

  it('distingue `preferido` de `fallback` — a auditoria não pode confundi-los', () => {
    // Se o motivo não existisse, escolher o primeiro e cair para o terceiro produziriam o
    // mesmo evento, e "o preferido está caindo com frequência" seria invisível.
    expect(selecionarProvider(rota(), disponiveis('anthropic'))).toMatchObject({
      motivo: 'preferido'
    })
    expect(selecionarProvider(rota(), disponiveis('gemini'))).toMatchObject({ motivo: 'fallback' })
  })

  it('todos offline devolve indisponível com os candidatos que foram tentados', () => {
    const selecao = selecionarProvider(rota(), disponiveis())

    expect(selecao).toEqual({
      decisao: 'indisponivel',
      pulados: ['anthropic', 'gemini', 'ollama']
    })
  })
})

describe('preferência local/offline (RF-011, critério 3)', () => {
  it('o local disponível vence a ordem declarada quando a rota liga a preferência', () => {
    const selecao = selecionarProvider(
      rota({ preferirLocal: true }),
      disponiveis('anthropic', 'gemini', 'ollama')
    )

    expect(selecao).toMatchObject({ provider: 'ollama', motivo: 'preferencia-local' })
  })

  it('sem a preferência ligada, o local não fura a fila', () => {
    const selecao = selecionarProvider(
      rota({ preferirLocal: false }),
      disponiveis('anthropic', 'ollama')
    )

    expect(selecao).toMatchObject({ provider: 'anthropic', motivo: 'preferido' })
  })

  it('local offline não ganha nada: "quando viável" é a condição', () => {
    // O invariante do critério 6 valendo pelo caminho da preferência: um provider fora do ar
    // não é escolhido nem quando a rota o prefere.
    const selecao = selecionarProvider(
      rota({ preferirLocal: true }),
      disponiveis('anthropic', 'gemini')
    )

    expect(selecao).toMatchObject({ provider: 'anthropic', motivo: 'preferido' })
  })

  it('quando o local já era o primeiro, o motivo é `preferido` — o toggle não teve efeito', () => {
    // Rotular de `preferencia-local` esconderia que a escolha se explica pela ordem, e a
    // auditoria diria que o toggle decidiu algo que ele não decidiu.
    const selecao = selecionarProvider(
      rota({ preferencia: ['ollama', 'anthropic'], preferirLocal: true }),
      disponiveis('ollama', 'anthropic')
    )

    expect(selecao).toMatchObject({ provider: 'ollama', motivo: 'preferido' })
  })

  it('o `claude-code` conta como local: o processo roda nesta máquina', () => {
    const selecao = selecionarProvider(
      rota({ preferencia: ['anthropic', 'claude-code'], preferirLocal: true }),
      disponiveis('anthropic', 'claude-code')
    )

    expect(selecao).toMatchObject({ provider: 'claude-code', motivo: 'preferencia-local' })
  })
})

describe('provider offline nunca é escolhido (critério 6)', () => {
  it.each(TASK_TYPES)('vale para a rota padrão de %s', (taskType) => {
    // O invariante do arquivo inteiro, exercitado sobre as cinco rotas semeadas: seja qual for
    // a preferência, ninguém fora do conjunto de disponíveis é devolvido.
    const escolhido = selecionarProvider(ROTEAMENTO_PADRAO[taskType], disponiveis('gemini'))

    if (escolhido.decisao === 'escolhido') {
      expect(escolhido.provider).toBe('gemini')
    } else {
      expect(ROTEAMENTO_PADRAO[taskType].preferencia).not.toContain('gemini')
    }
  })

  it('nenhuma seleção devolve provider fora do conjunto de disponíveis', () => {
    for (const taskType of TASK_TYPES) {
      for (const conjunto of [
        disponiveis('anthropic'),
        disponiveis('ollama'),
        disponiveis('gemini', 'claude-code'),
        disponiveis()
      ]) {
        const selecao = selecionarProvider(ROTEAMENTO_PADRAO[taskType], conjunto)
        if (selecao.decisao === 'escolhido') {
          expect(conjunto.has(selecao.provider)).toBe(true)
        }
      }
    }
  })
})

describe('roteamento padrão semeado', () => {
  it('cobre os cinco tipos de tarefa', () => {
    const padrao = roteamentoPadrao('user-1', 'jarvis')

    expect(Object.keys(padrao.rotas).sort()).toEqual([...TASK_TYPES].sort())
    expect(padrao.user_id).toBe('user-1')
    expect(padrao.workspace_id).toBe('jarvis')
  })

  it('cada rota lista só providers conhecidos', () => {
    // Uma preferência com nome inválido nunca casaria com adapter, e o sintoma apareceria como
    // "nenhum provider disponível" — longe da causa.
    for (const taskType of TASK_TYPES) {
      expect(isProviderRoute(ROTEAMENTO_PADRAO[taskType])).toBe(true)
    }
  })

  it('`vision` não lista o Ollama: fallback que não funciona não é fallback', () => {
    expect(ROTEAMENTO_PADRAO.vision.preferencia).not.toContain('ollama')
  })

  it('`code` prefere o Claude Code CLI — a rota de assinatura', () => {
    expect(ROTEAMENTO_PADRAO.code.preferencia[0]).toBe('claude-code')
  })

  it('todo tipo tem rótulo em pt-BR', () => {
    for (const taskType of TASK_TYPES) {
      expect(ROTULO_DO_TASK_TYPE[taskType]).toBeTruthy()
    }
  })
})

describe('guards da fronteira do IPC', () => {
  it('aceita uma rota bem formada', () => {
    expect(isProviderRoute(rota())).toBe(true)
  })

  it.each([
    ['null', null],
    ['string', 'chat'],
    ['sem taskType', { preferencia: ['anthropic'], preferirLocal: true }],
    ['taskType desconhecido', { taskType: 'dança', preferencia: [], preferirLocal: true }],
    ['preferência não-array', { taskType: 'chat', preferencia: 'anthropic', preferirLocal: true }],
    [
      'provider desconhecido na preferência',
      { taskType: 'chat', preferencia: ['anthropic', 'skynet'], preferirLocal: true }
    ],
    ['preferirLocal não-booleano', { taskType: 'chat', preferencia: [], preferirLocal: 'sim' }]
  ])('recusa %s', (_caso, entrada) => {
    expect(isProviderRoute(entrada)).toBe(false)
  })

  it('isTaskType aceita os semeados e recusa o resto', () => {
    for (const t of TASK_TYPES) expect(isTaskType(t)).toBe(true)
    expect(isTaskType('tradução')).toBe(false)
    expect(isTaskType(42)).toBe(false)
  })
})
