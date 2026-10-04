import { describe, expect, it } from 'vitest'
import type { ConfigDoPool, EstadoDoPool, ItemDaFila, SlotOcupado } from './pool'
import {
  CAPACIDADE_MAXIMA_DO_POOL,
  CONFIG_PADRAO,
  PREFIXO_DO_SLOT,
  SEM_PROVA,
  capacidadeEfetiva,
  decidirPool,
  ehRecursoDeSlot,
  maxPorProjetoEfetivo,
  recursoDoSlot,
  tokenConfere,
  validarConfig
} from './pool'

const PARALELO: ConfigDoPool = { ...CONFIG_PADRAO, paralelismo: true }

function item(runId: string, projectId: string, extra: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    runId,
    projectId,
    sliceId: `s-${runId}`,
    prioridade: 1,
    enfileiradoEm: 1_000,
    gatesAbertos: [],
    ...extra
  }
}

function slot(runId: string, projectId: string, extra: Partial<SlotOcupado> = {}): SlotOcupado {
  return { runId, projectId, estado: 'vigente', ...extra }
}

function estado(parcial: Partial<EstadoDoPool>): EstadoDoPool {
  return { config: CONFIG_PADRAO, itens: [], ocupados: [], ultimoServidoEm: {}, ...parcial }
}

const motivoDe = (d: ReturnType<typeof decidirPool>, runId: string) =>
  d.espera.find((e) => e.runId === runId)?.motivo

describe('configuração', () => {
  it('nasce com dois slots e o paralelismo desligado: a capacidade efetiva é 1', () => {
    expect(CONFIG_PADRAO.capacidadeGlobal).toBe(2)
    expect(CONFIG_PADRAO.maxPorProjeto).toBe(2)
    expect(CONFIG_PADRAO.paralelismo).toBe(false)
    expect(capacidadeEfetiva(CONFIG_PADRAO)).toBe(1)
    expect(maxPorProjetoEfetivo(CONFIG_PADRAO)).toBe(1)
  })

  it('com o paralelismo ligado vale a capacidade configurada, e o projeto nunca passa dela', () => {
    expect(capacidadeEfetiva(PARALELO)).toBe(2)
    expect(maxPorProjetoEfetivo(PARALELO)).toBe(2)
    const apertada = { ...PARALELO, capacidadeGlobal: 1, maxPorProjeto: 5 }
    expect(maxPorProjetoEfetivo(apertada)).toBe(1)
  })

  it('os recursos dos slots são nomeados e reconhecíveis', () => {
    expect(recursoDoSlot(1)).toBe(`${PREFIXO_DO_SLOT}1`)
    expect(ehRecursoDeSlot('wip:slot:2')).toBe(true)
    expect(ehRecursoDeSlot('wip:global')).toBe(false)
    expect(ehRecursoDeSlot('wip:global:writer:r1')).toBe(false)
  })
})

describe('validarConfig', () => {
  it('aceita a configuração padrão e a copia', () => {
    const r = validarConfig(CONFIG_PADRAO)
    expect(r.ok && r.config).toEqual(CONFIG_PADRAO)
  })

  it.each([
    [{ ...CONFIG_PADRAO, capacidadeGlobal: 0 }, 'capacidadeGlobal'],
    [{ ...CONFIG_PADRAO, capacidadeGlobal: CAPACIDADE_MAXIMA_DO_POOL + 1 }, 'capacidadeGlobal'],
    [{ ...CONFIG_PADRAO, capacidadeGlobal: 1.5 }, 'capacidadeGlobal'],
    [{ ...CONFIG_PADRAO, maxPorProjeto: -1 }, 'maxPorProjeto'],
    [{ ...CONFIG_PADRAO, paralelismo: 'sim' }, 'paralelismo'],
    [{ ...CONFIG_PADRAO, porExecutor: { 'claude code': 1 } }, 'porExecutor'],
    [{ ...CONFIG_PADRAO, porExecutor: { codex: 0 } }, 'porExecutor'],
    [{ ...CONFIG_PADRAO, porClasse: 'docker' }, 'porClasse'],
    [{ ...CONFIG_PADRAO, extra: 1 }, 'extra']
  ])('recusa %j', (entrada, campo) => {
    const r = validarConfig(entrada)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.erros.join(' ')).toContain(campo)
  })

  it('devolve todos os erros de uma vez e nunca lança', () => {
    const r = validarConfig({ capacidadeGlobal: 0, maxPorProjeto: 0, paralelismo: 1 })
    expect(!r.ok && r.erros.length).toBeGreaterThanOrEqual(3)
    for (const lixo of [null, undefined, 42, 'x', []]) expect(validarConfig(lixo).ok).toBe(false)
  })
})

