import { afterEach, describe, expect, it } from 'vitest'
import type { ReleaseScope } from '@shared/domain/release'
import {
  OUTRO_PROJETO,
  SCOPE,
  SHA_A,
  SHA_B,
  SHA_C,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

let h: Harness

afterEach(() => h.fechar())

const gates = (releaseId: string, scope: ReleaseScope = SCOPE) =>
  h.repository.detail({ ...scope, releaseId })!.gates
const compensacoes = (releaseId: string) =>
  h.promotion
    .listCompensations(SCOPE, releaseId)
    .map((c) => `${c.environment}:${c.action}:${c.state}`)

describe('falha antes da troca de tráfego (critério 5)', () => {
  it('migration que falha em Staging impede o deploy e não gera compensação', async () => {
    h = montarHarness()
    h.cloud.migrationOutcome = {
      state: 'failed',
      reason: 'migration-failed',
      failedAt: '002_users',
      applied: ['001_init']
    }
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'migration-failed', environment: 'staging' })
    expect(h.cloud.calls).not.toContain('backend.deploy:staging')
    expect(h.cloud.calls).not.toContain('frontend.assign:staging')
    expect(compensacoes(r.releaseId)).toEqual([])
    expect(gates(r.releaseId).find((g) => g.gate === 'migration')).toMatchObject({
      result: 'blocked',
      reason: 'migration-failed'
    })
    // A migration que falhou fica registrada como falha; a que passou, como confirmada.
    const estados = h.promotion
      .listMigrations(SCOPE, r.releaseId)
      .map((m) => `${m.migrationId}:${m.state}`)
    expect(estados).toEqual(['001_init:confirmed', '002_users:failed'])
  })

  it('migration que falha em Produção não troca o tráfego de Produção', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('database.migrate:production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', environment: 'production' })
    expect(h.cloud.calls).not.toContain('backend.deploy:production')
    expect(h.cloud.calls).not.toContain('frontend.assign:production')
    // Produção segue exatamente no que estava antes.
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.cloud.frontendAssigned.get('production')).toBe('dpl_antigo')
    expect(compensacoes(r.releaseId)).toEqual([])
  })

  it('o backup de Produção já feito permanece como referência mesmo com a migration falhando', async () => {
    h = montarHarness()
    h.cloud.failOn('database.migrate:production')
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(h.cloud.backups).toEqual([{ environment: 'production', backupRef: 'bkp-production-1' }])
  })

  it('falha de build do backend encerra a release sem tocar Staging nem Produção', async () => {
    h = montarHarness()
    h.cloud.failOn('build.backend')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', status: 'failed' })
    expect(h.cloud.calls.filter((c) => c.includes(':'))).toEqual([])
    expect(compensacoes(r.releaseId)).toEqual([])
  })
})

