import { describe, expect, it } from 'vitest'
import type { PerfilDeSquad, ResultadoDaValidacao } from './squad-perfil'
import { CAPACIDADES, REGISTRO_DE_CAPACIDADES } from './squad-capacidades'
import { ACOES_COM_APROVACAO, PERFIL_PADRAO, limitesDoPerfil, validarPerfil } from './squad-perfil'

/** Um perfil válido, derivado do padrão — cada teste estraga uma coisa só. */
function perfil(sobrescrita: Record<string, unknown> = {}): unknown {
  return { ...structuredClone(PERFIL_PADRAO), ...sobrescrita }
}

function codigos(r: ResultadoDaValidacao): readonly string[] {
  return r.ok ? [] : r.problemas.map((p) => p.codigo)
}

describe('registro de capacidades', () => {
  it('tem uma definição para cada capacidade, com o id certo e ao menos um fallback', () => {
    for (const id of CAPACIDADES) {
      const def = REGISTRO_DE_CAPACIDADES[id]
      expect(def.id).toBe(id)
      expect(def.fallbacks.length).toBeGreaterThan(0)
      expect(def.schemaDeResultado).toMatch(/^[a-z-]+@\d+$/)
    }
  })
})

describe('validarPerfil — critério 1 (versionado e validado)', () => {
  it('aceita o perfil padrão e devolve o mesmo conteúdo', () => {
    const r = validarPerfil(PERFIL_PADRAO)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.perfil).toEqual(PERFIL_PADRAO)
  })

  it('recusa schema de outra versão em vez de converter', () => {
    expect(codigos(validarPerfil(perfil({ schema: 2 })))).toContain('VERSAO_DE_SCHEMA_DESCONHECIDA')
  })

  it('recusa o que não é objeto, sem lançar', () => {
    for (const lixo of [null, undefined, 42, 'perfil', []]) {
      expect(codigos(validarPerfil(lixo))).toEqual(['SCHEMA'])
    }
  })

  it('devolve todos os problemas de uma vez, não só o primeiro', () => {
    const r = validarPerfil(perfil({ escritores: 5, tipoDeFatia: '' }))
    expect(codigos(r)).toEqual(expect.arrayContaining(['ESCRITORES_EXCEDIDOS', 'TIPO_INVALIDO']))
  })

  it('recusa capacidade desconhecida e capacidade repetida', () => {
    const base = PERFIL_PADRAO.capacidades[0]
    expect(
      codigos(validarPerfil(perfil({ capacidades: [{ ...base, id: 'telepatia' }] })))
    ).toContain('CAPACIDADE_DESCONHECIDA')
    expect(codigos(validarPerfil(perfil({ capacidades: [base, base] })))).toContain(
      'CAPACIDADE_DUPLICADA'
    )
  })

  it('recusa capacidade sem camada permitida', () => {
    const base = PERFIL_PADRAO.capacidades[0]
    expect(codigos(validarPerfil(perfil({ capacidades: [{ ...base, camadas: [] }] })))).toContain(
      'CAMADA_INVALIDA'
    )
    expect(
      codigos(validarPerfil(perfil({ capacidades: [{ ...base, camadas: ['cozinha'] }] })))
    ).toContain('CAMADA_INVALIDA')
  })

  it('recusa modelo explícito que o catálogo não tem — Fable pela API paga não existe', () => {
    const r = validarPerfil(
      perfil({
        camadas: {
          ...PERFIL_PADRAO.camadas,
          especialista: { origem: 'modelo', provider: 'anthropic', modelo: 'claude-fable-5-1' }
        }
      })
    )
    expect(codigos(r)).toContain('MODELO_FORA_DO_CATALOGO')
  })

  it('aceita Fable pela rota de assinatura', () => {
    const r = validarPerfil(
      perfil({
        camadas: {
          ...PERFIL_PADRAO.camadas,
          especialista: { origem: 'modelo', provider: 'claude-code', modelo: 'claude-fable-5-1' }
        }
      })
    )
    expect(r.ok).toBe(true)
  })
})

