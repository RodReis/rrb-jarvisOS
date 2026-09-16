import { describe, expect, it, vi } from 'vitest'
import { proximaExpiracao, type Lease } from '@shared/domain/lease'
import type { EntradaDoDiario } from '@shared/domain/effect-journal'
import { CodingExecutorRuntime } from './coding-executor-runtime'
import { FakeCodingExecutorAdapter } from './fake-coding-executor-adapter'
import {
  ExecutorRouter,
  selecionarExecutor,
  type AchadoDeExecutor,
  type EstadoDoExecutor,
  type ExecutorDeCodigo,
  type PedidoRoteado,
  type PreferenciaDeExecutor
} from './executor-router'

const AGORA = 1_700_000_000_000
const USER = 'u-1'
const RUN = 'run-1'
const POLITICA: PreferenciaDeExecutor = {
  taskType: 'code',
  executores: ['claude-code', 'codex-exec']
}

function estado(
  executor: ExecutorDeCodigo,
  sobrescreve: Partial<EstadoDoExecutor> = {}
): EstadoDoExecutor {
  return {
    executor,
    disponivel: true,
    modoDeCobranca: 'unmetered',
    modelo: executor === 'claude-code' ? 'claude-opus-5' : 'gpt-5.6-sol',
    autenticacao: { referencia: `${executor}-profile` },
    cobrancaAutorizada: true,
    elegivel: true,
    ...sobrescreve
  }
}

function pedido(sobrescreve: Partial<PedidoRoteado> = {}): PedidoRoteado {
  return {
    runId: RUN,
    attemptId: 'att',
    chaveIdempotente: 'slice-119',
    taskType: 'code',
    userId: USER,
    workspaceId: 'jarvis',
    contextPackId: 'pack-1',
    worktree: 'C:/work',
    pathsPermitidos: ['src/main/executors'],
    validacoes: [['npm', 'test']],
    limiteDeTempoMs: 5_000,
    revisoesAprovadas: ['revisao-padrao'],
    headSha: 'abc123',
    revisao: 'rev-119',
    ...sobrescreve
  }
}

function adapterSucesso(): FakeCodingExecutorAdapter {
  return new FakeCodingExecutorAdapter({
    eventos: [
      { tipo: 'started', sessao: 'sessao-nova' },
      { tipo: 'path_changed', path: 'src/main/executors/executor-router.ts' },
      { tipo: 'done', resumo: 'ok' }
    ],
    modosSuportados: ['unmetered', 'subscription_limited', 'metered']
  })
}

function adapterFalha(): FakeCodingExecutorAdapter {
  return new FakeCodingExecutorAdapter({
    eventos: [
      { tipo: 'started', sessao: 'sessao-falha' },
      { tipo: 'failed', erro: 'quebrou', assinatura: 'falha:teste' }
    ],
    modosSuportados: ['unmetered', 'subscription_limited', 'metered']
  })
}

function nomeado<T extends FakeCodingExecutorAdapter>(adapter: T, nome: ExecutorDeCodigo): T {
  Object.defineProperty(adapter, 'nome', { value: nome })
  return adapter
}

function lease(sobrescreve: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: USER,
    proprietario: RUN,
    recurso: `wip:global:writer:${RUN}`,
    heartbeatEm: AGORA,
    expiraEm: proximaExpiracao(AGORA),
    created_at: new Date(AGORA).toISOString(),
    ...sobrescreve
  }
}

function efeitoConfirmado(): EntradaDoDiario {
  return {
    id: 'efeito-1',
    userId: USER,
    workspaceId: 'jarvis',
    chaveIdempotente: 'slice-119',
    fingerprint: 'fp',
    alvo: 'github:merge',
    correlationId: 'corr-1',
    estado: 'confirmed',
    externalRefId: 'pr-7',
    criadoEm: new Date(AGORA).toISOString(),
    atualizadoEm: new Date(AGORA).toISOString()
  }
}

function montar(
  opcoes: {
    readonly claude?: FakeCodingExecutorAdapter
    readonly codex?: FakeCodingExecutorAdapter
    readonly leaseAtual?: Lease
    readonly efeito?: EntradaDoDiario
    readonly revisar?: (
      p: Parameters<ConstructorParameters<typeof ExecutorRouter>[0]['revisar']>[0]
    ) => Promise<readonly AchadoDeExecutor[]>
  } = {}
): ExecutorRouter {
  return new ExecutorRouter({
    runtime: new CodingExecutorRuntime(),
    adapters: {
      'claude-code': nomeado(opcoes.claude ?? adapterSucesso(), 'claude-code'),
      'codex-exec': nomeado(opcoes.codex ?? adapterSucesso(), 'codex-exec')
    },
    lease: {
      buscar: vi.fn(() => opcoes.leaseAtual),
      adquirir: vi.fn(() => lease())
    },
    effectJournal: {
      buscarPorChave: vi.fn(() => opcoes.efeito)
    },
    revisar: opcoes.revisar ?? vi.fn(async () => []),
    agora: () => AGORA
  })
}

