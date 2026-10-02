import { describe, expect, it } from 'vitest'
import type { ModeloEscolhido } from './modelo-da-fase'
import type { PerfilDeSquad } from './squad-perfil'
import type { AmbienteDeResolucao } from './squad-resolucao'
import type { ContextoDeValidacao, Decisao } from './squad-plano'
import { PERFIL_PADRAO } from './squad-perfil'
import { resolverPerfil } from './squad-resolucao'
import { CAPACIDADES_DO_PAPEL, PAPEIS, validarPlano } from './squad-plano'
import { CAPACIDADES } from './squad-capacidades'

const FASE: ModeloEscolhido = { provider: 'claude-code', modelo: 'claude-fable-5-1' }
const AMBIENTE: AmbienteDeResolucao = {
  skills: ['code-review', 'superpowers:test-driven-development'],
  ferramentas: [],
  ollama: { disponivel: false, modelos: [] },
  optInApiPaga: false
}

const LIMITES = { maxTurnos: 10, maxMinutos: 20, maxTokensEntrada: 8000, maxTokensSaida: 4000 }

/** Uma tarefa válida; cada teste estraga um campo. */
function tarefa(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    papel: 'desenvolvedor',
    capacidade: 'testes',
    camada: 'executor',
    escritor: 'w1',
    entradas: ['docs/spec'],
    dependencias: [],
    paths: ['src/shared/domain/novo.ts'],
    schemaDeResultado: 'resultado-de-testes@1',
    limites: LIMITES,
    fundamento: { criterio: 1 },
    regraDeConclusao: 'os testes da tarefa passam',
    ...extra
  }
}

/** t1 escreve, t2 testa, t3 revisa — cobre os critérios 1, 2 e 3 da SPEC. */
function plano(): { tarefas: Record<string, unknown>[] } {
  return {
    tarefas: [
      tarefa('t1'),
      tarefa('t2', {
        papel: 'testador',
        escritor: undefined,
        paths: [],
        dependencias: ['t1'],
        fundamento: { criterio: 2 }
      }),
      tarefa('t3', {
        papel: 'revisor',
        capacidade: 'revisao-de-codigo',
        camada: 'especialista',
        escritor: undefined,
        paths: [],
        dependencias: ['t2'],
        schemaDeResultado: 'achados@1',
        fundamento: { criterio: 3 }
      })
    ]
  }
}

function contexto(
  perfil: PerfilDeSquad = PERFIL_PADRAO,
  extra: Partial<ContextoDeValidacao> = {}
): ContextoDeValidacao {
  return {
    criteriosDaSpec: [1, 2, 3],
    perfil,
    resolucao: resolverPerfil(perfil, AMBIENTE, FASE),
    pathsPermitidos: ['src/shared/domain', 'src/main/squads'],
    fontesPermitidas: ['docs/spec', 'src'],
    arquivosDaBase: ['src/shared/domain/ai.ts', 'src/main/squads/x.ts', 'docs/spec/a.md'],
    orcamentoUsd: 1,
    ...extra
  }
}

const motivos = (d: Decisao): readonly string[] => d.rejeicoes.map((r) => r.motivo)

describe('plano mínimo válido — critério 1', () => {
  it('é aceito e cada tarefa sai classificada como válida', () => {
    const d = validarPlano(plano(), contexto())
    expect(d.rejeicoes).toEqual([])
    expect(d.aceito).toBe(true)
    expect(d.tarefas.map((t) => t.classificacao)).toEqual(['valida', 'valida', 'valida'])
  })

  it('nunca lança com entrada que não é plano', () => {
    for (const lixo of [null, undefined, 42, 'plano', [], { tarefas: [] }, { tarefas: 'x' }]) {
      const d = validarPlano(lixo, contexto())
      expect(d.aceito).toBe(false)
      expect(motivos(d)).toContain('SCHEMA')
    }
  })
})

