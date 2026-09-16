/**
 * O runtime de executores, exercitado de ponta a ponta (SPEC-Multi-Executor-01).
 *
 * Project `banco` (`*.int-spec.ts` em `src/main`): o arquivo usa timer real e o logger, que
 * é singleton de processo — a categoria roda serial por isso. A lógica pura de estado e de
 * recusa tem teste próprio em `regras`; aqui o que se mede é o runtime **inteiro**, com o
 * contrato que F02/F03 vão reexecutar.
 */

import { describe, expect, it } from 'vitest'
import { SEGREDO_REDIGIDO } from '@shared/domain/segredos'
import {
  rodarContractDoExecutor,
  requestDeTeste,
  type CenarioDoContrato
} from './coding-executor-contract'
import { CodingExecutorRuntime, type MatadorDeProcesso } from './coding-executor-runtime'
import { FakeCodingExecutorAdapter } from './fake-coding-executor-adapter'

/** O cenário do fake: cada desfecho do contrato é um roteiro de eventos. */
const cenarioDoFake = (): CenarioDoContrato => ({
  sucesso: () =>
    new FakeCodingExecutorAdapter({
      eventos: [
        { tipo: 'started' },
        { tipo: 'path_changed', path: 'src/a.ts' },
        { tipo: 'usage', tokensEntrada: 100, tokensSaida: 50 },
        { tipo: 'done', resumo: 'fatia pronta' }
      ]
    }),
  falha: () =>
    new FakeCodingExecutorAdapter({
      eventos: [
        { tipo: 'started' },
        { tipo: 'failed', erro: 'build quebrou', assinatura: 'build:falhou' }
      ]
    }),
  pendurado: () =>
    new FakeCodingExecutorAdapter({
      // Muitos eventos com atraso: o executor nunca chega ao terminal dentro do teto.
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'trabalhando' })),
      atrasoMs: 20
    }),
  ignoraCancelamento: () =>
    new FakeCodingExecutorAdapter({
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'teimoso' })),
      atrasoMs: 10,
      ignoraCancelamento: true
    }),
  comSessao: (sessao) =>
    new FakeCodingExecutorAdapter({
      eventos: [{ tipo: 'started', sessao }, { tipo: 'done' }]
    }),
  eventosDesordenados: () =>
    new FakeCodingExecutorAdapter({
      eventos: [
        // Fora de ordem: chega antes do `started`.
        { tipo: 'progress', mensagem: 'adiantado' },
        { tipo: 'started' },
        // Duplicado.
        { tipo: 'started' },
        { tipo: 'path_changed', path: 'src/a.ts' },
        // Path repetido.
        { tipo: 'path_changed', path: 'src/a.ts' },
        // Desconhecido: preservado como diagnóstico (regra 4).
        { tipo: 'desconhecido', bruto: '{"formato":"novo"}' },
        { tipo: 'done' }
      ]
    }),
  restrito: () =>
    new FakeCodingExecutorAdapter({
      eventos: [{ tipo: 'started' }, { tipo: 'done' }],
      modosSuportados: ['unmetered'],
      revisoesSuportadas: ['revisao-padrao']
    })
})

// O contrato inteiro, contra o fake. É a mesma chamada que F02/F03 farão com os adapters
// reais — e é o que faz "sucesso, falha, timeout, cancelamento e retomada" significar a
// mesma coisa nos três.
rodarContractDoExecutor('fake', cenarioDoFake)

describe('CodingExecutorRuntime — redaction da evidencia (regra 5)', () => {
  it('redige segredo no argumento de ferramenta', async () => {
    const runtime = new CodingExecutorRuntime()
    const adapter = new FakeCodingExecutorAdapter({
      eventos: [
        { tipo: 'started' },
        {
          tipo: 'tool_used',
          nome: 'Bash',
          argumentos: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwx"'
        },
        { tipo: 'done' }
      ]
    })

    const resultado = await runtime.executar(requestDeTeste(), adapter)
    const evidencia = resultado.evidencias.join('\n')

    // A linha **fica** — ferramenta é evidência que o PI precisa ver; o que sai é o segredo.
    expect(evidencia).toContain('ferramenta Bash')
    expect(evidencia).toContain(SEGREDO_REDIGIDO)
    expect(evidencia).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
  })

  it('redige segredo na mensagem de erro do processo', async () => {
    const runtime = new CodingExecutorRuntime()
    const adapter = new FakeCodingExecutorAdapter({
      eventos: [],
      lancaAntesDeEmitir: 'falha ao autenticar com ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    })

    const resultado = await runtime.executar(requestDeTeste(), adapter)

    expect(resultado.status).toBe('falhou')
    expect(resultado.evidencias.join('\n')).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    )
  })
})

describe('CodingExecutorRuntime — contrafactual da recusa (criterio 4)', () => {
  it('sem recusa, o mesmo request incompativel chegaria ao executor', async () => {
    // Mede que o teste do critério 4 tem conteúdo: com um adapter que aceita `metered`, o
    // mesmo request **passa** e o executor inicia. Se este teste falhasse, o `execucoes == 0`
    // do contrato estaria passando por outro motivo que não a recusa.
    const runtime = new CodingExecutorRuntime()
    const permissivo = new FakeCodingExecutorAdapter({
      eventos: [{ tipo: 'started' }, { tipo: 'done' }],
      modosSuportados: ['unmetered', 'metered']
    })

    const resultado = await runtime.executar(
      requestDeTeste({ modoDeCobranca: 'metered' }),
      permissivo
    )

    expect(resultado.status).toBe('concluido')
    expect(permissivo.chamadasDeExecucao).toBe(1)
  })
})

describe('CodingExecutorRuntime — arvore de processo (criterio 3)', () => {
  it('o matador recebe o request da tentativa, para saber o que matar', async () => {
    const recebidos: string[] = []
    const matar: MatadorDeProcesso = (request) => {
      // O matador precisa do worktree e do container para alcançar a árvore — sem eles,
      // "matar a árvore" não teria como ser implementado por quem subiu o sandbox.
      recebidos.push(`${request.attemptId}:${request.worktree}:${request.container ?? '-'}`)
    }
    const runtime = new CodingExecutorRuntime(matar)
    const adapter = new FakeCodingExecutorAdapter({
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'x' })),
      atrasoMs: 10,
      ignoraCancelamento: true
    })

    const execucao = runtime.executar(
      requestDeTeste({ container: 'cont-1', limiteDeTempoMs: 5_000 }),
      adapter
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    runtime.cancelar('att-1')
    await execucao

    expect(recebidos).toEqual(['att-1:/tmp/wt:cont-1'])
  })

  it('timeout tambem mata a arvore, nao so aborta o sinal', async () => {
    const mortes: string[] = []
    const runtime = new CodingExecutorRuntime((request) => mortes.push(request.attemptId))
    const adapter = new FakeCodingExecutorAdapter({
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'x' })),
      atrasoMs: 10,
      ignoraCancelamento: true
    })

    const resultado = await runtime.executar(requestDeTeste({ limiteDeTempoMs: 40 }), adapter)

    // Sem isto, um executor que ignora o sinal seguiria vivo depois do timeout — órfão
    // consumindo a assinatura, que é o caminho que o critério 3 fecha.
    expect(mortes).toEqual(['att-1'])
    expect(resultado.status).toBe('cancelado')
  })
})
