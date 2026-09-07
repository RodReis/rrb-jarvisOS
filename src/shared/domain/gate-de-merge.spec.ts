import { describe, expect, it } from 'vitest'
import type { CheckNormalizado } from './github-automation'
import type { SnapshotDeRuleset } from './ruleset'
import { avaliarGateDeMerge, type EntradaDoGate } from './gate-de-merge'

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const OUTRO_SHA = 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1'

function check(parcial: Partial<CheckNormalizado> = {}): CheckNormalizado {
  return {
    nome: 'validacao',
    headSha: SHA,
    status: 'completed',
    conclusao: 'success',
    ...parcial
  }
}

const SNAPSHOT: SnapshotDeRuleset = {
  runId: 'run-1',
  branch: 'main',
  contexts: ['validacao'],
  strict: true,
  protegida: true,
  mergeQueueExigida: false,
  ref: 'RodReis/projeto/protection/main',
  observadoEm: '2026-09-02T10:00:00.000Z'
}

function entrada(parcial: Partial<EntradaDoGate> = {}): EntradaDoGate {
  return {
    headShaEsperado: SHA,
    headShaNaOrigem: SHA,
    checks: [check()],
    snapshot: SNAPSHOT,
    achadosAbertos: [],
    ...parcial
  }
}

describe('avaliarGateDeMerge — o caminho feliz', () => {
  it('todos os obrigatórios verdes no head esperado permite mergear', () => {
    expect(avaliarGateDeMerge(entrada()).reason).toBe('pode-mergear')
  })
})

describe('avaliarGateDeMerge — stale (critério 4)', () => {
  it('head divergente na origem impede o merge e pede reconciliação', () => {
    // O head andou depois da verificação: os checks que aprovaram são de outro commit. Mergear
    // aqui entraria com código que ninguém verificou — a garantia inteira do critério.
    const v = avaliarGateDeMerge(entrada({ headShaNaOrigem: OUTRO_SHA }))

    expect(v.reason).toBe('stale')
    expect(v).toMatchObject({ mensagem: expect.stringContaining(OUTRO_SHA) })
  })

  it('o stale vence até quando os checks do head esperado estão todos verdes', () => {
    // A ordem importa: avaliar os checks primeiro daria "pode-mergear" para um PR cujo head já
    // não é o que foi verificado.
    const v = avaliarGateDeMerge({
      ...entrada({ headShaNaOrigem: OUTRO_SHA }),
      checks: [check(), check({ nome: 'extra' })]
    })

    expect(v.reason).toBe('stale')
  })
})

describe('avaliarGateDeMerge — revisão (critério 2)', () => {
  it('P0 aberto impede o merge mesmo com CI verde', () => {
    const v = avaliarGateDeMerge(entrada({ achadosAbertos: [{ severidade: 'P0' }] }))

    expect(v.reason).toBe('bloqueado-externo')
    expect(v).toMatchObject({ acao: expect.stringMatching(/P0\/P1/) })
  })

  it('P1 aberto impede o merge mesmo com CI verde', () => {
    expect(avaliarGateDeMerge(entrada({ achadosAbertos: [{ severidade: 'P1' }] })).reason).toBe(
      'bloqueado-externo'
    )
  })

  it('P2 e P3 são registrados e não bloqueiam (REVIEW.md § Severidade baseline)', () => {
    // A baseline do REVIEW.md: P2/P3 registram, não bloqueiam automaticamente. Bloquear neles
    // faria o gate parar em melhoria comprovável, e a fatia nunca fecharia.
    const v = avaliarGateDeMerge(
      entrada({ achadosAbertos: [{ severidade: 'P2' }, { severidade: 'P3' }] })
    )

    expect(v.reason).toBe('pode-mergear')
  })

  it('conta os bloqueantes na mensagem, não só o primeiro', () => {
    const v = avaliarGateDeMerge(
      entrada({
        achadosAbertos: [{ severidade: 'P1' }, { severidade: 'P2' }, { severidade: 'P0' }]
      })
    )

    expect(v).toMatchObject({ mensagem: expect.stringContaining('2') })
  })
})

describe('avaliarGateDeMerge — merge queue (critério 12)', () => {
  it('merge queue exigida bloqueia com ação explicável, sem tentar contornar', () => {
    const v = avaliarGateDeMerge({
      ...entrada(),
      snapshot: { ...SNAPSHOT, mergeQueueExigida: true }
    })

    expect(v.reason).toBe('bloqueado-externo')
    expect(v).toMatchObject({ acao: expect.stringContaining('merge queue') })
  })

  it('a merge queue bloqueia mesmo com todos os obrigatórios verdes', () => {
    // A pipeline **não** tenta contorná-la: o repositório que a exige termina em bloqueio
    // externo, e o merge é da queue. Checks verdes não mudam isso.
    const v = avaliarGateDeMerge({
      ...entrada({ checks: [check()] }),
      snapshot: { ...SNAPSHOT, mergeQueueExigida: true }
    })

    expect(v.reason).toBe('bloqueado-externo')
  })
})

