import { describe, expect, it } from 'vitest'
import type { ModeloEscolhido } from './modelo-da-fase'
import type { AmbienteDeResolucao } from './squad-resolucao'
import type { PerfilDeSquad } from './squad-perfil'
import { PERFIL_PADRAO } from './squad-perfil'
import { REGISTRO_DE_CAPACIDADES } from './squad-capacidades'
import { custoDoPlanoUsd, custoMaximoUsd, resolverPerfil } from './squad-resolucao'

const FASE: ModeloEscolhido = { provider: 'claude-code', modelo: 'claude-fable-5-1' }

/** Tudo instalado e o Ollama de pé — cada teste tira uma coisa. */
const AMBIENTE_COMPLETO: AmbienteDeResolucao = {
  skills: [
    'investigate',
    'plan-eng-review',
    'superpowers:test-driven-development',
    'code-review',
    'design-review'
  ],
  ferramentas: ['context7'],
  ollama: { disponivel: true, modelos: ['qwen3:8b', 'hermes3:8b'] },
  optInApiPaga: false
}

/** Análise sem prompt de reserva: só o modelo local a substitui — e ele pode estar fora do ar. */
const ANALISE_SO_COM_MODELO_LOCAL = {
  ...REGISTRO_DE_CAPACIDADES.analise,
  fallbacks: [{ tipo: 'modelo-local' as const }]
}

const sem = (nome: string): AmbienteDeResolucao => ({
  ...AMBIENTE_COMPLETO,
  skills: AMBIENTE_COMPLETO.skills.filter((s) => s !== nome)
})

function porCapacidade(
  r: ReturnType<typeof resolverPerfil>,
  id: string,
  camada: string
): { estado: string; via?: string; motivo?: string } {
  const cap = r.capacidades.find((c) => c.capacidade === id)
  const achada = cap?.porCamada.find((c) => c.camada === camada)
  if (achada === undefined) throw new Error(`sem resolução para ${id}/${camada}`)
  return achada
}

function comLocal(extra: Partial<PerfilDeSquad> = {}): PerfilDeSquad {
  return {
    ...PERFIL_PADRAO,
    camadas: {
      ...PERFIL_PADRAO.camadas,
      orquestrador: { origem: 'modelo', provider: 'ollama', modelo: 'qwen3:8b', validador: 'e1' }
    },
    ...extra
  }
}

