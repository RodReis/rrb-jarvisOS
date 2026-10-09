// Backend mínimo do projeto de prova: /health só responde 200 se o Postgres aceita conexão TCP.
import http from 'node:http'
import process from 'node:process'
import net from 'node:net'

const porta = Number(process.env.PORT)
const dbHost = process.env.DATABASE_HOST
const dbPorta = Number(process.env.DATABASE_PORT)

function bancoResponde() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: dbHost, port: dbPorta, timeout: 1500 })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('timeout', () => (socket.destroy(), resolve(false)))
    socket.once('error', () => resolve(false))
  })
}

http
  .createServer(async (req, res) => {
    if (req.url === '/health') {
      const ok = await bancoResponde()
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok }))
    }
    res.writeHead(404).end()
  })
  .listen(porta, '0.0.0.0')
