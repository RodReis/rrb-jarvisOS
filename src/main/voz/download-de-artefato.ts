/**
 * O download dos artefatos de voz — runtime, wheels e modelo (SPEC-Voz-01, critério 4).
 *
 * ## Caminho próprio, e por quê
 *
 * Não passa pelo runtime de conectores (não é capacidade externa com credencial) nem pelo ponto
 * único de IA (não é chamada de modelo). É download de artefato estático, com **URL fixa** e
 * **hash pinado** — a spec cravou isso porque nenhum dos dois caminhos existentes descreve o que
 * acontece aqui.
 *
 * ## Ação sensível: rede + escrita em disco
 *
 * Por isso audita **antes e depois** (CLAUDE.md § Regras invioláveis), e por isso o Policy Engine
 * decide antes de qualquer byte atravessar. Fail closed: URL que a política não reconhece não é
 * baixada — e a decisão vem **antes** da rede, senão o bloqueio chegaria tarde demais.
 *
 * ## Hash divergente apaga
 *
 * Deixar no disco um arquivo com hash errado é pior que não ter baixado: a execução seguinte o
 * encontraria e o usaria como se estivesse íntegro. O par (esperado, obtido) vai para a
 * auditoria porque, depois de apagar, ela é a única testemunha que sobra.
 */

import { createHash } from 'node:crypto'

export interface Artefato {
  readonly id: string
  readonly url: string
  /** O hash **pinado** no código. Divergiu, não entra. */
  readonly sha256: string
  /** Caminho relativo ao `userData`. */
  readonly destino: string
}

/** O evento que vai para a cadeia de auditoria. */
export interface EventoDeAuditoriaDoDownload {
  readonly type: 'voz.download.inicio' | 'voz.download.fim'
  readonly payload: Record<string, unknown>
}

export interface DepsDoDownload {
  readonly buscar: (url: string) => Promise<Buffer>
  readonly gravar: (destino: string, dados: Buffer) => Promise<void>
  readonly apagar: (destino: string) => Promise<void>
  readonly auditar: (evento: EventoDeAuditoriaDoDownload) => void
  /** O Policy Engine. Fail closed: o que ele não reconhece não acontece. */
  readonly permitido: (url: string) => boolean
}

export type DesfechoDoDownload =
  | { readonly estado: 'ok' }
  | { readonly estado: 'bloqueado' }
  | { readonly estado: 'hash-divergente' }
  | { readonly estado: 'falhou'; readonly motivo: string }

/**
 * Baixa um artefato, verifica o hash e grava — ou recusa, sempre deixando rastro.
 *
 * O par de auditoria (`inicio`/`fim`) fecha em **todos** os desfechos, inclusive falha de rede:
 * um início sem fim deixaria a cadeia sugerindo um download em curso para sempre.
 */
export async function baixarArtefato(
  artefato: Artefato,
  deps: DepsDoDownload
): Promise<DesfechoDoDownload> {
  // Antes da rede, e antes até do evento de início: bloqueio não é tentativa.
  if (!deps.permitido(artefato.url)) {
    deps.auditar({
      type: 'voz.download.inicio',
      payload: { artefato: artefato.id, url: artefato.url, estado: 'bloqueado' }
    })
    deps.auditar({
      type: 'voz.download.fim',
      payload: { artefato: artefato.id, estado: 'bloqueado' }
    })
    return { estado: 'bloqueado' }
  }

  deps.auditar({
    type: 'voz.download.inicio',
    payload: { artefato: artefato.id, url: artefato.url, esperado: artefato.sha256 }
  })

  const fim = (payload: Record<string, unknown>): void =>
    deps.auditar({ type: 'voz.download.fim', payload: { artefato: artefato.id, ...payload } })

  let dados: Buffer
  try {
    dados = await deps.buscar(artefato.url)
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    fim({ estado: 'falhou', motivo })
    return { estado: 'falhou', motivo }
  }

  const obtido = createHash('sha256').update(dados).digest('hex')

  if (obtido !== artefato.sha256) {
    // Apaga antes de reportar: entre reportar e apagar há uma janela em que o arquivo ruim
    // existe no disco, e é justamente a execução seguinte que o encontraria.
    await deps.apagar(artefato.destino)
    fim({ estado: 'hash-divergente', esperado: artefato.sha256, obtido })
    return { estado: 'hash-divergente' }
  }

  try {
    await deps.gravar(artefato.destino, dados)
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    fim({ estado: 'falhou', motivo })
    return { estado: 'falhou', motivo }
  }

  fim({ estado: 'ok', sha256: obtido })
  return { estado: 'ok' }
}