describe('health e smoke falhos impedem completed (critério 5)', () => {
  it('health falho no deploy de Staging reprova e compensa só Staging', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.scriptHealth('staging', [false])
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'health-down', environment: 'staging' })
    expect(h.cloud.calls.some((c) => c.endsWith(':production'))).toBe(false)
    expect(h.cloud.backends.get('staging')!.deploymentId).toBe('rw-staging-antigo')
  })

  it('smoke falho em Staging impede qualquer efeito em Produção', async () => {
    h = montarHarness()
    semearReleaseConcluida(h) // há para onde voltar: o desfecho esperado é failed
    h.cloud.smokeFails.add('staging')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', environment: 'staging', status: 'failed' })
    expect(h.cloud.calls.some((c) => c.endsWith(':production'))).toBe(false)
  })

  it('o motor de gates é a autoridade: gate não registrado barra Produção mesmo com o diário confirmado (regra 1)', async () => {
    h = montarHarness()
    semearReleaseConcluida(h) // há para onde voltar: o desfecho esperado é failed
    // Todos os passos de Staging confirmam, mas o resultado do E2E essencial não chega ao motor.
    const original = h.repository.recordGate.bind(h.repository)
    h.repository.recordGate = (input, now) => {
      if (input.gate !== 'e2e_essential') original(input, now)
    }
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({
      state: 'failed',
      reason: 'staging-e2e_essential',
      environment: 'staging'
    })
    expect(h.cloud.calls.some((c) => c.endsWith(':production'))).toBe(false)
  })

  it('contrafactual: Produção nunca é promovida antes de Staging aprovado', async () => {
    h = montarHarness()
    h.cloud.smokeFails.add('staging')
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(h.cloud.backends.has('production')).toBe(false)
    expect(h.cloud.frontendAssigned.has('production')).toBe(false)
  })

  it('frontend fiado ao backend do outro ambiente reprova o gate de fiação', async () => {
    h = montarHarness()
    semearReleaseConcluida(h) // há para onde voltar: o desfecho esperado é failed
    h.cloud.crossWired = 'production'
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({
      state: 'failed',
      environment: 'production',
      reason: 'frontend-wiring'
    })
    expect(
      gates(r.releaseId).find((g) => g.gate === 'frontend_wiring' && g.environment === 'production')
    ).toMatchObject({ result: 'blocked' })
  })
})

describe('compensação de aplicação (critério 6)', () => {
  it('falha em Produção devolve backend e frontend aos deployments da última release concluída', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', environment: 'production' })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.cloud.frontendAssigned.get('production')).toBe('dpl_antigo')
    expect(compensacoes(r.releaseId)).toEqual([
      'production:frontend:restore:dpl_antigo:confirmed',
      'production:backend:restore:rw-production-antigo:confirmed'
    ])
    // Staging não é compensado por falha de Produção: segue na versão nova.
    expect(h.cloud.backends.get('staging')!.deploymentId).not.toBe('rw-staging-antigo')
  })

  it('o banco permanece forward-only: nenhuma restauração, as migrations novas seguem aplicadas', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(h.cloud.databases.get('production')).toEqual(['001_init', '002_users'])
    expect(h.cloud.calls.some((c) => c.includes('restore'))).toBe(false)
    expect(h.cloud.calls.filter((c) => c === 'database.migrate:production')).toHaveLength(1)
  })

  it('compensação que falha deixa a release degraded e o rastro da falha', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    h.cloud.failOn('backend.rollback:production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'degraded', status: 'degraded', environment: 'production' })
    expect(compensacoes(r.releaseId)).toEqual([
      'production:frontend:restore:dpl_antigo:confirmed',
      'production:backend:restore:rw-production-antigo:failed'
    ])
  })

  it('sem release anterior concluída não há para onde voltar: a versão ruim segue no ar, então degraded', async () => {
    h = montarHarness()
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'degraded', status: 'degraded' })
    expect(compensacoes(r.releaseId)).toEqual([
      'production:frontend:none:no-previous:failed',
      'production:backend:none:no-previous:failed'
    ])
  })

  it('o destino é a última release CONCLUÍDA, não o que está no ar: resíduo de release degradada fica de fora', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    // R1 falha em Produção e a compensação do backend falha: o resíduo de R1 segue no ar.
    h.cloud.smokeFails.add('production')
    h.cloud.failOn('backend.rollback:production')
    const r1 = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r1.state).toBe('degraded')
    const residuo = h.cloud.backends.get('production')!.deploymentId
    expect(residuo).not.toBe('rw-production-antigo')
    // Degradada pausa o projeto: o operador reconhece o resíduo antes da próxima release.
    await h.service.recover(SCOPE, { acknowledge: true })

    // R2 falha em Produção: volta para a última CONCLUÍDA (R0), não para o resíduo de R1.
    const r2 = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(r2.state).toBe('failed')
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.cloud.frontendAssigned.get('production')).toBe('dpl_antigo')
  })

  it('release vizinha que conclui depois de B preparar não deixa o destino velho: Produção volta ao frontend e ao backend de A', async () => {
    let liberar!: () => void
    const trava = new Promise<void>((resolve) => (liberar = resolve))
    let chegou!: () => void
    const estabilizando = new Promise<void>((resolve) => (chegou = resolve))
    let primeira = true
    h = montarHarness({
      sleep: async (ms) => {
        if (primeira) {
          primeira = false
          chegou()
          await trava // A fica em estabilização enquanto B prepara e passa por Staging
        }
        await h.clock.sleep(ms)
      }
    })
    semearReleaseConcluida(h) // R0 é o estado anterior a A
    const a = h.service.handleMerge(SCOPE, SHA_A, projeto())
    await estabilizando
    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(b).toMatchObject({ state: 'waiting', status: 'staging' })

    liberar()
    const resultadoA = await a
    expect(resultadoA.state).toBe('completed')
    const frontendDeA = h.promotion.getDeployment(
      SCOPE,
      resultadoA.releaseId,
      'production',
      'frontend'
    )!
    const backendDeA = h.promotion.getDeployment(
      SCOPE,
      resultadoA.releaseId,
      'production',
      'backend'
    )!

    h.cloud.smokeFails.add('production')
    const retomadas = await h.service.resume(SCOPE, projeto())
    expect(retomadas.map((x) => x.state)).toEqual(['failed'])

    // Antes da correção o frontend voltava ao de R0 (dpl_antigo): o destino foi gravado antes de A concluir.
    expect(h.cloud.frontendAssigned.get('production')).toBe(frontendDeA.externalId)
    expect(h.cloud.backends.get('production')!.deploymentId).toBe(backendDeA.externalId)
  })
})

