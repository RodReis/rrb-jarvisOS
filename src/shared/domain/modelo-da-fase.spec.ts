/**
 * A resolução do modelo por fase (SPEC-Fases-02, critérios 1, 3 e 4).
 *
 * Sem banco de propósito: o que se prova aqui é a **herança** — projeto vence workspace,
 * ausência herda, remover volta —, e ela é a regra que mais erra sozinha. Um teste que
 * precisasse de SQLite tornaria caro cobrir os casos de borda, que é exatamente onde ela erra.
 */

import { describe, expect, it } from 'vitest'
import type { PhaseModelPolicy, ProjectModelOverride } from './modelo-da-fase'
import { TABELA_DE_PRECO } from './ai'
import { FASES } from './fase'
import {
  POLITICA_DE_MODELO_PADRAO,
  ROTAS_COM_MODELO,
  isModeloEscolhido,
  isProjectModelOverride,
  modeloDaFase,
  modeloExisteNoCatalogo,
  modelosDoCatalogo,
  politicaDeModeloPadrao,
  rotuloDoModelo
} from './modelo-da-fase'

const USUARIO = 'user-teste'

const politica = (
  fases: Partial<PhaseModelPolicy['fases']> = {}
): PhaseModelPolicy => ({
  ...politicaDeModeloPadrao(USUARIO, 'jarvis'),
  fases: { ...POLITICA_DE_MODELO_PADRAO, ...fases }
})

const override = (o: Partial<ProjectModelOverride> = {}): ProjectModelOverride => ({
  project_id: 'proj-1',
  fase: 'construcao',
  rota: 'assinatura',
  provider: 'claude-code',
  modelo: 'claude-sonnet-5',
  ...o
})

describe('catálogo (critério 1)', () => {
  it('`claude-fable-5-1` existe na rota de assinatura', () => {
    expect(modeloExisteNoCatalogo('claude-code', 'claude-fable-5-1')).toBe(true)
    expect(modelosDoCatalogo('claude-code')).toContain('claude-fable-5-1')
  })

  it('`claude-fable-5-1` NÃO existe em `anthropic`: a rota paga não o oferece', () => {
    expect(modeloExisteNoCatalogo('anthropic', 'claude-fable-5-1')).toBe(false)
    expect(modelosDoCatalogo('anthropic')).not.toContain('claude-fable-5-1')
  })

  it('`qwen3:8b` entra em Ollama sem remover as tags que já existiam', () => {
    expect(modelosDoCatalogo('ollama')).toEqual(
      expect.arrayContaining(['llama3.1', 'qwen2.5-coder', 'qwen3:8b'])
    )
  })

  it('nenhum id do Codex entra nesta fatia: sem provider, seria opção que nunca casa', () => {
    const todos = Object.values(TABELA_DE_PRECO).flatMap((m) => Object.keys(m))
    expect(todos.filter((id) => id.startsWith('gpt-'))).toEqual([])
  })

  it('o rótulo do combo cai no próprio id quando o produto não nomeia o modelo', () => {
    expect(rotuloDoModelo('claude-fable-5-1')).toBe('Fable 5.1')
    expect(rotuloDoModelo('tag-de-terceiro')).toBe('tag-de-terceiro')
  })
})

describe('padrão de quem nunca editou', () => {
  it('Planejamento e Especificação saem por Fable na assinatura', () => {
    for (const fase of ['planejamento', 'especificacao'] as const) {
      expect(modeloDaFase(fase, 'assinatura', undefined, politica())).toEqual({
        provider: 'claude-code',
        modelo: 'claude-fable-5-1'
      })
    }
  })

  it('Construção sai por Opus na assinatura', () => {
    expect(modeloDaFase('construcao', 'assinatura', undefined, politica())).toEqual({
      provider: 'claude-code',
      modelo: 'claude-opus-5'
    })
  })

  it('a rota paga nunca devolve Fable, em nenhuma fase: ele não existe lá', () => {
    for (const fase of FASES) {
      expect(modeloDaFase(fase, 'paga', undefined, politica()).modelo).not.toBe(
        'claude-fable-5-1'
      )
    }
  })

  it('toda fase e toda rota têm par: o padrão nunca deixa a geração sem modelo', () => {
    for (const fase of FASES) {
      for (const rota of ROTAS_COM_MODELO) {
        const escolhido = modeloDaFase(fase, rota, undefined, politica())
        expect(modeloExisteNoCatalogo(escolhido.provider, escolhido.modelo)).toBe(true)
      }
    }
  })
})

