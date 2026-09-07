/**
 * A prova de que um run aconteceu (SPEC-Entrega-06, critérios 1 e 2).
 *
 * A pergunta que este arquivo responde: **o que precisa estar registrado para que o desfecho de
 * um run seja verificável sem confiar em quem o executou?**
 *
 * **Artefato entra por hash, nunca inline.** O relatório de testes e os logs do container são
 * grandes e mudam a cada run; embuti-los faria a evidência crescer sem limite e duplicaria o que
 * já está versionado no PR. O hash liga o ledger ao artefato sem copiá-lo — e é o que permite a
 * retenção (`retencao.ts`) apagar o anexo pesado sem apagar a prova.
 *
 * **`MERGED` é o único estado com exigência estrutural.** `ledgerCompleto` recusa um `MERGED` sem
 * head, merge e check, porque é exatamente o critério 1: merge deduzido não é merge confirmado.
 * `AWAITING_MERGE` não exige merge SHA — é o terminal legítimo do kill-switch desligado (M9-F02),
 * e tratá-lo como incompleto ensinaria a ler o alerta como ruído.
 *
 * **O que este arquivo não faz:** não lê banco, não calcula hash, não decide quando encerrar.
 */

import type { AiProvider } from './ai'
import type { EstadoDoRun } from './pipeline'

/**
 * Um artefato extenso, referenciado — nunca embutido.
 *
 * `hash` vazio é inválido por construção: uma referência que só carrega o caminho deixa de
 * provar qualquer coisa no dia em que o arquivo é substituído, que é justamente o dia em que a
 * prova importaria.
 */
export interface ArtefatoReferenciado {
  readonly nome: string
  /** SHA-256 em hex. */
  readonly hash: string
  readonly bytes: number
}

/** Um marco da execução, no vocabulário do run — não uma linha de log. */
export interface EventoDoLedger {
  readonly em: string
  readonly oQue: string
}

/** Um check da origem, como ele foi observado no head verificado. */
export interface CheckDoLedger {
  readonly nome: string
  readonly conclusao: string
}

export interface ExecutionLedger {
  readonly runId: string
  readonly userId: string
  readonly projectId: string
  readonly estadoFinal: EstadoDoRun
  readonly duracaoMs: number
  readonly tentativas: number
  readonly tokens: number
  /** Créditos do conector, não dólares — a moeda que a M5-F02 mede (SPEC-Conectores-02). */
  readonly creditos: number
  readonly custoUsd: number
  readonly eventos: readonly EventoDoLedger[]
  /** O head verificado na origem. Obrigatório em `MERGED`. */
  readonly headSha?: string
  /** Confirmado na origem, nunca deduzido do PR. Obrigatório em `MERGED`. */
  readonly mergeSha?: string
  readonly checks: readonly CheckDoLedger[]
  readonly artefatos: readonly ArtefatoReferenciado[]
  readonly encerradoEm: string
  /**
   * O par que executou este run (SPEC-Fases-05, critério 5).
   *
   * Um por run, e não por tentativa: o preflight congela o par antes de o container subir, e as
   * três tentativas correm sob ele. Opcional porque runs gravados antes desta fatia não o têm —
   * ausência aqui é "run anterior ao modelo por fase", não "não se sabe qual foi".
   */
  readonly provider?: AiProvider
  readonly modelo?: string
  /**
   * A correlação com a execução do CI (SPEC-Pipeline-01 §8).
   *
   * Opcional porque runs gravados antes desta fatia não a têm, e porque nem toda origem informa
   * tudo. Ausência aqui é "não observado", nunca zero — a mesma disciplina de `provider`/`modelo`.
   */
  readonly correlacaoDeCi?: CorrelacaoDeCi
}

/**
 * O que liga o ledger à execução de CI que produziu a evidência (SPEC-Pipeline-01 §8).
 *
 * A §8 enumera: *"PR, head/base/tested SHA, CI run ID/attempt, perfil, resultados,
 * started/completed/observed timestamps"*. `headSha` e `mergeSha` já moram no ledger desde a
 * M9-F06; o que falta é o resto — e o que ele resolve é a pergunta *"esta prova descreve qual
 * execução, exatamente?"*.
 *
 * **`testedSha` é distinto de `headSha` de propósito.** O provedor pode testar um merge commit
 * sintético, que não é o head do PR; a §7 diz que a origem deve comprovar a relação entre eles,
 * *"não exigir igualdade de SHAs que representam objetos diferentes"*. Um campo só apagaria essa
 * distinção justamente onde ela importa.
 *
 * Todo campo é opcional e **ausência é ausência**: o critério 17 proíbe que dado indisponível
 * apareça como zero.
 */
export interface CorrelacaoDeCi {
  readonly pullRequest?: number
  /** A base contra a qual o trabalho foi validado. */
  readonly baseSha?: string
  /** O commit efetivamente testado, quando difere do head do PR. */
  readonly testedSha?: string
  /** O identificador da execução na origem. */
  readonly ciRunId?: string
  /** A tentativa daquela execução. Artefato da tentativa 1 não prova a tentativa 2. */
  readonly tentativaDoCi?: number
  /** A revisão do perfil de CI vigente quando a evidência foi produzida. */
  readonly revisaoDoPerfil?: string
  /** Instantes **observados**, nunca derivados. */
  readonly iniciadoEm?: string
  readonly concluidoEm?: string
  readonly observadoEm?: string
}

/** O que a tela mostra de relance. O ledger inteiro fica atrás de um expansor. */
export interface ResumoDoLedger {
  readonly estadoFinal: EstadoDoRun
  readonly duracaoMs: number
  readonly custoUsd: number
  readonly tentativas: number
  readonly artefatos: readonly ArtefatoReferenciado[]
  /** Quem executou. O painel os mostra ao lado do custo (SPEC-Fases-05, critério 5). */
  readonly provider?: AiProvider
  readonly modelo?: string
}

/**
 * O ledger é coerente com o estado que declara?
 *
 * Predicado e não exceção: quem grava decide o que fazer com um ledger incompleto, e a decisão
 * de `entrega-service.ts` é gravar assim mesmo com um `error` registrado — um ledger incompleto
 * ainda é mais evidência do que run nenhum. O que não pode acontecer é o run terminar sem
 * registro, e para isso a checagem não pode abortar a gravação.
 */
export function ledgerCompleto(ledger: ExecutionLedger): boolean {
  if (ledger.artefatos.some((artefato) => artefato.hash.trim() === '')) return false

  if (ledger.estadoFinal === 'MERGED') {
    return (
      typeof ledger.headSha === 'string' &&
      ledger.headSha !== '' &&
      typeof ledger.mergeSha === 'string' &&
      ledger.mergeSha !== '' &&
      ledger.checks.length > 0
    )
  }

  return true
}

/** O recorte que o painel consome (critério 7): resultado, custo e evidência, sem log técnico. */
export function resumoDoLedger(ledger: ExecutionLedger): ResumoDoLedger {
  return {
    estadoFinal: ledger.estadoFinal,
    duracaoMs: ledger.duracaoMs,
    custoUsd: ledger.custoUsd,
    tentativas: ledger.tentativas,
    artefatos: ledger.artefatos,
    // Espalhados condicionalmente, como `headSha`/`mergeSha` fazem em `buscar`: um `provider:
    // undefined` explícito no objeto é indistinguível da chave ausente para o consumidor, mas
    // difere na serialização e nas asserções de igualdade estrutural dos testes.
    ...(ledger.provider === undefined ? {} : { provider: ledger.provider }),
    ...(ledger.modelo === undefined ? {} : { modelo: ledger.modelo })
  }
}