describe('estabilização (critério 7)', () => {
  it('cinco minutos saudáveis produzem completed, e só então', async () => {
    const statusDuranteAEspera: string[] = []
    h = montarHarness({
      sleep: async (ms) => {
        statusDuranteAEspera.push(h.repository.queue(SCOPE).candidate?.status ?? 'sem-candidato')
        await h.clock.sleep(ms)
      }
    })
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(new Set(statusDuranteAEspera)).toEqual(new Set(['stabilizing']))
    expect(statusDuranteAEspera).toHaveLength(10)
  })

  it('uma falha isolada reinicia a contagem e a release ainda conclui', async () => {
    h = montarHarness()
    // 1ª resposta = passo backend_healthy; depois, uma por observação: t0 e t30 saudáveis, t60 falha.
    h.cloud.scriptHealth('production', [true, true, true, false])
    const inicio = h.clock.nowMs()
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    // A janela recomeça na falha (t=60s) e fecha 5 min depois.
    expect(h.clock.nowMs() - inicio).toBe(6 * 60_000)
    const estab = gates(r.releaseId).filter((g) => g.gate === 'stabilization')
    expect(estab.map((g) => `${g.result}:${g.reason}`)).toEqual([
      'unknown:health-restarted',
      'passed:null'
    ])
  })

  it('a segunda falha compensa: a release não conclui e Produção volta ao estado anterior', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.scriptHealth('production', [true, true, false, false])
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'stabilization-failed', status: 'failed' })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.cloud.frontendAssigned.get('production')).toBe('dpl_antigo')
    expect(h.cloud.databases.get('production')).toEqual(['001_init', '002_users'])
  })

  it('janela, intervalo e reinícios são configuráveis por projeto', async () => {
    h = montarHarness()
    const inicio = h.clock.nowMs()
    const r = await h.service.handleMerge(
      SCOPE,
      SHA_A,
      projeto(undefined, {
        stabilization: { windowMs: 60_000, intervalMs: 20_000, maxRestarts: 0 }
      })
    )
    expect(r.state).toBe('completed')
    expect(h.clock.nowMs() - inicio).toBe(60_000)
  })

  it('smoke que falha ao fechar a janela compensa em vez de concluir', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    // Só o smoke de Produção falha, e só depois do passo smoke_passed: simula regressão tardia.
    let verificacoes = 0
    const original = h.cloud.verifier.verify
    h.cloud.verifier.verify = async (input) => {
      const resultado = await original(input)
      verificacoes += 1
      return input.environment === 'production' &&
        input.checks.includes('smoke') &&
        verificacoes > 8
        ? resultado.map((x) => ({ ...x, result: 'blocked' as const, reason: 'smoke-failed' }))
        : resultado
    }
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r).toMatchObject({ state: 'failed', reason: 'stabilization-failed' })
  })
})

