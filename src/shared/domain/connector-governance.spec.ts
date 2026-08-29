/**
 * As decisões puras da governança (SPEC-Conectores-02, critérios 2, 3 e 8).
 *
 * O que estes testes provam é **política**, não infraestrutura: que 429 retenta e 401 não, que
 * mutação sem chave nunca é repetida, que o teto de créditos barra pelo número. Nenhum deles
 * precisa de rede — e é por isso que valem: um teste que precisasse de servidor para dizer
 * "401 não entra em loop" estaria medindo o servidor.
 *
 * O que **não** é provado aqui é o efeito (esperar, chamar, registrar) — isso é do serviço, e
 * está em `connector-service.int-spec.ts` contra um servidor que **conta** requisições.
 */

import { describe, expect, it } from 'vitest'
import { CONNECTOR_ERROR_CODES, type ConnectorErrorCode } from './connectors'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAXIMO_MS,
  CIRCUITO_ABERTO_MS,
  CIRCUITO_FECHADO,
  CODIGOS_SEM_RETRY,
  CONNECTOR_STATES,
  ESTADO_DO_ERRO,
  FALHAS_PARA_ABRIR,
  MAX_TENTATIVAS_PADRAO,
  avaliarCreditos,
  calcularEspera,
  circuitoAberto,
  contaContraOBreaker,
  decidirRetry,
  mensagemDeCreditoEsgotado,
  proximoCircuito,
  tetoDeCreditosPadrao,
  type ConnectorCreditPolicy,
  type CreditosConsumidos
} from './connector-governance'

const TETO: ConnectorCreditPolicy = {
  user_id: 'u-1',
  workspace_id: 'jarvis',
  connector: 'tavily',
  dailyLimit: 100,
  monthlyLimit: 1_000
}

const ZERO: CreditosConsumidos = { dia: 0, mes: 0 }

describe('estados — o desfecho de uma chamada, não um painel', () => {
  it('todo código de erro tem estado, e nenhum sobra', () => {
    // O `Record` completo já obriga no compilador; o que este teste pega é o contrário — um
    // estado para um código que saiu da lista.
    expect(Object.keys(ESTADO_DO_ERRO).sort()).toEqual([...CONNECTOR_ERROR_CODES].sort())
    for (const estado of Object.values(ESTADO_DO_ERRO)) {
      expect(CONNECTOR_STATES).toContain(estado)
    }
  })

  it.each<[ConnectorErrorCode]>([
    ['credencial-ausente'],
    ['credencial-recusada'],
    ['permissao-negada'],
    ['limite-excedido']
  ])('%s é BLOCKED_EXTERNAL — só o usuário resolve', (code) => {
    expect(ESTADO_DO_ERRO[code]).toBe('BLOCKED_EXTERNAL')
  })

  it.each<[ConnectorErrorCode]>([['indisponivel'], ['timeout'], ['resposta-invalida']])(
    '%s é FAILED — o tempo pode resolver',
    (code) => {
      expect(ESTADO_DO_ERRO[code]).toBe('FAILED')
    }
  )
})

