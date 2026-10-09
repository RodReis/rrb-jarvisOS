// Frontend mínimo do projeto de prova: serve uma página que aponta para o backend do MESMO run.
import http from 'node:http'
import process from 'node:process'

const porta = Number(process.env.PORT)
const apiUrl = process.env.API_URL

http
  .createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(`<!doctype html><title>prova</title><p data-api="${apiUrl}">ok</p>`)
    }
    res.writeHead(404).end()
  })
  .listen(porta, '0.0.0.0')