describe('selecionarExecutor — matriz de selecao/fallback/cobranca', () => {
  it('escolhe o preferido quando ele esta elegivel', () => {
    const selecao = selecionarExecutor(POLITICA, [estado('claude-code'), estado('codex-exec')])

    expect(selecao).toMatchObject({
      decisao: 'escolhido',
      executor: 'claude-code',
      motivo: 'preferido'
    })
  })

  it('cai apenas para rota previamente autorizada e registra quem pulou', () => {
    const selecao = selecionarExecutor(POLITICA, [
      estado('claude-code', { disponivel: false, motivoIndisponivel: 'offline' }),
      estado('codex-exec')
    ])

    expect(selecao).toMatchObject({
      decisao: 'escolhido',
      executor: 'codex-exec',
      motivo: 'fallback'
    })
    expect(selecao.excluidos).toEqual([{ executor: 'claude-code', motivo: 'offline' }])
  })

  it('rota paga sem autorizacao bloqueia, nunca vira fallback inferido', () => {
    const selecao = selecionarExecutor(POLITICA, [
      estado('claude-code', { disponivel: false }),
      estado('codex-exec', { modoDeCobranca: 'metered', cobrancaAutorizada: false })
    ])

    expect(selecao.decisao).toBe('bloqueado')
    expect(selecao.motivo).toBe('rota-paga-nao-autorizada')
  })
})

describe('ExecutorRouter — writer lease e fallback reconciliado', () => {
  it('um lease vigente de outro run impede segundo writer', async () => {
    const router = montar({ leaseAtual: lease({ proprietario: 'run-outro' }) })

    const resultado = await router.executar(pedido(), POLITICA, [
      estado('claude-code'),
      estado('codex-exec')
    ])

    expect(resultado.status).toBe('espera')
    expect(resultado.auditoria).toContain('writer-lease:ocupado:run-outro')
  })

  it('lease expirado bloqueia ate reconciliacao, sem roubo direto', async () => {
    const router = montar({ leaseAtual: lease({ expiraEm: AGORA }) })

    const resultado = await router.executar(pedido(), POLITICA, [
      estado('claude-code'),
      estado('codex-exec')
    ])

    expect(resultado.status).toBe('bloqueado')
    expect(resultado.auditoria).toContain('writer-lease:expirado-requer-reconciliacao')
  })

  it('troca de executor depois de falha nao repete efeito confirmed', async () => {
    const router = montar({
      claude: adapterFalha(),
      codex: adapterSucesso(),
      efeito: efeitoConfirmado()
    })

    const resultado = await router.executar(pedido(), POLITICA, [
      estado('claude-code'),
      estado('codex-exec')
    ])

    expect(resultado.status).toBe('bloqueado')
    expect(resultado.auditoria.join('\n')).toContain('fallback-bloqueado:efeito-confirmado:pr-7')
  })

  it('fallback sem efeito confirmado retoma sessao do writer falho', async () => {
    const codex = adapterSucesso()
    const router = montar({ claude: adapterFalha(), codex })

    const resultado = await router.executar(pedido(), POLITICA, [
      estado('claude-code'),
      estado('codex-exec')
    ])

    expect(resultado.status).toBe('concluido')
    expect(resultado.fallback).toMatchObject({ de: 'claude-code', para: 'codex-exec' })
    expect(codex.requestsRecebidos[0]?.sessaoAnterior).toBe('sessao-falha')
  })
})

describe('ExecutorRouter — revisao cruzada e dedupe de achados', () => {
  it('quando ambos disponiveis, revisor e diferente do writer', async () => {
    let recebido: unknown
    const router = montar({
      revisar: async (p) => {
        recebido = p
        return []
      }
    })

    const resultado = await router.executar(pedido(), POLITICA, [
      estado('claude-code'),
      estado('codex-exec')
    ])

    expect(resultado.status).toBe('concluido')
    expect(resultado.revisao).toMatchObject({
      revisor: 'codex-exec',
      modo: 'cruzada',
      headSha: 'abc123',
      revisao: 'rev-119'
    })
    expect(recebido).toMatchObject({ writer: 'claude-code', revisor: 'codex-exec' })
  })

  it('sem executor cruzado disponivel, usa revisao independente no mesmo executor', async () => {
    const router = montar()

    const resultado = await router.executar(pedido(), POLITICA, [
      estado('claude-code'),
      estado('codex-exec', { disponivel: false, motivoIndisponivel: 'offline' })
    ])

    expect(resultado.revisao).toMatchObject({ revisor: 'claude-code', modo: 'independente' })
  })

  it('revisao usa head/revisao exatos e nao reabre achado resolvido ou aberto', async () => {
    const antigoAberto = achado({ assinatura: 'a1', estado: 'aberto' })
    const antigoResolvido = achado({ assinatura: 'a2', estado: 'resolvido' })
    const novo = achado({ assinatura: 'a3', titulo: 'novo' })
    const router = montar({
      revisar: async () => [achado({ assinatura: 'a1' }), achado({ assinatura: 'a2' }), novo, novo]
    })

    const resultado = await router.executar(
      pedido({ headSha: 'head-exato', revisao: 'rev-exata' }),
      POLITICA,
      [estado('claude-code'), estado('codex-exec')],
      [antigoAberto, antigoResolvido]
    )

    expect(resultado.revisao?.headSha).toBe('head-exato')
    expect(resultado.revisao?.revisao).toBe('rev-exata')
    expect(resultado.revisao?.achados).toEqual([novo])
  })
})

function achado(sobrescreve: Partial<AchadoDeExecutor> = {}): AchadoDeExecutor {
  return {
    severidade: 'P1',
    titulo: 'falha',
    evidencia: 'arquivo.ts:1',
    assinatura: 'sig',
    headSha: 'abc123',
    revisao: 'rev-119',
    estado: 'aberto',
    ...sobrescreve
  }
}
