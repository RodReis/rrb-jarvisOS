/**
 * O runtime da voz vira **utilizável** depois de baixado (SPEC-Voz-01 § Dentro e decisão 5).
 *
 * ## O que estava errado
 *
 * A spec diz que o runtime é *"baixado no 1º uso (python-build-standalone + wheels com versão e
 * SHA-256 pinados)"* — para o sidecar rodar. O download gravava `voz/runtime/python.tar.gz` e as
 * wheels em `voz/wheels/`, e **nada os abria**. O main procura
 * `voz/runtime/python/python.exe`, que nunca existiu: o spawn falhava, a transcrição caía no
 * `catch` e a tela pedia "tentar de novo" para algo que tentar de novo nunca conserta.
 *
 * Pior que a falha: a **prontidão dizia que estava pronta**, porque perguntava se o arquivo
 * baixado existia. O tarball existia. O critério 4 existe para impedir exatamente esse estado —
 * a UI ofereceu baixar, o usuário baixou, e o app declarou pronto o que não roda.
 *
 * ## Duas etapas, e por que não uma
 *
 * `baixarArtefato` continua fazendo só o que faz: rede, hash, disco. Ele é auditado byte a byte e
 * roda uma vez por artefato; o preparo roda **uma vez para o conjunto** e depende de todos eles
 * já estarem lá — as wheels só instalam depois do Python extraído. Fundir os dois faria a
 * instalação rodar 28 vezes, uma por wheel baixada.
 *
 * ## `tar` do Windows, não uma dependência nova
 *
 * `C:\Windows\System32\tar.exe` (bsdtar) vem no Windows 10+ e extrai este tarball em ~1,5 s,
 * medido. Uma lib de tar em npm resolveria o mesmo problema com uma dependência a mais no
 * processo que já tem acesso a disco. `PATH` não é consultado: o binário é chamado pelo caminho
 * absoluto do `System32`, porque um `tar` de terceiro no `PATH` (o do Git, por exemplo) é
 * ambiente do usuário e não a garantia do produto.
 *
 * ## Idempotente por construção
 *
 * Cada passo verifica o resultado antes de agir. Reabrir o app não reextrai 200 MB nem reinstala
 * 28 wheels, e um preparo interrompido no meio termina na execução seguinte — que é o cenário
 * real, porque a instalação leva ~22 s e o usuário pode fechar o app no meio.
 */

import { join } from 'node:path'

/** Onde o sidecar espera achar o interpretador, relativo ao diretório da voz. */
export const RELATIVO_DO_PYTHON = join('runtime', 'python', 'python.exe')

/**
 * A marca de que as wheels foram instaladas.
 *
 * `faster_whisper` e não um arquivo de controle escrito por nós: é o pacote que o sidecar do STT
 * importa, então sua presença é a mesma pergunta que o sidecar fará. Um carimbo próprio poderia
 * dizer "instalado" para um `site-packages` que alguém apagou pela metade.
 */
export const RELATIVO_DA_MARCA = join('runtime', 'python', 'Lib', 'site-packages', 'faster_whisper')

/**
 * O `tar` do Windows, por caminho absoluto.
 *
 * Chamar `'tar'` e deixar o `PATH` resolver pegaria o `tar` do Git em máquinas que o têm antes do
 * `System32` — funciona, mas passa a depender do que o usuário instalou. O produto garante o do
 * sistema.
 */
export const TAR_DO_WINDOWS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

export type DesfechoDoPreparo =
  | { readonly estado: 'ok' }
  | { readonly estado: 'nada-a-fazer' }
  | { readonly estado: 'falhou'; readonly motivo: string }

export interface DepsDoPreparo {
  /** Raiz da voz no `userData` — o mesmo `diretorioDaVoz` que o main usa. */
  readonly diretorioDaVoz: (...partes: string[]) => string
  readonly existe: (caminho: string) => boolean
  /** Os `.whl` presentes no disco. Vazio significa nada a instalar. */
  readonly wheels: () => readonly string[]
  /** Roda um processo até o fim. Rejeita com a saída quando o código não é zero. */
  readonly executar: (comando: string, args: readonly string[]) => Promise<void>
  readonly registrar: (msg: string, ctx?: Record<string, unknown>) => void
}

