/**
 * O modelo por fase contra o banco de verdade (SPEC-Fases-02, critérios 2, 3 e 5).
 *
 * Cobre repositório, serviço e auditoria juntos — mesma escolha do `routing-repository.int-spec`:
 * a garantia que interessa ("a troca ficou gravada **e** deixou evento encadeado") atravessa as
 * três camadas, e testá-las separadas provaria cada metade sem provar a costura.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import type { ProjectModelOverride } from '@shared/domain/modelo-da-fase'
import { POLITICA_DE_MODELO_PADRAO } from '@shared/domain/modelo-da-fase'
import { openDatabase } from '../storage/database'
import { AuditRepository } from '../storage/audit-repository'
import { PhaseModelRepository } from './phase-model-repository'
import { PhaseModelService } from './phase-model-service'

const USUARIO = 'user-teste'
const PROJETO = 'proj-1'
const ESCOPO = { userId: USUARIO, workspace: 'jarvis' as const }

let dir: string
let db: Db
let repo: PhaseModelRepository
let audit: InstanceType<typeof AuditRepository>
let servico: PhaseModelService

/** Relógio fixo: o `updated_at` gravado não pode depender de quando o teste roda. */
const RELOGIO = 1_700_000_000_000

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-phase-model-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new PhaseModelRepository(db)
  audit = new AuditRepository(db, 'chave-de-teste')
  servico = new PhaseModelService(repo, audit, () => RELOGIO)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const override = (o: Partial<ProjectModelOverride> = {}): ProjectModelOverride => ({
  project_id: PROJETO,
  fase: 'construcao',
  rota: 'assinatura',
  provider: 'claude-code',
  modelo: 'claude-sonnet-5',
  ...o
})

function mudancas(): readonly Record<string, unknown>[] {
  return audit
    .list(USUARIO)
    .filter((e) => e.type === 'phase-model-change')
    .map((e) => e.payload as Record<string, unknown>)
}

describe('padrão valendo sem linha gravada', () => {
  it('banco vazio devolve a política padrão, sem semear linha por usuário', () => {
    expect(servico.politica(ESCOPO).fases).toEqual(POLITICA_DE_MODELO_PADRAO)
  })

  it('editar um combo não faz os outros cinco sumirem', () => {
    servico.setModeloDaFase(ESCOPO, 'planejamento', 'assinatura', 'claude-code', 'claude-opus-5')

    const fases = servico.politica(ESCOPO).fases
    expect(fases.planejamento.assinatura.modelo).toBe('claude-opus-5')
    expect(fases.especificacao.assinatura.modelo).toBe('claude-fable-5-1')
    expect(fases.construcao.assinatura.modelo).toBe('claude-opus-5')
    expect(fases.planejamento.paga.modelo).toBe('claude-opus-5')
  })

  it('gravar não muta a constante do padrão para o processo inteiro', () => {
    servico.setModeloDaFase(ESCOPO, 'construcao', 'assinatura', 'claude-code', 'claude-sonnet-5')

    expect(POLITICA_DE_MODELO_PADRAO.construcao.assinatura.modelo).toBe('claude-opus-5')
  })
})

describe('override do projeto vence o workspace (critério 3)', () => {
  it('com override, `resolver` devolve o par do projeto', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())

    expect(servico.resolver(ESCOPO, 'construcao', 'assinatura', PROJETO).modelo).toBe(
      'claude-sonnet-5'
    )
  })

  it('sem `projectId`, `resolver` ignora o override e devolve o workspace', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())

    expect(servico.resolver(ESCOPO, 'construcao', 'assinatura').modelo).toBe('claude-opus-5')
  })

  it('remover o override volta ao workspace', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())
    servico.setModeloDaFase(ESCOPO, 'construcao', 'assinatura', 'claude-code', 'claude-fable-5-1')

    expect(servico.removerOverride(ESCOPO, PROJETO, 'construcao', 'assinatura')).toBe(true)
    expect(servico.resolver(ESCOPO, 'construcao', 'assinatura', PROJETO).modelo).toBe(
      'claude-fable-5-1'
    )
  })

  it('override de um projeto não vaza para outro', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())

    expect(servico.resolver(ESCOPO, 'construcao', 'assinatura', 'proj-2').modelo).toBe(
      'claude-opus-5'
    )
  })

  it('override não vaza entre workspaces: o escopo entra em toda consulta', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())

    expect(
      servico.resolver({ userId: USUARIO, workspace: 'noa' }, 'construcao', 'assinatura', PROJETO)
        .modelo
    ).toBe('claude-opus-5')
  })

  it('política não vaza entre usuários', () => {
    servico.setModeloDaFase(ESCOPO, 'construcao', 'assinatura', 'claude-code', 'claude-sonnet-5')

    expect(
      servico.resolver({ userId: 'outro', workspace: 'jarvis' }, 'construcao', 'assinatura').modelo
    ).toBe('claude-opus-5')
  })
})

