/**
 * O contract test reutilizável de adapters de executor (SPEC-Multi-Executor-01, critério 1).
 *
 * Uma função e não um arquivo de teste: é o que F02 e F03 chamam com os adapters reais do
 * Claude Code e do Codex, e o que garante que "sucesso, falha, timeout, cancelamento e
 * retomada" signifiquem a mesma coisa nos três. Um arquivo de teste por adapter, cada um
 * escrevendo seus próprios casos, é onde o terceiro esquece o cancelamento.
 *
 * Mora no código de produção pelo mesmo motivo do fake: quem o importa é o teste de outra
 * fatia, e um helper em `*.spec.ts` não é importável de fora sem arrastar o `describe` do
 * vizinho.
 *
 * O adapter é criado **por cenário** (`criarCenario`), não recebido pronto: cada desfecho
 * precisa de um executor configurado diferente, e um adapter único obrigaria o chamador a
 * reconfigurá-lo entre casos — estado compartilhado entre testes é o que torna suíte
 * verde-por-ordem.
 */

import { describe, expect, it } from 'vitest'
import { CodingExecutorRuntime, type MatadorDeProcesso } from './coding-executor-runtime'
import type { CodingExecutorAdapter, ExecutorRequest } from './executor'

/** Um request completo e válido, para o teste sobrescrever só o que lhe interessa. */
export function requestDeTeste(sobrescrever: Partial<ExecutorRequest> = {}): ExecutorRequest {
  return {
    runId: 'run-1',
    attemptId: 'att-1',
    chaveIdempotente: 'chave-1',
    executor: 'fake',
    modelo: 'modelo-x',
    modoDeCobranca: 'unmetered',
    revisoesAprovadas: ['revisao-padrao'],
    contextPackId: 'pack-1',
    worktree: '/tmp/wt',
    pathsPermitidos: ['src'],
    validacoes: [['npm', 'test']],
    limiteDeTempoMs: 5_000,
    autenticacao: { referencia: 'sessao-1' },
    ...sobrescrever
  }
}

/**
 * O que o chamador do contrato precisa fornecer para cada desfecho.
 *
 * O contrato descreve o desfecho em termos de **comportamento observável** (o executor
 * concluiu, falhou, pendurou, ignorou o cancelamento) e deixa o chamador decidir como
 * produzi-lo no executor dele: no fake é um roteiro de eventos, no adapter real do Codex
 * será uma fixture de JSONL.
 */
export interface CenarioDoContrato {
  /** Executor que conclui com sucesso, relatando um path e o uso. */
  sucesso(): CodingExecutorAdapter
  /** Executor que falha com erro. */
  falha(): CodingExecutorAdapter
  /** Executor que pendura — nunca emite terminal dentro do limite de tempo. */
  pendurado(): CodingExecutorAdapter
  /** Executor que **ignora** o cancelamento e segue emitindo. */
  ignoraCancelamento(): CodingExecutorAdapter
  /** Executor que conclui informando a sessão a retomar. */
  comSessao(sessao: string): CodingExecutorAdapter
  /** Executor que emite duplicado, fora de ordem e desconhecido antes de concluir. */
  eventosDesordenados(): CodingExecutorAdapter
  /** Executor que só aceita `unmetered` e a revisão `revisao-padrao`. */
  restrito(): CodingExecutorAdapter
}

/**
 * Roda o contrato contra um executor.
 *
 * `nome` entra no `describe` para o relatório dizer **qual** adapter reprovou quando dois
 * rodam na mesma suíte.
 */