describe('capacidade — nunca mais escritores que o limite (critério 1)', () => {
  it('com o paralelismo desligado, um só run entra, mesmo de projetos diferentes', () => {
    const d = decidirPool(estado({ itens: [item('a1', 'A'), item('b1', 'B')] }))
    expect(d.adquirir).toHaveLength(1)
    const quem = d.adquirir[0] === 'a1' ? 'b1' : 'a1'
    expect(motivoDe(d, quem)).toEqual({ tipo: 'paralelismo-desligado', ocupados: 1 })
  })

  it('com o paralelismo ligado, dois projetos ocupam os dois slots', () => {
    const d = decidirPool(estado({ config: PARALELO, itens: [item('a1', 'A'), item('b1', 'B')] }))
    expect([...d.adquirir].sort()).toEqual(['a1', 'b1'])
    expect(d.espera).toEqual([])
  })

  it('um terceiro run espera pelo limite global, com os números', () => {
    const d = decidirPool(
      estado({ config: PARALELO, itens: [item('a1', 'A'), item('b1', 'B'), item('c1', 'C')] })
    )
    expect(d.adquirir).toHaveLength(2)
    const espera = d.espera[0]
    expect(espera.motivo).toEqual({ tipo: 'limite-global', ocupados: 2, limite: 2 })
    expect(espera.posicao).toBe(1)
  })

  it('o ocupado conta: um slot já tomado deixa só um para os novos', () => {
    const d = decidirPool(
      estado({
        config: PARALELO,
        ocupados: [slot('x', 'X')],
        itens: [item('a1', 'A'), item('b1', 'B')]
      })
    )
    expect(d.adquirir).toHaveLength(1)
  })

  it('o limite por projeto vale mesmo com capacidade sobrando', () => {
    const config = { ...PARALELO, capacidadeGlobal: 4, maxPorProjeto: 1 }
    const d = decidirPool(
      estado({
        config,
        itens: [item('a1', 'A', { prioridade: 1 }), item('a2', 'A', { prioridade: 2 })]
      })
    )
    expect(d.adquirir).toEqual(['a1'])
    // a1 acabou de ocupar o único lugar do projeto: o que segura a2 é o limite, não a ordem.
    expect(motivoDe(d, 'a2')).toEqual({ tipo: 'limite-do-projeto', ocupados: 1, limite: 1 })
  })

  it('o limite do projeto aparece como motivo quando o próprio projeto já tem ocupados', () => {
    const config = { ...PARALELO, capacidadeGlobal: 4, maxPorProjeto: 1 }
    const d = decidirPool(estado({ config, ocupados: [slot('a0', 'A')], itens: [item('a1', 'A')] }))
    expect(d.adquirir).toEqual([])
    expect(motivoDe(d, 'a1')).toEqual({ tipo: 'limite-do-projeto', ocupados: 1, limite: 1 })
  })

  it('o limite por executor protege a mesma assinatura', () => {
    const config = { ...PARALELO, porExecutor: { codex: 1 } }
    const d = decidirPool(
      estado({
        config,
        itens: [item('a1', 'A', { executor: 'codex' }), item('b1', 'B', { executor: 'codex' })]
      })
    )
    expect(d.adquirir).toHaveLength(1)
    const espera = d.espera[0]
    expect(espera.motivo).toMatchObject({
      tipo: 'limite-do-executor',
      executor: 'codex',
      limite: 1
    })
  })

  it('o limite por classe de recurso protege o que é escasso', () => {
    const config = { ...PARALELO, porClasse: { docker: 1 } }
    const d = decidirPool(
      estado({
        config,
        itens: [item('a1', 'A', { classe: 'docker' }), item('b1', 'B', { classe: 'docker' })]
      })
    )
    expect(d.adquirir).toHaveLength(1)
    expect(d.espera[0].motivo).toMatchObject({ tipo: 'limite-da-classe', classe: 'docker' })
  })

  it('executor e classe sem limite configurado não restringem nada', () => {
    const d = decidirPool(
      estado({
        config: PARALELO,
        itens: [
          item('a1', 'A', { executor: 'outro', classe: 'qualquer' }),
          item('b1', 'B', { executor: 'outro', classe: 'qualquer' })
        ]
      })
    )
    expect(d.adquirir).toHaveLength(2)
  })
})

