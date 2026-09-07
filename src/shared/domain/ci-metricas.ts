/**
 * As métricas do run, com indisponibilidade explícita (SPEC-Pipeline-01 §8, critério 17).
 *
 * A regra que este arquivo existe para cumprir é curta e absoluta: *"campo indisponível é
 * `unavailable`/ausente com razão, nunca zero inventado"*.
 *
 * O perigo é concreto. `duracaoMs: 0` e "não sei quanto durou" são o mesmo valor num número, e o
 * consumidor não tem como distinguir. Somando runs, os zeros puxam a média para baixo e o painel
 * mostra uma pipeline mais rápida do que ela é — a medida mente na direção que agrada, que é a
 * pior direção para uma medida mentir.
 *
 * A resposta é um tipo que **não permite** confundir: ou há valor, ou há razão da ausência.
 * `medidaDisponivel(m) ? m.valor : …` não compila se o consumidor esquecer de checar.
 *
 * **Este arquivo não mede nada.** Ele dá a forma; quem observa os timestamps é o serviço. A §8
 * também proíbe *"subtrair timestamps arbitrários para fingir"* espera de revisão e elegibilidade
 * de merge — por isso `duracaoEntre` exige os dois instantes **observados**, e devolve ausência
 * quando um deles falta, em vez de assumir "agora" no lugar do que não foi visto.
 */

/** Por que uma medida não existe. Cada razão pede uma ação diferente de quem lê. */
export type RazaoDaIndisponibilidade =
  /** A origem não informou o dado. Nada a fazer no nosso lado. */
  | 'nao-informado'
  /** O evento que marcaria o instante não foi observado (o run parou antes). */
  | 'evento-nao-observado'
  /** Faltou permissão para ler o dado na origem. */
  | 'sem-permissao'
  /** A consulta falhou. Distinta de `nao-informado`: aqui houve erro, não silêncio. */
  | 'leitura-falhou'

/** Uma medida: ou o valor, ou a razão de não haver valor. Nunca as duas, nunca nenhuma. */
export type Medida =
  | { readonly disponivel: true; readonly valorMs: number }
  | { readonly disponivel: false; readonly razao: RazaoDaIndisponibilidade }

/** O ramo com valor, nomeado — é o que o type guard estreita. */
export type MedidaDisponivel = Extract<Medida, { disponivel: true }>

/**
 * A medida existe? Type guard, para o consumidor não conseguir ler `valorMs` sem checar.
 *
 * `Extract` do próprio tipo, e não uma forma escrita à mão: uma cópia da forma **não** é o mesmo
 * tipo para o compilador, então `!medidaDisponivel(m)` não estreitaria para o ramo ausente e ler
 * `m.razao` no `else` não compilaria. O guard precisa apontar para um dos ramos da união real.
 */
export function medidaDisponivel(m: Medida): m is MedidaDisponivel {
  return m.disponivel
}

export function medida(valorMs: number): Medida {
  return { disponivel: true, valorMs }
}

export function indisponivel(razao: RazaoDaIndisponibilidade): Medida {
  return { disponivel: false, razao }
}

/**
 * A duração entre dois instantes observados.
 *
 * Qualquer um ausente devolve indisponível. **Não** assume "agora" para o fim que não chegou: isso
 * transformaria um run interrompido numa duração plausível e falsa, que é a forma mais silenciosa
 * de a métrica mentir.
 *
 * Fim anterior ao início também é indisponível, e não um negativo. Ordem invertida significa que
 * um dos dois instantes está errado; propagá-la como número deixaria o erro entrar nas somas.
 */
export function duracaoEntre(inicioIso?: string, fimIso?: string): Medida {
  if (inicioIso === undefined || fimIso === undefined) {
    return indisponivel('evento-nao-observado')
  }

  const inicio = Date.parse(inicioIso)
  const fim = Date.parse(fimIso)
  if (Number.isNaN(inicio) || Number.isNaN(fim)) return indisponivel('leitura-falhou')
  if (fim < inicio) return indisponivel('leitura-falhou')

  return medida(fim - inicio)
}

/**
 * A soma de medidas, e quantas ficaram de fora.
 *
 * Somar tratando ausência como zero é o erro que a §8 nomeia. Aqui a ausência é **contada**, e
 * quem consome decide: uma soma com `ausentes > 0` é um limite inferior, não um total, e
 * apresentá-la como total seria a mesma mentira por outro caminho.
 */
export function somar(medidas: readonly Medida[]): {
  readonly totalMs: number
  readonly somadas: number
  readonly ausentes: number
} {
  let totalMs = 0
  let somadas = 0
  let ausentes = 0

  for (const m of medidas) {
    if (medidaDisponivel(m)) {
      totalMs += m.valorMs
      somadas += 1
    } else {
      ausentes += 1
    }
  }

  return { totalMs, somadas, ausentes }
}

/**
 * Como a medida aparece para leitura humana.
 *
 * `'—'` para ausência, com a razão ao lado. Nunca `'0ms'`: o traço é lido como "não há", e o zero
 * como "foi instantâneo" — a mesma distinção que o relatório de testes deste repositório já faz
 * ao escrever `—` na cobertura ausente em vez de `0.0`.
 */
export function formatarMedida(m: Medida): string {
  return medidaDisponivel(m) ? `${m.valorMs}ms` : `— (${m.razao})`
}
