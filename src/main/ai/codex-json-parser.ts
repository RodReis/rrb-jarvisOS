/**
 * O parser do `codex exec --json` (SPEC-Fases-06 § Dentro).
 *
 * Traduz o JSONL do Codex CLI em `GenerationEvent` do domínio. É a **única** parte do app que
 * conhece o formato do Codex: acima dele, ninguém sabe que existe `item.completed` nem
 * `ThreadItemDetails`.
 *
 * ## Por que um parser próprio, e não ramos no do Claude Code
 *
 * Os dois formatos não têm um campo em comum. O Claude Code emite `message.content[].type`; o
 * Codex emite `item.completed` com `item.type`. Unificá-los seria um `if (provider)` dentro de
 * uma função só — exatamente o que o Done 1 do MVP-010 proíbe (*"Claude e Codex passam pelo mesmo
 * contract test **sem compartilhar parser**"*), e um bug no ramo comum atingiria os dois
 * providers de uma vez. Decisão do PI, 2026-09-05.
 *
 * ## Falha aberta para o texto, fechada para o console
 *
 * Mesma postura do `stream-json-parser`: linha que não parseia vira `erro` e a geração
 * **continua**. O documento é o produto; o console é evidência. Nenhuma função aqui lança.
 *
 * ## O que o formato garante, medido e confirmado na fonte
 *
 * O contrato do CLI é explícito (`codex-rs/exec/src/lib.rs`): *"In --json mode, stdout must be
 * valid JSONL, one event per line. For both modes, any other output must be written to stderr."*
 * Medido no 0.149.0: **zero** linhas não-JSON no stdout, com todos os logs no stderr. Por isso
 * este parser não precisa filtrar ruído de texto, ao contrário do que o CLI do Claude exigiria.
 *
 * Os nomes dos tipos vêm de `codex-rs/exec/src/exec_events.rs` (`ThreadEvent` e
 * `ThreadItemDetails`), não de adivinhação.
 */

import {
  resumoDoArgumento,
  truncarBytes,
  type GenerationEvent,
  type StatusDaFerramenta
} from '@shared/domain/geracao'

/**
 * Os tipos de item que **são ferramentas** no vocabulário do console (F03).
 *
 * `agent_message` e `reasoning` não entram: o primeiro é o texto do documento e o segundo é
 * raciocínio interno, que a spec da F03 não expõe. `todo_list` também fica fora — é planejamento
 * do agente, não trabalho executado.
 *
 * Dado e não `if`: acrescentar um tipo de ferramenta passa a ser acrescentar uma linha, e um tipo
 * novo do CLI é **ignorado sozinho** em vez de virar erro no painel do PI a cada geração.
 */
const ITENS_DE_FERRAMENTA: Readonly<Record<string, string>> = {
  command_execution: 'Comando',
  file_change: 'Arquivo',
  mcp_tool_call: 'Ferramenta MCP',
  collab_tool_call: 'Colaboração',
  web_search: 'Busca na web'
}

/** Acumula bytes do stdout e devolve as linhas completas, guardando o resto. */
export function extrairLinhasDoCodex(buffer: string): {
  readonly linhas: readonly string[]
  readonly resto: string
} {
  const partes = buffer.split('\n')
  // A última parte é o pedaço incompleto. Emiti-la entregaria JSON cortado ao parser, que o
  // reportaria como erro de formato — um erro nosso, de bufferização, disfarçado de erro do CLI.
  const resto = partes.pop() ?? ''
  return { linhas: partes.filter((linha) => linha.trim() !== ''), resto }
}

