import { describe, expect, it, vi } from 'vitest'
import { HotkeyDaVoz, type AtalhoGlobal } from './hotkey-da-voz'

/**
 * Um `globalShortcut` de mentira que guarda o callback registrado.
 *
 * Guardar o callback é o ponto: o que se mede aqui é o que acontece **ao acionar** o atalho, e
 * um mock que só conta chamadas de `register` nunca chegaria lá.
 */
function atalhoFalso(aceitar = true): {
  atalho: AtalhoGlobal
  acionar: () => void
  registrados: string[]
  liberados: string[]
} {
  const registrados: string[] = []
  const liberados: string[] = []
  let callback: (() => void) | undefined

  return {
    atalho: {
      register: (acelerador, aoAcionar) => {
        if (!aceitar) return false
        registrados.push(acelerador)
        callback = aoAcionar
        return true
      },
      unregister: (acelerador) => {
        liberados.push(acelerador)
        callback = undefined
      }
    },
    acionar: () => callback?.(),
    registrados,
    liberados
  }
}

describe('hotkey da voz — toggle (critério 5)', () => {
  it('abre a gravação no primeiro toque e encerra no segundo', () => {
    const falso = atalhoFalso()
    const alternancias: boolean[] = []

    const hotkey = new HotkeyDaVoz({
      atalho: falso.atalho,
      aoAlternar: (g) => alternancias.push(g)
    })
    hotkey.registrar('Control+Shift+Space', 60_000)

    falso.acionar()
    falso.acionar()

    expect(alternancias).toEqual([true, false])
    expect(hotkey.estaGravando).toBe(false)
  })

  it('devolve false quando outro app já tem o atalho, sem estourar', () => {
    // Atalho ocupado é situação comum e tratável: a tela oferece outra combinação. Lançar aqui
    // derrubaria o boot do app por causa de um conflito de teclado.
    const falso = atalhoFalso(false)
    const hotkey = new HotkeyDaVoz({ atalho: falso.atalho, aoAlternar: () => undefined })

    expect(hotkey.registrar('Control+Shift+Space', 60_000)).toBe(false)
  })
})

describe('hotkey da voz — o teto de gravação (critério 5)', () => {
  it('encerra sozinha quando o segundo toque nunca vem', () => {
    vi.useFakeTimers()
    try {
      const falso = atalhoFalso()
      const alternancias: boolean[] = []

      const hotkey = new HotkeyDaVoz({
        atalho: falso.atalho,
        aoAlternar: (g) => alternancias.push(g)
      })
      hotkey.registrar('Control+Shift+Space', 60_000)

      falso.acionar()
      vi.advanceTimersByTime(60_000)

      expect(alternancias).toEqual([true, false])
      expect(hotkey.estaGravando).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('não reabre o microfone sozinha depois de encerrada pelo usuário', () => {
    /*
     * O teto é armado só na abertura. Armá-lo também no fechamento agendaria uma reabertura
     * espontânea — microfone que acende sem ninguém pedir, que é pior que um bug.
     */
    vi.useFakeTimers()
    try {
      const falso = atalhoFalso()
      const alternancias: boolean[] = []

      const hotkey = new HotkeyDaVoz({
        atalho: falso.atalho,
        aoAlternar: (g) => alternancias.push(g)
      })
      hotkey.registrar('Control+Shift+Space', 60_000)

      falso.acionar()
      falso.acionar()
      vi.advanceTimersByTime(600_000)

      expect(alternancias).toEqual([true, false])
    } finally {
      vi.useRealTimers()
    }
  })

  it('o toque do usuário cancela o teto — ele não dispara depois', () => {
    vi.useFakeTimers()
    try {
      const falso = atalhoFalso()
      const alternancias: boolean[] = []

      const hotkey = new HotkeyDaVoz({
        atalho: falso.atalho,
        aoAlternar: (g) => alternancias.push(g)
      })
      hotkey.registrar('Control+Shift+Space', 60_000)

      falso.acionar()
      vi.advanceTimersByTime(30_000)
      falso.acionar()
      vi.advanceTimersByTime(60_000)

      expect(alternancias).toEqual([true, false])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('hotkey da voz — troca em Settings vale sem restart (critério 6)', () => {
  it('libera o acelerador antigo antes de registrar o novo', () => {
    // Sem liberar, os dois ficariam ativos e o antigo continuaria abrindo o microfone — a
    // troca em Settings pareceria não ter pegado.
    const falso = atalhoFalso()
    const hotkey = new HotkeyDaVoz({ atalho: falso.atalho, aoAlternar: () => undefined })

    hotkey.registrar('Control+Shift+Space', 60_000)
    hotkey.registrar('Control+Shift+J', 60_000)

    expect(falso.liberados).toEqual(['Control+Shift+Space'])
    expect(falso.registrados).toEqual(['Control+Shift+Space', 'Control+Shift+J'])
  })

  it('encerra gravação aberta ao liberar — o microfone não sobrevive ao atalho', () => {
    const falso = atalhoFalso()
    const alternancias: boolean[] = []

    const hotkey = new HotkeyDaVoz({
      atalho: falso.atalho,
      aoAlternar: (g) => alternancias.push(g)
    })
    hotkey.registrar('Control+Shift+Space', 60_000)

    falso.acionar()
    hotkey.liberar()

    expect(alternancias).toEqual([true, false])
    expect(hotkey.estaGravando).toBe(false)
  })

  it('liberar duas vezes não estoura', () => {
    const falso = atalhoFalso()
    const hotkey = new HotkeyDaVoz({ atalho: falso.atalho, aoAlternar: () => undefined })

    hotkey.registrar('Control+Shift+Space', 60_000)
    hotkey.liberar()

    expect(() => hotkey.liberar()).not.toThrow()
    expect(falso.liberados).toEqual(['Control+Shift+Space'])
  })
})

describe('hotkey da voz — o registro é auditado', () => {
  it('audita a combinação e se ela foi aceita', () => {
    const falso = atalhoFalso()
    const eventos: { acelerador: string; registrado: boolean }[] = []

    const hotkey = new HotkeyDaVoz({
      atalho: falso.atalho,
      aoAlternar: () => undefined,
      auditar: (e) => eventos.push(e)
    })
    hotkey.registrar('Control+Shift+J', 60_000)

    expect(eventos).toEqual([{ acelerador: 'Control+Shift+J', registrado: true }])
  })

  it('audita também a recusa — silêncio esconderia o atalho que nunca funcionou', () => {
    const falso = atalhoFalso(false)
    const eventos: { acelerador: string; registrado: boolean }[] = []

    const hotkey = new HotkeyDaVoz({
      atalho: falso.atalho,
      aoAlternar: () => undefined,
      auditar: (e) => eventos.push(e)
    })
    hotkey.registrar('Control+Shift+J', 60_000)

    expect(eventos).toEqual([{ acelerador: 'Control+Shift+J', registrado: false }])
  })
})
