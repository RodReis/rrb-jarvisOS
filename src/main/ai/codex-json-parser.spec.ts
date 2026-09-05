/**
 * O parser do `codex exec --json` (SPEC-Fases-06, critério 3).
 *
 * **As fixtures são reais**, não inventadas: as linhas de erro foram medidas no CLI 0.149.0 com
 * um `CODEX_HOME` vazio, e os nomes dos tipos vêm da fonte do CLI
 * (`codex-rs/exec/src/exec_events.rs` — `ThreadEvent` e `ThreadItemDetails`). Um parser testado
 * contra formato imaginado passa verde e falha no primeiro uso real.
 */

import { describe, expect, it } from 'vitest'
import { extrairLinhasDoCodex, parsearLinhaDoCodex } from './codex-json-parser'

/** Linha medida no CLI 0.149.0, perfil vazio. */
const TURN_FAILED_REAL =
  '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses"}}'

/** Também medida: o CLI reporta a queda de WebSocket como item de erro. */
const ITEM_ERRO_REAL =
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Falling back from WebSockets to HTTPS transport."}}'

describe('extrairLinhasDoCodex', () => {
  it('entrega linhas completas e guarda o pedaço incompleto', () => {
    const { linhas, resto } = extrairLinhasDoCodex('{"a":1}\n{"b":2}\n{"c":')

    expect(linhas).toEqual(['{"a":1}', '{"b":2}'])
    expect(resto).toBe('{"c":')
  })

  /**
   * Sem isto, o JSON cortado entre dois `data` do stdout chegaria ao parser e viraria uma linha de
   * `erro` — um defeito nosso, de bufferização, disfarçado de erro do CLI.
   */
  it('não emite o pedaço incompleto como linha', () => {
    expect(extrairLinhasDoCodex('{"parcial"').linhas).toEqual([])
  })

  it('descarta linhas em branco', () => {
    expect(extrairLinhasDoCodex('{"a":1}\n\n\n{"b":2}\n').linhas).toEqual(['{"a":1}', '{"b":2}'])
  })
})

describe('texto do documento', () => {
  /** `agent_message` é o equivalente do `text` do Claude Code: o conteúdo que o PI recebe. */
  it('traduz agent_message em texto', () => {
    const eventos = parsearLinhaDoCodex(
      '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"O brief está pronto."}}'
    )

    expect(eventos).toEqual([{ tipo: 'texto', delta: 'O brief está pronto.' }])
  })

  it('ignora agent_message vazio em vez de emitir texto em branco', () => {
    expect(
      parsearLinhaDoCodex('{"type":"item.completed","item":{"type":"agent_message","text":""}}')
    ).toEqual([])
  })

  /**
   * `reasoning` é raciocínio interno e **não** entra no console: a F03 mostra o que o agente fez,
   * não o que ele pensou. Sem esta exclusão, o painel do PI encheria de monólogo.
   */
  it('não trata reasoning como texto do documento', () => {
    expect(
      parsearLinhaDoCodex(
        '{"type":"item.completed","item":{"type":"reasoning","text":"vou começar pelo…"}}'
      )
    ).toEqual([])
  })
})

describe('ferramentas', () => {
  /**
   * O console modela ferramenta como **par** início/fim, e o Codex pode entregar só o
   * `item.completed` quando a execução é rápida. Emitir os dois a partir de um evento é o que
   * evita um fim órfão no painel.
   */
  it('emite início e fim a partir de um único item.completed', () => {
    const eventos = parsearLinhaDoCodex(
      '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"npm test","exit_code":0,"aggregated_output":"ok"}}'
    )

    expect(eventos).toHaveLength(2)
    expect(eventos[0]).toEqual({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Comando',
      resumoDoArgumento: 'npm test'
    })
    expect(eventos[1]).toMatchObject({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'ok'
    })
  })

  it('emite só o início quando o item ainda está em andamento', () => {
    const eventos = parsearLinhaDoCodex(
      '{"type":"item.started","item":{"id":"c2","type":"command_execution","command":"npm run build"}}'
    )

    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ tipo: 'ferramenta-inicio', chamadaId: 'c2' })
  })

  /**
   * **`exit_code` vence o `status`**: o código de saída é o fato, e o campo textual é a
   * interpretação do CLI sobre ele. Um parser que confiasse só no `status` pintaria de verde uma
   * ferramenta que falhou.
   */
  it('marca erro quando o exit_code não é zero, mesmo com status dizendo o contrário', () => {
    const eventos = parsearLinhaDoCodex(
      '{"type":"item.completed","item":{"id":"c3","type":"command_execution","command":"npm test","status":"completed","exit_code":1}}'
    )

    expect(eventos[1]).toMatchObject({ tipo: 'ferramenta-fim', status: 'erro' })
  })

  it('reconhece os demais tipos de ferramenta com o campo natural de cada um', () => {
    const arquivo = parsearLinhaDoCodex(
      '{"type":"item.completed","item":{"id":"f1","type":"file_change","path":"src/app.ts"}}'
    )
    expect(arquivo[0]).toMatchObject({ nome: 'Arquivo', resumoDoArgumento: 'src/app.ts' })

    const busca = parsearLinhaDoCodex(
      '{"type":"item.completed","item":{"id":"w1","type":"web_search","query":"vitest fixtures"}}'
    )
    expect(busca[0]).toMatchObject({ nome: 'Busca na web', resumoDoArgumento: 'vitest fixtures' })
  })

  /**
   * Tipo desconhecido é **ignorado**, não reportado como erro.
   *
   * Uma lista negra faria cada tipo novo do CLI virar uma linha de erro no painel a cada geração —
   * a mesma decisão do parser do Claude Code, e pela mesma razão.
   */
  it('ignora tipo de item que não conhece, em vez de acusar erro', () => {
    expect(
      parsearLinhaDoCodex('{"type":"item.completed","item":{"type":"todo_list","items":[]}}')
    ).toEqual([])
  })
})

