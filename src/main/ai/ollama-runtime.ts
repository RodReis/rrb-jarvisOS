import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { log } from '../logging/logger'

/** Inicia apenas uma instalação local conhecida; nunca executa um nome vindo do PATH. */
export function caminhoDoOllama(
  plataforma = process.platform,
  localAppData = process.env.LOCALAPPDATA
): string | undefined {
  const candidatos =
    plataforma === 'win32'
      ? localAppData
        ? [join(localAppData, 'Programs', 'Ollama', 'ollama.exe')]
        : []
      : plataforma === 'darwin'
        ? ['/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama']
        : ['/usr/local/bin/ollama', '/usr/bin/ollama']
  return candidatos.find((caminho) => existsSync(caminho))
}

/** A instância já existente pertence ao usuário; só o processo criado pelo app é encerrado aqui. */
export async function iniciarOllamaLocal(
  adapter: { readonly disponivel: () => Promise<boolean> },
  caminho = caminhoDoOllama(),
  iniciar: typeof spawn = spawn
): Promise<(() => void) | undefined> {
  if (await adapter.disponivel()) return undefined
  if (!caminho) {
    log.sistema.warn('Ollama não instalado no caminho local conhecido')
    return undefined
  }
  let processo: ChildProcess
  try {
    processo = iniciar(caminho, ['serve'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    })
  } catch (erro) {
    log.sistema.warn('Não foi possível iniciar o Ollama local', { erro })
    return undefined
  }
  processo.on('error', (erro) => log.sistema.warn('Ollama local falhou ao iniciar', { erro }))
  log.sistema.info('Inicialização do Ollama local solicitada')
  return () => {
    if (!processo.killed) processo.kill()
  }
}