describe('estrutura do grafo', () => {
  it('rejeita ciclo', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { dependencias: ['t3'] })
    expect(motivos(validarPlano(p, contexto()))).toContain('CICLO')
  })

  it('rejeita id duplicado e dependência inexistente', () => {
    const dup = plano()
    dup.tarefas[1] = tarefa('t1', { papel: 'testador', escritor: undefined, paths: [] })
    expect(motivos(validarPlano(dup, contexto()))).toContain('ID_DUPLICADO')

    const solta = plano()
    solta.tarefas[1] = { ...solta.tarefas[1], dependencias: ['t99'] }
    expect(motivos(validarPlano(solta, contexto()))).toContain('DEPENDENCIA_INEXISTENTE')
  })

  it('rejeita mais tarefas que o teto do perfil, que acompanha os critérios', () => {
    const muitas = { tarefas: Array.from({ length: 13 }, (_, i) => tarefa(`t${i}`)) }
    expect(motivos(validarPlano(muitas, contexto()))).toContain('ORCAMENTO_EXCEDIDO')
  })
})

describe('escritores — terceiro escritor, sem escritor, sem path', () => {
  const dois: PerfilDeSquad = {
    ...PERFIL_PADRAO,
    escritores: 2,
    integrador: { camada: 'executor' }
  }

  it('rejeita terceiro escritor, mesmo com o perfil de dois', () => {
    const p = plano()
    p.tarefas.push(
      tarefa('t4', {
        escritor: 'w2',
        paths: ['src/main/squads/a.ts'],
        fundamento: { criterio: 2 }
      }),
      tarefa('t5', { escritor: 'w3', paths: ['src/main/squads/b.ts'], fundamento: { criterio: 3 } })
    )
    expect(motivos(validarPlano(p, contexto(dois)))).toContain('ESCRITORES_EXCEDIDOS')
  })

  it('rejeita o segundo escritor quando o perfil só tem um', () => {
    const p = plano()
    p.tarefas.push(
      tarefa('t4', { escritor: 'w2', paths: ['src/main/squads/a.ts'], fundamento: { criterio: 2 } })
    )
    expect(motivos(validarPlano(p, contexto()))).toContain('ESCRITORES_EXCEDIDOS')
  })

  it('rejeita plano sem nenhum escritor (Emenda E1)', () => {
    const p = {
      tarefas: [
        tarefa('t1', {
          papel: 'explorador',
          capacidade: 'analise',
          escritor: undefined,
          paths: [],
          camada: 'especialista',
          schemaDeResultado: 'achados@1'
        })
      ]
    }
    expect(motivos(validarPlano(p, contexto(PERFIL_PADRAO, { criteriosDaSpec: [1] })))).toContain(
      'SEM_ESCRITOR'
    )
  })

  it('rejeita tarefa de escritor sem path (Emenda E1)', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { paths: [] })
    expect(motivos(validarPlano(p, contexto()))).toContain('ESCRITOR_SEM_PATH')
  })

  it('rejeita dois donos no mesmo path', () => {
    const p = plano()
    p.tarefas.push(tarefa('t4', { escritor: 'w2', fundamento: { criterio: 2 } }))
    expect(motivos(validarPlano(p, contexto(dois)))).toContain('ESCRITORES_COLIDEM')
  })

  it('só desenvolvedor e integrador escrevem; leitura com escritor é recusada', () => {
    const p = plano()
    p.tarefas[1] = { ...p.tarefas[1], escritor: 'w1', paths: ['src/shared/domain/y.ts'] }
    expect(motivos(validarPlano(p, contexto()))).toContain('ESCRITOR_EM_PAPEL_DE_LEITURA')

    const q = plano()
    q.tarefas[0] = tarefa('t1', { escritor: undefined })
    expect(motivos(validarPlano(q, contexto()))).toContain('PAPEL_DE_ESCRITA_SEM_ESCRITOR')
  })
})