/**
 * Extrai o runtime e instala as wheels, se ainda não estiverem.
 *
 * Devolve desfecho em vez de lançar porque quem chama é o fluxo de download da tela: uma exceção
 * aqui chegaria ao renderer como erro opaco, e a próxima ação some junto — o mesmo motivo pelo
 * qual `transcrever` é fechado em desfechos.
 */
export async function prepararRuntime(deps: DepsDoPreparo): Promise<DesfechoDoPreparo> {
  const tarball = deps.diretorioDaVoz('runtime', 'python.tar.gz')
  const python = deps.diretorioDaVoz(RELATIVO_DO_PYTHON)

  let fezAlgo = false

  if (!deps.existe(python)) {
    // Sem tarball e sem interpretador não é falha do preparo: é download que ainda não
    // aconteceu. Chamar `tar` num arquivo ausente daria um erro sobre a ferramenta, escondendo
    // que o que falta é o artefato.
    if (!deps.existe(tarball)) return { estado: 'nada-a-fazer' }

    deps.registrar('Extraindo o runtime da voz')

    try {
      await deps.executar(TAR_DO_WINDOWS, ['-xf', tarball, '-C', deps.diretorioDaVoz('runtime')])
    } catch (erro) {
      return { estado: 'falhou', motivo: `Não foi possível extrair o runtime: ${mensagem(erro)}` }
    }

    /*
     * Extrair sem erro não prova que o interpretador ficou onde o sidecar procura.
     *
     * O tarball do python-build-standalone abre em `python/`, e é isso que faz o caminho bater.
     * Um release com outro layout sairia com código zero e deixaria a prontidão mentindo de novo
     * — o mesmo defeito, uma camada adiante. Aqui ele vira falha nomeada.
     */
    if (!deps.existe(python)) {
      return {
        estado: 'falhou',
        motivo: 'O runtime foi extraído, mas o interpretador não está onde o sidecar o procura.'
      }
    }

    fezAlgo = true
  }

  const wheels = deps.wheels()

  if (wheels.length > 0 && !deps.existe(deps.diretorioDaVoz(RELATIVO_DA_MARCA))) {
    deps.registrar('Instalando as dependências da voz', { wheels: wheels.length })

    try {
      /*
       * `--no-index` e `--no-deps`: a instalação é **offline** e o conjunto de wheels já é o
       * fecho de dependências, pinado com SHA-256 no catálogo. Sem os dois, o pip iria à rede
       * resolver o que já está no disco — e um pacote entraria sem passar pelo hash pinado, que é
       * a garantia que o critério 4 protege.
       */
      await deps.executar(deps.diretorioDaVoz(RELATIVO_DO_PYTHON), [
        '-m',
        'pip',
        'install',
        '--no-index',
        '--no-deps',
        '--no-warn-script-location',
        ...wheels
      ])
    } catch (erro) {
      return {
        estado: 'falhou',
        motivo: `Não foi possível instalar as dependências da voz: ${mensagem(erro)}`
      }
    }

    fezAlgo = true
  }

  return fezAlgo ? { estado: 'ok' } : { estado: 'nada-a-fazer' }
}

/**
 * O runtime está **usável**? (não: "o arquivo baixado existe")
 *
 * É esta pergunta que a prontidão passa a fazer. A anterior — o destino do download existe —
 * respondia sim para um tarball fechado, e é a razão de a tela ter oferecido transcrever com o
 * sidecar impossível de subir.
 */
export function runtimeUsavel(deps: Pick<DepsDoPreparo, 'diretorioDaVoz' | 'existe'>): boolean {
  return (
    deps.existe(deps.diretorioDaVoz(RELATIVO_DO_PYTHON)) &&
    deps.existe(deps.diretorioDaVoz(RELATIVO_DA_MARCA))
  )
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}
