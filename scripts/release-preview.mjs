#!/usr/bin/env node
/**
 * Converge o Preview isolado de um PR (SPEC-Release-03): imagem por digest, ambiente temporário
 * (backend + PostgreSQL), migrations e seed, frontend e verificação — ou, com o PR fechado,
 * destrói tudo que o Preview criou. Idempotente. É o comando da aplicação: roda dentro do
 * Electron porque a chave da cadeia de auditoria só abre lá (`safeStorage`).
 *
 * Os tokens vêm do ambiente, nunca de argumento: RAILWAY_API_TOKEN e VERCEL_TOKEN.
 *
 * Uso:
 *   npm run release:preview -- --data-dir <userData> --user <id> --workspace noa|jarvis \
 *     --project <id> --pr <n> --spec <SPEC-...> --spec-revision <rev> --repo <dono/nome> \
 *     --profile <release-profile.json> --railway-workdir <pasta> --railway-template <ambiente> \
 *     --railway-backend-service <svc> --railway-database-service <svc> \
 *     --vercel-workdir <pasta> --vercel-api-env <VARIAVEL> \
 *     [--event sync|open|close --sha <sha>] [--registry ghcr.io] [--namespace <dono>] \
 *     [--builder <nome>] [--vercel-scope <time>]
 *
 * `sync` (padrão) lê o estado do PR no GitHub: aberto cria/atualiza; fechado ou mergeado destrói.
 * Sai com 0 (pronto, removido ou ausente), 3 (falhou ou limpeza pendente), 5 (outro executor
 * cuida deste PR) ou 2 (uso inválido).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Dentro do repo: o bundle resolve better-sqlite3 e demais pacotes pelo node_modules daqui.
const saida = join(raiz, 'out', 'release-cli', 'preview.cjs')

await build({
  entryPoints: [join(raiz, 'src/main/release/release-preview-entry.ts')],
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
env.JARVIS_RELEASE_PREVIEW_ARGV = JSON.stringify(process.argv.slice(2))

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