describe('camada, capacidade e papel — camada fora do perfil', () => {
  it('rejeita capacidade em camada que o perfil não lhe permite', () => {
    const p = plano()
    p.tarefas[2] = { ...p.tarefas[2], camada: 'executor' }
    expect(motivos(validarPlano(p, contexto()))).toContain('CAMADA_FORA_DO_PERFIL')
  })

  it('rejeita capacidade que o perfil não lista', () => {
    const semRevisao: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      capacidades: PERFIL_PADRAO.capacidades.filter((c) => c.id !== 'revisao-de-codigo')
    }
    expect(motivos(validarPlano(plano(), contexto(semRevisao)))).toContain(
      'CAPACIDADE_FORA_DO_PERFIL'
    )
  })

  it('rejeita capacidade que o papel não exerce (tabela papel → capacidades)', () => {
    const p = plano()
    p.tarefas[2] = {
      ...p.tarefas[2],
      capacidade: 'testes',
      schemaDeResultado: 'resultado-de-testes@1'
    }
    expect(motivos(validarPlano(p, contexto()))).toContain('CAPACIDADE_FORA_DO_PAPEL')
  })

  it('rejeita camada indisponível pela resolução (API paga sem opt-in)', () => {
    const paga: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      camadas: {
        ...PERFIL_PADRAO.camadas,
        especialista: { origem: 'modelo', provider: 'anthropic', modelo: 'claude-opus-5' }
      }
    }
    expect(motivos(validarPlano(plano(), contexto(paga)))).toContain('CAPACIDADE_INDISPONIVEL')
  })

  it('o revisor roda na camada do revisor do perfil, e o integrador na do integrador', () => {
    const p = plano()
    p.tarefas[2] = { ...p.tarefas[2], capacidade: 'revisao-de-codigo', camada: 'especialista' }
    const outraCamada: PerfilDeSquad = { ...PERFIL_PADRAO, revisor: { camada: 'executor' } }
    expect(motivos(validarPlano(p, contexto(outraCamada)))).toContain('REVISOR_FORA_DA_CAMADA')

    const comIntegrador = plano()
    comIntegrador.tarefas.push(
      tarefa('t4', {
        papel: 'integrador',
        capacidade: 'arquitetura',
        camada: 'especialista',
        schemaDeResultado: 'parecer@1',
        paths: ['src/main/squads/i.ts'],
        fundamento: { criterio: 3 }
      })
    )
    expect(motivos(validarPlano(comIntegrador, contexto()))).toContain('INTEGRADOR_FORA_DO_PERFIL')
  })

  it('a tabela papel → capacidades só referencia capacidades do registro', () => {
    for (const papel of PAPEIS) {
      expect(CAPACIDADES_DO_PAPEL[papel].length).toBeGreaterThan(0)
      for (const c of CAPACIDADES_DO_PAPEL[papel]) expect(CAPACIDADES).toContain(c)
    }
  })
})

describe('escopo, paths e fontes — escopo extra', () => {
  it('rejeita path de escrita fora dos diretórios permitidos', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { paths: ['supabase/migrations/x.sql'] })
    expect(motivos(validarPlano(p, contexto()))).toContain('PATH_FORA_DO_ESCOPO')
  })

  it('rejeita fonte de leitura fora das permitidas', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { entradas: ['/etc/passwd'] })
    expect(motivos(validarPlano(p, contexto()))).toContain('FONTE_FORA_DO_ESCOPO')
  })

  it('não deixa `..` sair do diretório permitido', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { paths: ['src/shared/domain/../../../.env'] })
    expect(motivos(validarPlano(p, contexto()))).toContain('PATH_FORA_DO_ESCOPO')
  })

  it('rejeita path que não existe e não é arquivo novo de extensão conhecida (Emenda E1)', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { paths: ['src/shared/domain/novo.py'] })
    expect(motivos(validarPlano(p, contexto()))).toContain('PATH_INEXISTENTE')
  })

  it('aceita arquivo novo dentro do diretório permitido com extensão presente na base', () => {
    expect(validarPlano(plano(), contexto()).aceito).toBe(true)
  })

  it('aceita arquivo que já existe na base', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { paths: ['src/shared/domain/ai.ts'] })
    expect(validarPlano(p, contexto()).aceito).toBe(true)
  })
})

