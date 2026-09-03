/**
 * O contrato de saída do modelo para os quatro documentos (SPEC-Jornada-04).
 *
 * O que estes testes protegem é a recusa: **o parser não conserta**. Uma âncora ausente, uma
 * origem desconhecida ou um tipo de ajuste inventado invalidam a saída inteira, em vez de serem
 * descartados em silêncio — é o que impede que o documento gerado seja "o que sobrou depois de
 * um filtro" em vez do que o modelo produziu.
 */

import { describe, expect, it } from 'vitest'
import {
  SISTEMA_DA_ARQUITETURA,
  documentosCobertosNaArquitetura,
  lerAjustesDoModelo,
  lerArquiteturaDoModelo,
  promptDaArquitetura,
  promptDaCoerencia
} from './arquitetura-schema'

const AFIRMACAO = {
  id: 'a-1',
  documento: 'ARCHITECTURE',
  secao: 'Fluxos cobertos',
  texto: 'O usuário entra na conta.',
  origem: 'prototipo',
  ancora: { anexo: 'docs/prototipos/login.html', hash: 'a'.repeat(64), jornada: 'Entrar na conta' }
}

const REQUISITOS = [{ id: 'r-1', secao: 'Escopo', texto: 'Entrar com e-mail e senha.' }]
const JORNADAS = [
  { jornada: 'Entrar na conta', anexo: 'docs/prototipos/login.html', hash: 'a'.repeat(64) }
]

describe('lerArquiteturaDoModelo', () => {
  it('lê a saída bem formada', () => {
    const r = lerArquiteturaDoModelo(JSON.stringify({ afirmacoes: [AFIRMACAO] }))

    expect(r).toHaveLength(1)
    expect(r?.[0]?.ancora?.jornada).toBe('Entrar na conta')
  })

  it('tolera a cerca de código que o modelo produz por hábito', () => {
    const r = lerArquiteturaDoModelo(
      '```json\n' + JSON.stringify({ afirmacoes: [AFIRMACAO] }) + '\n```'
    )

    expect(r).toHaveLength(1)
  })

  it('recusa saída que não é JSON', () => {
    expect(lerArquiteturaDoModelo('Claro! Aqui está a arquitetura:')).toBeUndefined()
  })

  it('recusa afirmação sem origem em vez de completá-la', () => {
    const semOrigem: Record<string, unknown> = { ...AFIRMACAO }
    delete semOrigem['origem']

    expect(lerArquiteturaDoModelo(JSON.stringify({ afirmacoes: [semOrigem] }))).toBeUndefined()
  })

  it('recusa documento fora do contrato', () => {
    const outro = { ...AFIRMACAO, documento: 'ROADMAP' }

    expect(lerArquiteturaDoModelo(JSON.stringify({ afirmacoes: [outro] }))).toBeUndefined()
  })

  it('recusa âncora incompleta — sem hash não há prova de qual conteúdo', () => {
    const semHash = {
      ...AFIRMACAO,
      ancora: { anexo: 'docs/prototipos/login.html', jornada: 'Entrar na conta' }
    }

    expect(lerArquiteturaDoModelo(JSON.stringify({ afirmacoes: [semHash] }))).toBeUndefined()
  })

  it('invalida a saída inteira quando uma afirmação está malformada', () => {
    const bruto = JSON.stringify({ afirmacoes: [AFIRMACAO, { id: 'a-2' }] })

    expect(lerArquiteturaDoModelo(bruto)).toBeUndefined()
  })

  it('lista os documentos cobertos', () => {
    const afirmacoes = lerArquiteturaDoModelo(JSON.stringify({ afirmacoes: [AFIRMACAO] })) ?? []

    expect(documentosCobertosNaArquitetura(afirmacoes)).toEqual(['ARCHITECTURE'])
  })
})

describe('lerAjustesDoModelo', () => {
  const AJUSTE = {
    id: 'j-1',
    tipo: 'tela-sem-requisito',
    jornada: 'Entrar na conta',
    observacao: 'Nenhum requisito pede esta tela.',
    recomendacao: 'Confirmar se o login entra nesta versão.'
  }

  it('lê os ajustes bem formados', () => {
    expect(lerAjustesDoModelo(JSON.stringify({ ajustes: [AJUSTE] }))).toHaveLength(1)
  })

  it('lista vazia é resultado legítimo, não ausência de saída', () => {
    expect(lerAjustesDoModelo(JSON.stringify({ ajustes: [] }))).toEqual([])
  })

  it('saída sem forma devolve undefined — a distinção que o critério 4 precisa', () => {
    expect(lerAjustesDoModelo('não achei nada')).toBeUndefined()
  })

  it('recusa tipo de ajuste inventado', () => {
    const outro = { ...AJUSTE, tipo: 'tela-bonita' }

    expect(lerAjustesDoModelo(JSON.stringify({ ajustes: [outro] }))).toBeUndefined()
  })
})

describe('o pedido ao modelo', () => {
  it('enumera os requisitos com os ids que a origem prd tem de citar', () => {
    const p = promptDaArquitetura({ requisitos: REQUISITOS, jornadas: JORNADAS })

    expect(p).toContain('[r-1]')
  })

  it('enumera as jornadas com o anexo e o hash da âncora', () => {
    const p = promptDaArquitetura({ requisitos: REQUISITOS, jornadas: JORNADAS })

    expect(p).toContain('docs/prototipos/login.html')
    expect(p).toContain('a'.repeat(64))
  })

  it('sem jornada, proíbe descrever fluxo em vez de deixar a lista vazia', () => {
    const p = promptDaArquitetura({ requisitos: REQUISITOS, jornadas: [] })

    expect(p).toContain('Não descreva fluxo algum')
  })

  it('a correção nomeia os problemas do validador', () => {
    const p = promptDaArquitetura({
      requisitos: REQUISITOS,
      jornadas: JORNADAS,
      correcao: ['A afirmação "a-9" descreve um fluxo sem âncora.']
    })

    expect(p).toContain('a-9')
  })

  it('a instrução deriva as seções de fluxo das constantes, não de lista escrita à mão', () => {
    expect(SISTEMA_DA_ARQUITETURA).toContain('ARCHITECTURE § Fluxos cobertos')
    expect(SISTEMA_DA_ARQUITETURA).toContain('TESTING § Estratégia')
  })

  it('o pedido da coerência mostra os dois lados que a análise compara', () => {
    const p = promptDaCoerencia({ requisitos: REQUISITOS, jornadas: JORNADAS })

    expect(p).toContain('[r-1]')
    expect(p).toContain('Entrar na conta')
  })
})