describe('independência dentro do projeto', () => {
  const doisDoMesmo = [item('a1', 'A', { prioridade: 1 }), item('a2', 'A', { prioridade: 2 })]

  it('sem prova de independência, o segundo run do projeto espera (padrão até a M12-F02)', () => {
    const d = decidirPool(estado({ config: PARALELO, itens: doisDoMesmo }))
    expect(d.adquirir).toEqual(['a1'])
    expect(motivoDe(d, 'a2')).toEqual({ tipo: 'sem-prova-de-independencia' })
  })

  it('o segundo run com o primeiro já ocupado explica a falta de prova', () => {
    const d = decidirPool(
      estado({ config: PARALELO, ocupados: [slot('a1', 'A')], itens: [item('a2', 'A')] })
    )
    expect(d.adquirir).toEqual([])
    expect(motivoDe(d, 'a2')).toEqual({ tipo: 'sem-prova-de-independencia' })
  })

  it('com a prova, os dois rodam juntos', () => {
    const d = decidirPool(estado({ config: PARALELO, itens: doisDoMesmo }), () => true)
    expect(d.adquirir).toEqual(['a1', 'a2'])
  })

  it('a prova recebe o item e os ativos do projeto', () => {
    const vistos: { item: string; ativos: readonly string[] }[] = []
    decidirPool(
      estado({ config: PARALELO, ocupados: [slot('a1', 'A')], itens: [item('a2', 'A')] }),
      (i, ativos) => {
        vistos.push({ item: i.runId, ativos })
        return false
      }
    )
    // A prova é consultada na decisão e de novo na explicação; as duas vezes com os mesmos dados.
    expect(vistos.length).toBeGreaterThan(0)
    expect(vistos.every((v) => v.item === 'a2' && v.ativos.join() === 'a1')).toBe(true)
  })

  it('o SEM_PROVA é o padrão', () => {
    expect(SEM_PROVA(item('x', 'X'), [])).toBe(false)
  })

  it('o veredito estruturado autoriza quando independente, como o booleano', () => {
    const d = decidirPool(estado({ config: PARALELO, itens: doisDoMesmo }), () => ({
      independente: true
    }))
    expect(d.adquirir).toEqual(['a1', 'a2'])
  })

  it('o veredito negativo leva as razões e o fingerprint ao motivo de espera (M12-F02)', () => {
    const razoes = [
      { tipo: 'recurso-exclusivo', runId: 'a2', contraRunId: 'a1', recurso: 'lockfile' }
    ] as const
    const d = decidirPool(estado({ config: PARALELO, itens: doisDoMesmo }), () => ({
      independente: false,
      razoes,
      fingerprint: 'abc123'
    }))
    expect(d.adquirir).toEqual(['a1'])
    expect(motivoDe(d, 'a2')).toEqual({
      tipo: 'sem-prova-de-independencia',
      razoes,
      fingerprint: 'abc123'
    })
  })

  it('o veredito negativo sem detalhe mantém o motivo simples', () => {
    const d = decidirPool(estado({ config: PARALELO, itens: doisDoMesmo }), () => ({
      independente: false
    }))
    expect(motivoDe(d, 'a2')).toEqual({ tipo: 'sem-prova-de-independencia' })
  })
})

