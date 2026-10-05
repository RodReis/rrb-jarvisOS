import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS,
  criarEstadoDasBoasVindasEmDisco,
  validarConfiguracaoDasBoasVindas
} from './estado-das-boas-vindas-em-disco'

const pastas: string[] = []
function caminho(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'boas-vindas-'))
  pastas.push(pasta)
  return join(pasta, 'estado.json')
}
afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

describe('estado das boas-vindas em disco', () => {
  it('começa desligado e mantém configuração e último dia entre instâncias', () => {
    const arquivo = caminho()
    const primeiro = criarEstadoDasBoasVindasEmDisco(arquivo)
    expect(primeiro.configuracao().ativa).toBe(false)
    primeiro.salvarConfiguracao({ ...CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS, ativa: true })
    primeiro.gravar({ ultimoDiaDesbloqueado: '2026-10-05', ultimoDesbloqueioMs: 1 })
    const segundo = criarEstadoDasBoasVindasEmDisco(arquivo)
    expect(segundo.configuracao().ativa).toBe(true)
    expect(segundo.ler().ultimoDiaDesbloqueado).toBe('2026-10-05')
    expect(JSON.parse(readFileSync(arquivo, 'utf8')).estado.ultimoDesbloqueioMs).toBe(1)
  })

  it('falha fechado se o arquivo existe mas está corrompido', () => {
    const arquivo = caminho()
    writeFileSync(arquivo, '{quebrado')
    expect(criarEstadoDasBoasVindasEmDisco(arquivo).configuracao().ativa).toBe(false)
  })

  it('recusa configuração inválida vinda da ponte', () => {
    const arquivo = caminho()
    const estado = criarEstadoDasBoasVindasEmDisco(arquivo)
    expect(
      validarConfiguracaoDasBoasVindas({ ...CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS, janelaInicio: -1 })
    ).toBe(false)
    expect(() =>
      estado.salvarConfiguracao({ ...CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS, midiaAtiva: true })
    ).toThrow()
    expect(estado.configuracao().ativa).toBe(false)
  })
})
