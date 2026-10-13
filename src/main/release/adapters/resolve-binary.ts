import { existsSync, readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/**
 * Resolve o executável **só pelo PATH**, nunca pelo diretório de trabalho (SPEC-Release-03, revisão
 * de segurança). No Windows o libuv procura o binário no `cwd` antes do PATH: com `cwd` num
 * working tree de PR, um `vercel.exe` plantado ali receberia os tokens do operador. Resolvendo o
 * caminho absoluto antes do `spawn`, o `cwd` deixa de influenciar qual binário roda.
 *
 * Também resolve o caso comum de CLIs instaladas pelo npm no Windows, que existem só como `.cmd`
 * (o Node recusa executar `.cmd` sem shell): o shim é lido e o script `.js` que ele chama é
 * executado direto pelo Node — `shell: false` continua valendo.
 */

export interface InvocacaoResolvida {
  readonly comando: string
  readonly prefixo: readonly string[]
}

export interface AmbienteDeResolucao {
  readonly plataforma: NodeJS.Platform
  readonly path: string
  readonly pathext: string
  readonly cwd: string
  readonly execPath: string
  readonly existe: (caminho: string) => boolean
  readonly ler: (caminho: string) => string
}

function ambientePadrao(): AmbienteDeResolucao {
  return {
    plataforma: process.platform,
    path: process.env.PATH ?? process.env.Path ?? '',
    pathext: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
    cwd: process.cwd(),
    execPath: process.execPath,
    existe: existsSync,
    ler: (caminho) => readFileSync(caminho, 'utf8')
  }
}

const NOME_SEGURO = /^[A-Za-z0-9._-]+$/
/** O shim do npm termina com `"%dp0%\caminho\relativo\script.js" %*`. */
const SHIM_DO_NPM = /"%dp0%\\([^"]+?\.m?js)"/i

function mesmoDiretorio(a: string, b: string, plataforma: NodeJS.Platform): boolean {
  const norm = (p: string): string =>
    (plataforma === 'win32' ? win32.normalize(p).toLowerCase() : posix.normalize(p)).replace(
      /[\\/]+$/,
      ''
    )
  return norm(a) === norm(b)
}

/** `null` = não achado no PATH. O chamador recusa: cair no binário cru reabriria a busca pelo `cwd`. */
export function resolverBinario(
  binario: string,
  env: AmbienteDeResolucao = ambientePadrao()
): InvocacaoResolvida | null {
  // Só nomes simples: caminho ou separador nunca é aceito como "binário permitido".
  if (!NOME_SEGURO.test(binario)) return null
  const windows = env.plataforma === 'win32'
  const pastas = env.path
    .split(windows ? ';' : ':')
    .map((p) => p.trim().replace(/^"|"$/g, ''))
    .filter(
      (p) =>
        p && (windows ? win32 : posix).isAbsolute(p) && !mesmoDiretorio(p, env.cwd, env.plataforma)
    )
  const caminhos = windows ? win32 : posix
  const junta = caminhos.join

  for (const pasta of pastas) {
    if (!windows) {
      const candidato = junta(pasta, binario)
      if (env.existe(candidato)) return { comando: candidato, prefixo: [] }
      continue
    }
    const extensoes = env.pathext
      .split(';')
      .map((e) => e.toLowerCase())
      .filter(Boolean)
    for (const ext of ['.exe', '.com']) {
      const candidato = junta(pasta, `${binario}${ext}`)
      if (extensoes.includes(ext) && env.existe(candidato))
        return { comando: candidato, prefixo: [] }
    }
    const shim = junta(pasta, `${binario}.cmd`)
    if (env.existe(shim)) {
      const relativo = SHIM_DO_NPM.exec(env.ler(shim))?.[1]
      if (relativo) {
        // Resolve na plataforma simulada, não na do host: assim o teste vale igual no Linux do CI.
        const script = caminhos.resolve(pasta, relativo.replace(/\\/g, '/'))
        if (env.existe(script)) return { comando: env.execPath, prefixo: [script] }
      }
    }
  }
  return null
}
