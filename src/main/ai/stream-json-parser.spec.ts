/**
 * Fixtures **reais**: cada linha abaixo foi capturada de uma execução verdadeira de
 * `claude --print --output-format stream-json --verbose` em 2026-09-04, e só teve identificadores
 * e caminhos encurtados. Fixture inventada aqui provaria que o parser entende o formato que eu
 * imaginei, e o formato que importa é o que o CLI emite.
 */

import { describe, expect, it } from 'vitest'
import { extrairLinhas, parsearLinha } from './stream-json-parser'
import { LIMITE_RESUMO_BYTES } from '@shared/domain/geracao'

const LINHA_INIT =
  '{"type":"system","subtype":"init","cwd":"C:\\\\Desenv","session_id":"3c0bef5b","tools":["Task","Bash","Read"]}'

const LINHA_HOOK =
  '{"type":"system","subtype":"hook_started","hook_id":"caada721","hook_name":"SessionStart:startup","session_id":"3c0bef5b"}'

const LINHA_RATE_LIMIT =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1788554400},"session_id":"3c0bef5b"}'

const LINHA_TEXTO =
  '{"type":"assistant","message":{"model":"claude-fable-5-1","id":"msg_011Ceii9","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":2,"output_tokens":4}},"session_id":"3c0bef5b"}'

const LINHA_TOOL_USE =
  '{"type":"assistant","message":{"model":"claude-fable-5-1","id":"msg_02","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_015gkD9b","name":"Bash","input":{"command":"cat package.json","description":"Read package.json"},"caller":{"type":"direct"}}]},"session_id":"3c0bef5b"}'

const LINHA_TOOL_RESULT =
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_015gkD9b","type":"tool_result","content":"cat: package.json: No such file","is_error":false}]},"session_id":"3c0bef5b"}'

const LINHA_TOOL_RESULT_ERRO =
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_015gkD9b","type":"tool_result","content":"permissão negada","is_error":true}]},"session_id":"3c0bef5b"}'

const LINHA_RESULT =
  '{"type":"result","subtype":"success","duration_api_ms":2608,"stop_reason":"end_turn","session_id":"3c0bef5b","total_cost_usd":1.715,"usage":{"input_tokens":2,"cache_creation_input_tokens":85394,"cache_read_input_tokens":27802,"output_tokens":4}}'

const LINHA_CORROMPIDA = '{"type":"assistant","message":{"content":[{"type":"text","tex'

describe('extrairLinhas', () => {
  it('separa linhas completas e guarda o pedaço incompleto', () => {
    const { linhas, resto } = extrairLinhas('{"a":1}\n{"b":2}\n{"c":')

    expect(linhas).toEqual(['{"a":1}', '{"b":2}'])
    expect(resto).toBe('{"c":')
  })

  it('não devolve resto quando o buffer termina em quebra de linha', () => {
    const { linhas, resto } = extrairLinhas('{"a":1}\n')

    expect(linhas).toEqual(['{"a":1}'])
    expect(resto).toBe('')
  })

  it('descarta linha em branco', () => {
    const { linhas } = extrairLinhas('{"a":1}\n\n{"b":2}\n')

    expect(linhas).toEqual(['{"a":1}', '{"b":2}'])
  })
})

describe('parsearLinha — ruído de sessão', () => {
  it('ignora init, hooks e rate limit sem virar erro', () => {
    expect(parsearLinha(LINHA_INIT)).toEqual([])
    expect(parsearLinha(LINHA_HOOK)).toEqual([])
    expect(parsearLinha(LINHA_RATE_LIMIT)).toEqual([])
  })

  it('ignora tipo desconhecido por omissão, não por lista negra', () => {
    expect(parsearLinha('{"type":"telemetria_que_ainda_nao_existe","x":1}')).toEqual([])
  })
})

