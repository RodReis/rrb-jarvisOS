import { gatesVigentes, urlPublicaDePreview } from '@shared/domain/release-preview'
import type { PreviewProjection } from './preview-ports'

/**
 * Comentário do PR com o estado do Preview (SPEC-Release-03). Montado por **lista de permissão**:
 * só entram SPEC, revisão, SHA, estado, URLs https sem credencial, nomes de gate e códigos de
 * motivo — todos validados. Nada que um provedor ou o texto do PR devolva chega aqui, então
 * segredo não tem por onde passar.
 */

const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const REVISAO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const CODIGO = /^[a-z0-9._:-]{1,64}$/
const GATE = /^[a-z0-9._-]{1,32}$/
const SHA = /^[a-f0-9]{7,64}$/i

const ROTULO_DO_ESTADO = {
  queued: 'na fila',
  preparing: 'em preparação',
  ready: 'pronto',
  failed: 'falhou',
  removing: 'remoção pendente',
  removed: 'removido'
} as const

const ROTULO_DO_GATE = { passed: 'passou', blocked: 'bloqueado', unknown: 'sem resultado' } as const

export function marcadorDoPreview(specId: string): string {
  if (!SPEC.test(specId)) throw new TypeError('SPEC inválida para o marcador do Preview.')
  return `<!-- jarvis-preview:${specId} -->`
}

function codigo(valor: string | null): string {
  return valor && CODIGO.test(valor) ? `\`${valor}\`` : '—'
}

export function renderizarComentarioDePreview(projecao: PreviewProjection): string {
  const { run } = projecao
  if (!SPEC.test(run.specId) || !REVISAO.test(run.specRevision) || !SHA.test(run.headSha))
    throw new TypeError('Preview com identidade inválida não pode ser publicado.')
  const removido = run.status === 'removed'
  const url = (tipo: 'frontend' | 'backend'): string => {
    if (removido) return '—'
    // Recurso de um commit anterior (a etapa que o atualizaria nem chegou a rodar) não é anunciado
    // junto ao SHA novo: a URL seria de outro código.
    const publica = urlPublicaDePreview(
      projecao.resources.find((r) => r.kind === tipo && r.sourceSha === run.headSha)?.url
    )
    return publica ?? '—'
  }
  const gates = gatesVigentes(projecao.gates, run.headSha).filter((g) => GATE.test(g.gate))
  const linhas = [
    marcadorDoPreview(run.specId),
    `### Preview isolado — ${ROTULO_DO_ESTADO[run.status]}`,
    '',
    '| | |',
    '|---|---|',
    `| SPEC | ${run.specId} (revisão ${run.specRevision}) |`,
    `| Commit | \`${run.headSha.slice(0, 12)}\` |`,
    `| Frontend | ${url('frontend')} |`,
    `| Backend | ${url('backend')} |`
  ]
  if (!removido) {
    linhas.push(
      '',
      `Gates do commit \`${run.headSha.slice(0, 12)}\`:`,
      '',
      '| Gate | Resultado | Motivo |',
      '|---|---|---|'
    )
    if (!gates.length) linhas.push('| — | — | — |')
    for (const g of gates)
      linhas.push(`| ${g.gate} | ${ROTULO_DO_GATE[g.result]} | ${codigo(g.reason)} |`)
  }
  const pendentes = projecao.resources.filter(
    (r) => r.kind !== 'image' && r.state !== 'destroyed' && run.status === 'removing'
  )
  if (pendentes.length)
    linhas.push('', `Limpeza pendente: ${pendentes.map((r) => r.kind).join(', ')}.`)
  linhas.push('', `Atualizado em ${run.updatedAt}.`)
  return linhas.join('\n')
}
