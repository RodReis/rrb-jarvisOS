import { describe, expect, it } from 'vitest'
import {
  CONFIGURACAO_PADRAO,
  escreverConfiguracao,
  lerConfiguracao,
  MODELOS_DA_VOZ
} from './configuracao'

describe('configuração da voz — o default da spec', () => {
  it('é small em pt-BR', () => {
    expect(CONFIGURACAO_PADRAO).toEqual({ modelo: 'small', idioma: 'pt' })
  })

  it('primeira execução, sem arquivo, cai no default', () => {
    expect(lerConfiguracao(undefined)).toEqual(CONFIGURACAO_PADRAO)
  })
})

describe('configuração da voz — arquivo ruim não impede transcrever', () => {
  it('JSON corrompido cai no default em vez de estourar', () => {
    // Recusar transcrever por causa de um arquivo de configuração ilegível puniria o usuário
    // por um estado que ele não criou e não sabe consertar.
    expect(lerConfiguracao('{ isto não é json')).toEqual(CONFIGURACAO_PADRAO)
  })

  it('JSON que não é objeto cai no default', () => {
    expect(lerConfiguracao('42')).toEqual(CONFIGURACAO_PADRAO)
    expect(lerConfiguracao('null')).toEqual(CONFIGURACAO_PADRAO)
    expect(lerConfiguracao('"texto"')).toEqual(CONFIGURACAO_PADRAO)
  })

  it('modelo fora do catálogo cai no default', () => {
    // O catálogo é fechado: um nome que o faster-whisper não conhece faria o sidecar falhar no
    // carregamento, e o erro chegaria à tela sem nada acionável.
    expect(lerConfiguracao('{"modelo":"gigante"}').modelo).toBe('small')
  })
})

describe('configuração da voz — campo a campo, não tudo ou nada', () => {
  it('idioma inválido não descarta um modelo válido ao lado', () => {
    const c = lerConfiguracao('{"modelo":"medium","idioma":""}')

    expect(c.modelo).toBe('medium')
    expect(c.idioma).toBe('pt')
  })

  it('modelo inválido não descarta um idioma válido ao lado', () => {
    const c = lerConfiguracao('{"modelo":"enorme","idioma":"en"}')

    expect(c.modelo).toBe('small')
    expect(c.idioma).toBe('en')
  })

  it('aceita os quatro modelos do catálogo', () => {
    for (const modelo of MODELOS_DA_VOZ) {
      expect(lerConfiguracao(JSON.stringify({ modelo })).modelo).toBe(modelo)
    }
  })
})

describe('configuração da voz — o disco nunca recebe lixo', () => {
  it('normaliza na escrita, não só na leitura', () => {
    const texto = escreverConfiguracao({ modelo: 'inexistente' as never, idioma: '  ' })

    expect(JSON.parse(texto)).toEqual(CONFIGURACAO_PADRAO)
  })

  it('o que foi escrito volta igual na leitura', () => {
    const texto = escreverConfiguracao({ modelo: 'base', idioma: 'en' })

    expect(lerConfiguracao(texto)).toEqual({ modelo: 'base', idioma: 'en' })
  })
})
