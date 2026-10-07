import { describe, expect, it, vi } from 'vitest'
import { consolidarProducao } from './squad-producao'

const sha = (letra: string) => letra.repeat(40)
const concluido = (escritor: string, commitSha: string) => ({
  tarefaId: `dev-${escritor}`,
  papel: 'desenvolvedor',
  estado: 'concluida',
  execucao: { estado: 'concluida', escritor, commitSha }
})

describe('consolidação de commits do Squad', () => {
  it('um escritor entrega seu commit sem chamar o integrador', async () => {
    const integrar = vi.fn()
    const producao = await consolidarProducao(
      { estado: 'concluido', tarefas: [concluido('a', sha('a'))] } as never,
      1,
      integrar
    )
    expect(producao).toEqual({ estado: 'pronto', commitSha: sha('a'), manifesto: '' })
    expect(integrar).not.toHaveBeenCalled()
  })

  it('dois escritores só entregam o commit e o manifesto conferidos pelo integrador', async () => {
    const integrar = vi.fn(async () => ({
      estado: 'integrado' as const,
      commitSha: sha('c'),
      manifestoTexto: '2/2 hunks conferidos'
    }))
    const producao = await consolidarProducao(
      { estado: 'concluido', tarefas: [concluido('a', sha('a')), concluido('b', sha('b'))] } as never,
      2,
      integrar as never
    )
    expect(integrar).toHaveBeenCalledWith([
      { escritor: 'a', commitSha: sha('a') },
      { escritor: 'b', commitSha: sha('b') }
    ])
    expect(producao).toEqual({
      estado: 'pronto',
      commitSha: sha('c'),
      manifesto: '2/2 hunks conferidos'
    })
  })

  it('não publica resultado parcial nem dois commits sem integração aprovada', async () => {
    const integrar = vi.fn(async () => ({ estado: 'parado' as const, motivo: 'hunk-perdido-sem-registro' as const }))
    const tarefas = [concluido('a', sha('a')), concluido('b', sha('b'))]
    expect(await consolidarProducao({ estado: 'parcial', tarefas } as never, 2, integrar as never))
      .toMatchObject({ estado: 'parado' })
    expect(integrar).not.toHaveBeenCalled()
    expect(await consolidarProducao({ estado: 'concluido', tarefas } as never, 2, integrar as never))
      .toEqual({ estado: 'parado', motivo: 'integracao-hunk-perdido-sem-registro' })
  })
})