/** Lê um inteiro de payload de terceiro. Ausente ou não-numérico vira 0, nunca `NaN`. */
function inteiro(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.max(0, Math.trunc(valor)) : 0
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

/** O `item` de um `item.started`/`item.completed`, no que este parser precisa dele. */
interface ItemDoCodex {
  readonly id?: unknown
  readonly type?: unknown
  readonly text?: unknown
  readonly message?: unknown
  readonly command?: unknown
  readonly path?: unknown
  readonly query?: unknown
  readonly tool?: unknown
  readonly status?: unknown
  readonly aggregated_output?: unknown
  readonly exit_code?: unknown
}

/**
 * O que descreve a ferramenta na linha do console.
 *
 * Cada tipo de item tem seu campo natural — `command` no comando, `path` no arquivo, `query` na
 * busca. Cair no JSON inteiro quando nenhum existe é deliberado: melhor um resumo feio do que uma
 * linha vazia que não diz o que o agente fez.
 */
function argumentoDoItem(item: ItemDoCodex, nome: string): string {
  const candidatos = [item.command, item.path, item.query, item.tool]
  for (const candidato of candidatos) {
    if (typeof candidato === 'string' && candidato !== '') return candidato
  }
  return resumoDoArgumento(nome, item)
}

/**
 * O desfecho da ferramenta.
 *
 * `exit_code` diferente de zero é falha mesmo quando o `status` diz outra coisa: o código de saída
 * é o fato, e o campo textual é a interpretação do CLI sobre ele.
 */
function statusDoItem(item: ItemDoCodex): StatusDaFerramenta {
  if (typeof item.exit_code === 'number' && item.exit_code !== 0) return 'erro'
  const status = texto(item.status).toLowerCase()
  if (status === 'failed' || status === 'error') return 'erro'
  return 'ok'
}

/**
 * Traduz uma linha do JSONL em zero ou mais `GenerationEvent`.
 *
 * Devolve lista, e não um evento: um `item.completed` de ferramenta produz **dois** eventos
 * (início e fim), porque o console da F03 modela ferramenta como par — e o `codex exec --json`
 * pode entregar só o `completed` quando a ferramenta é rápida.
 */
export function parsearLinhaDoCodex(linha: string): readonly GenerationEvent[] {
  let evento: Record<string, unknown>
  try {
    const analisado: unknown = JSON.parse(linha)
    if (typeof analisado !== 'object' || analisado === null) {
      return [{ tipo: 'erro', mensagem: 'Linha do Codex não é um objeto JSON.' }]
    }
    evento = analisado as Record<string, unknown>
  } catch {
    // Falha aberta: o console registra que a linha veio malformada, e a geração continua.
    return [{ tipo: 'erro', mensagem: 'Linha do Codex não pôde ser lida como JSON.' }]
  }

  const tipo = texto(evento.type)

  // O uso medido chega no `turn.completed` (confirmado em `sdk/typescript/src/events.ts`:
  // `TurnCompletedEvent = { type: "turn.completed"; usage: Usage }`). Preferir o número medido a
  // qualquer aproximação é a mesma regra que a M26-F03 estabeleceu para o Claude Code.
  if (tipo === 'turn.completed') {
    const uso = (evento.usage ?? {}) as Record<string, unknown>
    return [
      {
        tipo: 'uso',
        tokensEntrada: inteiro(uso.input_tokens),
        tokensSaida: inteiro(uso.output_tokens),
        duracaoMs: 0
      }
    ]
  }

  // `turn.failed` carrega **só** a mensagem no modo `--json` (confirmado em
  // `event_processor_with_jsonl_output.rs`: os campos estruturados são descartados na serialização).
  if (tipo === 'turn.failed') {
    const erro = (evento.error ?? {}) as Record<string, unknown>
    const mensagem = texto(erro.message)
    return [{ tipo: 'erro', mensagem: mensagem === '' ? 'A geração do Codex falhou.' : mensagem }]
  }

  if (tipo === 'error') {
    const mensagem = texto(evento.message)
    return mensagem === '' ? [] : [{ tipo: 'erro', mensagem }]
  }

  if (tipo === 'item.completed' || tipo === 'item.started') {
    return eventosDoItem(evento, tipo === 'item.completed')
  }

  /*
   * Ignorado por omissão, e não por lista negra: `thread.started`, `turn.started`,
   * `item.updated` e o que o CLI acrescentar amanhã não são a geração — são ciclo de sessão.
   *
   * Uma lista negra faria cada tipo novo do CLI virar uma linha de `erro` no painel do PI a cada
   * geração. É a mesma decisão do `stream-json-parser`, e pela mesma razão.
   *
   * **`item.updated` não perde texto**, e isso foi verificado antes de decidir: o `exec --json`
   * não emite delta de texto (medido no 0.149.0, e a documentação do CLI trata `item/completed`
   * como *"the authoritative execution/result state"*). O streaming token a token é um evento do
   * **app-server** (`item/agentMessage/delta`), um protocolo diferente que esta fatia não usa.
   * Tratar `item.updated` como texto duplicaria o conteúdo no dia em que o CLI passasse a
   * emiti-lo junto do `completed`.
   */
  return []
}

function eventosDoItem(
  evento: Record<string, unknown>,
  completado: boolean
): readonly GenerationEvent[] {
  const item = (evento.item ?? {}) as ItemDoCodex
  const tipoDoItem = texto(item.type)

  // O texto do documento sai daqui — é o `agent_message`, o equivalente do `text` no Claude Code.
  if (tipoDoItem === 'agent_message') {
    const conteudo = texto(item.text)
    return conteudo === '' ? [] : [{ tipo: 'texto', delta: conteudo }]
  }

  // Um item de erro do próprio CLI (ex.: a queda de WebSocket para HTTPS, medida no 0.149.0).
  if (tipoDoItem === 'error') {
    const mensagem = texto(item.message)
    return mensagem === '' ? [] : [{ tipo: 'erro', mensagem }]
  }

  const rotulo = ITENS_DE_FERRAMENTA[tipoDoItem]
  if (rotulo === undefined) return []

  const chamadaId = texto(item.id) === '' ? tipoDoItem : texto(item.id)
  const inicio: GenerationEvent = {
    tipo: 'ferramenta-inicio',
    chamadaId,
    nome: rotulo,
    resumoDoArgumento: argumentoDoItem(item, rotulo)
  }

  if (!completado) return [inicio]

  const saida = texto(item.aggregated_output)
  const truncado = truncarBytes(saida)

  /*
   * **Os dois eventos, mesmo quando só o `completed` chegou.**
   *
   * O console da F03 modela ferramenta como par início/fim, e uma ferramenta rápida do Codex pode
   * produzir só o `item.completed` — sem o par, ela apareceria como um fim órfão. Emitir os dois
   * a partir de um evento é o que mantém o painel coerente sem o console precisar saber qual CLI
   * está do outro lado.
   */
  return [
    inicio,
    {
      tipo: 'ferramenta-fim',
      chamadaId,
      status: statusDoItem(item),
      resumoDoResultado: truncado.resumo,
      tamanhoOriginal: truncado.tamanhoOriginal
    }
  ]
}
