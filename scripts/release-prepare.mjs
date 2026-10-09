#!/usr/bin/env node
/**
 * Prepara uma release localmente (SPEC-Release-02): configuração, Docker Compose, migrations,
 * publicação única do backend por digest e verificação. É o comando da aplicação — roda dentro do
 * Electron porque a chave da cadeia de auditoria só abre lá (`safeStorage`).
 *
 * Uso:
 *   npm run release:prepare -- --data-dir <userData> --user <id> --workspace noa|jarvis \
 *     --project <id> --release <id> --profile <release-profile.json> [--registry ghcr.io] \
 *     [--auto-start-docker]
 *
 * `--auto-start-docker` é a autorização para ligar o Docker se ele estiver desligado.
 * Sai com 0 (preparada), 3 (bloqueada, com a razão no JSON) ou 2 (uso inválido).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Dentro do repo: o bundle resolve better-sqlite3 e demais pacotes pelo node_modules daqui.
const saida = join(raiz, 'out', 'release-cli', 'prepare.cjs')

await build({
  entryPoints: [join(raiz, 'src/main/release/release-prepare-entry.ts')],
  outfile: saida,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: { '@shared': join(raiz, 'src/shared') },
  logLevel: 'error'
})

const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
// Com esta variável o Electron roda como Node puro e `safeStorage` deixa de existir.
delete env.ELECTRON_RUN_AS_NODE
// Argumentos por ambiente, não por `argv`: o Chromium varre a linha de comando inteira e um valor
// `host:porta` (`--registry localhost:5000`) seguido de outro switch o derruba com código -1.
env.JARVIS_RELEASE_PREPARE_ARGV = JSON.stringify([
  ...process.argv.slice(2),
  '--compose-file',
  join(raiz, 'docker/release/compose.yml')
])

const filho = spawn(
  electron,
  [saida],
  // Por pipe, não `inherit`: o Electron é um binário de interface e perde os handles de um pai
  // sem console (CI, subprocesso). O launcher repassa a saída e o código.
  { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true }
)
filho.stdout.pipe(process.stdout)
filho.stderr.pipe(process.stderr)
filho.on('error', (erro) => {
  process.stderr.write(`Falha ao iniciar o Electron: ${erro.message}\n`)
  process.exit(1)
})
filho.on('exit', (codigo) => process.exit(codigo ?? 1))
