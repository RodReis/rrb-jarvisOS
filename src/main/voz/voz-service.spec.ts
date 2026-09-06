import { describe, expect, it, vi } from 'vitest'
import { VozService } from './voz-service'
import type { SttEngine } from './stt-engine'

function engine(extra: Partial<SttEngine> = {}): SttEngine {
  return {
    transcribe: vi.fn(async () => ({ texto: 'olá', idioma: 'pt', segmentos: [] })),
    disponivel: vi.fn(async () => true),
    encerrar: vi.fn(async () => undefined),
    ...extra
  }
}

function servico(e = engine(), faltando: readonly string[] = []): VozService {
  return new VozService({
    engine: e,
    artefatosFaltando: () => faltando,
    computeAtual: () => (faltando.length ? 'cpu-int8' : 'cuda')
  })
}

describe('VozService — transcrição', () => {
  it('devolve o texto quando o engine responde', async () => {
    const d = await servico().transcrever(new Int16Array(16_000))

    expect(d.estado === 'ok' && d.resultado.texto).toBe('olá')
  })

  it('o PCM não fica guardado no serviço (critério 8)', async () => {
    // O serviço é vivo entre chamadas: se ele guardasse o último buffer "para debug", o áudio
    // sobreviveria à transcrição — que é exatamente o que o critério proíbe.
    const s = servico()
    await s.transcrever(new Int16Array([1, 2, 3]))

    expect(JSON.stringify(s)).not.toContain('1,2,3')
    expect(Object.values(s as unknown as Record<string, unknown>)).not.toContainEqual(
      expect.any(Int16Array)
    )
  })
})

describe('VozService — prontidão (critérios 4 e 7)', () => {
  it('pronta quando não falta artefato', async () => {
    const p = await servico().prontidao()

    expect(p.pronta).toBe(true)
    expect(p.faltando).toEqual([])
  })

  it('não pronta lista o que falta — a UI precisa saber o que baixar', async () => {
    const p = await servico(engine(), ['runtime-python', 'modelo-small']).prontidao()

    expect(p.pronta).toBe(false)
    expect(p.faltando).toEqual(['runtime-python', 'modelo-small'])
  })

  it('informa o modo de compute — a UI o indica (critério 7)', async () => {
    expect((await servico().prontidao()).compute).toBe('cuda')
    expect((await servico(engine(), ['x']).prontidao()).compute).toBe('cpu-int8')
  })
})