describe('resolução de capacidades — critério 2 e testes da SPEC', () => {
  it('skill presente: resolve pela implementação, sem fallback', () => {
    const r = resolverPerfil(PERFIL_PADRAO, AMBIENTE_COMPLETO, FASE)
    expect(porCapacidade(r, 'revisao-de-codigo', 'especialista')).toMatchObject({
      estado: 'implementacao',
      via: 'skill:code-review'
    })
    expect(porCapacidade(r, 'pesquisa-documental', 'executor')).toMatchObject({
      estado: 'implementacao',
      via: 'ferramenta:context7'
    })
    expect(r.elegivel).toBe(true)
  })

  it('skill ausente com fallback: mantém a disciplina pelo prompt e diz por quê', () => {
    const r = resolverPerfil(PERFIL_PADRAO, sem('code-review'), FASE)
    expect(porCapacidade(r, 'revisao-de-codigo', 'especialista')).toMatchObject({
      estado: 'fallback',
      via: 'prompt:revisao-de-codigo-disciplinada@1',
      motivo: 'IMPLEMENTACAO_AUSENTE'
    })
    expect(r.elegivel).toBe(true)
  })

  it('obrigatória sem implementação nem fallback: o plano fica inelegível (regra 2)', () => {
    const exigeAnalise: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      capacidades: PERFIL_PADRAO.capacidades.map((c) =>
        c.id === 'analise' ? { ...c, obrigatoria: true } : c
      )
    }
    const r = resolverPerfil(
      exigeAnalise,
      { ...sem('investigate'), ollama: { disponivel: false, modelos: [] } },
      FASE,
      { ...REGISTRO_DE_CAPACIDADES, analise: ANALISE_SO_COM_MODELO_LOCAL }
    )
    expect(porCapacidade(r, 'analise', 'especialista')).toMatchObject({
      estado: 'indisponivel',
      motivo: 'SEM_IMPLEMENTACAO_NEM_FALLBACK'
    })
    expect(r.elegivel).toBe(false)
    expect(r.motivosDeInelegibilidade.join(' ')).toContain('analise')
  })

  it('capacidade opcional indisponível não derruba a elegibilidade', () => {
    const r = resolverPerfil(
      PERFIL_PADRAO,
      { ...sem('investigate'), ollama: { disponivel: false, modelos: [] } },
      FASE,
      { ...REGISTRO_DE_CAPACIDADES, analise: ANALISE_SO_COM_MODELO_LOCAL }
    )
    expect(porCapacidade(r, 'analise', 'especialista').estado).toBe('indisponivel')
    expect(r.elegivel).toBe(true)
  })

  it('o prompt vem antes do modelo local na ordem do registro', () => {
    const r = resolverPerfil(PERFIL_PADRAO, sem('superpowers:test-driven-development'), FASE)
    expect(porCapacidade(r, 'testes', 'executor').via).toBe('prompt:tdd-disciplinado@1')
  })

  it('modelo local é o fallback quando é a única reserva e o Ollama está de pé', () => {
    const r = resolverPerfil(PERFIL_PADRAO, sem('investigate'), FASE, {
      ...REGISTRO_DE_CAPACIDADES,
      analise: ANALISE_SO_COM_MODELO_LOCAL
    })
    expect(porCapacidade(r, 'analise', 'especialista')).toMatchObject({
      estado: 'fallback',
      via: 'modelo-local:ollama',
      motivo: 'IMPLEMENTACAO_AUSENTE'
    })
  })

  it('devolve uma resolução por capacidade e por camada permitida', () => {
    const r = resolverPerfil(PERFIL_PADRAO, AMBIENTE_COMPLETO, FASE)
    for (const cap of PERFIL_PADRAO.capacidades) {
      const resolvida = r.capacidades.find((c) => c.capacidade === cap.id)
      expect(resolvida?.porCamada.map((c) => c.camada)).toEqual(cap.camadas)
    }
  })
})

describe('resolução de camadas — Ollama fora do ar → modelo da fase', () => {
  it('perfil padrão: toda camada sai pelo modelo da fase', () => {
    const r = resolverPerfil(PERFIL_PADRAO, AMBIENTE_COMPLETO, FASE)
    for (const camada of ['orquestrador', 'executor', 'especialista'] as const) {
      expect(r.camadas[camada]).toEqual({ camada, estado: 'configurado', modelo: FASE })
    }
  })

  it('orquestrador local com o Ollama de pé usa o modelo local', () => {
    const r = resolverPerfil(comLocal(), AMBIENTE_COMPLETO, FASE)
    expect(r.camadas.orquestrador).toEqual({
      camada: 'orquestrador',
      estado: 'configurado',
      modelo: { provider: 'ollama', modelo: 'qwen3:8b' }
    })
  })

  it('Ollama fora do ar cai no modelo da fase, com o motivo registrado', () => {
    const r = resolverPerfil(
      comLocal(),
      { ...AMBIENTE_COMPLETO, ollama: { disponivel: false, modelos: [] } },
      FASE
    )
    expect(r.camadas.orquestrador).toEqual({
      camada: 'orquestrador',
      estado: 'fallback',
      modelo: FASE,
      motivo: 'OLLAMA_FORA_DO_AR'
    })
    expect(r.elegivel).toBe(true)
  })

  it('Ollama de pé sem a tag pedida também cai no modelo da fase', () => {
    const r = resolverPerfil(
      comLocal(),
      { ...AMBIENTE_COMPLETO, ollama: { disponivel: true, modelos: ['llama3.1'] } },
      FASE
    )
    expect(r.camadas.orquestrador).toMatchObject({
      estado: 'fallback',
      modelo: FASE,
      motivo: 'MODELO_LOCAL_AUSENTE'
    })
  })

  it('o fallback nunca é uma API paga: o modelo da fase vem de fora, já pela rota escolhida', () => {
    const r = resolverPerfil(
      comLocal(),
      { ...AMBIENTE_COMPLETO, ollama: { disponivel: false, modelos: [] } },
      FASE
    )
    expect(r.camadas.orquestrador.modelo).toBe(FASE)
  })
})

