import { describe, expect, it, vi } from 'vitest'
import type { ConfiguracaoDoCronograma, ResultadoDoCronograma } from '@shared/domain/cronograma'
import { evaluate, RISK_TAXONOMY } from '@shared/policies'
import { CronogramaService } from './cronograma-service'

const sequencia = (tipo: 'evento' | 'horario' = 'evento') => ({
  id: 'entrada',
  nome: 'Entrada',
  ativa: true,
  gatilho:
    tipo === 'evento'
      ? { tipo: 'evento' as const, evento: 'boas-vindas' as const }
      : { tipo: 'horario' as const, dias: [2], minuto: 480 },
  atividades: [
    { id: 'a', tipo: 'falar' as const },
    {
      id: 'b',
      tipo: 'tocar-midia-local' as const,
      midia: { tipo: 'arquivo' as const, caminho: 'C:/audio.mp3' }
    },
    { id: 'c', tipo: 'falar' as const }
  ]
})

function montar(tipo: 'evento' | 'horario' = 'evento') {
  let config: ConfiguracaoDoCronograma = { versao: 1, ativa: true, sequencias: [sequencia(tipo)] }
  const resultados: ResultadoDoCronograma[] = []
  const ordem: string[] = []
  let data = new Date(2026, 9, 6, 8, 0) // terça-feira local
  const falar = vi.fn(async () => {
    ordem.push('falar')
  })
  const midia = vi.fn(async () => {
    ordem.push('midia')
  })
  const auditar = vi.fn()
  const servico = new CronogramaService({
    agora: () => data,
    estado: {
      ler: () => config,
      salvar: (c) => {
        config = c
      },
      historico: () => resultados,
      registrar: (r) => {
        resultados.unshift(r)
      }
    },
    avaliar: (acao) => evaluate(acao, { workspace: 'jarvis' }),
    auditar,
    midiaAutorizada: () => true,
    podeReproduzir: async () => true,
    sessaoBloqueada: () => false,
    falar,
    tocarMidia: midia
  })
  return {
    servico,
    ordem,
    resultados,
    falar,
    midia,
    auditar,
    mudarHora: (nova: Date) => {
      data = nova
    }
  }
}

describe('SPEC-Escuta-04 · cronograma', () => {
  it('salva e executa a ordem declarada após boas-vindas', async () => {
    const c = montar()
    expect(c.servico.dispararEvento('boas-vindas')).toBe(true)
    await c.servico.aguardarFila()
    expect(c.ordem).toEqual(['falar', 'midia', 'falar'])
    expect(c.resultados[0]?.atividades.map((a) => a.estado)).toEqual([
      'executada',
      'executada',
      'executada'
    ])
  })

  it('o horário só dispara no dia e minuto declarados, uma vez na mesma minuta', async () => {
    const c = montar('horario')
    c.mudarHora(new Date(2026, 9, 6, 7, 59))
    c.servico.verificarHorario()
    c.mudarHora(new Date(2026, 9, 6, 8, 0))
    c.servico.verificarHorario()
    c.servico.verificarHorario()
    await c.servico.aguardarFila()
    expect(c.resultados).toHaveLength(1)
    c.mudarHora(new Date(2026, 9, 7, 8, 0))
    c.servico.verificarHorario()
    await c.servico.aguardarFila()
    expect(c.resultados).toHaveLength(1)
    expect(c.servico.dispararEvento('boas-vindas')).toBe(false)
  })

  it('recusa tier acima de allow e ação desconhecida sem gravar', () => {
    const c = montar()
    const base = c.servico.ler()
    expect(() =>
      c.servico.salvar({
        ...base,
        sequencias: [{ ...sequencia(), atividades: [{ id: 'x', tipo: 'falar' }] }]
      })
    ).not.toThrow()
    // Mesmo um tipo válido sobe de tier quando o avaliador assim determina.
    const recusador = new CronogramaService({
      agora: () => new Date(),
      estado: {
        ler: () => base,
        salvar: () => {
          throw new Error('não deve salvar')
        },
        historico: () => [],
        registrar: () => undefined
      },
      avaliar: (acao) => evaluate(acao, { workspace: 'jarvis', sensitivity: 'personal' }),
      auditar: c.auditar,
      midiaAutorizada: () => true,
      podeReproduzir: async () => true,
      sessaoBloqueada: () => false,
      falar: async () => undefined,
      tocarMidia: async () => undefined
    })
    expect(() => recusador.salvar(base)).toThrow(/Atividade a.*recusada/)
    expect(() =>
      c.servico.salvar({
        ...base,
        sequencias: [{ ...sequencia(), atividades: [{ id: 'x', tipo: 'abrir-app' }] }]
      })
    ).toThrow(/Cronograma inválido/)
    expect(c.auditar).toHaveBeenCalledWith('fim', expect.objectContaining({ estado: 'recusado' }))
  })

  it('contrafactual: semear tier médio para falar barra o salvamento', () => {
    const catalogo = RISK_TAXONOMY as Map<
      string,
      { id: string; tier: 'baixo' | 'medio' | 'alto'; descricao: string }
    >
    const anterior = catalogo.get('cronograma.falar')
    catalogo.set('cronograma.falar', {
      id: 'cronograma.falar',
      tier: 'medio',
      descricao: 'Teste do tier'
    })
    try {
      const c = montar()
      expect(() => c.servico.salvar(c.servico.ler())).toThrow(/Atividade a.*recusada/)
    } finally {
      if (anterior) catalogo.set('cronograma.falar', anterior)
    }
  })

  it('continua após falha no meio e registra as três atividades', async () => {
    const c = montar()
    c.midia.mockRejectedValueOnce(new Error('mídia indisponível'))
    c.servico.dispararEvento('boas-vindas')
    await c.servico.aguardarFila()
    expect(c.ordem).toEqual(['falar', 'falar'])
    expect(c.resultados[0]?.atividades.map((a) => a.estado)).toEqual([
      'executada',
      'nao-executada',
      'executada'
    ])
  })

  it('serializa dois disparos concorrentes', async () => {
    const c = montar()
    let liberar!: () => void
    c.falar.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          liberar = resolve
        })
    )
    c.servico.dispararEvento('boas-vindas')
    c.servico.dispararEvento('boas-vindas')
    await vi.waitFor(() => expect(c.falar).toHaveBeenCalledTimes(1))
    liberar()
    await c.servico.aguardarFila()
    expect(c.resultados).toHaveLength(2)
    expect(c.ordem).toEqual(['midia', 'falar', 'falar', 'midia', 'falar'])
  })

  it('não inicia a fila de um usuário após a troca de sessão', async () => {
    let usuario = 'usuario-a'
    const c = montar()
    const base = c.servico.ler()
    const servico = new CronogramaService({
      agora: () => new Date(),
      usuarioAtual: () => usuario,
      estado: {
        ler: () => base,
        salvar: () => undefined,
        historico: () => [],
        registrar: () => undefined
      },
      avaliar: (acao) => evaluate(acao, { workspace: 'jarvis' }),
      auditar: c.auditar,
      midiaAutorizada: () => true,
      podeReproduzir: async () => true,
      sessaoBloqueada: () => false,
      falar: c.falar,
      tocarMidia: c.midia
    })
    servico.dispararEvento('boas-vindas')
    usuario = 'usuario-b'
    await servico.aguardarFila()
    expect(c.falar).not.toHaveBeenCalled()
    expect(c.midia).not.toHaveBeenCalled()
  })
})
