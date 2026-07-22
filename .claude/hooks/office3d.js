#!/usr/bin/env node
/**
 * Office3D Hook — cross-platform (Windows/Mac/Linux)
 * Encaminha eventos do Claude Code para o escritório 3D.
 *
 * Instalação: copie para <SEU_PROJETO>/.claude/hooks/office3d.js
 */

const http = require('http')
const OFFICE3D_URL = process.env.OFFICE3D_URL || 'http://localhost:3001'

const chunks = []
process.stdin.on('data', (d) => chunks.push(d))
process.stdin.on('end', () => {
  const payload = Buffer.concat(chunks).toString('utf-8')

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