describe('resolução de camadas — API paga só com opt-in (regra 6)', () => {
  const paga = (): PerfilDeSquad => ({
    ...PERFIL_PADRAO,
    camadas: {
      ...PERFIL_PADRAO.camadas,
      especialista: { origem: 'modelo', provider: 'anthropic', modelo: 'claude-opus-5' }
    }
  })

  it('sem opt-in a camada fica indisponível — não troca de rota em silêncio', () => {
    const r = resolverPerfil(paga(), AMBIENTE_COMPLETO, FASE)
    expect(r.camadas.especialista).toEqual({
      camada: 'especialista',
      estado: 'indisponivel',
      motivo: 'API_PAGA_SEM_OPT_IN'
    })
    expect(porCapacidade(r, 'revisao-de-codigo', 'especialista')).toMatchObject({
      estado: 'indisponivel',
      motivo: 'API_PAGA_SEM_OPT_IN'
    })
  })

  it('a camada indisponível arrasta o revisor e torna o plano inelegível', () => {
    const r = resolverPerfil(paga(), AMBIENTE_COMPLETO, FASE)
    expect(r.elegivel).toBe(false)
    expect(r.motivosDeInelegibilidade.join(' ')).toContain('revisor')
  })

  it('com opt-in do projeto a camada resolve', () => {
    const r = resolverPerfil(paga(), { ...AMBIENTE_COMPLETO, optInApiPaga: true }, FASE)
    expect(r.camadas.especialista.estado).toBe('configurado')
    expect(r.elegivel).toBe(true)
  })
})

describe('modelo da fase pago também respeita o opt-in (regra 6)', () => {
  const FASE_PAGA: ModeloEscolhido = { provider: 'anthropic', modelo: 'claude-opus-5' }

  it('fase paga sem opt-in deixa a camada indisponível e o plano inelegível', () => {
    const r = resolverPerfil(PERFIL_PADRAO, AMBIENTE_COMPLETO, FASE_PAGA)
    expect(r.camadas.especialista).toEqual({
      camada: 'especialista',
      estado: 'indisponivel',
      motivo: 'API_PAGA_SEM_OPT_IN'
    })
    expect(r.elegivel).toBe(false)
  })

  it('fase paga com opt-in resolve', () => {
    const r = resolverPerfil(PERFIL_PADRAO, { ...AMBIENTE_COMPLETO, optInApiPaga: true }, FASE_PAGA)
    expect(r.camadas.especialista.estado).toBe('configurado')
  })

  it('o fallback do Ollama para uma fase paga sem opt-in também é recusado', () => {
    const r = resolverPerfil(
      comLocal(),
      { ...AMBIENTE_COMPLETO, ollama: { disponivel: false, modelos: [] } },
      FASE_PAGA
    )
    expect(r.camadas.orquestrador).toEqual({
      camada: 'orquestrador',
      estado: 'indisponivel',
      motivo: 'API_PAGA_SEM_OPT_IN'
    })
  })
})

describe('tag do Ollama', () => {
  it('llama3.1 e llama3.1:latest são o mesmo modelo', () => {
    const perfilLocal = comLocal({
      camadas: {
        ...PERFIL_PADRAO.camadas,
        orquestrador: { origem: 'modelo', provider: 'ollama', modelo: 'llama3.1', validador: 'e1' }
      }
    })
    const r = resolverPerfil(
      perfilLocal,
      { ...AMBIENTE_COMPLETO, ollama: { disponivel: true, modelos: ['llama3.1:latest'] } },
      FASE
    )
    expect(r.camadas.orquestrador.estado).toBe('configurado')
  })
})