describe('serialização por projeto e ambiente (critério 8)', () => {
  it('a segunda release do mesmo projeto aguarda a Produção; outro projeto segue', async () => {
    let liberar!: () => void
    const trava = new Promise<void>((resolve) => (liberar = resolve))
    let chegouEmEstabilizacao!: () => void
    const estabilizando = new Promise<void>((resolve) => (chegouEmEstabilizacao = resolve))
    let primeiraEspera = true
    h = montarHarness({
      sleep: async (ms) => {
        if (primeiraEspera) {
          primeiraEspera = false
          chegouEmEstabilizacao()
          await trava // A fica parada em estabilização até o teste soltar
        }
        await h.clock.sleep(ms)
      }
    })

    const a = h.service.handleMerge(SCOPE, SHA_A, projeto())
    await estabilizando // A está em Produção, estabilizando, segurando a lane

    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(b).toMatchObject({ state: 'waiting', reason: 'lane-busy', status: 'staging' })

    // Outro projeto não espera por ninguém: tem lane, lease e nuvem próprias.
    const outro = h.outroProjeto()
    const c = await outro.service.handleMerge(OUTRO_PROJETO, SHA_C, projeto())
    expect(c.state).toBe('completed')

    liberar()
    expect((await a).state).toBe('completed')

    // B retoma de onde parou: não refaz Staging, só Produção.
    const buildsAntes = h.cloud.builds
    const retomadas = await h.service.resume(SCOPE, projeto())
    expect(retomadas.map((x) => x.state)).toEqual(['completed'])
    expect(retomadas[0]!.releaseId).toBe(b.releaseId)
    expect(h.cloud.builds).toBe(buildsAntes)
  })

  it('o candidato é imutável depois de Staging: SHA novo vira outra release', async () => {
    let liberar!: () => void
    const trava = new Promise<void>((resolve) => (liberar = resolve))
    let chegou!: () => void
    const estabilizando = new Promise<void>((resolve) => (chegou = resolve))
    let primeira = true
    h = montarHarness({
      sleep: async (ms) => {
        if (primeira) {
          primeira = false
          chegou()
          await trava
        }
        await h.clock.sleep(ms)
      }
    })
    const a = h.service.handleMerge(SCOPE, SHA_A, projeto())
    await estabilizando
    const releaseA = h.repository.queue(SCOPE).candidate?.id ?? ''

    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(b.releaseId).not.toBe(releaseA)
    expect(h.repository.get({ ...SCOPE, releaseId: releaseA })).toMatchObject({
      sha: SHA_A,
      status: 'stabilizing'
    })
    liberar()
    await a
  })

  it('SHA novo antes de Staging consolida o candidato: o intermediário vira superseded', async () => {
    h = montarHarness()
    const candidato = h.repository.enqueue(SCOPE, SHA_A, h.clock.now()).release.id
    const r = await h.service.handleMerge(SCOPE, SHA_B, projeto())

    expect(r.state).toBe('completed')
    expect(h.repository.get({ ...SCOPE, releaseId: candidato })?.status).toBe('superseded')
    expect(h.cloud.builds).toBe(1)
  })

  it('o mesmo merge entregue duas vezes não duplica efeito', async () => {
    h = montarHarness()
    const a = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const chamadas = h.cloud.calls.length
    const b = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(b.releaseId).toBe(a.releaseId)
    expect(h.cloud.calls).toHaveLength(chamadas)
  })
})

