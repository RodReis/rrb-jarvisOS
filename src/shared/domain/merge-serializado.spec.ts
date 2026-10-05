import { describe, expect, it } from 'vitest'
import type { RegraObservada, SnapshotDeRuleset } from './ruleset'
import {
  chaveDoMerge,
  decidirMerge,
  ehRecursoDeMerge,
  lerRecursoDeMerge,
  recursoDoMerge,
  type AvaliacaoDoMerge,
  type ObservacaoDoMerge
} from './merge-serializado'

/**
 * SPEC-Scheduler-04 — núcleo puro do merge serializado.
 *
 * Categoria: Regras de Negócio. Não há I/O aqui: a pergunta é "dado o que a pipeline avaliou e o
 * que a origem mostra agora, o merge pode sair?", e quem responde é uma função.
 */

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

const REGRA: RegraObservada = {
  contexts: ['ci'],
  strict: false,
  protegida: true,
  mergeQueueExigida: false
}

const SNAPSHOT: SnapshotDeRuleset = {
  runId: 'run-1',
  branch: 'main',
  ...REGRA,
  ref: 'ref',
  observadoEm: '2026-10-04T00:00:00.000Z'
}

const AVALIACAO: AvaliacaoDoMerge = { headSha: SHA_A, baseSha: SHA_B, snapshot: SNAPSHOT }

const ABERTO: ObservacaoDoMerge = {
  estado: 'aberto',
  headSha: SHA_A,
  baseSha: SHA_B,
  regra: REGRA,
  atrasadoPor: 0
}

describe('recurso do MergeLease', () => {
  it('é um por repositório e branch-base, e ignora a caixa de dono e repo', () => {
    expect(recursoDoMerge('RodReis', 'Jarvis', 'main')).toBe('merge:rodreis/jarvis:main')
    expect(recursoDoMerge('rodreis', 'jarvis', 'main')).toBe(
      recursoDoMerge('RodReis', 'Jarvis', 'main')
    )
  })

  it('mantém a caixa do branch: main e Main são refs diferentes', () => {
    expect(recursoDoMerge('o', 'r', 'Main')).not.toBe(recursoDoMerge('o', 'r', 'main'))
  })

  it('bases diferentes do mesmo repositório não disputam o mesmo lease', () => {
    expect(recursoDoMerge('o', 'r', 'main')).not.toBe(recursoDoMerge('o', 'r', 'release/1.0'))
  })

  it('reconhece o prefixo e não confunde com slot ou worktree', () => {
    expect(ehRecursoDeMerge('merge:o/r:main')).toBe(true)
    expect(ehRecursoDeMerge('wip:slot:1')).toBe(false)
    expect(ehRecursoDeMerge('worktree:abc')).toBe(false)
  })

  it('lê de volta dono, repositório e base, inclusive base com barra', () => {
    expect(lerRecursoDeMerge(recursoDoMerge('o', 'r', 'release/1.0'))).toEqual({
      owner: 'o',
      repo: 'r',
      branchBase: 'release/1.0'
    })
  })

  it('recurso malformado não é interpretado', () => {
    expect(lerRecursoDeMerge('merge:sem-base')).toBeUndefined()
    expect(lerRecursoDeMerge('wip:slot:1')).toBeUndefined()
  })
})

describe('chave de idempotência do merge', () => {
  it('é determinística: o retry depois do crash repete a chave, não inventa outra', () => {
    expect(chaveDoMerge('o', 'r', 7, SHA_A)).toBe(chaveDoMerge('o', 'r', 7, SHA_A))
  })

  it('muda com o head: o merge de outro commit é outra intenção', () => {
    expect(chaveDoMerge('o', 'r', 7, SHA_A)).not.toBe(chaveDoMerge('o', 'r', 7, SHA_B))
  })

  it('muda com o PR e com o repositório', () => {
    expect(chaveDoMerge('o', 'r', 7, SHA_A)).not.toBe(chaveDoMerge('o', 'r', 8, SHA_A))
    expect(chaveDoMerge('o', 'r', 7, SHA_A)).not.toBe(chaveDoMerge('o', 'x', 7, SHA_A))
  })
})