describe('avaliarGateDeMerge — ausência de regra não aprova (critério 10)', () => {
  it('branch sem proteção bloqueia, e a ação nomeia o que configurar', () => {
    const v = avaliarGateDeMerge({
      ...entrada({ checks: [] }),
      snapshot: { ...SNAPSHOT, protegida: false, contexts: [] }
    })

    expect(v.reason).toBe('bloqueado-externo')
    expect(v).toMatchObject({ acao: expect.stringContaining('Actions') })
  })

  it('proteção que não exige check nenhum também bloqueia', () => {
    // `protegida: true` com `contexts: []` é uma branch protegida que ninguém mandou verificar.
    // Sem check obrigatório não há verde: lista vazia nunca aprova.
    const v = avaliarGateDeMerge({
      ...entrada(),
      snapshot: { ...SNAPSHOT, contexts: [] }
    })

    expect(v.reason).toBe('bloqueado-externo')
  })

  it('nem um check verde extra faz uma proteção sem exigência aprovar', () => {
    // O engano que isto fecha: o repositório tem CI rodando, mas a proteção não a exige. O verde
    // existe e não é obrigatório — mergear com base nele seria confiar em regra que ninguém pôs.
    const v = avaliarGateDeMerge({
      ...entrada({ checks: [check({ nome: 'algum-ci' })] }),
      snapshot: { ...SNAPSHOT, contexts: [] }
    })

    expect(v.reason).toBe('bloqueado-externo')
  })
})

describe('avaliarGateDeMerge — o check pertence ao head (critério 3)', () => {
  it('check verde de outro commit não satisfaz o obrigatório', () => {
    const v = avaliarGateDeMerge(entrada({ checks: [check({ headSha: OUTRO_SHA })] }))

    expect(v.reason).toBe('bloqueado-externo')
    expect(v).toMatchObject({ mensagem: expect.stringContaining('validacao') })
  })

  it('obrigatório ausente entre os checks do head bloqueia e diz qual falta', () => {
    const v = avaliarGateDeMerge({
      ...entrada({ checks: [check()] }),
      snapshot: { ...SNAPSHOT, contexts: ['validacao', 'seguranca'] }
    })

    expect(v.reason).toBe('bloqueado-externo')
    expect(v).toMatchObject({ mensagem: expect.stringContaining('seguranca') })
  })

  it('obrigatório que falhou bloqueia', () => {
    const v = avaliarGateDeMerge(entrada({ checks: [check({ conclusao: 'failure' })] }))

    expect(v.reason).toBe('bloqueado-externo')
  })
})

describe('avaliarGateDeMerge — neutral e skipped (critério 11)', () => {
  it('skipped de check NÃO obrigatório não atrapalha', () => {
    const v = avaliarGateDeMerge(
      entrada({ checks: [check(), check({ nome: 'opcional', conclusao: 'skipped' })] })
    )

    expect(v.reason).toBe('pode-mergear')
  })

  it('skipped de check obrigatório NÃO satisfaz a regra da origem', () => {
    // A distinção que o critério 11 pede: `checksAprovam` trata `skipped` como não-falho, o que
    // continua certo para check opcional. Mas um obrigatório que decidiu não rodar não verificou
    // nada — e a regra da origem exige que ele conclua com sucesso.
    const v = avaliarGateDeMerge({
      ...entrada({ checks: [check(), check({ nome: 'seguranca', conclusao: 'skipped' })] }),
      snapshot: { ...SNAPSHOT, contexts: ['validacao', 'seguranca'] }
    })

    expect(v.reason).toBe('bloqueado-externo')
    expect(v).toMatchObject({ mensagem: expect.stringContaining('seguranca') })
  })

  it('neutral de check obrigatório também NÃO satisfaz', () => {
    const v = avaliarGateDeMerge(entrada({ checks: [check({ conclusao: 'neutral' })] }))

    expect(v.reason).toBe('bloqueado-externo')
  })

  it('neutral de check não obrigatório não atrapalha', () => {
    const v = avaliarGateDeMerge(
      entrada({ checks: [check(), check({ nome: 'opcional', conclusao: 'neutral' })] })
    )

    expect(v.reason).toBe('pode-mergear')
  })
})

