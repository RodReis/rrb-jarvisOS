/**
 * As decisões puras da automação do GitHub (SPEC-Conectores-04, categoria Regras).
 *
 * O que estes testes provam sem tocar a rede: que um check de outro SHA **não** satisfaz o gate
 * (critério 4), que um 404 autenticado não é declarado como inexistência (critério 6), e que
 * `squashMerge` não passa pela validação sem `expectedHeadSha` (critério 5).
 *
 * A validação é o lugar onde o critério 5 vira garantia em vez de intenção: se `expectedHeadSha`
 * fosse só documentado, um chamador o omitiria e o GitHub mergearia o que estivesse no head.
 */

import { describe, expect, it } from 'vitest'
import {
  GITHUB_API_ORIGIN,
  GITHUB_CAPABILITIES,
  GITHUB_OPERATIONS,
  checkSatisfazGate,
  checksAprovam,
  corpoComChaveExterna,
  corpoTemChaveExterna,
  erroDeHeadDivergente,
  marcadorDeChaveExterna,
  origemDaApi,
  significadoDo404,
  validarEntrada,
  type CheckNormalizado
} from './github-automation'

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const OUTRO_SHA = 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1'
const REPO = { owner: 'RodReis', repo: 'rrb-jarvisOS' }

function check(parcial: Partial<CheckNormalizado> = {}): CheckNormalizado {
  return {
    nome: 'test',
    headSha: SHA,
    status: 'completed',
    conclusao: 'success',
    ...parcial
  }
}

describe('capacidades declaradas', () => {
  it('declara as nove operações da spec, mais a autenticação da F03', () => {
    const operacoes = GITHUB_CAPABILITIES.map((c) => c.operation)
    expect(operacoes).toEqual(['auth.identify', ...Object.values(GITHUB_OPERATIONS)])
  })

  it('marca como mutação exatamente o que muda o mundo', () => {
    const mutacoes = GITHUB_CAPABILITIES.filter((c) => c.effect === 'mutacao').map(
      (c) => c.operation
    )
    // A distinção não é cosmética: a governança da F02 exige chave de idempotência de mutação, e
    // marcar uma leitura como mutação obrigaria o chamador a inventar uma chave para consultar.
    expect(mutacoes).toEqual([
      'repo.ensure',
      'issue.ensure',
      'issue.ensure-dependency',
      'ref.ensure',
      'pr.ensure',
      'pr.squash-merge',
      'repo.set-default-branch',
      'branch.ensure-protection'
    ])
    // `commit.sha-for-ref` fica de fora de propósito: ler o commit da origem não muda nada, e
    // marcá-lo como mutação obrigaria a publicação a inventar chave de idempotência para conferir
    // o que acabou de publicar.
  })

  it('toda capacidade é do conector github e tem descrição', () => {
    for (const cap of GITHUB_CAPABILITIES) {
      expect(cap.connector).toBe('github')
      expect(cap.descricao.length).toBeGreaterThan(10)
    }
  })
})

describe('origemDaApi', () => {
  it('sem override, fala com a API do GitHub', () => {
    expect(origemDaApi()).toBe(GITHUB_API_ORIGIN)
    expect(origemDaApi('')).toBe(GITHUB_API_ORIGIN)
  })

  it('descarta caminho e query: o override troca o servidor, não a rota', () => {
    expect(origemDaApi('http://127.0.0.1:9999/api/v3?x=1')).toBe('http://127.0.0.1:9999')
  })

  it('recusa esquema que não seja http(s)', () => {
    expect(origemDaApi('file:///etc/passwd')).toBe(GITHUB_API_ORIGIN)
    expect(origemDaApi('nao-e-url')).toBe(GITHUB_API_ORIGIN)
  })
})

describe('chave externa determinística', () => {
  it('o marcador é comentário HTML — invisível no render do GitHub', () => {
    expect(marcadorDeChaveExterna('M6-F04')).toBe('<!-- jarvis-key: M6-F04 -->')
  })

  it('acrescenta o marcador ao corpo e o reconhece depois', () => {
    const corpo = corpoComChaveExterna('Descrição da fatia.', 'M6-F04')
    expect(corpo).toContain('Descrição da fatia.')
    expect(corpoTemChaveExterna(corpo, 'M6-F04')).toBe(true)
  })

  it('não duplica o marcador ao reprocessar o mesmo corpo', () => {
    // Idempotência do próprio corpo: `ensureIssue` pode reescrever o body de uma issue que já
    // tem o marcador, e duplicá-lo faria o corpo crescer a cada execução.
    const uma = corpoComChaveExterna('x', 'K')
    const duas = corpoComChaveExterna(uma, 'K')
    expect(duas).toBe(uma)
  })

  it('chave diferente não casa — é o que impede duas fatias compartilharem uma issue', () => {
    const corpo = corpoComChaveExterna('x', 'M6-F04')
    expect(corpoTemChaveExterna(corpo, 'M6-F05')).toBe(false)
    expect(corpoTemChaveExterna(undefined, 'M6-F04')).toBe(false)
  })
})

