import { describe, expect, it } from 'vitest'
import {
  PADRAO_DE_AMBIENTE_DE_PREVIEW,
  gatesVigentes,
  nomeDoAmbienteDePreview,
  previewProntoParaPublicar,
  transicaoDePreviewPermitida,
  urlPublicaDePreview,
  validarEntradaDePreview,
  type PreviewGate
} from './release-preview'

const ID = '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa'
const SHA = 'a'.repeat(40)

function gate(
  nome: string,
  result: PreviewGate['result'],
  sourceSha = SHA,
  createdAt = '2026-10-13T10:00:00.000Z'
): PreviewGate {
  return {
    id: `${nome}-${createdAt}`,
    previewId: ID,
    sourceSha,
    gate: nome,
    result,
    reason: null,
    createdAt
  }
}

describe('estados do PreviewRun', () => {
  it('um commit novo leva ready e failed de volta a preparing, no mesmo Preview', () => {
    expect(transicaoDePreviewPermitida('ready', 'preparing')).toBe(true)
    expect(transicaoDePreviewPermitida('failed', 'preparing')).toBe(true)
  })

  it('removing repete a si mesmo (retomada da limpeza) e só termina em removed', () => {
    expect(transicaoDePreviewPermitida('removing', 'removing')).toBe(true)
    expect(transicaoDePreviewPermitida('removing', 'removed')).toBe(true)
    expect(transicaoDePreviewPermitida('removing', 'ready')).toBe(false)
  })

  it('removed só reabre como queued; ready nunca pula direto para removed', () => {
    expect(transicaoDePreviewPermitida('removed', 'queued')).toBe(true)
    expect(transicaoDePreviewPermitida('removed', 'preparing')).toBe(false)
    expect(transicaoDePreviewPermitida('ready', 'removed')).toBe(false)
  })
})

describe('entrada do Preview', () => {
  const valida = {
    pullRequest: 12,
    headSha: SHA,
    specId: 'SPEC-Release-03',
    specRevision: '2026-08-29'
  }

  it('aceita PR, SHA, SPEC e revisão válidos', () => {
    expect(() => validarEntradaDePreview(valida)).not.toThrow()
  })

  it.each([
    ['PR zero', { pullRequest: 0 }],
    ['PR fracionário', { pullRequest: 1.5 }],
    ['SHA não hexadecimal', { headSha: 'main' }],
    ['SPEC vazia', { specId: '' }],
    ['SPEC com texto de PR', { specId: 'x; rm -rf /' }],
    ['revisão vazia', { specRevision: '' }]
  ])('recusa %s', (_nome, parcial) => {
    expect(() => validarEntradaDePreview({ ...valida, ...parcial })).toThrow(TypeError)
  })
})

describe('nome do ambiente temporário', () => {
  it('deriva só do id do run e da geração, de forma estável', () => {
    expect(nomeDoAmbienteDePreview(ID, 1)).toBe('pv-0f3a9c1e77b2-g1')
    expect(nomeDoAmbienteDePreview(ID, 1)).toBe(nomeDoAmbienteDePreview(ID, 1))
    expect(nomeDoAmbienteDePreview(ID, 2)).not.toBe(nomeDoAmbienteDePreview(ID, 1))
  })

  it('dois runs distintos nunca compartilham nome', () => {
    const outro = '1f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa'
    expect(nomeDoAmbienteDePreview(outro, 1)).not.toBe(nomeDoAmbienteDePreview(ID, 1))
  })

  it('segue o padrão que a limpeza exige para reconhecer posse', () => {
    expect(nomeDoAmbienteDePreview(ID, 3)).toMatch(PADRAO_DE_AMBIENTE_DE_PREVIEW)
    expect('production').not.toMatch(PADRAO_DE_AMBIENTE_DE_PREVIEW)
    expect('staging').not.toMatch(PADRAO_DE_AMBIENTE_DE_PREVIEW)
  })

  it('recusa id que não rende doze hexadecimais e geração inválida', () => {
    expect(() => nomeDoAmbienteDePreview('zzz', 1)).toThrow(TypeError)
    expect(() => nomeDoAmbienteDePreview(ID, 0)).toThrow(TypeError)
  })
})

describe('URL publicável no PR', () => {
  it('aceita https puro e devolve só a origem', () => {
    expect(urlPublicaDePreview('https://app-pv.vercel.app/')).toBe('https://app-pv.vercel.app')
  })

  it.each([
    'http://app.vercel.app',
    'https://user:senha@app.vercel.app',
    'https://app.vercel.app/?token=abc',
    'https://app.vercel.app/#access_token=abc',
    'não é url',
    ''
  ])('recusa %s', (valor) => {
    expect(urlPublicaDePreview(valor)).toBeNull()
  })

  it('trata ausência como nula', () => {
    expect(urlPublicaDePreview(undefined)).toBeNull()
    expect(urlPublicaDePreview(null)).toBeNull()
  })
})

describe('gates por SHA', () => {
  it('um commit novo invalida a evidência do SHA anterior', () => {
    const antigos = [gate('health', 'passed', 'b'.repeat(40))]
    expect(gatesVigentes(antigos, SHA)).toEqual([])
  })

  it('vale o último resultado de cada gate no SHA corrente', () => {
    const gates = [
      gate('health', 'blocked', SHA, '2026-10-13T10:00:00.000Z'),
      gate('health', 'passed', SHA, '2026-10-13T10:05:00.000Z')
    ]
    expect(gatesVigentes(gates, SHA).map((g) => g.result)).toEqual(['passed'])
  })

  it('só publica como pronto com todos os gates obrigatórios passados', () => {
    const todos = [
      'imagem',
      'backend',
      'migration',
      'seed',
      'health',
      'identidade',
      'frontend'
    ].map((n) => gate(n, 'passed'))
    expect(previewProntoParaPublicar(todos)).toBe(true)
    expect(previewProntoParaPublicar(todos.slice(1))).toBe(false)
    expect(previewProntoParaPublicar([...todos.slice(1), gate('imagem', 'unknown')])).toBe(false)
  })
})