describe('decidirRetry — a ordem das recusas é a política (critérios 2 e 3)', () => {
  it('429 retenta quando a operação é repetível', () => {
    const d = decidirRetry({
      code: 'indisponivel',
      tentativa: 1,
      maxTentativas: MAX_TENTATIVAS_PADRAO,
      repetivel: true
    })

    expect(d.repetir).toBe(true)
  })

  it('mutação sem idempotência não repete NEM com erro transitório (critério 3)', () => {
    // A asserção que separa o critério 3 do 2: o código é o mesmo que retentaria acima. Se a
    // ordem das recusas invertesse — código terminal antes de repetibilidade —, um 429 sobre
    // uma mutação sem chave passaria a repetir, e a segunda issue seria criada.
    const d = decidirRetry({
      code: 'indisponivel',
      tentativa: 1,
      maxTentativas: MAX_TENTATIVAS_PADRAO,
      repetivel: false
    })

    expect(d).toEqual({ repetir: false, motivo: 'nao-repetivel' })
  })

  it.each(CODIGOS_SEM_RETRY.filter((c) => c !== 'validacao-invalida'))(
    '%s não entra em loop, mesmo repetível',
    (code) => {
      const d = decidirRetry({
        code,
        tentativa: 1,
        maxTentativas: MAX_TENTATIVAS_PADRAO,
        repetivel: true
      })

      expect(d).toEqual({ repetir: false, motivo: 'codigo-terminal' })
    }
  )

  it('quando as duas recusas se aplicam, a repetibilidade é a que responde', () => {
    // O caso que prova a **ordem**, e não só as regras. Uma mutação sem chave contra um 401
    // dispara as duas recusas; qual delas o motivo nomeia determina o que a auditoria conta e,
    // mais importante, qual regra alguém vai achar que pode relaxar depois.
    //
    // A repetibilidade vem primeiro porque é a mais forte: `codigo-terminal` depende de uma
    // lista que cresce; `nao-repetivel` vale para **todo** código, inclusive os que ainda não
    // existem. Invertida a ordem, este teste é o único que fica vermelho — os outros não
    // distinguem os dois motivos porque neles só uma recusa se aplica.
    const d = decidirRetry({
      code: 'credencial-recusada',
      tentativa: 1,
      maxTentativas: MAX_TENTATIVAS_PADRAO,
      repetivel: false
    })

    expect(d).toEqual({ repetir: false, motivo: 'nao-repetivel' })
  })

  it('e o orçamento de tentativas é o último a falar', () => {
    // Esgotado **e** não repetível: nem por isso o motivo vira `esgotou`. Só faz sentido
    // perguntar "já tentei demais?" sobre algo que valeria a pena tentar.
    const d = decidirRetry({
      code: 'timeout',
      tentativa: 99,
      maxTentativas: MAX_TENTATIVAS_PADRAO,
      repetivel: false
    })

    expect(d).toEqual({ repetir: false, motivo: 'nao-repetivel' })
  })

  it('para quando o orçamento de tentativas acaba', () => {
    const d = decidirRetry({
      code: 'timeout',
      tentativa: MAX_TENTATIVAS_PADRAO,
      maxTentativas: MAX_TENTATIVAS_PADRAO,
      repetivel: true
    })

    expect(d).toEqual({ repetir: false, motivo: 'esgotou' })
  })

  it('todo código fora da lista de retry é terminal por omissão', () => {
    // A garantia estrutural: um `ConnectorErrorCode` novo acrescentado amanhã cai no caso
    // conservador. Este teste falha se alguém inverter a lista para "quem pode retentar".
    const retentaveis = CONNECTOR_ERROR_CODES.filter(
      (c) =>
        decidirRetry({ code: c, tentativa: 1, maxTentativas: 3, repetivel: true }).repetir === true
    )

    expect([...retentaveis].sort()).toEqual(['indisponivel', 'timeout'])
  })
})

describe('calcularEspera — a orientação do serviço vence a nossa curva', () => {
  it('usa o Retry-After quando o serviço o informa', () => {
    expect(calcularEspera({ tentativa: 1, retryAfterMs: 5_000 })).toBe(5_000)
  })

  it('trunca uma orientação absurda no teto', () => {
    // Um `Retry-After` de uma hora penduraria a chamada. Truncar é honesto: falha mais cedo e o
    // usuário decide, em vez de o app parecer travado.
    expect(calcularEspera({ tentativa: 1, retryAfterMs: 3_600_000 })).toBe(BACKOFF_MAXIMO_MS)
  })

  it('ignora orientação inválida e cai no backoff', () => {
    expect(calcularEspera({ tentativa: 1, retryAfterMs: 0 })).toBe(BACKOFF_BASE_MS)
    expect(calcularEspera({ tentativa: 1, retryAfterMs: -1 })).toBe(BACKOFF_BASE_MS)
  })

  it('cresce exponencialmente sem orientação', () => {
    expect(calcularEspera({ tentativa: 1 })).toBe(500)
    expect(calcularEspera({ tentativa: 2 })).toBe(1_000)
    expect(calcularEspera({ tentativa: 3 })).toBe(2_000)
  })

  it('o backoff também respeita o teto', () => {
    expect(calcularEspera({ tentativa: 20 })).toBe(BACKOFF_MAXIMO_MS)
  })
})

