import { describe, expect, it } from 'vitest'
import { getRepositoryInventory } from './github-operations'
import { GithubRest } from './github-rest'

describe('repo.inventory', () => {
  it('percorre páginas, lê checks do SHA atual e devolve somente metadados normalizados', async () => {
    const chamadas: string[] = []
    const cliente = new GithubRest('https://api.github.test', 'token', async (url) => {
      const parsed = new URL(url)
      chamadas.push(`${parsed.pathname}${parsed.search}`)
      if (parsed.pathname.endsWith('/issues')) {
        const pagina = Number(parsed.searchParams.get('page'))
        const corpo =
          pagina === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                number: index + 1,
                title: `Issue ${index + 1}`,
                state: 'open',
                labels: []
              }))
            : [{ number: 101, title: 'Fatia', state: 'open', labels: [{ name: 'proplan:doing' }] }]
        return new Response(JSON.stringify(corpo), { status: 200 })
      }
      if (parsed.pathname.endsWith('/pulls')) {
        return new Response(
          JSON.stringify([
            {
              number: 22,
              state: 'open',
              merged_at: null,
              merge_commit_sha: null,
              head: { ref: 'feat/fatia', sha: 'a'.repeat(40) },
              base: { ref: 'main' },
              body: 'refs #101\ntexto não deve ser retornado'
            }
          ]),
          { status: 200 }
        )
      }
      if (parsed.pathname.endsWith('/branches')) {
        return new Response(JSON.stringify([{ name: 'main', commit: { sha: 'b'.repeat(40) } }]), {
          status: 200
        })
      }
      if (parsed.pathname.endsWith('/check-runs')) {
        return new Response(
          JSON.stringify({ check_runs: [{ status: 'completed', conclusion: 'success' }] }),
          { status: 200 }
        )
      }
      return new Response('{}', { status: 404 })
    })

    const resultado = await getRepositoryInventory(cliente, { owner: 'org', repo: 'app' })
    expect(resultado.data.issues).toHaveLength(101)
    expect(resultado.data.issues[100]).toEqual({
      numero: 101,
      titulo: 'Fatia',
      estado: 'open',
      labels: ['proplan:doing']
    })
    expect(resultado.data.pullRequests[0]).toMatchObject({
      numero: 22,
      headSha: 'a'.repeat(40),
      checks: 'success',
      issuesReferenciadas: [101]
    })
    expect(resultado.data.branches).toEqual([{ nome: 'main', sha: 'b'.repeat(40) }])
    expect(JSON.stringify(resultado.data)).not.toContain('texto não deve ser retornado')
    expect(chamadas.some((path) => path.includes('/issues?') && path.includes('page=2'))).toBe(true)
  })

  it('nunca transforma check-run ausente em sucesso', async () => {
    const cliente = new GithubRest('https://api.github.test', 'token', async (url) => {
      const path = new URL(url).pathname
      const body = path.endsWith('/pulls')
        ? [
            {
              number: 1,
              state: 'open',
              head: { ref: 'feat/x', sha: 'a'.repeat(40) },
              base: { ref: 'main' }
            }
          ]
        : path.endsWith('/check-runs')
          ? { check_runs: [] }
          : []
      return new Response(JSON.stringify(body), { status: 200 })
    })
    const resultado = await getRepositoryInventory(cliente, { owner: 'org', repo: 'app' })
    expect(resultado.data.pullRequests[0]?.checks).toBe('unknown')
  })
})
