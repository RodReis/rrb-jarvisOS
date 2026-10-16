import { afterEach, describe, expect, it } from 'vitest'
import {
  ProcessKiller,
  SCOPE,
  SHA_A,
  SimulatedCrash,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

/**
 * Crash em cada fronteira (SPEC-Release-05, critério 2). O processo é morto antes e depois de
 * CADA gravação do caminho feliz — intenção, confirmação de passo, gate, deployment, transição de
 * estado, lease — e um processo novo retoma do último passo confirmado. A convergência é medida na
 * nuvem falsa com estado: um passo repetido às cegas apareceria como segundo deployment, segunda
 * migration ou segundo build, não como um mock que aceita tudo.
 */

let h: Harness

afterEach(() => h.fechar())

const LEASE_VENCIDO_MS = 20 * 60_000
const chamadas = (operacao: string): number => h.cloud.calls.filter((c) => c === operacao).length

/** Quantas gravações o caminho feliz faz: o intervalo de pontos de morte a percorrer. */
async function gravacoesDoCaminhoFeliz(): Promise<number> {
  const contador = new ProcessKiller(Number.MAX_SAFE_INTEGER, 'before')
  h = montarHarness({ morte: contador })
  const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
  expect(r.state).toBe('completed')
  const total = contador.calls
  h.fechar()
  return total
}

function convergiu(releaseId: string): void {
  for (const ambiente of ['staging', 'production'] as const) {
    // Nenhum efeito remoto repetido: um build, um deployment por ambiente, uma migration por ambiente.
    expect(h.cloud.backendHistory.filter((b) => b.environment === ambiente)).toHaveLength(1)
    expect(chamadas(`backend.deploy:${ambiente}`)).toBe(1)
    expect(chamadas(`frontend.assign:${ambiente}`)).toBe(1)
    expect(chamadas(`database.migrate:${ambiente}`)).toBe(1)
    expect(h.cloud.databases.get(ambiente)).toEqual(['001_init', '002_users'])
    expect(h.promotion.getDeployment(SCOPE, releaseId, ambiente, 'backend')).not.toBeNull()
    expect(h.promotion.getDeployment(SCOPE, releaseId, ambiente, 'frontend')).not.toBeNull()
  }
  expect(h.cloud.builds).toBe(1)
  expect(h.cloud.frontendBuilds.size).toBe(1)
  // O backup é anterior à intenção da migration: uma morte entre os dois o refaz, nunca mais que isso.
  expect(h.cloud.backups.length).toBeLessThanOrEqual(2)
  expect(h.cloud.backups.length).toBeGreaterThanOrEqual(1)
  expect(
    h.db.prepare(`SELECT COUNT(*) AS n FROM release_run WHERE project_id=?`).get(SCOPE.projectId)
  ).toEqual({ n: 1 })
}

async function morrerEmRetomar(
  gravacao: number,
  quando: 'before' | 'after'
): Promise<{ releaseId: string }> {
  const morte = new ProcessKiller(gravacao, quando)
  h = montarHarness({ morte })
  let primeira: Awaited<ReturnType<Harness['service']['handleMerge']>> | null = null
  try {
    primeira = await h.service.handleMerge(SCOPE, SHA_A, projeto())
  } catch (erro) {
    if (!(erro instanceof SimulatedCrash)) throw erro
  }
  // Morte na limpeza final dos leases (o `finally`) não propaga: a release já terminou.
  if (primeira) {
    expect(primeira.state).toBe('completed')
    return { releaseId: primeira.releaseId }
  }
  // O processo morto não largou os leases: o seguinte espera o prazo expirar e retoma.
  await h.clock.sleep(LEASE_VENCIDO_MS)
  const retomada = await h
    .novoServico({ ownerId: 'executor-2' })
    .handleMerge(SCOPE, SHA_A, projeto())
  expect(retomada.state, `retomada após morte na gravação ${gravacao} (${quando})`).toBe(
    'completed'
  )
  return { releaseId: retomada.releaseId }
}

describe('morte do processo em cada gravação do caminho feliz (critério 2)', () => {
  it.each(['before', 'after'] as const)(
    'um processo novo converge sem repetir efeito: morte %s de cada gravação',
    async (quando) => {
      const total = await gravacoesDoCaminhoFeliz()
      // Sanidade do instrumento: o caminho feliz grava dezenas de vezes (intenções, passos, gates, ...).
      expect(total).toBeGreaterThan(40)
      for (let gravacao = 1; gravacao <= total; gravacao += 1) {
        const { releaseId } = await morrerEmRetomar(gravacao, quando)
        try {
          convergiu(releaseId)
        } catch (erro) {
          throw new Error(
            `Não convergiu após morte ${quando} da gravação ${gravacao}/${total}: ${String(erro)}`
          )
        } finally {
          h.fechar()
        }
      }
    },
    300_000
  )

  it('com release anterior concluída, a morte em cada gravação ainda converge para completed', async () => {
    const total = await gravacoesDoCaminhoFeliz()
    for (let gravacao = 1; gravacao <= total; gravacao += 1) {
      const morte = new ProcessKiller(gravacao, 'after')
      h = montarHarness({ morte })
      semearReleaseConcluida(h)
      try {
        await h.service.handleMerge(SCOPE, SHA_A, projeto())
      } catch (erro) {
        if (!(erro instanceof SimulatedCrash)) throw erro
      }
      await h.clock.sleep(LEASE_VENCIDO_MS)
      const r = await h.novoServico({ ownerId: 'executor-2' }).handleMerge(SCOPE, SHA_A, projeto())
      expect(r.state, `gravação ${gravacao}/${total}`).toBe('completed')
      h.fechar()
    }
  }, 300_000)
})
