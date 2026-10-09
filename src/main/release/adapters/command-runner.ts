import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

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
/** Teto por fluxo: um `pg_dump` ou build verboso não pode esgotar a memória do app. */
const TETO_DE_SAIDA = 8 * 1024 * 1024
const MARCA_DE_CORTE = '\n[saída cortada]'
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
  'DOCKER_CONFIG'
] as const

function acumular(atual: string, parte: Buffer): string {
  // Maior que o teto = já cortada (o corte acrescenta a marca): nada mais entra.
  if (atual.length > TETO_DE_SAIDA) return atual
  const proximo = atual + parte.toString('utf8')
  return proximo.length > TETO_DE_SAIDA ? proximo.slice(0, TETO_DE_SAIDA) + MARCA_DE_CORTE : proximo
}

/** `kill` no Windows mata só o `docker.exe`; o plugin (compose, buildx) filho sobreviveria. */
function encerrar(pid: number | undefined): void {
  if (pid === undefined || process.platform !== 'win32') return
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on(
    'error',
    () => undefined
  )
}

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
          // No Windows o libuv procura o binário no cwd antes do PATH: um `docker.exe` plantado
          // na pasta de execução seria o escolhido. O cwd padrão é neutro.
          cwd: options.cwd ?? tmpdir(),
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
          encerrar(filho.pid)
          filho.kill('SIGKILL')
        }, options.timeoutMs ?? TIMEOUT_PADRAO_MS)
        filho.stdout.on('data', (parte: Buffer) => (stdout = acumular(stdout, parte)))
        filho.stderr.on('data', (parte: Buffer) => (stderr = acumular(stderr, parte)))
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
