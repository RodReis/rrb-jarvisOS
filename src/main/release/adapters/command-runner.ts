import { spawn } from 'node:child_process'

/**
 * Porta de execução das CLIs dos adapters (SPEC-Release-02, regra 6: o adaptador declara a CLI
 * usada). Sem shell, só binários permitidos, env **explícito** e saída redigida: segredo nunca
 * vai em argumento, e o ambiente do processo não é herdado.
 */

export interface CommandResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface CommandOptions {
  readonly cwd?: string
  /** Único ambiente repassado ao filho, somado ao mínimo para achar o binário. */
  readonly env?: Readonly<Record<string, string>>
  readonly input?: string
  readonly timeoutMs?: number
  /** Valores que não podem aparecer na saída capturada. */
  readonly redact?: readonly string[]
}

export interface CommandRunner {
  run(binary: string, args: readonly string[], options?: CommandOptions): Promise<CommandResult>
}

const TIMEOUT_PADRAO_MS = 5 * 60_000
/** O mínimo para o SO achar o binário e o Docker achar seu daemon e credential store. */
const VARIAVEIS_BASE = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT'
] as const

export function redigir(texto: string, segredos: readonly string[]): string {
  let saida = texto
  for (const segredo of segredos) {
    if (segredo) saida = saida.split(segredo).join('[REDIGIDO]')
  }
  return saida
}

function ambienteMinimo(extra: Readonly<Record<string, string>>): Record<string, string> {
  const base: Record<string, string> = {}
  for (const nome of VARIAVEIS_BASE) {
    const valor = process.env[nome]
    if (valor !== undefined) base[nome] = valor
  }
  return { ...base, ...extra }
}

export function createCommandRunner(config: {
  readonly allowed: readonly string[]
}): CommandRunner {
  return {
    run(binary, args, options = {}) {
      if (!config.allowed.includes(binary)) {
        return Promise.reject(new Error(`Binário não permitido: ${binary}`))
      }
      return new Promise<CommandResult>((resolve, reject) => {
        const filho = spawn(binary, [...args], {
          cwd: options.cwd,
          env: ambienteMinimo(options.env ?? {}),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        const relogio = setTimeout(() => {
          timedOut = true
          filho.kill('SIGKILL')
        }, options.timeoutMs ?? TIMEOUT_PADRAO_MS)
        filho.stdout.on('data', (parte: Buffer) => (stdout += parte.toString('utf8')))
        filho.stderr.on('data', (parte: Buffer) => (stderr += parte.toString('utf8')))
        filho.on('error', (erro) => {
          clearTimeout(relogio)
          reject(erro)
        })
        filho.on('close', (code) => {
          clearTimeout(relogio)
          const segredos = options.redact ?? []
          resolve({
            code,
            stdout: redigir(stdout, segredos),
            stderr: redigir(stderr, segredos),
            timedOut
          })
        })
        filho.stdin.on('error', () => undefined)
        filho.stdin.end(options.input ?? '')
      })
    }
  }
}
