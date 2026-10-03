import { describe, expect, it } from 'vitest'
import type { AchadoRegistrado } from './squad-achado'
import { correcoesParaOEscritor, decidirRetrabalho } from './squad-retrabalho'

const achado = (extra: Partial<AchadoRegistrado>): AchadoRegistrado => ({
  categoria: 'corretude',
  severidade: 'P1',
  titulo: 't',
  arquivo: 'src/a.ts',
  trecho: 'x',
  impacto: 'i',
  correcao: 'c',
  foraDaSpec: false,
  assinatura: 's',
  estado: 'accepted',
  vistoPor: ['rev-1'],
  contestadoPor: [],
  deltaDaPrimeiraVista: 'd1',
  deltaDaUltimaVista: 'd1',
  ...extra
})

describe('decidirRetrabalho', () => {
  it.each([1, 2])('na tentativa %i ainda cabe voltar ao DEVELOPER', (tentativa) => {
    expect(decidirRetrabalho(tentativa, { origem: 'teste' })).toEqual({
      tipo: 'voltar',
      proximaTentativa: tentativa + 1
    })
  })

  it('na terceira tentativa não há quarta: esgotou, para com motivo para o PI', () => {
    expect(decidirRetrabalho(3, { origem: 'revisao' })).toEqual({
      tipo: 'parar',
      motivo: 'tentativas-esgotadas'
    })
  })

  it('suíte que falhou por causa externa não gasta tentativa do escritor', () => {
    expect(decidirRetrabalho(1, { origem: 'teste', classificacao: 'externo' })).toEqual({
      tipo: 'parar',
      motivo: 'falha-externa'
    })
  })

  it('tentativa inválida para: nunca presume permissão', () => {
    expect(decidirRetrabalho(0, { origem: 'teste' })).toEqual({
      tipo: 'parar',
      motivo: 'tentativa-invalida'
    })
    expect(decidirRetrabalho(1.5, { origem: 'teste' })).toEqual({
      tipo: 'parar',
      motivo: 'tentativa-invalida'
    })
  })
})

describe('correcoesParaOEscritor', () => {
  it('entrega só os aceitos, do mais grave ao menos grave, sem repetir assinatura', () => {
    const lista = correcoesParaOEscritor([
      achado({ assinatura: 'a', severidade: 'P1' }),
      achado({ assinatura: 'b', severidade: 'P0' }),
      achado({ assinatura: 'c', estado: 'open' }),
      achado({ assinatura: 'd', estado: 'fixed' }),
      achado({ assinatura: 'a', severidade: 'P1' })
    ])

    expect(lista.map((a) => a.assinatura)).toEqual(['b', 'a'])
  })

  it('o escritor recebe o que corrigir, não quem achou nem o debate', () => {
    const [primeiro] = correcoesParaOEscritor([achado({ contestadoPor: ['rev-2'] })])

    expect(primeiro).toEqual({
      assinatura: 's',
      severidade: 'P1',
      categoria: 'corretude',
      arquivo: 'src/a.ts',
      trecho: 'x',
      impacto: 'i',
      correcao: 'c'
    })
  })
})