describe('custo e limites antes de instanciar — critério 4', () => {
  it('rota de assinatura e Ollama não têm custo em USD, e o relatório diz isso', () => {
    const r = resolverPerfil(PERFIL_PADRAO, AMBIENTE_COMPLETO, FASE)
    const c = custoMaximoUsd(PERFIL_PADRAO, r, 6)
    expect(c.usd).toBe(0)
    expect(c.camadasMedidas).toEqual([])
    expect(c.slots).toBe(1)
    expect(c.maxTarefas).toBe(12)
  })

  it('cota superior: tarefas × a camada paga mais cara, pelo pior caso de tokens', () => {
    const paga: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      camadas: {
        ...PERFIL_PADRAO.camadas,
        especialista: { origem: 'modelo', provider: 'anthropic', modelo: 'claude-opus-5' }
      }
    }
    const r = resolverPerfil(paga, { ...AMBIENTE_COMPLETO, optInApiPaga: true }, FASE)
    const c = custoMaximoUsd(paga, r, 6)
    // opus: 5 USD/M entrada, 25 USD/M saída — 16.000 entrada e 8.000 saída por tarefa.
    const porTarefa = (16_000 / 1e6) * 5 + (8_000 / 1e6) * 25
    expect(c.usd).toBeCloseTo(12 * porTarefa, 10)
    expect(c.camadasMedidas).toEqual(['especialista'])
  })

  it('o teto de tarefas acompanha o número de critérios da SPEC', () => {
    const r = resolverPerfil(PERFIL_PADRAO, AMBIENTE_COMPLETO, FASE)
    expect(custoMaximoUsd(PERFIL_PADRAO, r, 13).maxTarefas).toBe(13)
  })

  it('dois escritores ocupam dois slots', () => {
    const dois: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      escritores: 2,
      integrador: { camada: 'executor' }
    }
    const r = resolverPerfil(dois, AMBIENTE_COMPLETO, FASE)
    expect(custoMaximoUsd(dois, r, 6).slots).toBe(2)
  })

  it('congela a soma dos limites das tarefas e ignora rotas sem preço por chamada', () => {
    const paga: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      camadas: {
        ...PERFIL_PADRAO.camadas,
        especialista: { origem: 'modelo', provider: 'anthropic', modelo: 'claude-opus-5' }
      }
    }
    const r = resolverPerfil(paga, { ...AMBIENTE_COMPLETO, optInApiPaga: true }, FASE)
    const limite = custoDoPlanoUsd(
      {
        tarefas: [
          {
            id: 'review-1',
            camada: 'especialista',
            limites: { maxTokensEntrada: 1000, maxTokensSaida: 500 }
          },
          {
            id: 'dev-1',
            camada: 'executor',
            limites: { maxTokensEntrada: 8000, maxTokensSaida: 4000 }
          }
        ]
      } as never,
      r
    )

    expect(limite.usd).toBeCloseTo((1000 / 1e6) * 5 + (500 / 1e6) * 25, 10)
    expect(limite.camadasMedidas).toEqual(['especialista'])
  })
})

describe('determinismo', () => {
  it('o mesmo perfil e o mesmo ambiente dão a mesma resolução', () => {
    const a = resolverPerfil(PERFIL_PADRAO, sem('code-review'), FASE)
    const b = resolverPerfil(PERFIL_PADRAO, sem('code-review'), FASE)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('o orquestrador também precisa de camada utilizável', () => {
  /** Executor e especialista em assinatura; só o orquestrador sai do modelo da fase — que é pago. */
  const soOrquestradorNaFase: PerfilDeSquad = {
    ...PERFIL_PADRAO,
    camadas: {
      orquestrador: { origem: 'fase' },
      executor: { origem: 'modelo', provider: 'claude-code', modelo: 'claude-opus-5' },
      especialista: { origem: 'modelo', provider: 'claude-code', modelo: 'claude-opus-5' }
    }
  }
  const FASE_PAGA: ModeloEscolhido = { provider: 'anthropic', modelo: 'claude-opus-5' }

  it('fase paga sem opt-in torna o plano inelegível, mesmo com as outras camadas em assinatura', () => {
    const r = resolverPerfil(soOrquestradorNaFase, AMBIENTE_COMPLETO, FASE_PAGA)
    expect(r.camadas.orquestrador).toMatchObject({ estado: 'indisponivel' })
    expect(r.camadas.executor.estado).toBe('configurado')
    expect(r.elegivel).toBe(false)
    expect(r.motivosDeInelegibilidade.join(' ')).toContain('orquestrador')
  })

  it('com opt-in, o mesmo perfil é elegível', () => {
    const r = resolverPerfil(
      soOrquestradorNaFase,
      { ...AMBIENTE_COMPLETO, optInApiPaga: true },
      FASE_PAGA
    )
    expect(r.elegivel).toBe(true)
  })
})