describe('gates — capacidade livre não torna ninguém elegível (regra 1)', () => {
  it('um item com gate aberto nunca adquire, mesmo com tudo livre', () => {
    const d = decidirPool(
      estado({ config: PARALELO, itens: [item('a1', 'A', { gatesAbertos: ['aprovacao-do-pi'] })] })
    )
    expect(d.adquirir).toEqual([])
    expect(motivoDe(d, 'a1')).toEqual({ tipo: 'gate', gates: ['aprovacao-do-pi'] })
  })

  it('o item com gate não toma o lugar de quem está elegível, e fica depois na ordem', () => {
    const d = decidirPool(
      estado({
        itens: [
          item('a1', 'A', { prioridade: 1, gatesAbertos: ['dependencia'] }),
          item('b1', 'B', { prioridade: 5 })
        ]
      })
    )
    expect(d.adquirir).toEqual(['b1'])
    expect(d.espera.map((e) => e.runId)).toEqual(['a1'])
  })

  it('o gate vem antes de qualquer limite na explicação', () => {
    const d = decidirPool(
      estado({ ocupados: [slot('x', 'X')], itens: [item('a1', 'A', { gatesAbertos: ['x'] })] })
    )
    expect(motivoDe(d, 'a1')?.tipo).toBe('gate')
  })
})

describe('lease expirado ocupa o slot até a reconciliação (regra 3)', () => {
  it('não dá o slot a outro run, e diz quem está pendente de reconciliação', () => {
    const d = decidirPool(
      estado({ ocupados: [slot('x', 'X', { estado: 'expirado' })], itens: [item('a1', 'A')] })
    )
    expect(d.adquirir).toEqual([])
    expect(motivoDe(d, 'a1')).toEqual({ tipo: 'aguardando-reconciliacao', runIds: ['x'] })
  })

  it('com capacidade sobrando, o expirado ocupa um slot mas não trava os outros', () => {
    const d = decidirPool(
      estado({
        config: PARALELO,
        ocupados: [slot('x', 'X', { estado: 'expirado' })],
        itens: [item('a1', 'A')]
      })
    )
    expect(d.adquirir).toEqual(['a1'])
  })
})

describe('configuração reduzida não mata run ativo (regra 2)', () => {
  it('com mais ocupados que a capacidade, ninguém novo entra e ninguém é retirado', () => {
    const config = { ...PARALELO, capacidadeGlobal: 1 }
    const ocupados = [slot('x', 'X'), slot('y', 'Y')]
    const d = decidirPool(estado({ config, ocupados, itens: [item('a1', 'A')] }))
    expect(d.adquirir).toEqual([])
    expect(ocupados).toHaveLength(2)
  })

  it('ao ficar abaixo do teto, volta a adquirir', () => {
    const config = { ...PARALELO, capacidadeGlobal: 1 }
    const d = decidirPool(estado({ config, ocupados: [], itens: [item('a1', 'A')] }))
    expect(d.adquirir).toEqual(['a1'])
  })
})

describe('precedência do roadmap dentro do projeto', () => {
  it('a menor prioridade vai primeiro; a idade só desempata', () => {
    const d = decidirPool(
      estado({
        itens: [
          item('velho', 'A', { prioridade: 2, enfileiradoEm: 1 }),
          item('novo', 'A', { prioridade: 1, enfileiradoEm: 999 })
        ]
      })
    )
    expect(d.adquirir).toEqual(['novo'])
    expect(motivoDe(d, 'velho')).toEqual({ tipo: 'paralelismo-desligado', ocupados: 1 })
  })

  it('quem está atrás de outro que também espera é explicado pela precedência', () => {
    const d = decidirPool(
      estado({
        itens: [
          item('a1', 'A', { prioridade: 1 }),
          item('a2', 'A', { prioridade: 2 }),
          item('a3', 'A', { prioridade: 3 })
        ]
      })
    )
    expect(d.adquirir).toEqual(['a1'])
    expect(motivoDe(d, 'a2')?.tipo).toBe('paralelismo-desligado')
    expect(motivoDe(d, 'a3')).toEqual({ tipo: 'precedencia', aposRunId: 'a2' })
  })

  it('com a mesma prioridade, o mais antigo; com a mesma idade, o id', () => {
    const d = decidirPool(
      estado({
        itens: [
          item('b', 'A', { enfileiradoEm: 5 }),
          item('a', 'A', { enfileiradoEm: 5 }),
          item('c', 'A', { enfileiradoEm: 1 })
        ]
      })
    )
    expect(d.adquirir).toEqual(['c'])
    expect(d.espera.map((e) => e.runId)).toEqual(['a', 'b'])
  })
})

