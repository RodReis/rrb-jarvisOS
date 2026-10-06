import { describe, expect, it } from 'vitest'
import { getIssueState } from './github-operations'
import { GithubRest } from './github-rest'

const input = { owner: 'org', repo: 'app', issue: 370 }

function rest(corpo: unknown): GithubRest {
  return new GithubRest(
    'https://api.github.test',
    'token-de-teste',
    async () =>
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
  )
}

describe('issue.get-state', () => {
  it('só reconhece o aceite quando a issue está fechada e finalizada', async () => {
    const fechada = await getIssueState(
      rest({ number: 370, state: 'closed', labels: [{ name: 'proplan:finalizado' }] }),
      input
    )
    expect(fechada.data).toEqual({ numero: 370, estado: 'closed', finalizado: true })

    const aberta = await getIssueState(
      rest({ number: 370, state: 'open', labels: [{ name: 'proplan:finalizado' }] }),
      input
    )
    expect(aberta.data.estado).toBe('open')
  })

  it('recusa estado não reconhecido em vez de mostrar aceite falso', async () => {
    await expect(getIssueState(rest({ number: 370, state: 'unknown' }), input)).rejects.toThrow(
      'Estado inválido'
    )
  })
})
