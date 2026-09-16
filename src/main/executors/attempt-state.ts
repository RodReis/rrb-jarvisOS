/**
 * A máquina de estados da tentativa (SPEC-Multi-Executor-01, critério 2 e regras 1 e 4).
 *
 * Pura de propósito: recebe estado e evento, devolve estado novo. Nenhum I/O, nenhum timer,
 * nenhum processo. São exatamente as decisões que a spec exige serem determinísticas — e
 * mantê-las aqui é o que permite provar "evento duplicado não corrompe" sem subir um CLI.
 *
 * A postura diante de evento inesperado é sempre a mesma: **registrar como diagnóstico, não
 * inferir transição** (regra 4). Um stream de CLI chega fora de ordem, repetido e atrasado
 * na vida real; uma máquina que adivinha a intenção de cada evento é uma máquina cujo estado
 * depende de qual mensagem o fornecedor decidiu emitir primeiro.
 */

import { EVENTOS_TERMINAIS, type ExecutorEvent, type EventoTerminal } from './executor'

/**
 * As fases de uma tentativa.
 *
 * `aberta` é o estado que **só o kernel cria** (regra 1): a tentativa existe porque o kernel
 * a abriu, não porque um evento chegou. `executando` começa com `started`. As três últimas
 * são terminais e não voltam atrás.
 */
export const FASES_DA_TENTATIVA = [
  'aberta',
  'executando',
  'concluida',
  'falhou',
  'cancelada'
] as const
export type FaseDaTentativa = (typeof FASES_DA_TENTATIVA)[number]

const FASES_TERMINAIS: readonly FaseDaTentativa[] = ['concluida', 'falhou', 'cancelada']

/** A fase encerra a tentativa? Evento que chega depois dela é diagnóstico, nunca transição. */
export function isTerminal(fase: FaseDaTentativa): boolean {
  return FASES_TERMINAIS.includes(fase)
}

/** O estado acumulado da tentativa. Imutável: `aplicarEvento` devolve cópia. */
export interface EstadoDaTentativa {
  readonly attemptId: string
  readonly fase: FaseDaTentativa
  readonly sessao?: string
  readonly resumo?: string
  readonly erro?: string
  readonly assinaturaDeFalha?: string
  readonly pathsAlterados: readonly string[]
  readonly uso?: {
    readonly tokensEntrada: number
    readonly tokensSaida: number
    readonly duracaoMs?: number
  }
  /**
   * Tudo que não virou transição: evento desconhecido, duplicado, fora de ordem e atrasado.
   *
   * Uma lista só para os quatro casos porque a pergunta que ela responde é uma: "o que
   * chegou e o kernel não usou?". Separá-los em quatro campos daria quatro lugares para o
   * relatório esquecer de ler.
   */
  readonly diagnosticos: readonly string[]
}

/** Abre a tentativa. **Só o kernel chama isto** (regra 1). */
export function estadoInicial(attemptId: string): EstadoDaTentativa {
  return {
    attemptId,
    fase: 'aberta',
    pathsAlterados: [],
    diagnosticos: []
  }
}

/** Acrescenta um diagnóstico, preservando o resto do estado. */
function comDiagnostico(estado: EstadoDaTentativa, motivo: string): EstadoDaTentativa {
  return { ...estado, diagnosticos: [...estado.diagnosticos, motivo] }
}

/**
 * Aplica um evento ao estado.
 *
 * A ordem das guardas importa: **terminal primeiro**. Um `failed` que chega depois de um
 * `done` não pode trocar o desfecho, e checar isso antes de qualquer outra coisa é o que
 * torna a garantia independente do tipo do evento atrasado.
 */
export function aplicarEvento(
  estado: EstadoDaTentativa,
  evento: ExecutorEvent
): EstadoDaTentativa {
  if (isTerminal(estado.fase)) {
    return comDiagnostico(estado, `evento ${evento.tipo} apos estado terminal ${estado.fase}`)
  }

  switch (evento.tipo) {
    case 'started':
      // Duplicado mantém a **primeira** sessão: o kernel retoma pelo que guardou aqui, e
      // trocar por uma sessão posterior o faria retomar a sessão errada.
      if (estado.fase === 'executando') {
        return comDiagnostico(estado, 'started duplicado')
      }
      return {
        ...estado,
        fase: 'executando',
        ...(evento.sessao === undefined ? {} : { sessao: evento.sessao })
      }

    case 'progress':
      // Progresso não move a máquina — ele é texto para quem observa. Antes de `started`
      // ele é fora de ordem, e inferir início dele seria adivinhar.
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'progress antes de started')
      }
      return estado

    case 'tool_used':
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'tool_used antes de started')
      }
      return estado

    case 'path_changed': {
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'path_changed antes de started')
      }
      // `Set` não serve porque a ordem importa no relatório; o `includes` num array de
      // paths de uma tentativa é barato e mantém a ordem de chegada.
      if (estado.pathsAlterados.includes(evento.path)) return estado
      return { ...estado, pathsAlterados: [...estado.pathsAlterados, evento.path] }
    }

    case 'usage':
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'usage antes de started')
      }
      return {
        ...estado,
        uso: {
          tokensEntrada: evento.tokensEntrada,
          tokensSaida: evento.tokensSaida,
          ...(evento.duracaoMs === undefined ? {} : { duracaoMs: evento.duracaoMs })
        }
      }

    case 'done':
      return {
        ...estado,
        fase: 'concluida',
        ...(evento.resumo === undefined ? {} : { resumo: evento.resumo })
      }

    case 'failed':
      return {
        ...estado,
        fase: 'falhou',
        erro: evento.erro,
        ...(evento.assinatura === undefined ? {} : { assinaturaDeFalha: evento.assinatura })
      }

    case 'canceled':
      return { ...estado, fase: 'cancelada' }

    case 'desconhecido':
      // O caso da regra 4: preserva o bruto e **não** altera a fase.
      return comDiagnostico(estado, evento.bruto)
  }
}

/** Reexporta para quem precisa da lista sem importar dois módulos. */
export { EVENTOS_TERMINAIS, type EventoTerminal }