describe('justiça entre projetos — critério 2', () => {
  it('quem foi servido há mais tempo vai primeiro', () => {
    const d = decidirPool(
      estado({
        itens: [item('a1', 'A'), item('b1', 'B')],
        ultimoServidoEm: { A: 500, B: 100 }
      })
    )
    expect(d.adquirir).toEqual(['b1'])
  })

  it('quem nunca foi servido tem a vez', () => {
    const d = decidirPool(
      estado({ itens: [item('a1', 'A'), item('b1', 'B')], ultimoServidoEm: { A: 500 } })
    )
    expect(d.adquirir).toEqual(['b1'])
  })

  it('empate de vez: o mais antigo na fila, depois o id do projeto', () => {
    const porIdade = decidirPool(
      estado({
        itens: [item('a1', 'A', { enfileiradoEm: 9 }), item('b1', 'B', { enfileiradoEm: 3 })]
      })
    )
    expect(porIdade.adquirir).toEqual(['b1'])
    const porId = decidirPool(estado({ itens: [item('b1', 'B'), item('a1', 'A')] }))
    expect(porId.adquirir).toEqual(['a1'])
  })

  it('a posição de quem espera alterna entre projetos', () => {
    const d = decidirPool(
      estado({
        itens: [
          item('a1', 'A', { prioridade: 1 }),
          item('a2', 'A', { prioridade: 2 }),
          item('b1', 'B', { prioridade: 1 }),
          item('b2', 'B', { prioridade: 2 })
        ]
      })
    )
    expect(d.adquirir).toEqual(['a1'])
    expect(d.espera.map((e) => e.runId)).toEqual(['b1', 'a2', 'b2'])
    expect(d.espera.map((e) => e.posicao)).toEqual([1, 2, 3])
  })

  it('o projeto servido agora é devolvido para o chamador gravar a vez', () => {
    const d = decidirPool(estado({ config: PARALELO, itens: [item('a1', 'A'), item('b1', 'B')] }))
    expect(d.servidos).toEqual(['A', 'B'])
  })
})

describe('determinismo — regra 4', () => {
  const base = estado({
    config: { ...PARALELO, capacidadeGlobal: 3 },
    ocupados: [slot('o1', 'A'), slot('o2', 'C', { estado: 'expirado' })],
    itens: [
      item('a1', 'A', { prioridade: 2, enfileiradoEm: 4 }),
      item('a2', 'A', { prioridade: 1, enfileiradoEm: 9 }),
      item('b1', 'B', { enfileiradoEm: 2 }),
      item('b2', 'B', { prioridade: 3, gatesAbertos: ['g'] }),
      item('c1', 'C', { enfileiradoEm: 7 })
    ],
    ultimoServidoEm: { A: 10, B: 5 }
  })

  it('a ordem dos itens e dos ocupados não muda a decisão', () => {
    const embaralhado: EstadoDoPool = {
      ...base,
      itens: [...base.itens].reverse(),
      ocupados: [...base.ocupados].reverse()
    }
    expect(JSON.stringify(decidirPool(embaralhado))).toBe(JSON.stringify(decidirPool(base)))
  })

  it('não altera o estado recebido', () => {
    const antes = JSON.stringify(base)
    decidirPool(base)
    expect(JSON.stringify(base)).toBe(antes)
  })
})

describe('fencing token', () => {
  it('só o token igual ao do lease confere', () => {
    expect(tokenConfere(7, 7)).toBe(true)
    expect(tokenConfere(7, 6)).toBe(false)
    expect(tokenConfere(7, 8)).toBe(false)
  })

  it('lease sem token (V1) nunca confere, e token inválido nunca confere', () => {
    expect(tokenConfere(undefined, 1)).toBe(false)
    expect(tokenConfere(7, Number.NaN)).toBe(false)
    expect(tokenConfere(7, 7.5)).toBe(false)
  })
})

