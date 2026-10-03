import { describe, expect, it, vi } from 'vitest'
import { criarAoDispararDaEscuta } from './disparo-da-escuta'

function montar() {
  const ordem: string[] = []
  const avisos: unknown[] = []
  const aoDisparar = criarAoDispararDaEscuta({
    revelarJanela: () => void ordem.push('janela'),
    avisarTela: (d) => {
      ordem.push('aviso')
      avisos.push(d)
    }
  })
  return { aoDisparar, ordem, avisos }
}

describe('o disparo da escuta (SPEC-Escuta-01, critérios 6 e 7)', () => {
  it('com a sessão desbloqueada a janela sobe e a tela é avisada, nessa ordem', () => {
    const m = montar()

    m.aoDisparar({ gatilho: 'frase', confianca: 0.9, sessaoBloqueada: false })

    // A janela sobe antes do aviso: a tela que recebe o disparo já está à frente.
    expect(m.ordem).toEqual(['janela', 'aviso'])
  })

  it('com a sessão bloqueada a janela NÃO sobe, mas a tela é avisada para responder por voz', () => {
    const m = montar()

    m.aoDisparar({ gatilho: 'palmas', sessaoBloqueada: true })

    // A lock screen é outra sessão: subir a janela expõe a conversa a quem passa.
    expect(m.ordem).toEqual(['aviso'])
    expect(m.avisos).toEqual([{ gatilho: 'palmas', sessaoBloqueada: true }])
  })

  it('a confiança do detector não atravessa para a tela', () => {
    const m = montar()

    m.aoDisparar({ gatilho: 'frase', confianca: 0.93, sessaoBloqueada: false })

    expect(m.avisos).toEqual([{ gatilho: 'frase', sessaoBloqueada: false }])
  })

  it('janela que não pôde subir não impede o aviso à tela', () => {
    const avisarTela = vi.fn()
    const aoDisparar = criarAoDispararDaEscuta({
      revelarJanela: () => {
        throw new Error('janela destruída')
      },
      avisarTela
    })

    aoDisparar({ gatilho: 'frase', sessaoBloqueada: false })

    expect(avisarTela).toHaveBeenCalledTimes(1)
  })
})
