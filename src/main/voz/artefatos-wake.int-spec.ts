import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARTEFATOS_DA_VOZ } from './artefatos'

describe('artefato distribuído do detector local', () => {
  it('aponta para a revisão imutável e para o SHA do ONNX publicado', () => {
    const artefato = ARTEFATOS_DA_VOZ.find((item) => item.id === 'modelo-wake/ei_amigo.onnx')
    expect(artefato).toBeDefined()
    expect(artefato?.url).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/RodReis\/rrb-jarvisOS\/[a-f0-9]{40}\/docs\/spec\/models\/ei_amigo\.onnx$/
    )
    const modelo = readFileSync(resolve('docs/spec/models/ei_amigo.onnx'))
    expect(createHash('sha256').update(modelo).digest('hex')).toBe(artefato?.sha256)
  })
})
