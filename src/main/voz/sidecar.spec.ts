import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Sidecar, type SpawnDoSidecar } from './sidecar'

/**
 * Um processo filho de mentira, com o mínimo que o `Sidecar` toca.
 *
 * `EventEmitter` de verdade e não objeto com `on: vi.fn()`: o que se mede aqui é a reação a
 * eventos que chegam **fora de ordem** — resposta depois do timeout, morte no meio da chamada —,
 * e um mock de `on` não os entrega.
 */
function processoFalso(): {
  proc: EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: () => void }
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
    killed: boolean
  }
  responder: (linha: string) => void
  morrer: () => void
} {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = Object.assign(new EventEmitter(), {
    stdin: { write: vi.fn(), end: (): void => undefined },
    stdout,
    stderr,
    kill: vi.fn(),
    killed: false
  })

  return {
    proc,
    responder: (linha) => stdout.emit('data', Buffer.from(linha + '\n')),
    morrer: () => proc.emit('exit', 1, null)
  }
}

function sidecarDeTeste(): {
  sidecar: Sidecar
  falso: ReturnType<typeof processoFalso>
  spawns: number
} {
  const estado = { falso: processoFalso(), spawns: 0 }
  const spawn: SpawnDoSidecar = () => {
    estado.spawns += 1
    estado.falso = processoFalso()
    return estado.falso.proc as never
  }

  const sidecar = new Sidecar({ spawn, comando: 'python-falso', args: [], timeoutMs: 50 })
  return {
    sidecar,
    get falso() {
      return estado.falso
    },
    get spawns() {
      return estado.spawns
    }
  } as never
}

describe('Sidecar — inicia sob demanda (critério 2)', () => {
  it('não sobe processo nenhum antes da primeira chamada', () => {
    const t = sidecarDeTeste()

    expect(t.spawns).toBe(0)
  })

  it('sobe na primeira chamada e reusa na segunda', async () => {
    const t = sidecarDeTeste()

    const p1 = t.sidecar.pedir({ op: 'ping' })
    t.falso.responder(JSON.stringify({ id: 1, ok: true }))
    await p1

    const p2 = t.sidecar.pedir({ op: 'ping' })
    t.falso.responder(JSON.stringify({ id: 2, ok: true }))
    await p2

    // Um spawn para as duas chamadas: subir o runtime a cada transcrição custaria segundos
    // por enunciado, que é o oposto do que a fatia entrega.
    expect(t.spawns).toBe(1)
  })
})

describe('Sidecar — protocolo por linha', () => {
  it('devolve a resposta correlacionada pelo id, não a primeira que chegar', async () => {
    const t = sidecarDeTeste()

    const a = t.sidecar.pedir({ op: 'a' })
    const b = t.sidecar.pedir({ op: 'b' })

    // Fora de ordem de propósito: sem correlação por id, `a` receberia a resposta de `b`.
    t.falso.responder(JSON.stringify({ id: 2, ok: true, texto: 'de b' }))
    t.falso.responder(JSON.stringify({ id: 1, ok: true, texto: 'de a' }))

    expect((await a).texto).toBe('de a')
    expect((await b).texto).toBe('de b')
  })

  it('linha que não é JSON não derruba a chamada em curso', async () => {
    const t = sidecarDeTeste()
    const p = t.sidecar.pedir({ op: 'ping' })

    // O runtime pode escrever aviso no stdout. Tratar isso como resposta mataria a chamada.
    t.falso.responder('warning: cuda indisponivel, caindo para cpu')
    t.falso.responder(JSON.stringify({ id: 1, ok: true, texto: 'chegou' }))

    expect((await p).texto).toBe('chegou')
  })

  it('resposta de erro do sidecar vira rejeição com o motivo dele', async () => {
    const t = sidecarDeTeste()
    const p = t.sidecar.pedir({ op: 'ping' })

    t.falso.responder(JSON.stringify({ id: 1, ok: false, erro: 'modelo nao carregado' }))

    await expect(p).rejects.toThrow(/modelo nao carregado/)
  })
})

describe('Sidecar — morte no meio (critério 2)', () => {
  it('a chamada em curso rejeita em vez de pendurar para sempre', async () => {
    const t = sidecarDeTeste()
    const p = t.sidecar.pedir({ op: 'transcrever' })

    t.falso.morrer()

    // Sem isto a promessa nunca resolveria: a UI ficaria em "transcrevendo" indefinidamente,
    // que é pior que erro — não há próxima ação possível.
    await expect(p).rejects.toThrow()
  })

  it('a tentativa seguinte funciona — sobe um processo novo', async () => {
    const t = sidecarDeTeste()
    const p1 = t.sidecar.pedir({ op: 'transcrever' })
    t.falso.morrer()
    await expect(p1).rejects.toThrow()

    // `t.falso` agora aponta para o processo **novo**: o spawn do restart o substituiu. O id
    // recomeça? Não — o contador é do `Sidecar`, não do processo, então a segunda chamada é
    // `id: 2` mesmo tendo subido um processo novo. Responder com `id: 1` deixaria a promessa
    // pendurada até o timeout, que foi como este teste falhou na primeira execução.
    const p2 = t.sidecar.pedir({ op: 'transcrever' })
    t.falso.responder(JSON.stringify({ id: 2, ok: true, texto: 'depois do restart' }))

    expect((await p2).texto).toBe('depois do restart')
    expect(t.spawns).toBe(2)
  })

  it('silêncio além do timeout rejeita, e não fica esperando', async () => {
    const t = sidecarDeTeste()

    // O sidecar pode travar sem morrer — o timeout é o que separa "demorando" de "travado".
    await expect(t.sidecar.pedir({ op: 'transcrever' })).rejects.toThrow(/tempo/i)
  })
})

describe('Sidecar — morre com o app (critério 2)', () => {
  it('encerrar mata o processo', async () => {
    const t = sidecarDeTeste()
    const p = t.sidecar.pedir({ op: 'ping' })
    t.falso.responder(JSON.stringify({ id: 1, ok: true }))
    await p
    const proc = t.falso.proc

    await t.sidecar.encerrar()

    expect(proc.kill).toHaveBeenCalled()
  })

  it('encerrar sem nunca ter subido não estoura', async () => {
    const t = sidecarDeTeste()

    await expect(t.sidecar.encerrar()).resolves.toBeUndefined()
  })
})