describe('avaliarGateDeMerge — espera não é bloqueio', () => {
  it('obrigatório ainda correndo é aguardando, com a contagem', () => {
    const v = avaliarGateDeMerge(
      entrada({ checks: [check({ status: 'in_progress', conclusao: undefined })] })
    )

    expect(v.reason).toBe('aguardando')
    expect(v).toMatchObject({ pendentes: 1 })
  })

  it('obrigatório enfileirado também é aguardando', () => {
    const v = avaliarGateDeMerge(
      entrada({ checks: [check({ status: 'queued', conclusao: undefined })] })
    )

    expect(v.reason).toBe('aguardando')
  })

  it('um obrigatório correndo e outro que falhou é bloqueio, não espera', () => {
    // Esperar aqui seria esperar por um desfecho que já se conhece: o run não vai ficar verde.
    const v = avaliarGateDeMerge({
      ...entrada({
        checks: [
          check({ nome: 'validacao', conclusao: 'failure' }),
          check({ nome: 'seguranca', status: 'in_progress', conclusao: undefined })
        ]
      }),
      snapshot: { ...SNAPSHOT, contexts: ['validacao', 'seguranca'] }
    })

    expect(v.reason).toBe('bloqueado-externo')
  })

  it('obrigatórios verdes com um check não obrigatório pendente é aguardando', () => {
    // O check extra não é exigido pela origem, mas ainda está correndo no head. Mergear com ele
    // no ar descartaria um sinal que o repositório escolheu produzir.
    const v = avaliarGateDeMerge(
      entrada({
        checks: [check(), check({ nome: 'extra', status: 'in_progress', conclusao: undefined })]
      })
    )

    expect(v.reason).toBe('aguardando')
    expect(v).toMatchObject({ pendentes: 1 })
  })
})

describe('avaliarGateDeMerge — identidade da evidência (SPEC-Pipeline-01, critério 11)', () => {
  it('sem exigência declarada, decide como sempre decidiu', () => {
    // A §2 proíbe endurecer proteção por iniciativa própria: projeto que nunca declarou emissor
    // não passa a ser bloqueado por isso.
    const r = avaliarGateDeMerge(entrada({ checks: [check({ emissor: 'qualquer-um' })] }))
    expect(r.reason).toBe('pode-mergear')
  })

  it('check verde de emissor diferente do exigido não satisfaz o gate', () => {
    const r = avaliarGateDeMerge(
      entrada({
        checks: [check({ emissor: 'app-de-terceiro' })],
        exigenciaDeIdentidade: { emissorEsperado: 'github-actions' }
      })
    )
    expect(r.reason).toBe('bloqueado-externo')
  })

  it('check verde de tentativa antiga não satisfaz o gate', () => {
    const r = avaliarGateDeMerge(
      entrada({
        checks: [check({ tentativa: 1 })],
        exigenciaDeIdentidade: { tentativaCorrente: 2 }
      })
    )
    expect(r.reason).toBe('bloqueado-externo')
  })

  it('emissor e tentativa corretos continuam aprovando', () => {
    const r = avaliarGateDeMerge(
      entrada({
        checks: [check({ emissor: 'github-actions', tentativa: 2 })],
        exigenciaDeIdentidade: { emissorEsperado: 'github-actions', tentativaCorrente: 2 }
      })
    )
    expect(r.reason).toBe('pode-mergear')
  })

  it('origem que não informa emissor não vira bloqueio por ausência de dado', () => {
    // "A API não me contou" não pode virar bloqueio (§2), mas também não vira aprovação: as
    // três checagens de sempre continuam valendo, e um check vermelho segue reprovando.
    const r = avaliarGateDeMerge(
      entrada({ exigenciaDeIdentidade: { emissorEsperado: 'github-actions' } })
    )
    expect(r.reason).toBe('pode-mergear')

    const vermelho = avaliarGateDeMerge(
      entrada({
        checks: [check({ conclusao: 'failure' })],
        exigenciaDeIdentidade: { emissorEsperado: 'github-actions' }
      })
    )
    expect(vermelho.reason).toBe('bloqueado-externo')
  })

  it('a causa nomeia a identidade, não "não concluiu com sucesso"', () => {
    // Um check verde recusado por emissor, reportado como "sem sucesso", mandaria o leitor
    // investigar o log de um job que passou — o erro verdadeiro que esconde a causa.
    const r = avaliarGateDeMerge(
      entrada({
        checks: [check({ emissor: 'app-de-terceiro' })],
        exigenciaDeIdentidade: { emissorEsperado: 'github-actions' }
      })
    )
    if (r.reason !== 'bloqueado-externo') throw new Error('esperava bloqueado-externo')
    expect(r.mensagem).toContain('emissor-nao-confiavel')
    expect(r.mensagem).not.toContain('sem sucesso')
    expect(r.acao).toContain('emissor')
  })
})
