import type { PreviewOutcome } from './preview-coordinator'
import { UsoInvalido, type EventoDePreview } from './preview-cli-args'

/**
 * Converge o Preview para o estado **observado** do PR (SPEC-Release-03). O estado vem sempre do
 * GitHub — nunca de um argumento sozinho — e é reobservado depois de cada aplicação: um `close`
 * que chegou enquanto outro executor provisionava (e recebeu `busy`) não se perde, porque o dono
 * da posse reconfere o PR ao terminar. Um evento explícito que já não descreve o PR (re-execução
 * de um workflow antigo) é recusado em vez de ressuscitar ou regredir o Preview.
 */

export interface PullRequestObservado {
  readonly aberto: boolean
  readonly headSha: string
  /** PR vindo de fork: código externo não ganha Docker, Railway nem Vercel do operador. */
  readonly deFork: boolean
}

export interface DependenciasDeSync {
  readonly observar: () => Promise<PullRequestObservado>
  readonly aplicar: (observado: PullRequestObservado) => Promise<PreviewOutcome>
  readonly maximoDeRodadas?: number
}

const MAXIMO_PADRAO = 3

const igual = (a: PullRequestObservado, b: PullRequestObservado): boolean =>
  a.aberto === b.aberto && a.headSha === b.headSha

function validar(
  observado: PullRequestObservado,
  evento: EventoDePreview,
  shaInformado: string | null
): void {
  if (observado.aberto && observado.deFork)
    throw new UsoInvalido(
      'PR de fork não recebe Preview: o código externo usaria os tokens do operador.'
    )
  if (evento === 'open') {
    if (!observado.aberto) throw new UsoInvalido('Evento obsoleto: o PR já não está aberto.')
    if (shaInformado && !observado.headSha.toLowerCase().startsWith(shaInformado.toLowerCase()))
      throw new UsoInvalido('Evento obsoleto: o head do PR já é outro commit.')
  }
  if (evento === 'close' && observado.aberto)
    throw new UsoInvalido('Evento obsoleto: o PR continua aberto.')
}

export async function convergirPreview(
  deps: DependenciasDeSync,
  evento: EventoDePreview,
  shaInformado: string | null
): Promise<PreviewOutcome> {
  let observado = await deps.observar()
  validar(observado, evento, shaInformado)
  const maximo = deps.maximoDeRodadas ?? MAXIMO_PADRAO
  let resultado = await deps.aplicar(observado)
  for (let rodada = 1; rodada < maximo; rodada += 1) {
    if (resultado.state === 'busy') return resultado
    const depois = await deps.observar()
    if (igual(observado, depois)) return resultado
    validar(depois, 'sync', null)
    observado = depois
    resultado = await deps.aplicar(observado)
  }
  return resultado
}