describe('checkSatisfazGate', () => {
  it('check verde do mesmo commit satisfaz', () => {
    expect(checkSatisfazGate(check(), SHA)).toBe(true)
  })

  it('check verde de OUTRO commit não satisfaz — critério 4', () => {
    // O engano que a spec existe para impedir: um check verde do push anterior diz que o código
    // de ontem passava, não este.
    expect(checkSatisfazGate(check({ headSha: OUTRO_SHA }), SHA)).toBe(false)
  })

  it('check ainda rodando não satisfaz, mesmo sem conclusão ruim', () => {
    expect(checkSatisfazGate(check({ status: 'in_progress', conclusao: undefined }), SHA)).toBe(
      false
    )
  })

  it('check concluído com falha não satisfaz', () => {
    expect(checkSatisfazGate(check({ conclusao: 'failure' }), SHA)).toBe(false)
  })
})

describe('checksAprovam', () => {
  it('todos verdes do head aprovam', () => {
    expect(checksAprovam([check({ nome: 'a' }), check({ nome: 'b' })], SHA)).toEqual({
      aprovado: true,
      pendentes: 0,
      falhos: 0
    })
  })

  it('lista vazia NÃO aprova — "nenhum check" não é "todos passaram"', () => {
    // `every` sobre lista vazia devolveria `true`, e o gate diria verde para um commit que
    // ninguém verificou. A regra precisa ser explícita, não herdada da linguagem.
    expect(checksAprovam([], SHA)).toEqual({ aprovado: false, pendentes: 0, falhos: 0 })
  })

  it('checks só de outro commit contam como nenhum check deste', () => {
    expect(checksAprovam([check({ headSha: OUTRO_SHA })], SHA).aprovado).toBe(false)
  })

  it('um pendente segura a aprovação e é contado', () => {
    const r = checksAprovam([check({ nome: 'a' }), check({ nome: 'b', status: 'queued' })], SHA)
    expect(r).toEqual({ aprovado: false, pendentes: 1, falhos: 0 })
  })

  it('skipped não conta como falha — é o check que decidiu não rodar', () => {
    expect(checksAprovam([check(), check({ nome: 'b', conclusao: 'skipped' })], SHA)).toEqual({
      aprovado: true,
      pendentes: 0,
      falhos: 0
    })
  })

  it('falha reprova e é contada', () => {
    expect(checksAprovam([check({ conclusao: 'failure' })], SHA)).toMatchObject({
      aprovado: false,
      falhos: 1
    })
  })
})

describe('significadoDo404 — critério 6', () => {
  it('autenticado, o 404 é ambíguo e a mensagem nomeia as duas possibilidades', () => {
    const r = significadoDo404(true)
    expect(r.code).toBe('permissao-negada')
    // O que o critério proíbe é **alegar inexistência**. A mensagem precisa dizer "ou não existe,
    // ou você não vê" — porque afirmar qual dos dois exigiria uma chamada que não temos.
    expect(r.mensagem).toMatch(/não existe/i)
    expect(r.mensagem).toMatch(/acesso/i)
  })

  it('sem autenticação, o 404 é falta de credencial', () => {
    expect(significadoDo404(false).code).toBe('credencial-ausente')
  })

  it('nunca devolve um código que afirme inexistência', () => {
    // Não existe `nao-encontrado` no vocabulário da F01, e é deliberado: nenhum adapter pode
    // afirmar ausência a partir de um 404 autenticado.
    for (const autenticado of [true, false]) {
      expect(significadoDo404(autenticado).code).not.toBe('nao-encontrado')
    }
  })
})

