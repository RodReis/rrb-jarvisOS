import { describe, expect, it } from 'vitest'
import {
  validarPlano,
  type ContextoDeValidacao,
  type MotivoDeRejeicao,
  type TarefaDoPlano
} from './squad-plan'

const ctx: ContextoDeValidacao = {
  criteriosDaSpec: [1, 2],
  capacidadesPermitidas: ['ler-repositorio', 'escrever-codigo', 'rodar-testes'],
  camadasPermitidas: ['local', 'fase'],
  pathsPermitidos: ['src/main/executors', 'docs/spec'],
  maxEscritores: 2,
  maxTarefas: 6
}

const tarefa = (sobre: Partial<TarefaDoPlano> & { id: string }): TarefaDoPlano => ({
  papel: 'desenvolvedor',
  capacidade: 'escrever-codigo',
  camada: 'local',
  dependencias: [],
  paths: ['src/main/executors/a.ts'],
  fundamento: { criterio: 1 },
  regraDeConclusao: 'teste do critério passa',
  ...sobre
})

const plano = (...tarefas: TarefaDoPlano[]): { tarefas: TarefaDoPlano[] } => ({ tarefas })

const minimo = plano(
  tarefa({ id: 't1', escritor: 'W1' }),
  tarefa({
    id: 't2',
    escritor: 'W1',
    paths: ['src/main/executors/b.ts'],
    fundamento: { criterio: 2 },
    dependencias: ['t1']
  })
)

const motivos = (bruto: unknown): MotivoDeRejeicao[] =>
  validarPlano(bruto, ctx).rejeicoes.map((r) => r.motivo)

describe('validarPlano', () => {
  it('aceita o plano mínimo válido', () => {
    expect(validarPlano(minimo, ctx)).toEqual({ aceito: true, rejeicoes: [] })
  })

  it('rejeita ciclo', () => {
    const ciclico = plano(
      tarefa({ id: 't1', dependencias: ['t2'] }),
      tarefa({
        id: 't2',
        dependencias: ['t1'],
        paths: ['docs/spec/x.md'],
        fundamento: { criterio: 2 }
      })
    )
    expect(motivos(ciclico)).toContain('CICLO')
  })

  it('rejeita path fora do escopo da fatia', () => {
    const extra = plano(
      tarefa({ id: 't1', paths: ['src/renderer/tela.tsx'] }),
      tarefa({ id: 't2', fundamento: { criterio: 2 } })
    )
    expect(motivos(extra)).toContain('PATH_FORA_DO_ESCOPO')
  })

  it('não confunde prefixo de nome com diretório permitido', () => {
    const quase = plano(
      tarefa({ id: 't1', paths: ['src/main/executors-extra/a.ts'] }),
      tarefa({ id: 't2', fundamento: { criterio: 2 } })
    )
    expect(motivos(quase)).toContain('PATH_FORA_DO_ESCOPO')
  })

  it('rejeita o terceiro escritor', () => {
    const tres = plano(
      tarefa({ id: 't1', escritor: 'W1', paths: ['src/main/executors/a.ts'] }),
      tarefa({
        id: 't2',
        escritor: 'W2',
        paths: ['src/main/executors/b.ts'],
        fundamento: { criterio: 2 }
      }),
      tarefa({ id: 't3', escritor: 'W3', paths: ['docs/spec/c.md'], fundamento: { criterio: 2 } })
    )
    expect(motivos(tres)).toContain('ESCRITORES_EXCEDIDOS')
  })

  it('rejeita dois escritores no mesmo path', () => {
    const colide = plano(
      tarefa({ id: 't1', escritor: 'W1' }),
      tarefa({ id: 't2', escritor: 'W2', fundamento: { criterio: 2 } })
    )
    expect(motivos(colide)).toContain('ESCRITORES_COLIDEM')
  })

  it('rejeita camada fora do perfil', () => {
    const premium = plano(
      tarefa({ id: 't1', camada: 'premium' }),
      tarefa({ id: 't2', fundamento: { criterio: 2 } })
    )
    expect(motivos(premium)).toContain('CAMADA_NAO_PERMITIDA')
  })

  it('rejeita capacidade fora do perfil', () => {
    const cap = plano(
      tarefa({ id: 't1', capacidade: 'push-remoto' }),
      tarefa({ id: 't2', fundamento: { criterio: 2 } })
    )
    expect(motivos(cap)).toContain('CAPACIDADE_NAO_PERMITIDA')
  })

  it('rejeita critério da SPEC sem tarefa', () => {
    expect(motivos(plano(tarefa({ id: 't1' })))).toContain('COBERTURA_INCOMPLETA')
  })

  it('rejeita tarefa sem fundamento e fundamento que aponta critério inexistente', () => {
    const sem = plano(
      tarefa({ id: 't1', fundamento: {} }),
      tarefa({ id: 't2', fundamento: { criterio: 9 } }),
      tarefa({ id: 't3', fundamento: { criterio: 2 }, paths: ['docs/spec/z.md'] })
    )
    const m = motivos(sem)
    expect(m).toContain('SEM_FUNDAMENTO')
    expect(m).toContain('CRITERIO_INEXISTENTE')
  })

  it('rejeita tarefa não comprovável, repetida, de id duplicado e dependência inexistente', () => {
    const ruim = plano(
      tarefa({ id: 't1', regraDeConclusao: '  ' }),
      tarefa({ id: 't1', fundamento: { criterio: 2 }, dependencias: ['fantasma'] }),
      tarefa({ id: 't3', fundamento: { criterio: 2 }, dependencias: [] })
    )
    const m = motivos(ruim)
    expect(m).toEqual(
      expect.arrayContaining([
        'NAO_COMPROVAVEL',
        'ID_DUPLICADO',
        'DEPENDENCIA_INEXISTENTE',
        'REDUNDANTE'
      ])
    )
  })

  it('rejeita plano acima do orçamento de tarefas', () => {
    const muitas = plano(
      ...Array.from({ length: 7 }, (_, i) =>
        tarefa({ id: `t${i}`, paths: [`docs/spec/${i}.md`], fundamento: { criterio: (i % 2) + 1 } })
      )
    )
    expect(motivos(muitas)).toContain('ORCAMENTO_EXCEDIDO')
  })

  it.each([
    ['null', null],
    ['texto solto', 'Aqui está o plano: ...'],
    ['sem tarefas', { tarefas: [] }],
    ['papel inventado', { tarefas: [{ ...tarefa({ id: 't1' }), papel: 'mago' }] }],
    ['dependencias que não é lista', { tarefas: [{ ...tarefa({ id: 't1' }), dependencias: 't0' }] }]
  ])('saída malformada (%s) vira SCHEMA, sem lançar', (_nome, bruto) => {
    expect(motivos(bruto)).toEqual(['SCHEMA'])
  })

  it('é determinística: o mesmo plano e contexto dão a mesma decisão', () => {
    const ruim = plano(tarefa({ id: 't1', dependencias: ['t1'], camada: 'premium' }))
    expect(validarPlano(ruim, ctx)).toEqual(validarPlano(structuredClone(ruim), ctx))
  })
})