/** Gerador pseudoaleatório determinístico (mulberry32): os testes de propriedade são reproduzíveis. */
function aleatorio(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function estadoAleatorio(rand: () => number): EstadoDoPool {
  const inteiro = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1))
  const projetos = ['A', 'B', 'C', 'D'].slice(0, inteiro(1, 4))
  const executores = ['codex', 'claude-code']
  const classes = ['docker', 'rede']
  const config: ConfigDoPool = {
    capacidadeGlobal: inteiro(1, 4),
    maxPorProjeto: inteiro(1, 3),
    paralelismo: rand() < 0.7,
    porExecutor: rand() < 0.5 ? { codex: inteiro(1, 2) } : {},
    porClasse: rand() < 0.5 ? { docker: inteiro(1, 2) } : {}
  }
  const ocupados: SlotOcupado[] = Array.from({ length: inteiro(0, 3) }, (_, i) => ({
    runId: `o${i}`,
    projectId: projetos[inteiro(0, projetos.length - 1)],
    ...(rand() < 0.5 ? { executor: executores[inteiro(0, 1)] } : {}),
    ...(rand() < 0.5 ? { classe: classes[inteiro(0, 1)] } : {}),
    estado: rand() < 0.2 ? ('expirado' as const) : ('vigente' as const)
  }))
  const itens: ItemDaFila[] = Array.from({ length: inteiro(0, 10) }, (_, i) => ({
    runId: `r${i}`,
    projectId: projetos[inteiro(0, projetos.length - 1)],
    sliceId: `s${i}`,
    prioridade: inteiro(1, 4),
    enfileiradoEm: inteiro(1, 50),
    ...(rand() < 0.5 ? { executor: executores[inteiro(0, 1)] } : {}),
    ...(rand() < 0.5 ? { classe: classes[inteiro(0, 1)] } : {}),
    gatesAbertos: rand() < 0.25 ? ['g'] : []
  }))
  const ultimoServidoEm = Object.fromEntries(
    projetos.filter(() => rand() < 0.6).map((p) => [p, inteiro(1, 100)])
  )
  return { config, itens, ocupados, ultimoServidoEm }
}

describe('propriedades sobre estados aleatórios (reproduzíveis pela semente)', () => {
  const RODADAS = 600

  it('nunca ultrapassa a capacidade, o limite do projeto, do executor nem da classe', () => {
    const rand = aleatorio(20261002)
    for (let i = 0; i < RODADAS; i++) {
      const e = estadoAleatorio(rand)
      const d = decidirPool(e, i % 2 === 0 ? SEM_PROVA : () => true)
      const novos = e.itens.filter((it) => d.adquirir.includes(it.runId))
      const todos = [...e.ocupados, ...novos]

      const teto = capacidadeEfetiva(e.config)
      expect(todos.length <= Math.max(e.ocupados.length, teto), `rodada ${i}: global`).toBe(true)
      if (e.ocupados.length >= teto) expect(novos, `rodada ${i}: cheio`).toHaveLength(0)

      for (const p of new Set(todos.map((t) => t.projectId))) {
        const noProjeto = todos.filter((t) => t.projectId === p).length
        const jaTinha = e.ocupados.filter((t) => t.projectId === p).length
        expect(
          noProjeto <= Math.max(jaTinha, maxPorProjetoEfetivo(e.config)),
          `rodada ${i}: ${p}`
        ).toBe(true)
      }
      for (const [exec, limite] of Object.entries(e.config.porExecutor)) {
        const n = todos.filter((t) => t.executor === exec).length
        const ja = e.ocupados.filter((t) => t.executor === exec).length
        expect(n <= Math.max(ja, limite), `rodada ${i}: executor`).toBe(true)
      }
      for (const [cls, limite] of Object.entries(e.config.porClasse)) {
        const n = todos.filter((t) => t.classe === cls).length
        const ja = e.ocupados.filter((t) => t.classe === cls).length
        expect(n <= Math.max(ja, limite), `rodada ${i}: classe`).toBe(true)
      }
    }
  })

  it('só adquire quem é elegível, sem repetir, e respeita a precedência do projeto', () => {
    const rand = aleatorio(7)
    for (let i = 0; i < RODADAS; i++) {
      const e = estadoAleatorio(rand)
      const d = decidirPool(e, () => true)
      expect(new Set(d.adquirir).size).toBe(d.adquirir.length)

      for (const id of d.adquirir) {
        const it = e.itens.find((x) => x.runId === id)
        expect(it?.gatesAbertos).toEqual([])
      }
      for (const p of new Set(e.itens.map((x) => x.projectId))) {
        const elegiveis = e.itens
          .filter((x) => x.projectId === p && x.gatesAbertos.length === 0)
          .sort(
            (a, b) =>
              a.prioridade - b.prioridade ||
              a.enfileiradoEm - b.enfileiradoEm ||
              (a.runId < b.runId ? -1 : 1)
          )
          .map((x) => x.runId)
        const doProjeto = d.adquirir.filter((id) => elegiveis.includes(id))
        expect(doProjeto, `rodada ${i}: precedência de ${p}`).toEqual(
          elegiveis.slice(0, doProjeto.length)
        )
      }
    }
  })

  it('todo item fora do pool tem motivo e posição, e as posições são 1..n', () => {
    const rand = aleatorio(99)
    for (let i = 0; i < RODADAS; i++) {
      const e = estadoAleatorio(rand)
      const d = decidirPool(e)
      const fora = e.itens.filter((x) => !d.adquirir.includes(x.runId))
      expect(d.espera.map((x) => x.runId).sort()).toEqual(fora.map((x) => x.runId).sort())
      expect(d.espera.map((x) => x.posicao)).toEqual(d.espera.map((_, k) => k + 1))
      for (const w of d.espera) expect(w.motivo.tipo).toBeTruthy()
    }
  })

  it('a ordem de entrada nunca muda a decisão', () => {
    const rand = aleatorio(31337)
    for (let i = 0; i < RODADAS; i++) {
      const e = estadoAleatorio(rand)
      const virado: EstadoDoPool = {
        ...e,
        itens: [...e.itens].reverse(),
        ocupados: [...e.ocupados].reverse()
      }
      expect(JSON.stringify(decidirPool(virado)), `rodada ${i}`).toBe(
        JSON.stringify(decidirPool(e))
      )
    }
  })
})