describe('override do projeto vence o workspace (critério 3)', () => {
  it('com override, o modelo é o do projeto', () => {
    expect(modeloDaFase('construcao', 'assinatura', override(), politica())).toEqual({
      provider: 'claude-code',
      modelo: 'claude-sonnet-5'
    })
  })

  it('sem override, herda o workspace editado', () => {
    const editada = politica({
      construcao: {
        assinatura: { provider: 'claude-code', modelo: 'claude-fable-5-1' },
        paga: { provider: 'anthropic', modelo: 'claude-haiku-4-5' }
      }
    })

    expect(modeloDaFase('construcao', 'assinatura', undefined, editada).modelo).toBe(
      'claude-fable-5-1'
    )
  })

  it('remover o override volta ao workspace, sem cópia envelhecida', () => {
    const editada = politica({
      construcao: {
        assinatura: { provider: 'claude-code', modelo: 'claude-sonnet-5' },
        paga: { provider: 'anthropic', modelo: 'claude-opus-5' }
      }
    })

    expect(modeloDaFase('construcao', 'assinatura', override(), editada).modelo).toBe(
      'claude-sonnet-5'
    )
    expect(modeloDaFase('construcao', 'assinatura', undefined, editada).modelo).toBe(
      'claude-sonnet-5'
    )
  })

  it('override de OUTRA fase não vaza para esta', () => {
    const daConstrucao = override({ fase: 'construcao', modelo: 'claude-sonnet-5' })

    expect(modeloDaFase('planejamento', 'assinatura', daConstrucao, politica()).modelo).toBe(
      'claude-fable-5-1'
    )
  })

  it('override de OUTRA rota não vaza para esta: é o que impede Fable na rota paga', () => {
    const daAssinatura = override({ rota: 'assinatura', modelo: 'claude-fable-5-1' })

    expect(modeloDaFase('construcao', 'paga', daAssinatura, politica())).toEqual({
      provider: 'anthropic',
      modelo: 'claude-opus-5'
    })
  })
})

describe('linha velha no banco não derruba a geração', () => {
  it('override com modelo fora do catálogo cai no workspace, sem lançar', () => {
    const morto = override({ modelo: 'claude-fable-5-1', provider: 'anthropic' })

    expect(modeloDaFase('construcao', 'assinatura', morto, politica()).modelo).toBe(
      'claude-opus-5'
    )
  })

  it('política com modelo fora do catálogo cai no padrão, sem lançar', () => {
    const corrompida = politica({
      planejamento: {
        assinatura: { provider: 'claude-code', modelo: 'modelo-que-nao-existe' },
        paga: { provider: 'anthropic', modelo: 'claude-opus-5' }
      }
    })

    expect(modeloDaFase('planejamento', 'assinatura', undefined, corrompida).modelo).toBe(
      'claude-fable-5-1'
    )
  })
})

describe('guards de fronteira (critério 4)', () => {
  it('recusa Fable em `anthropic`: forma certa, conteúdo proibido', () => {
    expect(isModeloEscolhido({ provider: 'anthropic', modelo: 'claude-fable-5-1' })).toBe(false)
  })

  it('aceita Fable em `claude-code`', () => {
    expect(isModeloEscolhido({ provider: 'claude-code', modelo: 'claude-fable-5-1' })).toBe(true)
  })

  it('recusa provider inventado, modelo inventado e forma errada', () => {
    expect(isModeloEscolhido({ provider: 'openai', modelo: 'gpt-5.5' })).toBe(false)
    expect(isModeloEscolhido({ provider: 'anthropic', modelo: 'nao-existe' })).toBe(false)
    expect(isModeloEscolhido(null)).toBe(false)
    expect(isModeloEscolhido('claude-opus-5')).toBe(false)
  })

  it('override só passa com projeto, fase, rota e par válidos', () => {
    expect(isProjectModelOverride(override())).toBe(true)
    expect(isProjectModelOverride(override({ project_id: '' }))).toBe(false)
    expect(isProjectModelOverride({ ...override(), fase: 'entrega' })).toBe(false)
    expect(isProjectModelOverride({ ...override(), rota: 'bloqueado' })).toBe(false)
    expect(
      isProjectModelOverride({ ...override(), provider: 'anthropic', modelo: 'claude-fable-5-1' })
    ).toBe(false)
  })
})