describe('efeito incerto e retomada', () => {
  it('timeout no deploy sem que o provedor responda à reconciliação: o passo fica ambíguo, sem compensar nem repetir às cegas', async () => {
    h = montarHarness()
    h.cloud.failOn('backend.deploy:staging', 'timeout')
    h.cloud.failOn('backend.current:staging', 'timeout', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'blocked', environment: 'staging', step: 'backend_healthy' })
    expect(r.status).toBe('staging')
    expect(compensacoes(r.releaseId)).toEqual([])
    expect(h.cloud.calls.filter((c) => c === 'backend.deploy:staging')).toHaveLength(1)
    const passo = h.repository.getStep(
      { ...SCOPE, releaseId: r.releaseId, environment: 'staging' },
      'backend_healthy'
    )
    expect(passo?.state).toBe('ambiguous')
  })

  it('a retomada reconcilia contra o provedor antes de repetir e conclui', async () => {
    h = montarHarness()
    h.cloud.failOn('backend.deploy:staging', 'timeout')
    h.cloud.failOn('backend.current:staging', 'timeout', 3)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('blocked')

    const retomada = await h.service.promote(SCOPE, r.releaseId, projeto())
    expect(retomada.state).toBe('completed')
    // Reconciliou (consultou o ambiente) antes de implantar de novo.
    const calls = h.cloud.calls
    expect(calls.indexOf('backend.current:staging')).toBeGreaterThan(-1)
    expect(calls.indexOf('backend.current:staging')).toBeLessThan(
      calls.lastIndexOf('backend.deploy:staging')
    )
    expect(h.cloud.builds).toBe(1)
  })

  it('efeito aplicado que só perdeu a resposta é reconhecido sem implantar duas vezes', async () => {
    h = montarHarness()
    // Aplica de verdade e depois "perde a resposta": o deploy existe no provedor.
    const original = h.cloud.backend.deploy
    let primeira = true
    h.cloud.backend.deploy = async (input) => {
      const feito = await original(input)
      if (primeira && input.environment === 'staging') {
        primeira = false
        throw new Error('resposta perdida')
      }
      return feito
    }
    // O provedor também não responde à primeira rodada de reconciliação: a release para...
    h.cloud.failOn('backend.current:staging', 'timeout', 3)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('blocked')

    // ...e a retomada reconhece o deploy que já existe, em vez de implantar outro.
    const retomada = await h.service.promote(SCOPE, r.releaseId, projeto())
    expect(retomada.state).toBe('completed')
    expect(h.cloud.backendHistory.filter((b) => b.environment === 'staging')).toHaveLength(1)
    expect(h.promotion.getDeployment(SCOPE, r.releaseId, 'staging', 'backend')).not.toBeNull()
  })

  it('app reaberto no meio da estabilização retoma dali, sem repetir deploy nem migration', async () => {
    let esperas = 0
    h = montarHarness({
      sleep: async (ms) => {
        esperas += 1
        if (esperas === 3) throw new Error('processo encerrado')
        await h.clock.sleep(ms)
      }
    })
    await expect(h.service.handleMerge(SCOPE, SHA_A, projeto())).rejects.toThrow(
      'processo encerrado'
    )
    const chamadas = h.cloud.calls.filter((c) => /deploy|migrate|build|backup/.test(c)).length

    const novo = h.novoServico()
    const r = await novo.resume(SCOPE, projeto())
    expect(r.map((x) => x.state)).toEqual(['completed'])
    expect(h.cloud.calls.filter((c) => /deploy|migrate|build|backup/.test(c))).toHaveLength(
      chamadas
    )
  })

  it('dois executores na mesma release: o segundo espera e não escreve', async () => {
    let liberar!: () => void
    const trava = new Promise<void>((resolve) => (liberar = resolve))
    let chegou!: () => void
    const estabilizando = new Promise<void>((resolve) => (chegou = resolve))
    let primeira = true
    h = montarHarness({
      sleep: async (ms) => {
        if (primeira) {
          primeira = false
          chegou()
          await trava
        }
        await h.clock.sleep(ms)
      }
    })
    const a = h.service.handleMerge(SCOPE, SHA_A, projeto())
    await estabilizando
    const releaseId = h.repository.queue(SCOPE).candidate!.id

    const intruso = h.novoServico({ ownerId: 'executor-2' })
    const r = await intruso.promote(SCOPE, releaseId, projeto())
    expect(r).toMatchObject({ state: 'waiting', reason: 'lease-busy' })

    liberar()
    expect((await a).state).toBe('completed')
  })
})