describe('sem starvation — dois projetos continuamente elegíveis avançam (critério 2)', () => {
  /** Roda N rodadas em que o slot é liberado ao fim de cada uma, e conta quantas vezes cada projeto foi servido. */
  function simular(
    projetos: Record<string, { prioridadeBase: number; idade: number }>,
    config: ConfigDoPool,
    rodadas: number
  ): Record<string, number> {
    const servidos: Record<string, number> = Object.fromEntries(
      Object.keys(projetos).map((p) => [p, 0])
    )
    let ultimo: Record<string, number> = {}
    const proximo: Record<string, number> = Object.fromEntries(
      Object.keys(projetos).map((p) => [p, 0])
    )

    for (let rodada = 1; rodada <= rodadas; rodada++) {
      const itens: ItemDaFila[] = Object.entries(projetos).flatMap(([p, cfg]) =>
        Array.from({ length: 3 }, (_, k) =>
          item(`${p}-${proximo[p] + k}`, p, {
            prioridade: cfg.prioridadeBase + proximo[p] + k,
            enfileiradoEm: cfg.idade + proximo[p] + k
          })
        )
      )
      const d = decidirPool({ config, itens, ocupados: [], ultimoServidoEm: ultimo })
      for (const id of d.adquirir) {
        const p = id.split('-')[0]
        servidos[p]++
        proximo[p]++
      }
      ultimo = { ...ultimo, ...Object.fromEntries(d.servidos.map((p) => [p, rodada])) }
    }
    return servidos
  }

  it('dois projetos, um slot: servidos em alternância, a diferença nunca passa de um', () => {
    const r = simular(
      { A: { prioridadeBase: 1, idade: 1 }, B: { prioridadeBase: 1, idade: 1 } },
      CONFIG_PADRAO,
      100
    )
    expect(Math.abs(r.A - r.B)).toBeLessThanOrEqual(1)
    expect(r.A + r.B).toBe(100)
  })

  it('o projeto mais antigo e de maior precedência não toma tudo', () => {
    const r = simular(
      { A: { prioridadeBase: 1, idade: 1 }, B: { prioridadeBase: 50, idade: 90_000 } },
      CONFIG_PADRAO,
      100
    )
    expect(Math.abs(r.A - r.B)).toBeLessThanOrEqual(1)
  })

  it('três projetos, dois slots: todos avançam e o desvio fica pequeno', () => {
    const r = simular(
      {
        A: { prioridadeBase: 1, idade: 1 },
        B: { prioridadeBase: 1, idade: 2 },
        C: { prioridadeBase: 9, idade: 3 }
      },
      { ...PARALELO, capacidadeGlobal: 2 },
      90
    )
    const valores = Object.values(r)
    expect(Math.max(...valores) - Math.min(...valores)).toBeLessThanOrEqual(2)
    expect(Math.min(...valores)).toBeGreaterThan(0)
  })
})