describe('uso medido', () => {
  /**
   * O uso vem no `turn.completed` (`TurnCompletedEvent = { type, usage }` no SDK oficial).
   *
   * Preferir o número medido a qualquer aproximação por caracteres é a regra que a M26-F03
   * estabeleceu — e ali o ganho foi de 230.444 tokens medidos contra ~30 estimados.
   */
  it('lê tokens de entrada e saída do turn.completed', () => {
    const eventos = parsearLinhaDoCodex(
      '{"type":"turn.completed","usage":{"input_tokens":1200,"output_tokens":340}}'
    )

    expect(eventos).toEqual([
      { tipo: 'uso', tokensEntrada: 1200, tokensSaida: 340, duracaoMs: 0 }
    ])
  })

  /** Campo ausente vira 0, nunca `NaN` — um `NaN` no ledger contaminaria a soma inteira. */
  it('trata usage ausente como zero, não como NaN', () => {
    const eventos = parsearLinhaDoCodex('{"type":"turn.completed"}')

    expect(eventos).toEqual([{ tipo: 'uso', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 }])
  })
})

describe('erros', () => {
  /** Fixture **real**, medida no CLI 0.149.0 com perfil sem credencial. */
  it('traduz o turn.failed real do CLI em erro com a mensagem', () => {
    const eventos = parsearLinhaDoCodex(TURN_FAILED_REAL)

    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ tipo: 'erro' })
    expect((eventos[0] as { mensagem: string }).mensagem).toContain('401 Unauthorized')
  })

  it('traduz o item de erro real do CLI', () => {
    const eventos = parsearLinhaDoCodex(ITEM_ERRO_REAL)

    expect(eventos).toHaveLength(1)
    expect((eventos[0] as { mensagem: string }).mensagem).toContain('Falling back from WebSockets')
  })

  it('dá mensagem própria quando o turn.failed não traz uma', () => {
    const eventos = parsearLinhaDoCodex('{"type":"turn.failed","error":{}}')

    expect((eventos[0] as { mensagem: string }).mensagem).toMatch(/falhou/i)
  })

  /**
   * **Falha aberta:** linha malformada vira `erro` e a geração continua.
   *
   * O documento é o produto e o console é evidência — uma exceção aqui pararia a jornada por uma
   * mudança de formato do CLI.
   */
  it('não lança em linha que não é JSON', () => {
    const eventos = parsearLinhaDoCodex('isto não é json {{{')

    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ tipo: 'erro' })
  })

  it('não lança em JSON que não é objeto', () => {
    expect(parsearLinhaDoCodex('42')[0]).toMatchObject({ tipo: 'erro' })
  })
})

describe('ciclo de sessão é ignorado', () => {
  /**
   * `thread.started`, `turn.started` e `item.updated` não são a geração — são ruído de sessão.
   *
   * As três linhas foram medidas no CLI real; ignorá-las por omissão é o que mantém o painel do PI
   * limpo sem uma lista negra a manter.
   */
  it.each([
    '{"type":"thread.started","thread_id":"01a06f74"}',
    '{"type":"turn.started"}',
    '{"type":"item.updated","item":{"type":"agent_message","text":"parcial"}}'
  ])('ignora %s', (linha) => {
    expect(parsearLinhaDoCodex(linha)).toEqual([])
  })
})
