/**
 * O que transforma artefatos baixados num runtime que roda (SPEC-Voz-01, critérios 2 e 4).
 *
 * Entre "os 29 arquivos estão no disco" e "o sidecar sobe" há trabalho: extrair o CPython,
 * instalar as 24 wheels nele e escrever o script. Este arquivo é esse trabalho, e nada além —
 * ele não baixa (é o `download-de-artefato`) e não transcreve (é o engine).
 *
 * ## Prontidão é uma pergunta sobre o disco, não uma anotação
 *
 * `artefatosFaltando` olha o disco toda vez em vez de consultar um "instalado: true" gravado em
 * algum lugar. Anotação e realidade divergem — o usuário apaga a pasta, um download morre pela
 * metade, uma versão nova muda o catálogo — e quando divergem é a anotação que ganha,
 * prometendo um runtime que não está lá. O disco não mente sobre o próprio conteúdo.
 *
 * ## A instalação é idempotente, e é o que a torna retomável
 *
 * Cada passo verifica antes de agir: extração que já aconteceu não repete, wheel já instalada
 * não reinstala. Um download interrompido no arquivo 20 de 29 retoma do 20, e não do zero —
 * baixar 600 MB de novo porque a rede caiu no fim seria punição por acidente.
 */

import { SCRIPT_DO_SIDECAR } from './script-do-sidecar'
import type { Artefato } from './download-de-artefato'

/** O nome do script no disco. Fica junto do runtime, no `userData`. */
export const CAMINHO_DO_SCRIPT = 'voz/sidecar.py'

/** Onde o CPython é extraído. O `install_only` do python-build-standalone cria `python/`. */
export const DIRETORIO_DO_RUNTIME = 'voz/runtime/extraido'

/** O modelo, depois de baixados os quatro arquivos. */
export const DIRETORIO_DO_MODELO = 'voz/models/whisper-small'

/** A marca de que as wheels já foram instaladas neste runtime. */
export const MARCA_DE_WHEELS = 'voz/runtime/.wheels-instaladas'

export interface DepsDaInstalacao {
  /** Se um caminho relativo ao `userData` existe. */
  readonly existe: (relativo: string) => Promise<boolean>
  /** Extrai um `.tar.gz` num diretório, os dois relativos ao `userData`. */
  readonly extrair: (origem: string, destino: string) => Promise<void>
  /** Escreve texto num caminho relativo ao `userData`. */
  readonly escrever: (relativo: string, conteudo: string) => Promise<void>
  /** Roda o Python extraído com estes argumentos. Rejeita quando ele sai diferente de zero. */
  readonly rodarPython: (args: readonly string[]) => Promise<void>
  /** O caminho absoluto de um relativo ao `userData` — o `pip` precisa de absoluto. */
  readonly absoluto: (relativo: string) => string
}

/**
 * Os artefatos que ainda não estão no disco, pelo id.
 *
 * Devolve ids e não um booleano porque a tela precisa dizer **o que** falta baixar na primeira
 * execução (critério 4), e porque a instalação usa a mesma lista para saber se pode começar.
 */
export async function artefatosFaltando(
  artefatos: readonly Artefato[],
  existe: (relativo: string) => Promise<boolean>
): Promise<readonly string[]> {
  const presencas = await Promise.all(
    artefatos.map(async (a) => [a, await existe(a.destino)] as const)
  )

  return presencas.filter(([, presente]) => !presente).map(([a]) => a.id)
}

/** O que a instalação fez, ou por que não pôde fazer. */
export type DesfechoDaInstalacao =
  | { readonly estado: 'ok' }
  | { readonly estado: 'faltam-artefatos'; readonly ids: readonly string[] }
  | { readonly estado: 'falhou'; readonly motivo: string }

/**
 * Deixa o runtime pronto para o sidecar subir: extrai, instala as wheels e escreve o script.
 *
 * Recusa começar se faltar artefato — instalar pela metade deixaria um runtime que existe e não
 * funciona, que é pior que um que não existe, porque `disponivel()` passaria a mentir.
 */
export async function instalarRuntime(
  artefatos: readonly Artefato[],
  deps: DepsDaInstalacao
): Promise<DesfechoDaInstalacao> {
  const faltando = await artefatosFaltando(artefatos, deps.existe)
  if (faltando.length > 0) return { estado: 'faltam-artefatos', ids: faltando }

  try {
    if (!(await deps.existe(DIRETORIO_DO_RUNTIME))) {
      const runtime = artefatos.find((a) => a.grupo === 'runtime')
      if (runtime === undefined) {
        return { estado: 'falhou', motivo: 'O catálogo não tem runtime.' }
      }

      await deps.extrair(runtime.destino, DIRETORIO_DO_RUNTIME)
    }

    if (!(await deps.existe(MARCA_DE_WHEELS))) {
      const wheels = artefatos.filter((a) => a.grupo === 'wheel')

      // `--no-index` e `--no-deps`: o pip instala **exatamente** estes arquivos e não vai à
      // rede buscar mais nada. Um pip que resolvesse dependências aqui traria bytes que nenhum
      // hash verificou, que é o furo que o catálogo pinado existe para fechar.
      await deps.rodarPython([
        '-m',
        'pip',
        'install',
        '--no-index',
        '--no-deps',
        ...wheels.map((w) => deps.absoluto(w.destino))
      ])

      // A marca é escrita **depois** do pip. Antes, um pip que falhasse deixaria a marca
      // afirmando uma instalação que não houve, e a execução seguinte pularia o passo.
      await deps.escrever(MARCA_DE_WHEELS, new Date().toISOString())
    }

    // O script é reescrito sempre: ele é a única peça que muda com o código do app, e uma
    // versão velha no disco falaria um protocolo que o `Sidecar` não fala mais.
    await deps.escrever(CAMINHO_DO_SCRIPT, SCRIPT_DO_SIDECAR)

    return { estado: 'ok' }
  } catch (erro) {
    return { estado: 'falhou', motivo: erro instanceof Error ? erro.message : String(erro) }
  }
}
