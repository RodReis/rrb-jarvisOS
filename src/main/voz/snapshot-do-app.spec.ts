import { describe, expect, it, vi } from 'vitest'
import { montarSnapshot, textoDoSnapshot, type FontesDoSnapshot } from './snapshot-do-app'
import type { Project } from '@shared/domain/entities'
import type { PipelineRun, VistaDaFila } from '@shared/domain/pipeline'

/**
 * O contrato do `SnapshotDoApp` (SPEC-Voz-03, critério 6).
 *
 * **Teste de contrato, e não de integração**, porque é o que o MVP-019 vai consumir: o que
 * precisa ficar preso é a *forma* e o *significado* dos campos, não a mecânica de ler o banco.
 * As fontes entram injetadas — quem lê SQLite é o `index.ts`, e um teste que precisasse de banco
 * para afirmar "AWAITING_PI não conta como em andamento" estaria testando a coisa errada.
 */

function projeto(id: string, nome: string): Project {
  return {
    id,
    user_id: 'u-1',
    workspace_id: 'jarvis',
    nome,
    slug: nome.toLowerCase(),
    diretorio: `/projetos/${id}`,
    origem: 'criado',
    gitPreexistente: false,
    created_at: '2026-09-08T00:00:00.000Z'
  } as Project
}

function run(estado: PipelineRun['estado']): PipelineRun {
  return { estado } as PipelineRun
}

function vista(parcial: Partial<VistaDaFila> = {}): VistaDaFila {
  return { ativos: [], concluidas: [], bloqueadas: [], ...parcial }
}

function fontes(parcial: Partial<FontesDoSnapshot> = {}): FontesDoSnapshot {
  return {
    projetos: () => [],
    fila: () => undefined,
    ...parcial
  }
}

describe('SnapshotDoApp', () => {
  it('separa o que aguarda aceite do que está em andamento', () => {
    // A distinção é o ponto: `AWAITING_PI` é o gate de aceite, e contá-lo como trabalho corrente
    // diria que algo está sendo feito quando o que falta é uma **decisão** do PI.
    const snapshot = montarSnapshot(
      fontes({
        projetos: () => [projeto('p-1', 'JarvisOS')],
        fila: () =>
          vista({ ativos: [run('RUNNING'), run('AWAITING_PI'), run('AWAITING_PI'), run('READY')] })
      }),
      'jarvis'
    )

    expect(snapshot.projetos[0].emAndamento).toBe(2)
    expect(snapshot.projetos[0].aguardandoAceite).toBe(2)
    expect(snapshot.aguardandoAceite).toBe(2)
  })

  it('soma os aceites pendentes de todos os projetos', () => {
    const snapshot = montarSnapshot(
      fontes({
        projetos: () => [projeto('p-1', 'Um'), projeto('p-2', 'Dois')],
        fila: (id) =>
          id === 'p-1'
            ? vista({ ativos: [run('AWAITING_PI')] })
            : vista({ ativos: [run('AWAITING_PI'), run('AWAITING_PI')] })
      }),
      'jarvis'
    )

    expect(snapshot.aguardandoAceite).toBe(3)
  })

  it('sobrevive a projeto sem pipeline', () => {
    // Projeto recém-criado não tem fila. Isso não é erro nem ausência de dado: é um projeto com
    // zero de tudo, e omiti-lo esconderia do usuário um projeto que existe.
    const snapshot = montarSnapshot(
      fontes({ projetos: () => [projeto('p-1', 'Novo')], fila: () => undefined }),
      'jarvis'
    )

    expect(snapshot.projetos).toHaveLength(1)
    expect(snapshot.projetos[0]).toEqual({
      nome: 'Novo',
      emAndamento: 0,
      aguardandoAceite: 0,
      bloqueadas: 0
    })
  })

  it('carimba o instante — o snapshot descreve um momento que já passou', () => {
    const snapshot = montarSnapshot(fontes(), 'jarvis')

    expect(snapshot.em).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(snapshot.workspace).toBe('jarvis')
  })

  it('lê só o workspace pedido', () => {
    // Escopo é regra inviolável do projeto: o Command Center é do JARVIS OS, e vazar projetos da
    // NOA para a conversa dele seria misturar os dois espaços do usuário.
    const projetos = vi.fn(() => [])
    montarSnapshot(fontes({ projetos }), 'jarvis')

    expect(projetos).toHaveBeenCalledWith('jarvis')
    expect(projetos).toHaveBeenCalledTimes(1)
  })

  it('não toca em nada além das fontes injetadas', () => {
    // O critério 6 exige que a montagem não acesse o GitHub. Aqui isso é estrutural: o serviço
    // não tem como — ele só conhece as duas funções que recebeu.
    const chamadas: string[] = []
    montarSnapshot(
      fontes({
        projetos: () => {
          chamadas.push('projetos')
          return [projeto('p-1', 'Um')]
        },
        fila: () => {
          chamadas.push('fila')
          return vista()
        }
      }),
      'jarvis'
    )

    expect(chamadas).toEqual(['projetos', 'fila'])
  })
})

describe('o snapshot como texto falável', () => {
  it('diz explicitamente quando não há projeto', () => {
    // Omitir a seção faria o modelo preencher a lacuna com suposição. "Nenhum projeto" é uma
    // resposta, não uma falta de dado.
    const texto = textoDoSnapshot(montarSnapshot(fontes(), 'jarvis'))

    expect(texto).toContain('nenhum projeto')
  })

  it('traz os números em prosa curta, sem markdown', () => {
    // Isto vai ser **falado**. Tabela markdown lida em voz alta é ruído, e o bloco fixo da
    // persona proíbe markdown pelo mesmo motivo.
    const texto = textoDoSnapshot(
      montarSnapshot(
        fontes({
          projetos: () => [projeto('p-1', 'JarvisOS')],
          fila: () => vista({ ativos: [run('RUNNING'), run('AWAITING_PI')] })
        }),
        'jarvis'
      )
    )

    expect(texto).toContain('JarvisOS')
    expect(texto).toContain('1 em andamento')
    expect(texto).toContain('1 aguardando aceite')
    expect(texto).not.toMatch(/[|*#`]/)
  })

  it('omite o que é zero, para a fala não virar ladainha', () => {
    // "0 bloqueadas, 0 aguardando aceite" em cada projeto tornaria a resposta longa e igual.
    // O que é zero não precisa ser dito; o que existe, sim.
    const texto = textoDoSnapshot(
      montarSnapshot(
        fontes({
          projetos: () => [projeto('p-1', 'Limpo')],
          fila: () => vista({ ativos: [run('RUNNING')] })
        }),
        'jarvis'
      )
    )

    expect(texto).toContain('1 em andamento')
    expect(texto).not.toContain('bloqueadas')
    expect(texto).not.toContain('0 aguardando')
  })
})
