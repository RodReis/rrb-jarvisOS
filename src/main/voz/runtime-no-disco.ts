/**
 * Os detalhes de sistema operacional da instalação (SPEC-Voz-01, critérios 2 e 4).
 *
 * Extrair um `.tar.gz`, achar o executável do Python e rodá-lo. Nada disto é domínio: mora aqui
 * para que a `instalacao` fale de passos ("extrair", "rodar pip") e possa ser testada sem tocar
 * o disco, enquanto este arquivo fala de caminhos e processos.
 *
 * ## Sem biblioteca de tar
 *
 * A extração usa o `tar` **do sistema**, que existe no Windows 10+ (`System32\\tar.exe`, um
 * bsdtar) e em todo Unix. Trazer um pacote de npm para descompactar um arquivo que o sistema já
 * sabe abrir seria dependência nova — com a superfície de supply chain que vem junto — para
 * resolver o que uma chamada de processo resolve.
 *
 * No Windows o caminho é absoluto de propósito: `tar` sem caminho pegaria o que estivesse no
 * `PATH`, e numa máquina com Git for Windows instalado esse é o GNU tar do MSYS, que interpreta
 * `C:\\...` como host remoto.
 *
 * ## Windows primeiro
 *
 * O `install_only` do python-build-standalone deixa o executável em `python/python.exe` no
 * Windows e em `python/bin/python3` nos outros. O projeto é Windows por padrão (CLAUDE.md), mas
 * a diferença é uma linha e não custava esconder uma quebra futura atrás de um caminho fixo.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const NO_WINDOWS = process.platform === 'win32'

/** O executável do Python dentro do diretório extraído. */
export function caminhoDoPythonDaVoz(diretorioExtraido: string): string {
  return NO_WINDOWS
    ? join(diretorioExtraido, 'python', 'python.exe')
    : join(diretorioExtraido, 'python', 'bin', 'python3')
}

/**
 * Roda um executável e espera ele terminar, rejeitando com o stderr quando ele falha.
 *
 * O stderr vai junto porque é onde a explicação mora: um `pip` que falha diz o motivo ali, e
 * engolir isso deixaria a instalação falhando com "código 1", que não ajuda ninguém a
 * consertar.
 */
async function rodar(executavel: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolver, rejeitar) => {
    const processo = spawn(executavel, [...args], { windowsHide: true })
    let erro = ''

    processo.stderr.on('data', (pedaco: Buffer) => {
      // Limitado ao fim: um pip que falha instalando 24 wheels escreve muito, e a mensagem que
      // importa é a última.
      erro = (erro + pedaco.toString('utf8')).slice(-4_000)
    })

    processo.on('error', rejeitar)
    processo.on('exit', (codigo) => {
      if (codigo === 0) return resolver()

      rejeitar(new Error(`\`${executavel}\` saiu com código ${codigo}. ${erro.trim()}`))
    })
  })
}

/** Extrai um `.tar.gz` num diretório. Os dois caminhos são absolutos. */
export async function extrairTarGz(origem: string, destino: string): Promise<void> {
  const executavel = NO_WINDOWS
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'

  await rodar(executavel, ['-xzf', origem, '-C', destino])
}

/** Roda o Python instalado com estes argumentos. */
export async function rodarPythonDaVoz(
  diretorioExtraido: string,
  args: readonly string[]
): Promise<void> {
  await rodar(caminhoDoPythonDaVoz(diretorioExtraido), args)
}