describe('validarEntrada', () => {
  it('recusa entrada que não é objeto', () => {
    expect(validarEntrada(GITHUB_OPERATIONS.ensureRepository, null)).toBeTruthy()
    expect(validarEntrada(GITHUB_OPERATIONS.ensureRepository, 'texto')).toBeTruthy()
  })

  it('toda operação exige owner e repo', () => {
    for (const operation of Object.values(GITHUB_OPERATIONS)) {
      expect(validarEntrada(operation, { owner: '', repo: '' })).toMatch(/owner/)
    }
  })

  it('operação desconhecida é recusada pelo nome', () => {
    expect(validarEntrada('repo.delete', { ...REPO })).toMatch(/não pertence/)
  })

  describe('repo.ensure', () => {
    it('aceita visibilidade válida', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureRepository, { ...REPO, visibility: 'private' })
      ).toBeUndefined()
    })

    it('recusa visibilidade inventada', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureRepository, { ...REPO, visibility: 'secreto' })
      ).toMatch(/visibility/)
    })
  })

  describe('issue.ensure', () => {
    it('exige a chave externa — é ela que torna o ensure idempotente', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureIssue, { ...REPO, title: 'x', body: '' })
      ).toMatch(/externalKey/)
    })

    it('aceita entrada completa', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureIssue, {
          ...REPO,
          externalKey: 'M6-F04',
          title: 'Automação',
          body: ''
        })
      ).toBeUndefined()
    })
  })

  describe('issue.ensure-dependency', () => {
    it('aceita pai e filho distintos', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureIssueDependency, {
          ...REPO,
          parentIssue: 86,
          childIssue: 90
        })
      ).toBeUndefined()
    })

    it('recusa issue como sub-issue dela mesma', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureIssueDependency, {
          ...REPO,
          parentIssue: 90,
          childIssue: 90
        })
      ).toMatch(/dela mesma/)
    })

    it('recusa número não inteiro', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureIssueDependency, {
          ...REPO,
          parentIssue: 1.5,
          childIssue: 2
        })
      ).toBeTruthy()
    })
  })

  describe('ref.ensure', () => {
    it('aceita branch e SHA', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureBranchRef, { ...REPO, branch: 'feat/x', sha: SHA })
      ).toBeUndefined()
    })

    it('recusa nome de branch no lugar do SHA', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensureBranchRef, { ...REPO, branch: 'x', sha: 'main' })
      ).toMatch(/SHA/)
    })
  })

  describe('pr.ensure', () => {
    it('aceita head e base distintos', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensurePullRequest, {
          ...REPO,
          head: 'feat/x',
          base: 'main',
          title: 'T',
          body: ''
        })
      ).toBeUndefined()
    })

    it('recusa head igual a base', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.ensurePullRequest, {
          ...REPO,
          head: 'main',
          base: 'main',
          title: 'T',
          body: ''
        })
      ).toMatch(/mesmo branch/)
    })
  })

  describe('pr.squash-merge — critério 5', () => {
    it('aceita com expectedHeadSha', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.squashMerge, {
          ...REPO,
          pullRequest: 146,
          expectedHeadSha: SHA
        })
      ).toBeUndefined()
    })

    it('RECUSA sem expectedHeadSha — é aqui que o critério vira garantia', () => {
      // Sem esta recusa, `expectedHeadSha` seria só documentação: um chamador o omitiria e o
      // GitHub mergearia o que estivesse no head, sem ter sido verificado.
      expect(validarEntrada(GITHUB_OPERATIONS.squashMerge, { ...REPO, pullRequest: 146 })).toMatch(
        /expectedHeadSha/
      )
    })

    it('recusa nome de branch como expectedHeadSha', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.squashMerge, {
          ...REPO,
          pullRequest: 146,
          expectedHeadSha: 'main'
        })
      ).toMatch(/expectedHeadSha/)
    })

    it('recusa número de PR ausente ou zero', () => {
      expect(
        validarEntrada(GITHUB_OPERATIONS.squashMerge, { ...REPO, expectedHeadSha: SHA })
      ).toMatch(/pullRequest/)
      expect(
        validarEntrada(GITHUB_OPERATIONS.squashMerge, {
          ...REPO,
          pullRequest: 0,
          expectedHeadSha: SHA
        })
      ).toMatch(/pullRequest/)
    })
  })

  describe('leituras por commit', () => {
    it.each([GITHUB_OPERATIONS.getChecksForHead, GITHUB_OPERATIONS.getWorkflowRunsForHead])(
      '%s exige SHA',
      (operation) => {
        expect(validarEntrada(operation, { ...REPO, sha: SHA })).toBeUndefined()
        expect(validarEntrada(operation, { ...REPO, sha: 'HEAD' })).toMatch(/SHA/)
      }
    )
  })
})

describe('erroDeHeadDivergente', () => {
  it('diz o que houve e o que fazer, e não é retentável', () => {
    const erro = erroDeHeadDivergente(
      SHA,
      '2026-08-29T12:00:00.000Z',
      GITHUB_OPERATIONS.squashMerge
    )

    expect(erro.code).toBe('validacao-invalida')
    expect(erro.retryable).toBe(false)
    // Repetir o mesmo pedido erraria de novo: quem repete precisa reler o head primeiro.
    expect(erro.acao).toBe('corrigir-entrada')
    expect(erro.mensagem).toContain(SHA.slice(0, 7))
    expect(erro.mensagem).toMatch(/releia os checks/i)
  })
})
