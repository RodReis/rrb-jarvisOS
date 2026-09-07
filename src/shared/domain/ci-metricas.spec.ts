/**
 * Métricas com indisponibilidade explícita (SPEC-Pipeline-01 §8, critério 17).
 *
 * A regra é curta: *"campo indisponível é `unavailable`/ausente com razão, nunca zero inventado"*.
 * O que estes testes guardam é a distinção entre "durou zero" e "não sei quanto durou", que num
 * número simples é indistinguível — e que, somada, faz a pipeline parecer mais rápida do que é.
 */

import { describe, expect, it } from 'vitest'

import {
  duracaoEntre,
  formatarMedida,
  indisponivel,
  medida,
  medidaDisponivel,
  somar
} from './ci-metricas'

const INICIO = '2026-09-06T10:00:00.000Z'
const FIM = '2026-09-06T10:00:05.000Z'

describe('duracaoEntre — critério 17', () => {
  it('mede quando os dois instantes foram observados', () => {
    const m = duracaoEntre(INICIO, FIM)
    expect(medidaDisponivel(m)).toBe(true)
    if (medidaDisponivel(m)) expect(m.valorMs).toBe(5000)
  })

  it('fim não observado é indisponível, não "agora"', () => {
    // Assumir "agora" transformaria um run interrompido numa duração plausível e falsa — a forma
    // mais silenciosa de a métrica mentir.
    const m = duracaoEntre(INICIO, undefined)
    expect(medidaDisponivel(m)).toBe(false)
    if (!medidaDisponivel(m)) expect(m.razao).toBe('evento-nao-observado')
  })

  it('início não observado é indisponível', () => {
    expect(medidaDisponivel(duracaoEntre(undefined, FIM))).toBe(false)
  })

  it('nenhum dos dois observado é indisponível, e não se confunde com duração zero', () => {
    const ausente = duracaoEntre(undefined, undefined)
    const zeroReal = duracaoEntre(INICIO, INICIO)

    expect(medidaDisponivel(ausente)).toBe(false)
    expect(medidaDisponivel(zeroReal)).toBe(true)
    // O contraste que importa, afirmado sobre o **tipo** e não sobre a serialização: num número
    // simples estes dois casos seriam ambos `0` e indistinguíveis para quem consome.
    expect(ausente).not.toEqual(zeroReal)
    expect(formatarMedida(ausente)).not.toBe(formatarMedida(zeroReal))
  })

  it('ordem invertida é indisponível, não duração negativa', () => {
    const m = duracaoEntre(FIM, INICIO)
    expect(medidaDisponivel(m)).toBe(false)
    if (!medidaDisponivel(m)) expect(m.razao).toBe('leitura-falhou')
  })

  it('instante ilegível é leitura-falhou, não evento não observado', () => {
    // Razões diferentes pedem ações diferentes: uma é "o run parou antes", a outra é "o dado
    // veio quebrado". Fundi-las mandaria investigar o lugar errado.
    const m = duracaoEntre(INICIO, 'não é uma data')
    if (!medidaDisponivel(m)) expect(m.razao).toBe('leitura-falhou')
  })

  it('duração real de zero continua sendo uma medida disponível', () => {
    // O contrapeso: zero legítimo existe, e não pode ser confundido com ausência.
    const m = duracaoEntre(INICIO, INICIO)
    expect(medidaDisponivel(m)).toBe(true)
    if (medidaDisponivel(m)) expect(m.valorMs).toBe(0)
  })
})

describe('somar — ausência é contada, nunca somada como zero', () => {
  it('soma só as disponíveis e conta as ausentes', () => {
    const r = somar([medida(1000), indisponivel('nao-informado'), medida(500)])
    expect(r.totalMs).toBe(1500)
    expect(r.somadas).toBe(2)
    expect(r.ausentes).toBe(1)
  })

  it('a ausência não puxa o total para baixo tratando-a como zero', () => {
    // Com ausência somada como zero, os dois casos abaixo dariam o mesmo total e o consumidor
    // não teria como saber que um deles é um limite inferior.
    const comAusencia = somar([medida(1000), indisponivel('sem-permissao')])
    const soUma = somar([medida(1000)])
    expect(comAusencia.totalMs).toBe(soUma.totalMs)
    expect(comAusencia.ausentes).toBe(1)
    expect(soUma.ausentes).toBe(0)
  })

  it('tudo ausente devolve zero somadas, e o total não é apresentável como medida', () => {
    const r = somar([indisponivel('leitura-falhou'), indisponivel('nao-informado')])
    expect(r.somadas).toBe(0)
    expect(r.ausentes).toBe(2)
  })

  it('lista vazia não inventa medida', () => {
    expect(somar([])).toEqual({ totalMs: 0, somadas: 0, ausentes: 0 })
  })
})

describe('formatarMedida — o traço não é zero', () => {
  it('medida disponível aparece com o valor', () => {
    expect(formatarMedida(medida(1234))).toBe('1234ms')
  })

  it('ausência aparece como traço com a razão, nunca como 0ms', () => {
    const texto = formatarMedida(indisponivel('sem-permissao'))
    expect(texto).toContain('—')
    expect(texto).toContain('sem-permissao')
    expect(texto).not.toBe('0ms')
  })

  it('zero legítimo aparece como zero, não como traço', () => {
    expect(formatarMedida(medida(0))).toBe('0ms')
  })
})
