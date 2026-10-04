import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { criarEstadoDaEscutaEmDisco } from './estado-da-escuta-em-disco'

const ESTADO = {
  ativa: false,
  frase: true,
  palmas: false,
  sensibilidade: 0.7,
  hotkey: 'Control+Shift+K'
} as const

let pasta: string
let arquivo: string

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'escuta-'))
  arquivo = join(pasta, 'voz', 'escuta.json')
})
afterEach(() => rmSync(pasta, { recursive: true, force: true }))

describe('estado persistido da escuta (SPEC-Escuta-01, critério 8)', () => {
  it('na primeira execução não há estado: vale o padrão do serviço (ligada)', () => {
    expect(criarEstadoDaEscutaEmDisco(arquivo).ler()).toBeUndefined()
  })

  it('o que foi gravado volta igual, criando a pasta que faltava', () => {
    const estado = criarEstadoDaEscutaEmDisco(arquivo)
    estado.gravar(ESTADO)
    expect(estado.ler()).toEqual(ESTADO)
  })

  it('não deixa arquivo temporário para trás', () => {
    criarEstadoDaEscutaEmDisco(arquivo).gravar(ESTADO)
    expect(readdirSync(join(pasta, 'voz'))).toEqual(['escuta.json'])
  })

  it('arquivo corrompido falha fechado: a escuta volta desligada, não ligada', () => {
    const estado = criarEstadoDaEscutaEmDisco(arquivo)
    estado.gravar(ESTADO)
    writeFileSync(arquivo, '{"ativa": tru')

    // Se o PI desligou o microfone e o arquivo estragou, abrir o microfone "por padrão" é o pior
    // desfecho possível. Estado ilegível não é primeira execução.
    expect(estado.ler()).toMatchObject({ ativa: false })
  })

  it('arquivo sem hotkey, de antes dela existir, mantém o resto e usa a hotkey padrão', () => {
    const estado = criarEstadoDaEscutaEmDisco(arquivo)
    estado.gravar(ESTADO)

    writeFileSync(
      arquivo,
      JSON.stringify({ ativa: true, frase: false, palmas: true, sensibilidade: 0.6 })
    )

    // Campo novo ausente não é arquivo corrompido: tratá-lo assim desligaria a escuta sem o PI
    // ter pedido.
    expect(estado.ler()).toEqual({
      ativa: true,
      frase: false,
      palmas: true,
      sensibilidade: 0.6,
      hotkey: 'Control+Alt+M'
    })
  })

  it('hotkey fora da lista volta para a padrão, sem desligar a escuta', () => {
    const estado = criarEstadoDaEscutaEmDisco(arquivo)
    estado.gravar(ESTADO)

    writeFileSync(arquivo, JSON.stringify({ ...ESTADO, ativa: true, hotkey: 'Control+C' }))

    expect(estado.ler()).toMatchObject({ ativa: true, hotkey: 'Control+Alt+M' })
  })

  it('forma errada também falha fechado, e não aceita o que o contrato não promete', () => {
    const estado = criarEstadoDaEscutaEmDisco(arquivo)
    estado.gravar(ESTADO)

    writeFileSync(arquivo, JSON.stringify({ ativa: 'sim', frase: 1, sensibilidade: 'alta' }))

    expect(estado.ler()).toEqual({
      ativa: false,
      frase: true,
      palmas: true,
      sensibilidade: 0.95,
      hotkey: 'Control+Alt+M'
    })
  })
})