describe('decidirMerge', () => {
  it('nada mudou: pode mergear', () => {
    expect(decidirMerge(AVALIACAO, ABERTO)).toEqual({ reason: 'pode-mergear' })
  })

  it('PR já mergeado na origem: adota o mergeSha em vez de mergear de novo', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, estado: 'mergeado', mergeSha: SHA_C })).toEqual({
      reason: 'ja-mergeado',
      mergeSha: SHA_C
    })
  })

  it('PR marcado como mergeado sem mergeSha não é confirmação', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, estado: 'mergeado' }).reason).toBe(
      'observacao-incompleta'
    )
  })

  it('PR fechado sem merge não é mergeado nem revalidado', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, estado: 'fechado' })).toEqual({
      reason: 'pr-fechado'
    })
  })

  it('o head andou: os checks aprovaram outro commit', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, headSha: SHA_C })).toEqual({
      reason: 'head-mudou',
      headSha: SHA_C
    })
  })

  it('head ilegível não é afirmação de que nada mudou', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, headSha: undefined }).reason).toBe(
      'observacao-incompleta'
    )
  })

  it('a regra da origem mudou desde o snapshot', () => {
    expect(
      decidirMerge(AVALIACAO, { ...ABERTO, regra: { ...REGRA, contexts: ['ci', 'lint'] } })
    ).toEqual({ reason: 'regra-mudou' })
  })

  it('regra ilegível é observação incompleta, nunca regra igual', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, regra: undefined }).reason).toBe(
      'observacao-incompleta'
    )
  })

  it('a base avançou depois da avaliação', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, baseSha: SHA_C })).toEqual({
      reason: 'base-avancou',
      baseSha: SHA_C
    })
  })

  describe('o PR que não contém a base atual (a origem diz quantos commits faltam)', () => {
    it('atrasado: a base avançou para este head, mesmo que ela não tenha mudado desde a avaliação', () => {
      // A avaliação leu a base **depois** de o vizinho mergear: baseSha igual nos dois lados. Foi
      // o PR que ficou para trás — o CI dele rodou sem o commit do vizinho.
      expect(decidirMerge(AVALIACAO, { ...ABERTO, atrasadoPor: 1 })).toEqual({
        reason: 'base-avancou',
        baseSha: SHA_B
      })
    })

    it('o adapter omite o campo em PR já mergeado ou fechado: a precedência impede o "incompleto"', () => {
      // Sem o `return` antecipado de `mergeado`/`fechado`, o PR que já entrou viraria
      // `observacao-incompleta` e o run nunca adotaria o merge nem iria a `MERGED`.
      expect(
        decidirMerge(AVALIACAO, {
          ...ABERTO,
          estado: 'mergeado',
          mergeSha: SHA_C,
          atrasadoPor: undefined
        }).reason
      ).toBe('ja-mergeado')
      expect(
        decidirMerge(AVALIACAO, { ...ABERTO, estado: 'fechado', atrasadoPor: undefined }).reason
      ).toBe('pr-fechado')
      expect(
        decidirMerge(AVALIACAO, { ...ABERTO, headSha: SHA_C, atrasadoPor: undefined }).reason
      ).toBe('head-mudou')
    })

    it('em dia (0) pode mergear', () => {
      expect(decidirMerge(AVALIACAO, { ...ABERTO, atrasadoPor: 0 })).toEqual({
        reason: 'pode-mergear'
      })
    })

    it('não saber (ausente) é observação incompleta, nunca "em dia": o merge não sai', () => {
      // O merge autônomo roda como o dono e a proteção `strict` não o barra: se a comparação
      // falhou (429, 5xx, rede) e a decisão seguisse, o PR atrasado entraria sobre uma base que o
      // CI dele nunca viu. Mesma postura de head e regra ilegíveis.
      expect(decidirMerge(AVALIACAO, { ...ABERTO, atrasadoPor: undefined })).toEqual({
        reason: 'observacao-incompleta',
        faltou: 'comparação base...head do pull request'
      })
    })

    it('atrasado com a base ilegível ainda manda atualizar: o que a origem disse basta', () => {
      expect(
        decidirMerge(AVALIACAO, { ...ABERTO, baseSha: undefined, atrasadoPor: 2 }).reason
      ).toBe('base-avancou')
    })

    it('a regra que mudou vence o atraso, como vence a base avançada', () => {
      expect(
        decidirMerge(AVALIACAO, { ...ABERTO, atrasadoPor: 1, regra: { ...REGRA, strict: true } })
          .reason
      ).toBe('regra-mudou')
    })
  })

  it('base ilegível não bloqueia: a M9-F05 manda preservar o PR e explicar a limitação', () => {
    expect(decidirMerge(AVALIACAO, { ...ABERTO, baseSha: undefined })).toEqual({
      reason: 'pode-mergear'
    })
    expect(decidirMerge({ ...AVALIACAO, baseSha: undefined }, ABERTO)).toEqual({
      reason: 'pode-mergear'
    })
  })

  it('sem snapshot da avaliação a regra não é comparável e o merge não sai', () => {
    expect(decidirMerge({ ...AVALIACAO, snapshot: undefined }, ABERTO).reason).toBe(
      'observacao-incompleta'
    )
  })

  describe('precedência quando mais de uma coisa mudou', () => {
    it('já mergeado vence tudo: o efeito aconteceu, o resto é detalhe', () => {
      expect(
        decidirMerge(AVALIACAO, {
          estado: 'mergeado',
          mergeSha: SHA_C,
          headSha: SHA_C,
          baseSha: SHA_C,
          regra: { ...REGRA, contexts: [] }
        }).reason
      ).toBe('ja-mergeado')
    })

    it('head mudou vence regra e base: o commit novo precisa de checks novos antes de tudo', () => {
      expect(
        decidirMerge(AVALIACAO, {
          ...ABERTO,
          headSha: SHA_C,
          baseSha: SHA_C,
          regra: { ...REGRA, strict: true }
        }).reason
      ).toBe('head-mudou')
    })

    it('regra mudou vence base avançada: a regra nova decide o que "verde" significa', () => {
      expect(
        decidirMerge(AVALIACAO, { ...ABERTO, baseSha: SHA_C, regra: { ...REGRA, strict: true } })
          .reason
      ).toBe('regra-mudou')
    })
  })
})
