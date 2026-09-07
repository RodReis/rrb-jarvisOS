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
 *
 * ## Por pedaços, e por um arquivo temporário
 *
 * `buscar` entrega o corpo **em pedaços**: o hash é atualizado e o byte é gravado a cada um.
 * Acumular o arquivo em memória para só então verificar custaria meio gigabyte de pico só no
 * modelo, e não daria progresso nenhum — que o critério 4 pede junto com a verificação.
 *
 * Gravar enquanto baixa cria uma pergunta que o desenho anterior não tinha: o conteúdo **toca o
 * disco antes de ser verificado**. Por isso ele toca um **caminho temporário**, e só é promovido
 * ao destino final depois que o hash confere. A janela perigosa — a execução seguinte encontrar
 * um arquivo corrompido e usá-lo como íntegro — some, porque nada com hash errado chega a existir
 * no caminho onde alguém procura.
 *
 * O `progresso` leva o total **declarado pela origem** (`Content-Length`), que pode não vir.
 * Quando não vem, o total é `undefined` e não zero: zero seria um número, e a tela desenharia uma
 * barra parada em vez de dizer que não sabe o tamanho.
 */

import { createHash } from 'node:crypto'

/** A que parte da instalação o artefato pertence. A tela agrupa o progresso por isto. */
export type GrupoDoArtefato = 'runtime' | 'wheel' | 'modelo'

export interface Artefato {
  readonly id: string
  readonly grupo: GrupoDoArtefato
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

/** O corpo da resposta, em pedaços, mais o tamanho que a origem declarou (quando declara). */
export interface CorpoDoDownload {
  readonly pedacos: AsyncIterable<Uint8Array>
  readonly totalBytes?: number
}

/** Quanto já veio de um artefato. `totalBytes` ausente = a origem não declarou o tamanho. */
export interface ProgressoDoDownload {
  readonly artefato: string
  readonly grupo: GrupoDoArtefato
  readonly baixados: number
  readonly totalBytes?: number
}

export interface DepsDoDownload {
  readonly buscar: (url: string) => Promise<CorpoDoDownload>
  /** Grava os pedaços num caminho temporário, conforme chegam. */
  readonly gravarPedacos: (destino: string, pedacos: AsyncIterable<Uint8Array>) => Promise<void>
  /** Move o temporário para o destino final. Só é chamado depois que o hash confere. */
  readonly promover: (temporario: string, destino: string) => Promise<void>
  readonly apagar: (destino: string) => Promise<void>
  readonly auditar: (evento: EventoDeAuditoriaDoDownload) => void
  /** O Policy Engine. Fail closed: o que ele não reconhece não acontece. */
  readonly permitido: (url: string) => boolean
  /** Chamado enquanto os bytes chegam. Opcional: quem não desenha barra não passa nada. */
  readonly progresso?: (p: ProgressoDoDownload) => void
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

  const hash = createHash('sha256')
  const temporario = `${artefato.destino}.parcial`
  let baixados = 0

  try {
    const corpo = await deps.buscar(artefato.url)

    // O hash acompanha a chegada, e o byte segue para o temporário no mesmo passo. É o que
    // mantém o pico de memória constante, seja o artefato de 6 KB ou de meio gigabyte.
    const contados = async function* (): AsyncGenerator<Uint8Array> {
      for await (const pedaco of corpo.pedacos) {
        hash.update(pedaco)
        baixados += pedaco.byteLength

        deps.progresso?.({
          artefato: artefato.id,
          grupo: artefato.grupo,
          baixados,
          totalBytes: corpo.totalBytes
        })

        yield pedaco
      }
    }

    await deps.gravarPedacos(temporario, contados())
  } catch (erro) {
    // O temporário fica para trás numa falha de rede ou de disco; apagá-lo é o que impede que
    // um download interrompido seja retomado como se estivesse completo.
    await deps.apagar(temporario)
    const motivo = erro instanceof Error ? erro.message : String(erro)
    fim({ estado: 'falhou', motivo })
    return { estado: 'falhou', motivo }
  }

  const obtido = hash.digest('hex')

  if (obtido !== artefato.sha256) {
    // Apaga o **temporário**: o destino final nunca chegou a receber estes bytes, que é
    // justamente o ponto de baixar para outro caminho.
    await deps.apagar(temporario)
    fim({ estado: 'hash-divergente', esperado: artefato.sha256, obtido })
    return { estado: 'hash-divergente' }
  }

  try {
    await deps.promover(temporario, artefato.destino)
  } catch (erro) {
    await deps.apagar(temporario)
    const motivo = erro instanceof Error ? erro.message : String(erro)
    fim({ estado: 'falhou', motivo })
    return { estado: 'falhou', motivo }
  }

  fim({ estado: 'ok', sha256: obtido })
  return { estado: 'ok' }
}
