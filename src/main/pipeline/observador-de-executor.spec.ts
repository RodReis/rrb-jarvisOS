import { describe, expect, it } from 'vitest'
import type { RecursosGeridos } from './docker-runner'
import { observadorDeExecutor } from './verificadores-de-sandbox'

interface DockerFalso {
  geridos: RecursosGeridos | undefined | 'explode'
  legados: Set<string>
}

const docker = (f: DockerFalso) => ({
  listarGeridos: (): RecursosGeridos | undefined => {
    if (f.geridos === 'explode') throw new Error('docker caiu')
    return f.geridos
  },
  containerExiste: (nome: string): boolean => f.legados.has(nome)
})

const geridos = (...runIds: (string | undefined)[]): RecursosGeridos => ({
  containers: runIds.map((runId, i) => ({ nome: `c-${i}`, runId })),
  redes: []
})

const observar = (f: DockerFalso, runId: string) =>
  observadorDeExecutor(docker(f), () => '/repo')(runId)

describe('observadorDeExecutor — o que o Docker diz do executor de um run', () => {
  it('container gerido com a label do run: vivo', () => {
    expect(observar({ geridos: geridos('run-1'), legados: new Set() }, 'run-1')).toBe('vivo')
  })

  it('unidade de sandbox do Squad (<run>-<escritor>) também conta como o executor do run', () => {
    expect(observar({ geridos: geridos('run-1-w1-t1'), legados: new Set() }, 'run-1')).toBe('vivo')
  })

  it('prefixo é por segmento: run-10 não é executor de run-1', () => {
    expect(observar({ geridos: geridos('run-10'), legados: new Set() }, 'run-1')).toBe('morto')
  })

  it('nenhum container do run: morto', () => {
    expect(observar({ geridos: geridos(), legados: new Set() }, 'run-1')).toBe('morto')
  })

  it('container sem label de run não é de ninguém', () => {
    expect(observar({ geridos: geridos(undefined), legados: new Set() }, 'run-1')).toBe('morto')
  })

  it('run anterior ao inventário: o container nomeado pelo run ainda conta', () => {
    const f = { geridos: geridos(), legados: new Set(['jarvisos-run-run-1']) }
    expect(observar(f, 'run-1')).toBe('vivo')
  })

  it('Docker que não lista é desconhecido, nunca morto', () => {
    expect(observar({ geridos: undefined, legados: new Set() }, 'run-1')).toBe('desconhecido')
  })

  it('Docker que lança é desconhecido, nunca morto', () => {
    expect(observar({ geridos: 'explode', legados: new Set() }, 'run-1')).toBe('desconhecido')
  })
})
