/**
 * As decisões puras do Device Flow (SPEC-Conectores-03, categoria Regras).
 *
 * O que estes testes provam e nenhum teste de integração provaria melhor: que o polling **termina**
 * (critério 3). Cada resposta possível do GitHub vira exatamente um dos três desfechos, e só um
 * deles continua o laço — então não existe entrada que faça o serviço girar para sempre.
 */

import { describe, expect, it } from 'vitest'
import {
  GITHUB_CLIENT_ID_EMBUTIDO,
  GITHUB_OAUTH_ORIGIN,
  MARGEM_DE_RENOVACAO_MS,
  MENSAGEM_DO_CLIENT_ID,
  SLOW_DOWN_ACRESCIMO_MS,
  descreverOverrideDoClientId,
  erroDeInstalacaoAusente,
  grantExpirou,
  interpretarRespostaDeToken,
  lerGrantDeDeviceCode,
  lerPayloadDeToken,
  origemDoOAuth,
  precisaRenovar,
  resolverClientId,
  urlDeInstalacao,
  validarClientId
} from './github-auth'

const AGORA = Date.parse('2026-08-29T12:00:00.000Z')
const INTERVALO = 5_000

describe('resolverClientId', () => {
  it('usa o override quando preenchido — precedência do critério 7', () => {
    expect(resolverClientId('Iv1.abc123')).toBe('Iv1.abc123')
  })

  it('apara espaços do override colado', () => {
    expect(resolverClientId('  Iv1.abc123\n')).toBe('Iv1.abc123')
  })

  it('trata override em branco como ausente, não como client_id vazio', () => {
    expect(resolverClientId('   ')).toBeUndefined()
    expect(resolverClientId('')).toBeUndefined()
    expect(resolverClientId(undefined)).toBeUndefined()
  })

  it('sem override e sem embutido, não há client_id — o app diz o que falta em vez de chamar', () => {
    // Trava a decisão do PI de 2026-08-29 enquanto a GitHub App não existe. Quando o
    // `client_id` real for embutido, este teste falha e cobra a atualização — que é o ponto.
    expect(GITHUB_CLIENT_ID_EMBUTIDO).toBe('')
    expect(resolverClientId()).toBeUndefined()
  })
})

describe('validarClientId (SPEC-Conectores-03, regra 7: o client ID não é segredo)', () => {
  it('aceita as duas formas de client ID de GitHub App, com e sem espaço em volta', () => {
    expect(validarClientId('Iv1.0123456789abcdef')).toEqual({
      ok: true,
      clientId: 'Iv1.0123456789abcdef'
    })
    expect(validarClientId('  Iv23liAbCdEfGhIjKlMn\n')).toEqual({
      ok: true,
      clientId: 'Iv23liAbCdEfGhIjKlMn'
    })
  })

  it('vazio limpa o override: ok, sem valor', () => {
    expect(validarClientId('')).toEqual({ ok: true, clientId: undefined })
    expect(validarClientId('   ')).toEqual({ ok: true, clientId: undefined })
  })

  it.each(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'])(
    'recusa valor com prefixo de token do GitHub (%s…) como segredo, não como client ID',
    (prefixo) => {
      expect(validarClientId(`${prefixo}AbCdEfGhIjKl`)).toEqual({
        ok: false,
        problema: 'parece-segredo'
      })
    }
  )

  it('o prefixo de token vale em qualquer caixa', () => {
    expect(validarClientId('GITHUB_PAT_AbCdEfGhIjKl')).toEqual({
      ok: false,
      problema: 'parece-segredo'
    })
  })

  it('recusa um client secret (40 caracteres hexadecimais): é longo demais para um client ID', () => {
    expect(validarClientId('a'.repeat(40))).toEqual({ ok: false, problema: 'formato' })
  })

  it('recusa o valor de 93 caracteres que apareceu no campo (forma de token)', () => {
    expect(validarClientId(`github${'x'.repeat(87)}`)).toEqual({ ok: false, problema: 'formato' })
  })

  it.each(['curto', 'tem espaço no meio ok', 'com/barra/aqui1', 'acento-áéíóú-1'])(
    'recusa por formato: %s',
    (valor) => {
      expect(validarClientId(valor)).toEqual({ ok: false, problema: 'formato' })
    }
  )

  it('a mensagem de cada problema existe e nunca ecoa o valor recusado', () => {
    expect(MENSAGEM_DO_CLIENT_ID['parece-segredo']).toMatch(/segredo|token/i)
    expect(MENSAGEM_DO_CLIENT_ID.formato).toMatch(/client ID/)
    expect(JSON.stringify(MENSAGEM_DO_CLIENT_ID)).not.toMatch(/ghp_|github_pat_/)
  })
})