describe('o catálogo é a fronteira (critério 4)', () => {
  it('Fable na rota paga é recusado e nada é gravado', () => {
    expect(
      servico.setModeloDaFase(ESCOPO, 'construcao', 'paga', 'anthropic', 'claude-fable-5-1')
    ).toBeUndefined()

    expect(servico.resolver(ESCOPO, 'construcao', 'paga').modelo).toBe('claude-opus-5')
  })

  it('override com modelo fora do catálogo é recusado e nada é gravado', () => {
    expect(
      servico.setOverrideDoProjeto(
        ESCOPO,
        override({ provider: 'anthropic', modelo: 'claude-fable-5-1' })
      )
    ).toBeUndefined()

    expect(servico.overrides(ESCOPO, PROJETO)).toHaveLength(0)
  })

  it('linha gravada com modelo que saiu do catálogo degrada para o padrão, sem lançar', () => {
    // Escrita direta: é o cenário de um catálogo que encolheu depois de a linha existir, que
    // nenhum caminho do serviço consegue produzir — e é justamente o que a leitura precisa
    // aguentar sem derrubar a geração.
    db.prepare(
      `INSERT INTO phase_model_policy
         (user_id, workspace_id, fase, rota, provider, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(USUARIO, 'jarvis', 'construcao', 'assinatura', 'claude-code', 'modelo-morto', 'ontem')

    expect(servico.resolver(ESCOPO, 'construcao', 'assinatura').modelo).toBe('claude-opus-5')
  })
})

describe('toda troca é auditada e a cadeia fecha (critério 5)', () => {
  it('troca no workspace registra escopo, fase, rota e o antes/depois', () => {
    servico.setModeloDaFase(ESCOPO, 'construcao', 'assinatura', 'claude-code', 'claude-sonnet-5')

    expect(mudancas()[0]).toMatchObject({
      escopo: 'workspace',
      fase: 'construcao',
      rota: 'assinatura',
      de: { provider: 'claude-code', modelo: 'claude-opus-5' },
      para: { provider: 'claude-code', modelo: 'claude-sonnet-5' }
    })
  })

  it('troca no projeto registra o projeto e o que valia para ele', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())

    expect(mudancas()[0]).toMatchObject({
      escopo: 'projeto',
      projectId: PROJETO,
      de: { modelo: 'claude-opus-5' },
      para: { modelo: 'claude-sonnet-5' }
    })
  })

  it('o `de` do segundo override é o override anterior, não o workspace', () => {
    servico.setOverrideDoProjeto(ESCOPO, override({ modelo: 'claude-sonnet-5' }))
    servico.setOverrideDoProjeto(ESCOPO, override({ modelo: 'claude-fable-5-1' }))

    expect(mudancas()[1]).toMatchObject({
      de: { modelo: 'claude-sonnet-5' },
      para: { modelo: 'claude-fable-5-1' }
    })
  })

  it('remover o override marca `herda`, distinguindo de escolher o mesmo par', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())
    servico.removerOverride(ESCOPO, PROJETO, 'construcao', 'assinatura')

    expect(mudancas()[1]).toMatchObject({ herda: true, para: { modelo: 'claude-opus-5' } })
  })

  it('troca recusada NÃO é auditada: registrar o que não aconteceu faria a auditoria mentir', () => {
    servico.setModeloDaFase(ESCOPO, 'construcao', 'paga', 'anthropic', 'claude-fable-5-1')
    servico.setOverrideDoProjeto(ESCOPO, override({ modelo: 'nao-existe' }))

    expect(mudancas()).toHaveLength(0)
  })

  it('remover override inexistente NÃO é auditado: a segunda remoção não aconteceu', () => {
    servico.setOverrideDoProjeto(ESCOPO, override())
    servico.removerOverride(ESCOPO, PROJETO, 'construcao', 'assinatura')

    expect(servico.removerOverride(ESCOPO, PROJETO, 'construcao', 'assinatura')).toBe(false)
    expect(mudancas()).toHaveLength(2)
  })

  it('a cadeia HMAC fecha depois de todas as trocas', () => {
    servico.setModeloDaFase(ESCOPO, 'planejamento', 'assinatura', 'claude-code', 'claude-opus-5')
    servico.setOverrideDoProjeto(ESCOPO, override())
    servico.removerOverride(ESCOPO, PROJETO, 'construcao', 'assinatura')

    expect(audit.verify(USUARIO).ok).toBe(true)
  })
})
