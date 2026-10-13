import { describe, expect, it } from 'vitest'
import type { PreviewRun } from '@shared/domain/release'
import type { PreviewGate, PreviewResource } from '@shared/domain/release-preview'
import { marcadorDoPreview, renderizarComentarioDePreview } from './preview-comment'
import type { PreviewProjection } from './preview-ports'

const SHA = 'a'.repeat(40)
const RUN: PreviewRun = {
  id: '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa',
  userId: 'u',
  workspaceId: 'jarvis',
  projectId: 'p',
  pullRequest: 12,
  specId: 'SPEC-Release-03',
  specRevision: '2026-08-29',
  headSha: SHA,
  generation: 1,
  status: 'ready',
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:05:00.000Z'
}

function recurso(
  kind: PreviewResource['kind'],
  url: string | undefined,
  state: PreviewResource['state'] = 'ready'
): PreviewResource {
  return {
    id: kind, previewId: RUN.id, generation: 1, kind, provider: 'vercel', externalId: kind,
    ...(url ? { url } : {}), sourceSha: SHA, state, reason: null, createdAt: RUN.createdAt, updatedAt: RUN.updatedAt
  } // prettier-ignore
}

function gate(
  nome: string,
  result: PreviewGate['result'],
  sourceSha = SHA,
  reason: string | null = null
): PreviewGate {
  return {
    id: nome + sourceSha,
    previewId: RUN.id,
    sourceSha,
    gate: nome,
    result,
    reason,
    createdAt: RUN.updatedAt
  }
}

function projecao(parcial: Partial<PreviewProjection> = {}): PreviewProjection {
  return {
    run: RUN,
    resources: [
      recurso('frontend', 'https://web-1.vercel.app'),
      recurso('backend', 'https://api.up.railway.app')
    ],
    gates: [gate('health', 'passed'), gate('seed', 'blocked', SHA, 'seed-failed')],
    ...parcial
  }
}

describe('comentário do Preview no PR', () => {
  it('traz marcador, SPEC e revisão, SHA, URLs e gates verificáveis', () => {
    const texto = renderizarComentarioDePreview(projecao())
    expect(texto.startsWith(marcadorDoPreview('SPEC-Release-03'))).toBe(true)
    expect(texto).toContain('SPEC-Release-03 (revisão 2026-08-29)')
    expect(texto).toContain('`aaaaaaaaaaaa`')
    expect(texto).toContain('https://web-1.vercel.app')
    expect(texto).toContain('https://api.up.railway.app')
    expect(texto).toContain('| health | passou | — |')
    expect(texto).toContain('| seed | bloqueado | `seed-failed` |')
  })

  it('mostra só os gates do SHA vigente', () => {
    const texto = renderizarComentarioDePreview(
      projecao({ gates: [gate('health', 'passed', 'b'.repeat(40)), gate('seed', 'passed')] })
    )
    expect(texto).toContain('| seed | passou')
    expect(texto).not.toContain('| health |')
  })

  it('URL com credencial, query ou http nunca chega ao comentário', () => {
    const texto = renderizarComentarioDePreview(
      projecao({
        resources: [
          recurso('frontend', 'https://u:senha@web.vercel.app'),
          recurso('backend', 'https://api.up.railway.app/?token=SEGREDO')
        ]
      })
    )
    expect(texto).not.toMatch(/senha|SEGREDO|u:senha/)
    expect(texto).toContain('| Frontend | — |')
  })

  it('motivo fora do formato de código é descartado, não escapado', () => {
    const texto = renderizarComentarioDePreview(
      projecao({ gates: [gate('seed', 'blocked', SHA, 'Erro: senha=abc 123')] })
    )
    expect(texto).not.toContain('senha=abc')
    expect(texto).toContain('| seed | bloqueado | — |')
  })

  it('removido não anuncia mais URLs nem gates', () => {
    const texto = renderizarComentarioDePreview(projecao({ run: { ...RUN, status: 'removed' } }))
    expect(texto).toContain('removido')
    expect(texto).not.toContain('https://')
    expect(texto).not.toContain('Gates do commit')
  })

  it('remoção pendente lista o que ainda não foi confirmado', () => {
    const texto = renderizarComentarioDePreview(
      projecao({
        run: { ...RUN, status: 'removing' },
        resources: [
          recurso('backend', undefined, 'failed'),
          recurso('frontend', undefined, 'destroyed')
        ]
      })
    )
    expect(texto).toContain('Limpeza pendente: backend.')
  })

  it('recusa identidade inválida em vez de publicar', () => {
    expect(() =>
      renderizarComentarioDePreview(projecao({ run: { ...RUN, specId: 'x; y' } }))
    ).toThrow(TypeError)
    expect(() =>
      renderizarComentarioDePreview(projecao({ run: { ...RUN, headSha: 'main' } }))
    ).toThrow(TypeError)
  })

  it('URL de recurso de um commit anterior não é anunciada junto ao SHA novo', () => {
    const antigo = {
      ...recurso('frontend', 'https://web-velho.vercel.app'),
      sourceSha: 'b'.repeat(40)
    }
    const texto = renderizarComentarioDePreview(
      projecao({ resources: [antigo, recurso('backend', 'https://api.up.railway.app')] })
    )
    expect(texto).not.toContain('web-velho')
    expect(texto).toContain('| Frontend | — |')
    expect(texto).toContain('https://api.up.railway.app')
  })
})