describe('endurecimento pós-revisão', () => {
  it('migration que lança erro definitivo registra failed nas linhas e bloqueia o gate', async () => {
    h = montarHarness()
    h.cloud.failOn('database.migrate:staging', 'failed')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('failed')
    const estados = h.promotion.listMigrations(SCOPE, r.releaseId).map((m) => m.state)
    expect(estados).toEqual(['failed', 'failed'])
    expect(
      gates(r.releaseId).find((g) => g.gate === 'migration' && g.environment === 'staging')
    ).toMatchObject({ result: 'blocked', reason: 'migration-failed' })
  })

  it('timeout no backup de Produção não prende a lane: nada foi migrado, então a repetição é segura', async () => {
    h = montarHarness()
    h.cloud.failOn('database.backup:production', 'timeout')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    // O backup é anterior à intenção da migration: sem linha de migration, reconciliar devolve
    // "não aplicado" e o passo é repetido na mesma execução — a migration roda uma única vez.
    expect(r.state).toBe('completed')
    expect(h.cloud.calls.filter((c) => c === 'database.migrate:production')).toHaveLength(1)
    expect(h.cloud.databases.get('production')).toEqual(['001_init', '002_users'])
  })

  it('timeout DEPOIS de a migration começar continua exigindo reconciliação: sem leitura do banco, não repete às cegas', async () => {
    h = montarHarness()
    h.cloud.failOn('database.migrate:production', 'timeout')
    h.cloud.failOn('database.applied:production', 'timeout', 20)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r).toMatchObject({ state: 'blocked', step: 'database_migrated' })

    const retomada = await h.service.promote(SCOPE, r.releaseId, projeto())
    expect(retomada.state).toBe('blocked')
    expect(h.cloud.calls.filter((c) => c === 'database.migrate:production')).toHaveLength(1)
  })

  it('verificação de estabilização que devolve lista vazia não conta como saudável', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    const original = h.cloud.verifier.verify
    h.cloud.verifier.verify = async (input) =>
      input.environment === 'production' && input.checks.length === 2
        ? [] // o verificador "esqueceu" de responder os checks da estabilização
        : original(input)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r).toMatchObject({ state: 'failed', reason: 'stabilization-failed' })
  })

  it('merge que chega com o candidato anterior em passo incerto vira desfecho, não exceção', async () => {
    h = montarHarness()
    const candidato = h.repository.enqueue(SCOPE, SHA_A, h.clock.now()).release.id
    h.db
      .prepare(
        `INSERT INTO release_step
           (user_id,workspace_id,project_id,release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at)
         VALUES (?,?,?,?, 'staging', 'prepared', 'k', ?, 'intended', 1, ?)`
      )
      .run(
        SCOPE.userId,
        SCOPE.workspaceId,
        SCOPE.projectId,
        candidato,
        'e'.repeat(64),
        h.clock.now()
      )

    const r = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(r).toMatchObject({
      state: 'blocked',
      reason: 'reconciliation-required',
      releaseId: candidato
    })
    // O SHA novo não ganhou release: o chamador precisa reentregar o merge depois de reconciliar.
    expect(h.repository.queue(SCOPE).candidate?.sha).toBe(SHA_A)
  })

  it('o lease é renovado durante a estabilização: janela maior que o lease ainda conclui', async () => {
    h = montarHarness({ leaseMs: 2 * 60_000 })
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('completed')
  })
})
