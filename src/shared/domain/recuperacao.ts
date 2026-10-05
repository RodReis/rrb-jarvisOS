/**
 * Recuperação de um run (SPEC-Scheduler-05).
 *
 * A pergunta que este arquivo responde: **olhando o que as fontes reais mostram agora, o que a
 * recuperação faz com este run?**
 *
 * É a regra 1 da SPEC — *"recuperação prefere estado observado nas fontes reais a suposição
 * local"* — escrita como função: quem chama traz o que **observou** (lease, executor, merge) e a
 * decisão sai só disso. Nada aqui lê banco, Docker ou GitHub, e por isso a tabela de decisões é
 * testável inteira, sem nenhum dublê.
 *
 * **Quatro desfechos, e `manter`/`aguardar` são os que protegem a fatia saudável:**
 *
 *  - `manter`: nada a fazer — o run está vivo, ou já não segura nada;
 *  - `aguardar`: não dá para saber (executor indeterminado, merge no ar). Fail closed: a
 *    recuperação não toca o que não consegue provar morto, e a pendência continua visível;
 *  - `recolher`: o run **já terminou** e ainda segura slot e travas — devolve;
 *  - `bloquear-e-recolher`: o run ainda constava como ativo, o lease expirou **e** o executor está
 *    provadamente morto — bloqueia com a ação de retomada e devolve.
 *
 * **Lease expirado sozinho não decide nada.** A expiração pode ser máquina lenta, não processo
 * morto (SPEC-Entrega-02, critério 3): roubar o slot de um executor vivo criaria dois executores
 * sobre o mesmo worktree. Por isso só `executor: 'morto'` autoriza bloquear.
 */

import { ehTerminal, type EstadoDoRun } from './pipeline'
import type { FaseDeCancelamento } from './limpeza'

/** O slot do pool que o run segura, como a recuperação o vê. */
export type SlotObservado = 'ausente' | 'vigente' | 'expirado'

/**
 * O executor do run (container e processos), como a fonte real o mostra. `desconhecido` é a
 * consulta que falhou — nunca vira `morto` por omissão.
 */
export type ExecutorObservado = 'vivo' | 'morto' | 'desconhecido'

export interface ObservacaoDoRun {
  readonly estado: EstadoDoRun
  readonly slot: SlotObservado
  readonly executor: ExecutorObservado
  /** Há tentativa de merge no ar, ou confirmada e ainda não registrada no run. */
  readonly mergeEmCurso: boolean
}

export type AcaoDeRecuperacao = 'manter' | 'aguardar' | 'recolher' | 'bloquear-e-recolher'

export interface DecisaoDeRecuperacao {
  readonly acao: AcaoDeRecuperacao
  /** Em português, para a auditoria e para o PI: por que a recuperação fez (ou não) isto. */
  readonly motivo: string
}

export function decidirRecuperacao(o: ObservacaoDoRun): DecisaoDeRecuperacao {
  if (ehTerminal(o.estado)) {
    return o.slot === 'ausente'
      ? { acao: 'manter', motivo: `Run em ${o.estado} sem slot: nada a recolher.` }
      : {
          acao: 'recolher',
          motivo: `Run em ${o.estado} ainda segura o slot (${o.slot}): o trabalho acabou.`
        }
  }

  // Sem slot não há o que recuperar: o run espera na fila ou executa pelo caminho que não passou
  // pelo pool, e quem o move é o dono dele.
  if (o.slot === 'ausente') {
    return { acao: 'manter', motivo: 'O run não detém slot do pool.' }
  }

  if (o.slot === 'vigente') {
    return { acao: 'manter', motivo: 'O lease do slot está vigente: o dono está vivo.' }
  }

  // Daqui em diante o lease expirou.
  if (o.executor === 'vivo') {
    return {
      acao: 'manter',
      motivo: 'Lease expirado, mas o executor está vivo: lentidão, não morte.'
    }
  }

  if (o.executor === 'desconhecido') {
    return {
      acao: 'aguardar',
      motivo: 'Lease expirado e o executor não pôde ser verificado: não é seguro assumir morte.'
    }
  }

  if (o.mergeEmCurso) {
    return {
      acao: 'aguardar',
      motivo:
        'Há merge no ar para este run: a origem decide se ele aconteceu, antes de qualquer bloqueio.'
    }
  }

  return {
    acao: 'bloquear-e-recolher',
    motivo: 'Lease expirado e executor morto: o run perdeu o dono e não vai terminar sozinho.'
  }
}

/**
 * A fase da matriz de cancelamento (V2 §11.3) em que um run em `estado` se encontra, ou
 * `undefined` quando o run já terminou e não há o que cancelar.
 *
 * **`depois-do-push` não tem estado próprio**: o run em `RUNNING`/`VALIDATING` com o PR já
 * publicado (volta a validar depois de a base avançar) tem o trabalho no remoto, e a matriz manda
 * preservar o PR e convertê-lo em rascunho. Por isso quem chama diz se há PR (`temPr`): o estado
 * sozinho não distingue "ainda escrevendo" de "revalidando um PR aberto". `PR_CI` é a fase em que o
 * PR existe e o CI corre; antes do executor não existe PR.
 */
export function faseDoCancelamento(
  estado: EstadoDoRun,
  temPr = false
): FaseDeCancelamento | undefined {
  switch (estado) {
    case 'PLANNED':
    case 'AWAITING_PI':
    case 'READY':
      return 'antes-do-executor'
    case 'RUNNING':
    case 'VALIDATING':
      return temPr ? 'depois-do-push' : 'durante-execucao'
    case 'PR_CI':
      return 'durante-ci'
    default:
      return undefined
  }
}

/**
 * De quanto em quanto tempo o supervisor varre os slots. Metade da validade do lease: um run que
 * morre é visto em até 45 s, e a varredura (só SQLite quando nada expirou) não pesa.
 */
export const INTERVALO_DO_SUPERVISOR_MS = 15_000
