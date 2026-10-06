import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { criarCronogramaEmDisco } from './cronograma-em-disco'

const temporarios: string[] = []
afterEach(() => {
  for (const pasta of temporarios.splice(0)) rmSync(pasta, { recursive: true, force: true })
})
function caminho(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'cronograma-f04-'))
  temporarios.push(pasta)
  return join(pasta, 'estado.json')
}

describe('SPEC-Escuta-04 · persistência local', () => {
  it('começa desligada, grava atomicamente e só reabre para o mesmo usuário', () => {
    const arquivo = caminho()
    const estado = criarCronogramaEmDisco(arquivo, 'usuario-a')
    expect(estado.ler()).toEqual({ versao: 1, ativa: false, sequencias: [] })
    estado.salvar({ versao: 1, ativa: true, sequencias: [] })
    expect(criarCronogramaEmDisco(arquivo, 'usuario-a').ler().ativa).toBe(true)
    expect(criarCronogramaEmDisco(arquivo, 'usuario-b').ler().ativa).toBe(false)
    expect(JSON.parse(readFileSync(arquivo, 'utf8'))).toMatchObject({
      user_id: 'usuario-a',
      workspace_id: 'jarvis'
    })
  })
  it('falha fechada quando o arquivo é ilegível ou inválido', () => {
    const arquivo = caminho()
    writeFileSync(arquivo, '{incompleto')
    expect(criarCronogramaEmDisco(arquivo, 'usuario-a').ler().ativa).toBe(false)
  })
})