describe('validarPerfil — critério 3 (escritores, integrador, Git/GitHub)', () => {
  it('recusa mais de 2 escritores, mesmo com o multi-escritor ligado', () => {
    const r = validarPerfil(perfil({ escritores: 3 }), { multiEscritor: true })
    expect(codigos(r)).toContain('ESCRITORES_EXCEDIDOS')
  })

  it('recusa 2 escritores por padrão (ADR-006, decisão 16) e aceita no E2E de teste', () => {
    const dois = perfil({ escritores: 2, integrador: { camada: 'executor' } })
    expect(codigos(validarPerfil(dois))).toContain('MULTI_ESCRITOR_DESLIGADO')
    expect(validarPerfil(dois, { multiEscritor: true }).ok).toBe(true)
  })

  it('exige integrador quando há 2 escritores', () => {
    const r = validarPerfil(perfil({ escritores: 2, integrador: undefined }), {
      multiEscritor: true
    })
    expect(codigos(r)).toContain('INTEGRADOR_AUSENTE')
  })

  it('recusa integrador na mesma camada do revisor', () => {
    const r = validarPerfil(
      perfil({
        escritores: 2,
        revisor: { camada: 'especialista' },
        integrador: { camada: 'especialista' }
      }),
      { multiEscritor: true }
    )
    expect(codigos(r)).toContain('INTEGRADOR_NA_CAMADA_DO_REVISOR')
  })

  it('recusa integrador declarado com um escritor só — não há o que integrar', () => {
    const r = validarPerfil(perfil({ escritores: 1, integrador: { camada: 'executor' } }))
    expect(codigos(r)).toContain('INTEGRADOR_SEM_SEGUNDO_ESCRITOR')
  })

  it.each(['git', 'github'] as const)('recusa qualquer função com permissão de %s', (campo) => {
    for (const funcao of ['leitura', 'escritor', 'integrador'] as const) {
      const acesso = {
        ...PERFIL_PADRAO.acessoPorFuncao,
        [funcao]: { ...PERFIL_PADRAO.acessoPorFuncao[funcao], [campo]: true }
      }
      const r = validarPerfil(perfil({ acessoPorFuncao: acesso }))
      expect(codigos(r), `${funcao}.${campo}`).toContain('PERMISSAO_GIT_GITHUB')
    }
  })

  it('não concede escrita a quem só lê (regra 3)', () => {
    const acesso = {
      ...PERFIL_PADRAO.acessoPorFuncao,
      leitura: { escrita: true, git: false, github: false }
    }
    expect(codigos(validarPerfil(perfil({ acessoPorFuncao: acesso })))).toContain(
      'ACESSO_SUPERIOR_A_FUNCAO'
    )
  })

  it('exige as três ações sujeitas à aprovação do PI — fail closed', () => {
    for (const acao of ACOES_COM_APROVACAO) {
      const sem = ACOES_COM_APROVACAO.filter((a) => a !== acao)
      expect(codigos(validarPerfil(perfil({ aprovacoes: sem })))).toContain('APROVACAO_AUSENTE')
    }
  })
})

describe('validarPerfil — orquestrador local (SPEC-Squads-02, Emenda E1)', () => {
  const local = (extra: Record<string, unknown> = {}): unknown =>
    perfil({
      camadas: {
        ...PERFIL_PADRAO.camadas,
        orquestrador: { origem: 'modelo', provider: 'ollama', modelo: 'qwen3:8b', ...extra }
      }
    })

  it('recusa o local sem o validador endurecido declarado', () => {
    expect(codigos(validarPerfil(local()))).toContain('LOCAL_SEM_VALIDADOR_E1')
  })

  it('aceita o local com o validador E1 e aceita tag que o produto não cataloga', () => {
    expect(validarPerfil(local({ validador: 'e1' })).ok).toBe(true)
    expect(validarPerfil(local({ validador: 'e1', modelo: 'hermes3:8b' })).ok).toBe(true)
  })

  it('o padrão do orquestrador é o modelo da fase, não o local', () => {
    expect(PERFIL_PADRAO.camadas.orquestrador).toEqual({ origem: 'fase' })
  })
})

describe('limitesDoPerfil — critério 4 (limites antes de instanciar)', () => {
  it('conta um slot por escritor', () => {
    expect(limitesDoPerfil(PERFIL_PADRAO, 6).slots).toBe(1)
    expect(limitesDoPerfil({ ...PERFIL_PADRAO, escritores: 2 }, 6).slots).toBe(2)
  })

  it('o teto de tarefas é max(mínimo, critérios) — a lição da M11-F00', () => {
    const minimo = PERFIL_PADRAO.limites.maxTarefasMinimo
    expect(limitesDoPerfil(PERFIL_PADRAO, 3).maxTarefas).toBe(minimo)
    expect(limitesDoPerfil(PERFIL_PADRAO, minimo + 1).maxTarefas).toBe(minimo + 1)
  })
})

describe('perfil é dado imutável', () => {
  it('o perfil padrão está congelado', () => {
    expect(Object.isFrozen(PERFIL_PADRAO)).toBe(true)
    expect(Object.isFrozen(PERFIL_PADRAO.capacidades)).toBe(true)
  })

  it('validar não altera a entrada', () => {
    const entrada = structuredClone(PERFIL_PADRAO) as PerfilDeSquad
    const antes = JSON.stringify(entrada)
    validarPerfil(entrada)
    expect(JSON.stringify(entrada)).toBe(antes)
  })
})
