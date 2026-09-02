/**
 * O que a limpeza preserva, por fase (SPEC-Entrega-06, critério 8).
 *
 * A pergunta que este arquivo responde: **cancelar agora, o que pode ser desfeito e o que não
 * pode?**
 *
 * **Tabela, não `if`** — mesma postura de `TRANSICOES` em `pipeline.ts`. A regra que importa é
 * negativa (*"nunca apaga branch ou PR, e nunca cria revert automático"*), e uma tabela permite
 * ler de relance que nenhuma fase a viola. Espalhada em condicionais, bastaria alguém escrever
 * uma condição errada para a limpeza apagar trabalho — o oposto exato do que ela existe para
 * fazer. Há teste varrendo todas as fases para provar que a invariante vale em todas.
 *
 * **O que este arquivo não faz:** não fala com Docker nem Git, não toca o disco, não decide em
 * que fase o run está. Ele diz o que cada fase permite; quem executa mora em `limpeza-service.ts`.
 */

/**
 * As fases em que um cancelamento pode chegar.
 *
 * A divisão não é arbitrária: cada fronteira é um ponto em que o trabalho passa a existir em
 * algum lugar que a limpeza não controla. Depois do push ele está no remoto; depois do merge
 * está na `main` de outra pessoa.
 */
export const FASES_DE_CANCELAMENTO = [
  'antes-do-executor',
  'durante-execucao',
  'depois-do-push',
  'durante-ci',
  'depois-do-merge'
] as const

export type FaseDeCancelamento = (typeof FASES_DE_CANCELAMENTO)[number]

export interface PlanoDeLimpeza {
  /** Mata a árvore de processos do executor dentro do container, sem derrubar o container. */
  readonly mataProcessos: boolean
  /** O que o executor já escreveu no worktree fica onde está. */
  readonly preservaSnapshot: boolean
  readonly preservaBranch: boolean
  readonly preservaPr: boolean
  /** Marca o cancelamento onde ele é visível para quem vai olhar o PR depois. */
  readonly convertePrParaRascunho: boolean
  readonly paraMonitoramentoDeCi: boolean
  /** Invariante: `false` em toda fase. Desfazer trabalho é o oposto de limpar. */
  readonly criaRevert: boolean
  /** Invariante: `false` em toda fase. Volume órfão vira pendência, nunca remoção. */
  readonly removeVolumePersistente: boolean
  /** Worktree e container só saem quando o run acabou — antes disso o snapshot ainda serve. */
  readonly removeRecursos: boolean
}

const PLANOS: Readonly<Record<FaseDeCancelamento, PlanoDeLimpeza>> = {
  // Nada rodou: não há processo a matar nem efeito a desfazer.
  'antes-do-executor': {
    mataProcessos: false,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: false,
    paraMonitoramentoDeCi: false,
    criaRevert: false,
    removeVolumePersistente: false,
    removeRecursos: true
  },
  // O executor está escrevendo: interrompe, mas guarda o que ele já produziu — o snapshot é o
  // que permite retomar sem refazer, e apagá-lo transformaria cancelamento em perda de trabalho.
  'durante-execucao': {
    mataProcessos: true,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: false,
    paraMonitoramentoDeCi: false,
    criaRevert: false,
    removeVolumePersistente: false,
    removeRecursos: false
  },
  // O trabalho já está no remoto. Preservar é a única opção segura: quem olhar o PR depois
  // precisa encontrar o que foi feito, e o rascunho é o que sinaliza que ninguém deve mergeá-lo.
  'depois-do-push': {
    mataProcessos: true,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: true,
    paraMonitoramentoDeCi: false,
    criaRevert: false,
    removeVolumePersistente: false,
    removeRecursos: false
  },
  'durante-ci': {
    mataProcessos: true,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: true,
    paraMonitoramentoDeCi: true,
    criaRevert: false,
    removeVolumePersistente: false,
    removeRecursos: true
  },
  // Mergeado é fato consumado: cancelar não muda o resultado, e os recursos do run podem sair.
  'depois-do-merge': {
    mataProcessos: false,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: false,
    paraMonitoramentoDeCi: true,
    criaRevert: false,
    removeVolumePersistente: false,
    removeRecursos: true
  }
}

export function planoDeLimpeza(fase: FaseDeCancelamento): PlanoDeLimpeza {
  return PLANOS[fase]
}

/**
 * Os recursos que a limpeza remove.
 *
 * Volume persistente **não** está na lista, de propósito: a spec decide que ele nunca é apagado
 * pela limpeza automática, mesmo órfão — vira pendência para o usuário decidir. Deixá-lo fora do
 * tipo é o que impede um chamador futuro passá-lo por engano.
 */
export const RECURSOS_LIMPAVEIS = ['worktree', 'container', 'rede', 'sidecar', 'porta'] as const

export type RecursoLimpavel = (typeof RECURSOS_LIMPAVEIS)[number]

/**
 * Uma remoção que não deu certo (critério 5).
 *
 * Falha de limpeza **não desfaz merge** — o trabalho já aterrissou, e tratar a sobra de um
 * container como motivo para reverter seria trocar um problema de disco por perda de entrega. O
 * que ela faz é ficar registrada de forma que a reconciliação encontre depois.
 */
export interface PendenciaDeLimpeza {
  readonly runId: string
  readonly recurso: RecursoLimpavel
  readonly identificador: string
  readonly motivo: string
  readonly em: string
}
