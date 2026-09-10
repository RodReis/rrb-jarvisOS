import { describe, expect, it } from 'vitest'
import { MODULOS_RENDERIZAVEIS } from './modulos-renderizaveis'

describe('registro renderizável dos módulos (SPEC-Voz-05, critério 11)', () => {
  it('todo item visível registra a própria tela', () => {
    expect(MODULOS_RENDERIZAVEIS.every((modulo) => modulo.renderizar !== undefined)).toBe(true)
  })
})
