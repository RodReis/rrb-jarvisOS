/** Guarda da SPEC-Escuta-03: mede saída, sem ler PCM nem nomes de sessões. */
import { execFile } from 'node:child_process'
import { join } from 'node:path'

type Executar = (
  arquivo: string,
  argumentos: readonly string[],
  opcoes: { readonly windowsHide: true; readonly timeout: number },
  concluido: (erro: Error | null, stdout: string) => void
) => void

const executarPadrao: Executar = (arquivo, argumentos, opcoes, concluido) => {
  execFile(arquivo, [...argumentos], opcoes, (erro, stdout) => {
    concluido(erro, stdout)
  })
}

export function atividadeDeAudioNoWindows(
  executar: Executar = executarPadrao,
  plataforma: NodeJS.Platform = process.platform,
  script = join(__dirname, 'atividade-de-audio.ps1')
): Promise<boolean | undefined> {
  if (plataforma !== 'win32') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    executar(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 5_000 },
      (erro, stdout) => {
        if (erro) return resolve(undefined)
        const resultado = stdout.trim()
        if (resultado === 'ATIVO') return resolve(true)
        if (resultado === 'SILENCIO') return resolve(false)
        resolve(undefined)
      }
    )
  })
}