describe('circuit breaker — impede tempestade, não converte falha em sucesso', () => {
  it('não conta contra o serviço o que é problema nosso', () => {
    // Credencial e permissão dizem respeito a nós; contá-las abriria o circuito e barraria
    // chamadas que funcionariam — um problema de configuração virando apagão.
    expect(contaContraOBreaker('credencial-recusada')).toBe(false)
    expect(contaContraOBreaker('permissao-negada')).toBe(false)
    expect(contaContraOBreaker('limite-excedido')).toBe(false)
    expect(contaContraOBreaker('validacao-invalida')).toBe(false)
    expect(contaContraOBreaker('cancelado')).toBe(false)
  })

  it('conta o que indica serviço mal', () => {
    expect(contaContraOBreaker('indisponivel')).toBe(true)
    expect(contaContraOBreaker('timeout')).toBe(true)
  })

  it('abre depois de falhas consecutivas e fecha na primeira prova bem-sucedida', () => {
    const agora = 1_000_000
    let estado = CIRCUITO_FECHADO

    for (let i = 1; i < FALHAS_PARA_ABRIR; i += 1) {
      estado = proximoCircuito(estado, true, agora)
      expect(circuitoAberto(estado, agora)).toBe(false)
    }

    estado = proximoCircuito(estado, true, agora)
    expect(circuitoAberto(estado, agora)).toBe(true)
    // E fecha sozinho quando a janela passa: o breaker deixa uma chamada de prova sair.
    expect(circuitoAberto(estado, agora + CIRCUITO_ABERTO_MS + 1)).toBe(false)

    // Sucesso zera por completo, e não decrementa: a prova que passou é evidência de que o
    // serviço voltou. Decrementar manteria o app cauteloso contra um serviço já de pé.
    expect(proximoCircuito(estado, false, agora)).toEqual(CIRCUITO_FECHADO)
  })
})

describe('avaliarCreditos — o ledger separado (critério 8)', () => {
  it('permite o que cabe', () => {
    expect(avaliarCreditos(TETO, ZERO, 10)).toEqual({ decisao: 'permitido' })
  })

  it('bloqueia o que estoura o teto do dia, nomeando o período', () => {
    const v = avaliarCreditos(TETO, { dia: 95, mes: 95 }, 10)

    expect(v).toEqual({ decisao: 'bloqueado', periodo: 'dia', limite: 100, projetado: 105 })
  })

  it('bloqueia pelo mês quando o dia cabe', () => {
    const v = avaliarCreditos(TETO, { dia: 0, mes: 995 }, 10)

    expect(v.decisao).toBe('bloqueado')
    expect(v).toMatchObject({ periodo: 'mes' })
  })

  it('gastar exatamente o teto é respeitá-lo, não excedê-lo', () => {
    expect(avaliarCreditos(TETO, { dia: 90, mes: 0 }, 10)).toEqual({ decisao: 'permitido' })
  })

  it('custo zero sempre passa, mesmo com o teto estourado', () => {
    // O GitHub não cobra. Barrar uma chamada gratuita porque uma chamada paga estourou a cota
    // seria cobrar por algo que não custa.
    expect(avaliarCreditos(TETO, { dia: 9_999, mes: 9_999 }, 0)).toEqual({ decisao: 'permitido' })
  })

  it('não tem caminho de alerta — crédito é cota comprada, não decisão de gasto', () => {
    // A diferença deliberada em relação ao `VereditoDoOrcamento`, que tem três caminhos. Um
    // alerta aqui pediria uma decisão que o usuário não tem como tomar no meio da chamada.
    const decisoes = new Set(
      [1, 50, 79, 80, 99, 100, 101].map((c) => avaliarCreditos(TETO, ZERO, c).decisao)
    )

    expect([...decisoes].sort()).toEqual(['bloqueado', 'permitido'])
  })

  it('o teto padrão é conservador e existe sem ninguém o editar', () => {
    const padrao = tetoDeCreditosPadrao('u-1', 'noa', 'tavily')

    expect(padrao.dailyLimit).toBeGreaterThan(0)
    expect(padrao.monthlyLimit).toBeGreaterThan(padrao.dailyLimit)
  })

  it('a mensagem de bloqueio nomeia o conector, os números e o que fazer', () => {
    const msg = mensagemDeCreditoEsgotado('tavily', {
      decisao: 'bloqueado',
      periodo: 'dia',
      limite: 100,
      projetado: 105
    })

    expect(msg).toContain('tavily')
    expect(msg).toContain('100')
    expect(msg).toContain('Configurações')
  })
})