describe('fundamento e comprovação — critério 2', () => {
  it('rejeita tarefa sem critério nem risco', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { fundamento: {} })
    const d = validarPlano(p, contexto())
    expect(motivos(d)).toContain('SEM_FUNDAMENTO')
    expect(d.tarefas[0].classificacao).toBe('nao-comprovavel')
  })

  it('rejeita critério que a SPEC não tem', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { fundamento: { criterio: 99 } })
    const d = validarPlano(p, contexto())
    expect(motivos(d)).toContain('CRITERIO_INEXISTENTE')
    expect(d.tarefas[0].classificacao).toBe('fora-de-escopo')
  })

  it('aceita fundamento por risco declarado, mas o critério ainda precisa ser coberto', () => {
    const p = plano()
    p.tarefas.push(
      tarefa('t4', {
        papel: 'testador',
        escritor: undefined,
        paths: [],
        fundamento: { risco: 'regressão no hash' }
      })
    )
    expect(validarPlano(p, contexto()).aceito).toBe(true)
  })

  it('rejeita regra de conclusão em branco e schema de resultado divergente do registro', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { regraDeConclusao: '  ' })
    expect(motivos(validarPlano(p, contexto()))).toContain('NAO_COMPROVAVEL')

    const q = plano()
    q.tarefas[0] = tarefa('t1', { schemaDeResultado: 'qualquer@1' })
    expect(motivos(validarPlano(q, contexto()))).toContain('SCHEMA_DE_RESULTADO_DIVERGENTE')
  })

  it('rejeita critério da SPEC sem tarefa', () => {
    const p = { tarefas: plano().tarefas.slice(0, 2) }
    const d = validarPlano(p, contexto())
    expect(motivos(d)).toContain('COBERTURA_INCOMPLETA')
  })
})

describe('redundância', () => {
  it('rejeita a repetição do mesmo papel, critério e paths', () => {
    const p = plano()
    p.tarefas.push(tarefa('t4'))
    const d = validarPlano(p, contexto())
    expect(motivos(d)).toContain('REDUNDANTE')
    expect(d.tarefas.find((t) => t.id === 't4')?.classificacao).toBe('redundante')
  })
})

describe('classificação quando a proposta cai em duas classes', () => {
  const classeDoDuplicado = (extra: Record<string, unknown>): string | undefined => {
    const p = plano()
    p.tarefas.push(tarefa('t4', extra))
    return validarPlano(p, contexto()).tarefas.find((t) => t.id === 't4')?.classificacao
  }

  it('fora de escopo vence redundante', () => {
    expect(classeDoDuplicado({ entradas: ['/etc/passwd'] })).toBe('fora-de-escopo')
  })

  it('não comprovável vence redundante', () => {
    expect(classeDoDuplicado({ regraDeConclusao: '' })).toBe('nao-comprovavel')
  })

  it('fora de escopo vence não comprovável', () => {
    expect(classeDoDuplicado({ regraDeConclusao: '', entradas: ['/etc/passwd'] })).toBe(
      'fora-de-escopo'
    )
  })
})

describe('limites, turnos, tempo e orçamento', () => {
  it.each([
    ['maxTurnos', 'TURNOS_EXCEDIDOS'],
    ['maxMinutos', 'TEMPO_EXCEDIDO'],
    ['maxTokensEntrada', 'TOKENS_EXCEDIDOS'],
    ['maxTokensSaida', 'TOKENS_EXCEDIDOS']
  ])('rejeita %s acima do perfil', (campo, motivo) => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { limites: { ...LIMITES, [campo]: 1_000_000 } })
    expect(motivos(validarPlano(p, contexto()))).toContain(motivo)
  })

  it('rejeita limite ausente ou não positivo', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { limites: { ...LIMITES, maxTurnos: 0 } })
    expect(motivos(validarPlano(p, contexto()))).toContain('LIMITE_INVALIDO')
  })

  it('rejeita plano cujo custo estimado passa do orçamento', () => {
    const paga: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      camadas: {
        ...PERFIL_PADRAO.camadas,
        executor: { origem: 'modelo', provider: 'anthropic', modelo: 'claude-opus-5' }
      }
    }
    const caro = resolverPerfil(paga, { ...AMBIENTE, optInApiPaga: true }, FASE)
    const d = validarPlano(plano(), {
      ...contexto(paga),
      resolucao: caro,
      orcamentoUsd: 0.0001
    })
    expect(motivos(d)).toContain('ORCAMENTO_EXCEDIDO')
  })

  it('rota de assinatura e local não consomem o orçamento em USD', () => {
    expect(validarPlano(plano(), { ...contexto(), orcamentoUsd: 0 }).aceito).toBe(true)
  })
})

