#!/usr/bin/env node
/**
 * Office3D Hook — cross-platform (Windows/Mac/Linux)
 * Encaminha eventos do Claude Code para o escritório 3D.
 *
 * Instalação: copie para <SEU_PROJETO>/.claude/hooks/office3d.js
 */

const http = require('http')
// NUNCA 'localhost': no Windows com Node >=17 ele resolve ::1 (IPv6) primeiro,
// mas o backend faz bind só em 127.0.0.1 → ECONNREFUSED silencioso (§8.1).
const OFFICE3D_URL = process.env.OFFICE3D_URL || 'http://127.0.0.1:3001'

const chunks = []
process.stdin.on('data', (d) => chunks.push(d))
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf-8')

  // Garante o campo `cwd` no payload (RepoScanner da Fase 4 depende dele).
  // O Claude Code costuma injetar cwd; se faltar, usa o diretório do processo,
  // que é a raiz do projeto onde o hook roda.
  let payload = raw
  try {
    const obj = JSON.parse(raw)
    if (!obj.cwd) obj.cwd = process.cwd()
    payload = JSON.stringify(obj)
  } catch (_) {
    // payload não-JSON: encaminha cru (nunca bloqueia o Claude Code)
  }

  // Sempre exit 0 — nunca bloqueia o Claude Code.
  // Precisa esperar o request terminar: process.exit() imediato mata
  // o socket antes de ele ser enviado e o evento se perde.
  const done = () => process.exit(0)

  try {
    const url = new URL('/hook', OFFICE3D_URL)
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 3001,
        path: url.pathname,
        method: 'POST',
        family: 4, // força IPv4 mesmo se alguém apontar OFFICE3D_URL p/ localhost
        timeout: 1000, // backend lento nunca trava o Claude Code
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume() // drena a resposta para o socket fechar
        res.on('end', done)
      }
    )
    req.on('error', done) // backend off — segue a vida
    req.on('timeout', () => req.destroy())
    req.write(payload)
    req.end()
  } catch (_) {
    done()
  }
})
