/**
 * O adapter do GitHub (SPEC-Conectores-03, categoria Regras).
 *
 * O que estes testes cobram: que o adapter **normaliza** — traduz o status HTTP no vocabulário
 * comum da F01 e devolve dado escolhido campo a campo, não o corpo do GitHub inteiro. É o
 * critério 3 da F01 ("o `ConnectorResult` não pode carregar o objeto nativo do SDK") valendo
 * pelo primeiro adapter concreto, e não mais por um contract fixture.
 *
 * O caso que só um adapter real tem: o **403 ambíguo** do GitHub. Ele é rate limit secundário
 * quando vem com `retry-after`, e falta de acesso no resto — e é por isso que a `acao` mora no
 * erro em vez de numa tabela por status.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ConnectorError, ConnectorRequest, ConnectorResult } from '@shared/domain/connectors'
import type { ConnectorAdapter } from '../adapter'
import { urlDeInstalacao } from '@shared/domain/github-auth'
import { GITHUB_APP_SLUG, GithubAdapter } from './github-adapter'

const AGORA = Date.parse('2026-08-29T12:00:00.000Z')

const REQUEST: ConnectorRequest = {
  contractVersion: 1,
  connector: 'github',
  operation: 'auth.identify',
  correlationId: 'c-1',
  timeoutMs: 10_000,
  credential: { key: 'github', user_id: 'u-1', workspace_id: 'jarvis' },
  input: {}
}

function execution(secret?: string): Parameters<GithubAdapter['executar']>[0] {
  return {
    request: REQUEST,
    capability: {
      connector: 'github',
      operation: 'auth.identify',
      effect: 'leitura',
      descricao: 'x'
    },
    ...(secret === undefined ? {} : { secret })
  }
}

function resposta(
  corpo: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => corpo,
    headers: new Headers(init.headers ?? {})
  } as Response
}

function adapter(devolver: () => Response): {
  instancia: GithubAdapter
  chamadas: { url: string; init: RequestInit }[]
} {
  const chamadas: { url: string; init: RequestInit }[] = []
  const instancia = new GithubAdapter(
    async (url, init) => {
      chamadas.push({ url, init })
      return devolver()
    },
    () => AGORA
  )
  return { instancia, chamadas }
}

describe('capacidades', () => {
  it('declara auth.identify, as nove da M6-F04 e as três da M9-F01', () => {
    // O teste da F03 afirmava `['auth.identify']` e nada mais — e foi ele que cobrou esta
    // atualização quando a F04 chegou, que era o ponto de tê-lo escrito assim. Cobrou de novo
    // na M9-F01, quando a publicação precisou de branch base, proteção e leitura de commit.
    const caps = new GithubAdapter().capacidades()
    expect(caps.map((c) => c.operation)).toEqual([
      'auth.identify',
      'repo.ensure',
      'issue.ensure',
      'issue.ensure-dependency',
      'ref.ensure',
      'pr.ensure',
      'checks.for-head',
      'actions.runs-for-head',
      'pr.squash-merge',
      'pr.merge-state',
      'repo.set-default-branch',
      'branch.ensure-protection',
      'commit.sha-for-ref'
    ])
    expect(caps[0]).toMatchObject({ connector: 'github', effect: 'leitura' })
  })

  it('não declara custoEstimado — ausência é zero, e o GitHub não cobra', () => {
    // Pelo tipo da **interface**, não pela classe: `custoEstimado` é opcional em
    // `ConnectorAdapter`, e a classe concreta simplesmente não o tem. Acessá-lo na classe nem
    // compilaria — que já é meia prova; esta asserção fecha a outra metade, do lado de quem
    // consome o adapter pela interface (o gate de créditos da F02).
    const adapter: ConnectorAdapter = new GithubAdapter()
    expect(adapter.custoEstimado).toBeUndefined()
  })
})

describe('validar', () => {
  it('NÃO confere credencial — quem faz isso é o serviço, depois desta etapa', () => {
    // O `ConnectorService` chama `validar` no passo 3 e resolve o cofre no passo 6, de propósito:
    // recusar pedido malformado sem tocar o segredo. Então `secret` está sempre ausente aqui, e
    // uma guarda de credencial recusaria **toda** chamada — que foi exatamente o que o E2E da
    // F04 pegou, com a guarda que a F03 havia posto e que só tinha teste unitário.
    expect(new GithubAdapter().validar(execution())).toBeUndefined()
  })

  it('valida o input da operação sem tocar a rede', () => {
    const buscar = vi.fn()
    const instancia = new GithubAdapter(buscar)

    const erro = instancia.validar({
      request: { ...REQUEST, operation: 'repo.ensure', input: { owner: '', repo: '' } },
      capability: {
        connector: 'github',
        operation: 'repo.ensure',
        effect: 'mutacao',
        descricao: 'x'
      }
    })

    expect(erro).toMatchObject({ code: 'validacao-invalida', acao: 'corrigir-entrada' })
    expect(buscar).not.toHaveBeenCalled()
  })

  it('input válido passa', () => {
    expect(
      new GithubAdapter().validar({
        request: {
          ...REQUEST,
          operation: 'repo.ensure',
          input: { owner: 'o', repo: 'r', visibility: 'private' }
        },
        capability: {
          connector: 'github',
          operation: 'repo.ensure',
          effect: 'mutacao',
          descricao: 'x'
        }
      })
    ).toBeUndefined()
  })
})

describe('executar', () => {
  it('devolve identidade normalizada, sem os campos que ninguém pediu', async () => {
    const { instancia } = adapter(() =>
      resposta({
        login: 'rodreis',
        id: 42,
        type: 'User',
        // O corpo real traz dezenas destes; nenhum deve atravessar o IPC.
        url: 'https://api.github.com/users/rodreis',
        gravatar_id: '',
        node_id: 'MDQ6VXNlcjQy'
      })
    )

    const desfecho = (await instancia.executar(execution('ghu_x'))) as ConnectorResult
    expect(desfecho.ok).toBe(true)
    expect(desfecho.data).toEqual({ login: 'rodreis', id: 42, tipo: 'User' })
    // Espalhar o corpo (`...dados`) publicaria estes; escolher campo a campo não.
    expect(JSON.stringify(desfecho.data)).not.toContain('node_id')
    expect(desfecho.usage.creditos).toBe(0)
  })

  it('manda o token no header e não na URL', async () => {
    const { instancia, chamadas } = adapter(() => resposta({ login: 'x', id: 1, type: 'User' }))
    await instancia.executar(execution('ghu_secreto'))

    expect(chamadas[0]?.url).not.toContain('ghu_secreto')
    const headers = chamadas[0]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ghu_secreto')
  })

  it('401 vira credencial-recusada com ação de reautenticar', async () => {
    const { instancia } = adapter(() => resposta({}, { ok: false, status: 401 }))
    const erro = (await instancia.executar(execution('ghu_x'))) as ConnectorError

    expect(erro).toMatchObject({
      code: 'credencial-recusada',
      acao: 'reautenticar',
      retryable: false
    })
  })

  it('403 com retry-after é limite-excedido e traz o backoff como número', async () => {
    const { instancia } = adapter(() =>
      resposta({}, { ok: false, status: 403, headers: { 'retry-after': '60' } })
    )
    const erro = (await instancia.executar(execution('ghu_x'))) as ConnectorError

    // Número e não texto: a governança da F02 decide com ele, e uma orientação que só existe
    // como string é uma orientação que ninguém obedece.
    expect(erro).toMatchObject({ code: 'limite-excedido', retryable: true, retryAfterMs: 60_000 })
  })

  it('403 com cota zerada também é limite, mesmo sem retry-after', async () => {
    const { instancia } = adapter(() =>
      resposta({}, { ok: false, status: 403, headers: { 'x-ratelimit-remaining': '0' } })
    )
    expect(await instancia.executar(execution('ghu_x'))).toMatchObject({ code: 'limite-excedido' })
  })

  it('403 sem sinal de cota é falta de instalação, com a URL concreta — não mensagem genérica', async () => {
    const { instancia } = adapter(() => resposta({}, { ok: false, status: 403 }))
    const erro = (await instancia.executar(execution('ghu_x'))) as ConnectorError

    expect(erro.code).toBe('permissao-negada')
    expect(erro.mensagem).toContain(urlDeInstalacao(GITHUB_APP_SLUG))
  })

  it('500 é indisponível e retentável', async () => {
    const { instancia } = adapter(() => resposta({}, { ok: false, status: 502 }))
    expect(await instancia.executar(execution('ghu_x'))).toMatchObject({
      code: 'indisponivel',
      retryable: true
    })
  })

  it('status inesperado guarda só o número como evidência, sem corpo', async () => {
    const { instancia } = adapter(() =>
      resposta({ message: 'algo com ghu_secreto dentro' }, { ok: false, status: 418 })
    )
    const erro = (await instancia.executar(execution('ghu_x'))) as ConnectorError

    expect(erro.evidencia).toBe('HTTP 418')
    expect(JSON.stringify(erro)).not.toContain('ghu_secreto')
  })

  it('resposta sem login é resposta-invalida, não sucesso com dado vazio', async () => {
    const { instancia } = adapter(() => resposta({ id: 1 }))
    expect(await instancia.executar(execution('ghu_x'))).toMatchObject({
      code: 'resposta-invalida'
    })
  })
})

describe('health', () => {
  it('sonda endpoint público e não manda credencial nenhuma', async () => {
    const { instancia, chamadas } = adapter(() => resposta('keep it simple'))

    expect(await instancia.health()).toBe(true)
    expect(chamadas[0]?.url).toContain('/zen')
    // A assinatura já impede passar segredo; isto confirma que nenhum header o carrega.
    expect(JSON.stringify(chamadas[0]?.init ?? {})).not.toContain('Authorization')
  })

  it('rede caída é indisponível, não exceção que derruba o chamador', async () => {
    const instancia = new GithubAdapter(async () => {
      throw new Error('sem rede')
    })
    expect(await instancia.health()).toBe(false)
  })
})