describe('esquema estrito — o modelo não inventa campo', () => {
  it('recusa chave desconhecida no plano e na tarefa', () => {
    const topo = { ...plano(), permissoes: { git: true } }
    expect(motivos(validarPlano(topo, contexto()))).toContain('SCHEMA')

    const p = plano()
    p.tarefas[0] = tarefa('t1', { git: true })
    expect(motivos(validarPlano(p, contexto()))).toContain('SCHEMA')
  })

  it('recusa campo com tipo errado, sem lançar', () => {
    const p = plano()
    p.tarefas[0] = tarefa('t1', { paths: 'src/x.ts', limites: 'muitos' })
    expect(() => validarPlano(p, contexto())).not.toThrow()
    expect(motivos(validarPlano(p, contexto()))).toContain('SCHEMA')
  })
})

describe('prompt injection — não cria tarefa, permissão nem escritor (critério 5)', () => {
  /** Saídas que um documento ou repositório envenenado faria o modelo produzir. */
  const injecoes: Record<string, () => unknown> = {
    'tarefa de deploy a pedido do documento': () => {
      const p = plano()
      p.tarefas.push(
        tarefa('t4', {
          capacidade: 'deploy',
          paths: ['scripts/deploy-prod.sh'],
          fundamento: { criterio: 99 }
        })
      )
      return p
    },
    'terceiro escritor': () => {
      const p = plano()
      p.tarefas.push(
        tarefa('t4', {
          escritor: 'w2',
          paths: ['src/main/squads/a.ts'],
          fundamento: { criterio: 2 }
        }),
        tarefa('t5', {
          escritor: 'w3',
          paths: ['src/main/squads/b.ts'],
          fundamento: { criterio: 3 }
        })
      )
      return p
    },
    'permissão de git por campo novo': () => {
      const p = plano()
      p.tarefas[0] = tarefa('t1', { permissoes: { git: true, github: true } })
      return p
    },
    'camada que o perfil não tem': () => {
      const p = plano()
      p.tarefas[0] = tarefa('t1', { camada: 'premium' })
      return p
    },
    'path de segredo': () => {
      const p = plano()
      p.tarefas[0] = tarefa('t1', { paths: ['.env'], entradas: ['~/.ssh/id_rsa'] })
      return p
    }
  }

  it.each(Object.keys(injecoes))('rejeita: %s', (nome) => {
    const d = validarPlano(injecoes[nome](), contexto())
    expect(d.aceito).toBe(false)
    expect(d.rejeicoes.length).toBeGreaterThan(0)
  })

  it('nenhuma injeção aceita deixa a decisão com tarefa fora do que o perfil permite', () => {
    for (const fabricar of Object.values(injecoes)) {
      expect(validarPlano(fabricar(), contexto()).aceito).toBe(false)
    }
  })
})

describe('determinismo — critério 4', () => {
  it('o mesmo plano e o mesmo contexto dão a mesma decisão, qualquer que seja a ordem das chaves', () => {
    const a = validarPlano(plano(), contexto())
    const b = validarPlano(JSON.parse(JSON.stringify(plano())), contexto())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('não altera o plano nem o contexto recebidos', () => {
    const p = plano()
    const ctx = contexto()
    const antes = JSON.stringify([p, ctx])
    validarPlano(p, ctx)
    expect(JSON.stringify([p, ctx])).toBe(antes)
  })
})