describe('parsearLinha — a geração', () => {
  it('lê o texto do modelo', () => {
    expect(parsearLinha(LINHA_TEXTO)).toEqual([{ tipo: 'texto', delta: 'ok' }])
  })

  it('lê a chamada de ferramenta com nome e resumo do argumento', () => {
    expect(parsearLinha(LINHA_TOOL_USE)).toEqual([
      {
        tipo: 'ferramenta-inicio',
        chamadaId: 'toolu_015gkD9b',
        nome: 'Bash',
        resumoDoArgumento: 'cat package.json'
      }
    ])
  })

  it('lê o resultado da ferramenta com status ok', () => {
    expect(parsearLinha(LINHA_TOOL_RESULT)).toEqual([
      {
        tipo: 'ferramenta-fim',
        chamadaId: 'toolu_015gkD9b',
        status: 'ok',
        resumoDoResultado: 'cat: package.json: No such file',
        tamanhoOriginal: 31
      }
    ])
  })

  it('marca status erro quando is_error é true', () => {
    const [evento] = parsearLinha(LINHA_TOOL_RESULT_ERRO)

    expect(evento).toMatchObject({ tipo: 'ferramenta-fim', status: 'erro' })
  })

  it('lê o uso do result, somando os tokens de cache na entrada', () => {
    expect(parsearLinha(LINHA_RESULT)).toEqual([
      {
        tipo: 'uso',
        // 2 + 85394 + 27802 — o contexto lido conta como entrada.
        tokensEntrada: 113198,
        tokensSaida: 4,
        duracaoMs: 2608
      }
    ])
  })

  it('emite vários eventos quando a mensagem traz vários blocos', () => {
    const linha = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'vou ler o arquivo' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } }
        ]
      }
    })

    expect(parsearLinha(linha)).toEqual([
      { tipo: 'texto', delta: 'vou ler o arquivo' },
      {
        tipo: 'ferramenta-inicio',
        chamadaId: 'toolu_1',
        nome: 'Read',
        resumoDoArgumento: '/tmp/a.ts'
      }
    ])
  })

  it('lê o resultado entregue como lista de blocos, não só como string', () => {
    const linha = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_1',
            type: 'tool_result',
            content: [
              { type: 'text', text: 'primeira parte' },
              { type: 'image', source: {} },
              { type: 'text', text: 'segunda parte' }
            ]
          }
        ]
      }
    })

    expect(parsearLinha(linha)).toEqual([
      {
        tipo: 'ferramenta-fim',
        chamadaId: 'toolu_1',
        status: 'ok',
        resumoDoResultado: 'primeira parte\nsegunda parte',
        tamanhoOriginal: 28
      }
    ])
  })

  it('trunca resultado acima de 2 KB e preserva o tamanho original (critério 4)', () => {
    const linha = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { tool_use_id: 'toolu_1', type: 'tool_result', content: 'x'.repeat(LIMITE_RESUMO_BYTES * 2) }
        ]
      }
    })

    const [evento] = parsearLinha(linha)

    expect(evento).toEqual({
      tipo: 'ferramenta-fim',
      chamadaId: 'toolu_1',
      status: 'ok',
      resumoDoResultado: 'x'.repeat(LIMITE_RESUMO_BYTES),
      tamanhoOriginal: LIMITE_RESUMO_BYTES * 2
    })
  })
})

describe('parsearLinha — falha aberta (critério 5)', () => {
  it('linha corrompida vira erro de parser, sem lançar', () => {
    expect(parsearLinha(LINHA_CORROMPIDA)).toEqual([
      { tipo: 'erro', mensagem: 'Uma linha do Claude Code CLI não pôde ser interpretada.' }
    ])
  })

  it('a mensagem de erro não ecoa o conteúdo da linha', () => {
    const [evento] = parsearLinha('{"segredo":"sk-ant-api03-vazamento')

    expect(evento).toBeDefined()
    expect(JSON.stringify(evento)).not.toContain('sk-ant')
  })

  it('a geração continua depois da linha corrompida', () => {
    const eventos = [LINHA_TEXTO, LINHA_CORROMPIDA, LINHA_RESULT].flatMap((l) => parsearLinha(l))

    expect(eventos.map((e) => e.tipo)).toEqual(['texto', 'erro', 'uso'])
  })

  it('não lança com JSON válido de forma inesperada', () => {
    expect(parsearLinha('null')).toEqual([])
    expect(parsearLinha('42')).toEqual([])
    expect(parsearLinha('"texto"')).toEqual([])
    expect(parsearLinha('{"type":"assistant","message":null}')).toEqual([])
    expect(parsearLinha('{"type":"assistant","message":{"content":"nao e lista"}}')).toEqual([])
    expect(parsearLinha('{"type":"assistant","message":{"content":[null,42]}}')).toEqual([])
  })

  it('descarta bloco de ferramenta sem id — evento órfão seria pior que ausente', () => {
    const linha = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] }
    })

    expect(parsearLinha(linha)).toEqual([])
  })

  it('usa zero quando o result vem sem usage, nunca NaN', () => {
    expect(parsearLinha('{"type":"result","subtype":"success"}')).toEqual([
      { tipo: 'uso', tokensEntrada: 0, tokensSaida: 0, duracaoMs: 0 }
    ])
  })
})
