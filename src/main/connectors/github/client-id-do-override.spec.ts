import { describe, expect, it, vi } from 'vitest'
import { gravarClientIdDoOverride, limparOverrideInvalido } from './client-id-do-override'

/**
 * A fronteira de confiança do override do `client_id` (SPEC-Conectores-03, regra 7): o renderer
 * valida, mas o `main` não confia — a coluna é texto puro porque o client ID não é segredo.
 */

const perfil = () => ({ saveGithubClientId: vi.fn() })

describe('gravarClientIdDoOverride', () => {
  it('grava um client ID válido, sem espaços em volta', () => {
    const p = perfil()

    gravarClientIdDoOverride(p, 'u-1', '  Iv1.0123456789abcdef\n')

    expect(p.saveGithubClientId).toHaveBeenCalledWith('u-1', 'Iv1.0123456789abcdef')
  })

  it('texto vazio limpa o override (volta ao client ID de fábrica)', () => {
    const p = perfil()

    gravarClientIdDoOverride(p, 'u-1', '   ')

    expect(p.saveGithubClientId).toHaveBeenCalledWith('u-1', undefined)
  })

  it.each([undefined, null, 42, {}, ['Iv1.0123456789abcdef']])(
    'o que não é texto (%j) vira limpar, nunca "[object Object]" gravado',
    (bruto) => {
      const p = perfil()

      gravarClientIdDoOverride(p, 'u-1', bruto)

      expect(p.saveGithubClientId).toHaveBeenCalledWith('u-1', undefined)
    }
  )

  it('recusa um token colado: nada é gravado e a mensagem não ecoa o valor', () => {
    const p = perfil()
    const token = `github_pat_${'x'.repeat(80)}`

    let mensagem = ''
    try {
      gravarClientIdDoOverride(p, 'u-1', token)
    } catch (erro) {
      mensagem = erro instanceof Error ? erro.message : ''
    }

    expect(p.saveGithubClientId).not.toHaveBeenCalled()
    expect(mensagem).toMatch(/token ou segredo/)
    expect(mensagem).not.toContain('github_pat_')
    expect(mensagem).not.toContain('xxxx')
  })

  it('recusa um client secret (40 caracteres) e um valor de forma errada, sem gravar', () => {
    const p = perfil()

    expect(() => gravarClientIdDoOverride(p, 'u-1', 'a'.repeat(40))).toThrow(/forma esperada/)
    expect(() => gravarClientIdDoOverride(p, 'u-1', 'curto')).toThrow(/forma esperada/)
    expect(p.saveGithubClientId).not.toHaveBeenCalled()
  })
})

describe('limparOverrideInvalido (o valor de antes da validação sai do disco)', () => {
  const perfilCom = (salvo: string | undefined) => ({
    findGithubClientId: vi.fn(() => salvo),
    saveGithubClientId: vi.fn()
  })

  it('apaga um override com forma de token e devolve true', () => {
    const p = perfilCom(`github_pat_${'x'.repeat(80)}`)

    expect(limparOverrideInvalido(p, 'u-1')).toBe(true)
    expect(p.saveGithubClientId).toHaveBeenCalledWith('u-1', undefined)
  })

  it('apaga um valor com forma errada (o de 93 caracteres que apareceu no campo)', () => {
    const p = perfilCom(`github${'x'.repeat(87)}`)

    expect(limparOverrideInvalido(p, 'u-1')).toBe(true)
    expect(p.saveGithubClientId).toHaveBeenCalledWith('u-1', undefined)
  })

  it('um client ID válido nunca é tocado', () => {
    const p = perfilCom('Iv1.0123456789abcdef')

    expect(limparOverrideInvalido(p, 'u-1')).toBe(false)
    expect(p.saveGithubClientId).not.toHaveBeenCalled()
  })

  it('sem override salvo, não há o que apagar', () => {
    const p = perfilCom(undefined)

    expect(limparOverrideInvalido(p, 'u-1')).toBe(false)
    expect(p.saveGithubClientId).not.toHaveBeenCalled()
  })
})