describe('resolverClientId ignora o override inválido (fail-closed)', () => {
  it('um override com forma de token nunca é usado: não vai ao GitHub como client_id', () => {
    expect(resolverClientId(`github_pat_${'x'.repeat(80)}`)).toBeUndefined()
    expect(resolverClientId('a'.repeat(40))).toBeUndefined()
  })
})

describe('descreverOverrideDoClientId (o que a tela pode saber do que está salvo)', () => {
  it('sem override, não há o que dizer', () => {
    expect(descreverOverrideDoClientId(undefined)).toEqual({})
    expect(descreverOverrideDoClientId('  ')).toEqual({})
  })

  it('override válido: devolve o client ID (público por desenho)', () => {
    expect(descreverOverrideDoClientId('Iv1.0123456789abcdef')).toEqual({
      clientIdSalvo: 'Iv1.0123456789abcdef'
    })
  })

  it('override inválido: só avisa que é inválido — o valor nunca sai, nem em parte', () => {
    const r = descreverOverrideDoClientId(`github_pat_${'x'.repeat(80)}`)

    expect(r).toEqual({ clientIdSalvoInvalido: true })
    expect(JSON.stringify(r)).not.toMatch(/github_pat_|xxxx/)
  })
})

describe('origemDoOAuth', () => {
  it('sem override, fala com o GitHub', () => {
    expect(origemDoOAuth()).toBe(GITHUB_OAUTH_ORIGIN)
    expect(origemDoOAuth('')).toBe(GITHUB_OAUTH_ORIGIN)
  })

  it('aceita um servidor local — é o que permite provar o fluxo no app real', () => {
    expect(origemDoOAuth('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321')
  })

  it('descarta caminho, query e fragmento: o override troca o servidor, não a rota', () => {
    // Sem isto, um override poderia apontar o polling para outro endpoint da mesma origem —
    // e o ponto de teste viraria um redirecionador de rota.
    expect(origemDoOAuth('http://127.0.0.1:54321/qualquer/rota?x=1#y')).toBe(
      'http://127.0.0.1:54321'
    )
  })

  it('recusa esquema que não seja http(s) e valor sem forma de URL', () => {
    expect(origemDoOAuth('file:///etc/passwd')).toBe(GITHUB_OAUTH_ORIGIN)
    expect(origemDoOAuth('javascript:alert(1)')).toBe(GITHUB_OAUTH_ORIGIN)
    // Valor mal digitado não derruba o boot: cai no GitHub de verdade.
    expect(origemDoOAuth('nao-e-url')).toBe(GITHUB_OAUTH_ORIGIN)
  })
})

describe('lerGrantDeDeviceCode', () => {
  it('converte expires_in relativo em expiraEm absoluto', () => {
    const grant = lerGrantDeDeviceCode(
      {
        device_code: 'dc-40-chars',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      },
      AGORA
    )

    expect(grant).toEqual({
      deviceCode: 'dc-40-chars',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiraEm: new Date(AGORA + 900_000).toISOString(),
      intervaloMs: 5_000
    })
  })

  it('aceita os campos como texto — a resposta form-encoded traz tudo como string', () => {
    const grant = lerGrantDeDeviceCode(
      { device_code: 'dc', user_code: 'UC', expires_in: '600', interval: '10' },
      AGORA
    )

    expect(grant?.intervaloMs).toBe(10_000)
    expect(grant?.expiraEm).toBe(new Date(AGORA + 600_000).toISOString())
  })

  it('recusa grant sem device_code ou sem user_code', () => {
    expect(lerGrantDeDeviceCode({ user_code: 'UC' }, AGORA)).toBeUndefined()
    expect(lerGrantDeDeviceCode({ device_code: 'dc' }, AGORA)).toBeUndefined()
  })
})

describe('interpretarRespostaDeToken', () => {
  it('authorization_pending mantém o intervalo e continua', () => {
    expect(
      interpretarRespostaDeToken({ error: 'authorization_pending' }, INTERVALO, AGORA)
    ).toEqual({
      tipo: 'esperar',
      intervaloMs: INTERVALO
    })
  })

  it('slow_down acresce ao intervalo atual, não recomeça do inicial', () => {
    // O segundo slow_down parte de 10s (o valor já aumentado), não de 5s. Recomeçar do inicial
    // devolveria o app ao ritmo que o GitHub acabou de recusar.
    const primeiro = interpretarRespostaDeToken({ error: 'slow_down' }, INTERVALO, AGORA)
    expect(primeiro).toEqual({ tipo: 'esperar', intervaloMs: INTERVALO + SLOW_DOWN_ACRESCIMO_MS })

    const segundo = interpretarRespostaDeToken(
      { error: 'slow_down' },
      (primeiro as { intervaloMs: number }).intervaloMs,
      AGORA
    )
    expect(segundo).toEqual({
      tipo: 'esperar',
      intervaloMs: INTERVALO + SLOW_DOWN_ACRESCIMO_MS * 2
    })
  })

  it('slow_down com interval maior obedece o serviço em vez do acréscimo fixo', () => {
    expect(
      interpretarRespostaDeToken({ error: 'slow_down', interval: 60 }, INTERVALO, AGORA)
    ).toEqual({ tipo: 'esperar', intervaloMs: 60_000 })
  })

  it('slow_down com interval menor que o acréscimo mantém o piso', () => {
    expect(
      interpretarRespostaDeToken({ error: 'slow_down', interval: 1 }, INTERVALO, AGORA)
    ).toEqual({ tipo: 'esperar', intervaloMs: INTERVALO + SLOW_DOWN_ACRESCIMO_MS })
  })

  it.each([
    ['expired_token', 'credencial-ausente'],
    ['access_denied', 'cancelado'],
    ['incorrect_client_credentials', 'credencial-recusada'],
    ['device_flow_disabled', 'permissao-negada']
  ])('%s termina o polling como %s', (error, code) => {
    const decisao = interpretarRespostaDeToken({ error }, INTERVALO, AGORA)
    expect(decisao.tipo).toBe('falhou')
    expect(decisao).toMatchObject({ code })
  })

  it('erro desconhecido é normalizado: o código entra, a descrição do GitHub não vaza para a tela', () => {
    const decisao = interpretarRespostaDeToken(
      { error: 'inventado', error_description: 'token ghu_segredo rejeitado' },
      INTERVALO,
      AGORA
    )

    expect(decisao).toMatchObject({ tipo: 'falhou', code: 'resposta-invalida' })
    expect((decisao as { mensagem: string }).mensagem).not.toContain('ghu_segredo')
    // O **código** (vocabulário fechado do OAuth) entra para o erro ser diagnosticável; a descrição
    // livre do serviço, não (decisão do PI, 2026-10-05, na correção do campo de client ID).
    expect((decisao as { mensagem: string }).mensagem).toContain('inventado')
  })

  it('sucesso devolve o payload estruturado com expirações absolutas', () => {
    const decisao = interpretarRespostaDeToken(
      {
        access_token: 'ghu_access',
        refresh_token: 'ghr_refresh',
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
        token_type: 'bearer'
      },
      INTERVALO,
      AGORA
    )

    expect(decisao).toEqual({
      tipo: 'concluido',
      payload: {
        accessToken: 'ghu_access',
        refreshToken: 'ghr_refresh',
        expiraEm: new Date(AGORA + 28_800_000).toISOString(),
        refreshExpiraEm: new Date(AGORA + 15_897_600_000).toISOString(),
        tokenType: 'bearer'
      }
    })
  })

  it('resposta sem access_token e sem error é resposta inválida, não sucesso vazio', () => {
    expect(interpretarRespostaDeToken({ token_type: 'bearer' }, INTERVALO, AGORA)).toMatchObject({
      tipo: 'falhou',
      code: 'resposta-invalida'
    })
  })

  it('toda resposta cai em um dos três desfechos — o laço sempre tem saída', () => {
    const respostas: Record<string, unknown>[] = [
      { error: 'authorization_pending' },
      { error: 'slow_down' },
      { error: 'expired_token' },
      { error: 'access_denied' },
      { error: 'incorrect_client_credentials' },
      { error: 'device_flow_disabled' },
      { error: 'qualquer-outro' },
      { access_token: 'ghu_x' },
      {}
    ]

    for (const resposta of respostas) {
      const decisao = interpretarRespostaDeToken(resposta, INTERVALO, AGORA)
      expect(['concluido', 'esperar', 'falhou']).toContain(decisao.tipo)
    }
  })
})

describe('interpretarRespostaDeToken — erro desconhecido do GitHub', () => {
  it('inclui o código do GitHub quando ele tem a forma de um código (diagnosticável, sem texto do serviço)', () => {
    const r = interpretarRespostaDeToken(
      { error: 'unauthorized_client', error_description: 'texto livre do GitHub' },
      INTERVALO,
      AGORA
    )

    expect(r).toMatchObject({ tipo: 'falhou', code: 'resposta-invalida' })
    expect(r.tipo === 'falhou' && r.mensagem).toContain('unauthorized_client')
    // A descrição livre do GitHub continua fora da mensagem.
    expect(r.tipo === 'falhou' && r.mensagem).not.toContain('texto livre')
  })

  it('código com forma estranha não entra na mensagem (pode ser qualquer coisa)', () => {
    const r = interpretarRespostaDeToken(
      { error: 'Isto não é um código <script>' },
      INTERVALO,
      AGORA
    )

    expect(r.tipo === 'falhou' && r.mensagem).toBe(
      'O GitHub recusou a autorização por um motivo não previsto.'
    )
  })
})

describe('lerPayloadDeToken', () => {
  it('token sem expiração fica sem expiraEm — a App pode não expirar user tokens', () => {
    expect(lerPayloadDeToken({ access_token: 'ghu_x' }, AGORA)).toEqual({
      accessToken: 'ghu_x',
      tokenType: 'bearer'
    })
  })

  it('refresh token vazio é ausência, não string vazia gravada no cofre', () => {
    expect(
      lerPayloadDeToken({ access_token: 'ghu_x', refresh_token: '' }, AGORA)
    ).not.toHaveProperty('refreshToken')
  })

  it('expires_in não-positivo é descartado em vez de virar prazo no passado', () => {
    expect(lerPayloadDeToken({ access_token: 'ghu_x', expires_in: -10 }, AGORA)).not.toHaveProperty(
      'expiraEm'
    )
  })
})

describe('grantExpirou', () => {
  const grant = {
    deviceCode: 'dc',
    userCode: 'UC',
    verificationUri: 'https://github.com/login/device',
    expiraEm: new Date(AGORA + 900_000).toISOString(),
    intervaloMs: 5_000
  }

  it('vale antes do prazo', () => {
    expect(grantExpirou(grant, AGORA + 899_000)).toBe(false)
  })

  it('expira no instante do prazo — o limite não é uma janela extra', () => {
    expect(grantExpirou(grant, AGORA + 900_000)).toBe(true)
  })
})

describe('precisaRenovar', () => {
  it('token sem expiração nunca precisa de renovação', () => {
    expect(precisaRenovar({ accessToken: 'ghu_x', tokenType: 'bearer' }, AGORA)).toBe(false)
  })

  it('token que ainda vale muito não é renovado', () => {
    const payload = {
      accessToken: 'ghu_x',
      tokenType: 'bearer',
      expiraEm: new Date(AGORA + 3_600_000).toISOString()
    }
    expect(precisaRenovar(payload, AGORA)).toBe(false)
  })

  it('token dentro da margem é renovado antes de vencer — não no 401', () => {
    // Vence em 30s: a comparação crua diria "ainda vale" e a chamada expiraria no meio.
    const payload = {
      accessToken: 'ghu_x',
      tokenType: 'bearer',
      expiraEm: new Date(AGORA + 30_000).toISOString()
    }
    expect(precisaRenovar(payload, AGORA)).toBe(true)
    // Contraprova da margem: sem ela, o mesmo token passaria.
    expect(precisaRenovar(payload, AGORA, 0)).toBe(false)
  })

  it('token já vencido precisa de renovação', () => {
    const payload = {
      accessToken: 'ghu_x',
      tokenType: 'bearer',
      expiraEm: new Date(AGORA - 1).toISOString()
    }
    expect(precisaRenovar(payload, AGORA, MARGEM_DE_RENOVACAO_MS)).toBe(true)
  })
})

describe('erroDeInstalacaoAusente', () => {
  it('carrega a URL de instalação como ação concreta, não mensagem genérica', () => {
    const erro = erroDeInstalacaoAusente('jarvis-os', '2026-08-29T12:00:00.000Z', 'auth.identify')

    expect(erro.code).toBe('permissao-negada')
    expect(erro.acao).toBe('reautenticar')
    expect(erro.retryable).toBe(false)
    expect(erro.mensagem).toContain(urlDeInstalacao('jarvis-os'))
  })
})