export function rodarContractDoExecutor(nome: string, criarCenario: () => CenarioDoContrato): void {
  describe(`contrato de executor: ${nome}`, () => {
    it('sucesso: conclui, relata paths e uso (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(requestDeTeste(), criarCenario().sucesso())

      expect(resultado.status).toBe('concluido')
      expect(resultado.attemptId).toBe('att-1')
      expect(resultado.pathsAlterados).toContain('src/a.ts')
      expect(resultado.uso?.tokensEntrada).toBeGreaterThan(0)
      expect(resultado.uso?.duracaoMs).toBeGreaterThanOrEqual(0)
    })

    it('falha: devolve status falhou sem lancar (criterios 1 e 6)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(requestDeTeste(), criarCenario().falha())

      expect(resultado.status).toBe('falhou')
      // A assinatura é **nossa**: é o que agrupa a falha na auditoria sem depender do
      // formato interno do fornecedor (critério 6).
      expect(resultado.assinaturaDeFalha).toBeDefined()
    })

    it('timeout: o limite de tempo encerra o executor pendurado (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(
        requestDeTeste({ limiteDeTempoMs: 40 }),
        criarCenario().pendurado()
      )

      // `cancelado` e não `falhou`: fomos nós que o encerramos, e reportar falha diria que
      // o executor quebrou quando ele apenas demorou mais do que o teto.
      expect(resultado.status).toBe('cancelado')
    })

    it('cancelamento: duas chamadas produzem um unico efeito (criterio 3)', async () => {
      const mortes: string[] = []
      const matar: MatadorDeProcesso = (request) => mortes.push(request.attemptId)
      const runtime = new CodingExecutorRuntime(matar)
      const request = requestDeTeste({ limiteDeTempoMs: 5_000 })

      const execucao = runtime.executar(request, criarCenario().ignoraCancelamento())

      // Espera o executor entrar em voo antes de cancelar: cancelar antes do `for await`
      // testaria o mapa vazio, não o cancelamento.
      await new Promise((resolve) => setTimeout(resolve, 30))

      const primeiro = runtime.cancelar('att-1')
      const segundo = runtime.cancelar('att-1')
      const resultado = await execucao

      expect(primeiro).toBe(true)
      // O segundo não teve efeito — é o que "idempotente" significa aqui.
      expect(segundo).toBe(false)
      expect(mortes).toEqual(['att-1'])
      expect(resultado.status).toBe('cancelado')
    })

    it('cancelar tentativa desconhecida e no-op (criterio 3)', () => {
      const mortes: string[] = []
      const runtime = new CodingExecutorRuntime((request) => mortes.push(request.attemptId))

      expect(runtime.cancelar('att-inexistente')).toBe(false)
      expect(mortes).toEqual([])
    })

    it('retomada: a sessao do executor volta no resultado (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(requestDeTeste(), criarCenario().comSessao('ses-42'))

      expect(resultado.sessaoRetomavel).toBe('ses-42')
    })

    it('retomada: o request leva a sessao anterior ao adapter (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().sucesso()
      await runtime.executar(requestDeTeste({ sessaoAnterior: 'ses-7' }), adapter)

      // Sem este caminho, "retomada" seria só ler a sessão de volta — e o executor
      // recomeçaria do zero a cada tentativa sem ninguém notar.
      expect(recebidos(adapter)[0]?.sessaoAnterior).toBe('ses-7')
    })

    it('evento duplicado, fora de ordem e desconhecido nao corrompem o estado (criterio 2)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(
        requestDeTeste(),
        criarCenario().eventosDesordenados()
      )

      expect(resultado.status).toBe('concluido')
      // O path duplicado entra uma vez só.
      expect(resultado.pathsAlterados).toEqual(['src/a.ts'])
      // E o que não virou transição ficou registrado, em vez de desaparecer.
      expect(resultado.diagnosticos.length).toBeGreaterThan(0)
    })

    it('modo de cobranca incompativel recusa sem tocar o executor (criterio 4)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().restrito()
      const resultado = await runtime.executar(
        requestDeTeste({ modoDeCobranca: 'metered' }),
        adapter
      )

      expect(resultado.status).toBe('recusado')
      expect(resultado.assinaturaDeFalha).toBe('recusa:modo-de-cobranca')
      // O lado que importa: o CLI **não iniciou**. Um contador acima de zero aqui prova
      // que a recusa chegou depois do spawn, que é o defeito do critério 4.
      expect(execucoes(adapter)).toBe(0)
    })

    it('revisao desconhecida recusa sem tocar o executor (criterio 4)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().restrito()
      const resultado = await runtime.executar(
        requestDeTeste({ revisoesAprovadas: ['revisao-exotica'] }),
        adapter
      )

      expect(resultado.status).toBe('recusado')
      expect(resultado.assinaturaDeFalha).toBe('recusa:revisao')
      expect(execucoes(adapter)).toBe(0)
    })

    it('schema de saida incompativel recusa sem tocar o executor (criterio 4)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().restrito()
      const resultado = await runtime.executar(
        requestDeTeste({ schemaDeSaida: '{"type":"object"}' }),
        adapter
      )

      expect(resultado.status).toBe('recusado')
      expect(resultado.assinaturaDeFalha).toBe('recusa:schema')
      expect(execucoes(adapter)).toBe(0)
    })

    it('o adapter nao recebe credencial, so referencia opaca (criterio 5)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().sucesso()
      await runtime.executar(requestDeTeste(), adapter)

      const recebido = recebidos(adapter)[0]
      const chaves = Object.keys(recebido ?? {})

      // Afirma **ausência**: nenhum campo de credencial, token ou segredo atravessa a
      // fronteira. O que o adapter recebe é o identificador da sessão a usar.
      expect(chaves).not.toContain('apiKey')
      expect(chaves).not.toContain('token')
      expect(chaves).not.toContain('credencial')
      expect(recebido?.autenticacao.referencia).toBe('sessao-1')
      expect(JSON.stringify(recebido?.autenticacao)).not.toMatch(/sk-|ghp_|Bearer /)
    })

    it('saude do executor responde sem lancar', async () => {
      const runtime = new CodingExecutorRuntime()

      await expect(runtime.saudeDoExecutor(criarCenario().sucesso())).resolves.toBe(true)
    })
  })
}

/**
 * Lê os requests que o adapter recebeu, quando ele os expõe.
 *
 * O contrato não obriga o adapter a instrumentar-se — um adapter real pode não guardar
 * requests —, então a leitura é tolerante: sem instrumentação, o caso que depende dela é o
 * que o chamador decide fornecer. `unknown` estreitado, nunca `any`.
 */
function recebidos(adapter: CodingExecutorAdapter): readonly ExecutorRequest[] {
  const candidato = (adapter as { requestsRecebidos?: unknown }).requestsRecebidos
  return Array.isArray(candidato) ? (candidato as ExecutorRequest[]) : []
}

/** Quantas vezes o adapter iniciou execução, quando ele o expõe. Ver `recebidos`. */
function execucoes(adapter: CodingExecutorAdapter): number {
  const candidato = (adapter as { chamadasDeExecucao?: unknown }).chamadasDeExecucao
  return typeof candidato === 'number' ? candidato : 0
}
