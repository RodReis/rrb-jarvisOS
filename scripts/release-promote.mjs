#!/usr/bin/env node
/**
 * Promove uma release mergeada para Staging e Produção (SPEC-Release-04): build único do backend,
 * Staging (migration, deploy, atribuição do frontend, health, smoke e E2E essencial), Produção
 * (backup, migration, o MESMO digest e o MESMO frontend) e estabilização — compensando as
 * aplicações se algo falhar. Idempotente. É o comando da aplicação: roda dentro do Electron porque
 * a chave da cadeia de auditoria só abre lá (`safeStorage`).
 *
 * Os tokens vêm do ambiente, nunca de argumento: RAILWAY_API_TOKEN e VERCEL_TOKEN.
 *
 * Uso:
 *   npm run release:promote -- --data-dir <userData> --user <id> --workspace noa|jarvis \
 *     --project <id> --profile <release-profile.json> --promotion-profile <promotion.json> \
 *     --compose-file <compose.yml> --event merge --sha <sha> \
 *     [--registry ghcr.io] [--namespace <dono>] [--builder <nome>] [--auto-start-docker]
 *   npm run release:promote -- ... --event resume --release <id>
 *
 * A árvore local precisa ser o commit da release. Sai com 0 (concluída), 3 (falhou, degradada ou
 * bloqueada por passo de efeito incerto), 5 (aguarda a lane ou outro executor) ou 2 (uso inválido).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Dentro do repo: o bundle resolve better-sqlite3 e demais pacotes pelo node_modules daqui.
const saida = join(raiz, 'out', 'release-cli', 'promote.cjs')

await build({
  entryPoints: [join(raiz, 'src/main/release/release-promote-entry.ts')],
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
env.JARVIS_RELEASE_PROMOTE_ARGV = JSON.stringify(process.argv.slice(2))

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
