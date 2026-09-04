/**
 * O parser do `--output-format stream-json` do Claude Code CLI (SPEC-Fases-03 § Adapter).
 *
 * Traduz o NDJSON do CLI em `GenerationEvent` do domínio. É a **única** parte do app que conhece
 * o formato do CLI: acima dele, ninguém sabe que existe um campo `message.content[].type`.
 *
 * ## Falha aberta para o texto, fechada para o console
 *
 * Linha que não parseia vira `erro` e a geração **continua** (SPEC § Adapter; decisão cravada
 * pelo Cowork). O documento é o produto e o console é evidência — trocar a ordem faria uma
 * mudança de formato do CLI parar a jornada inteira. Por isso nenhuma função aqui lança: entrada
 * inesperada devolve `erro` ou `undefined`, nunca exceção.
 *
 * ## O que é ignorado, e por quê
 *
 * O CLI emite muito mais do que interessa: `system/init` (com a lista inteira de ferramentas
 * disponíveis), `system/hook_started`, `hook_response`, `rate_limit_event`. Nada disso é a
 * geração — é ruído de sessão. Ignorar por omissão (`undefined`) e não por lista negra: o dia em
 * que o CLI acrescentar um tipo novo de telemetria, ele será ignorado sozinho, em vez de virar
 * uma linha de `erro` no painel do PI a cada geração.
 */

import {
  resumoDoArgumento,
  truncarBytes,
  type GenerationEvent,
  type StatusDaFerramenta
} from '@shared/domain/geracao'

/** Acumula bytes do stdout e devolve as linhas completas, guardando o resto. */
export function extrairLinhas(buffer: string): {
  readonly linhas: readonly string[]
  readonly resto: string
} {
  const partes = buffer.split('\n')
  // A última parte é o pedaço incompleto (ou '' quando o buffer terminou em '\n'). Emiti-la
  // como linha entregaria JSON cortado ao parser, que o reportaria como erro de formato — um
  // erro nosso, de bufferização, disfarçado de erro do CLI.
  const resto = partes.pop() ?? ''
  return { linhas: partes.filter((linha) => linha.trim() !== ''), resto }
}

/** O bloco de conteúdo de uma mensagem do CLI, no que este parser precisa dele. */
interface BlocoDeConteudo {
  readonly type?: unknown
  readonly text?: unknown
  readonly id?: unknown
  readonly name?: unknown
  readonly input?: unknown
  readonly tool_use_id?: unknown
  readonly content?: unknown
  readonly is_error?: unknown
}

/**
 * O texto de um `tool_result`, que o CLI entrega ora como string, ora como lista de blocos.
 *
 * Os dois formatos existem de verdade (o segundo aparece quando a ferramenta devolve imagem
 * junto com texto). Tratar só o primeiro faria o resultado aparecer vazio no painel exatamente
 * nas chamadas mais interessantes.
 */
function textoDoResultado(content: unknown): string {
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    return content
      .map((bloco: unknown) => {
        if (typeof bloco !== 'object' || bloco === null) return ''
        const texto = (bloco as BlocoDeConteudo).text
        return typeof texto === 'string' ? texto : ''
      })
      .filter((parte) => parte !== '')
      .join('\n')
  }

  return JSON.stringify(content) ?? ''
}

/** Lê um inteiro de um payload de terceiro. Ausente ou não-numérico vira 0, nunca `NaN`. */
function inteiro(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}

/**
 * Traduz uma linha do `stream-json` nos eventos que ela contém.
 *
 * Devolve **lista** porque uma linha de `assistant` pode carregar vários blocos — texto e duas
 * chamadas de ferramenta na mesma mensagem é comum. Lista vazia significa "linha irrelevante"
 * (telemetria, init, hooks), que é diferente de erro.
 */
export function parsearLinha(linha: string): readonly GenerationEvent[] {
  let payload: unknown
  try {
    payload = JSON.parse(linha)
  } catch {
    // Critério 5: linha inválida vira `erro` de parser, e quem consome segue lendo. A linha
    // **não** entra na mensagem: ela é conteúdo do CLI e pode carregar qualquer coisa.
    return [{ tipo: 'erro', mensagem: 'Uma linha do Claude Code CLI não pôde ser interpretada.' }]
  }

  if (typeof payload !== 'object' || payload === null) return []

  const registro = payload as Record<string, unknown>
  const tipo = registro.type

  if (tipo === 'assistant' || tipo === 'user') {
    const mensagem = registro.message
    if (typeof mensagem !== 'object' || mensagem === null) return []

    const blocos = (mensagem as Record<string, unknown>).content
    if (!Array.isArray(blocos)) return []

    return blocos.flatMap((bloco: unknown): readonly GenerationEvent[] => {
      if (typeof bloco !== 'object' || bloco === null) return []
      return eventosDoBloco(bloco as BlocoDeConteudo)
    })
  }

  if (tipo === 'result') {
    const uso = registro.usage
    const dados = typeof uso === 'object' && uso !== null ? (uso as Record<string, unknown>) : {}

    return [
      {
        tipo: 'uso',
        // Tokens de cache entram na entrada: eles **foram** lidos pelo modelo, e omiti-los faria
        // uma geração sobre 80 KB de contexto aparecer como se tivesse custado 2 tokens.
        tokensEntrada:
          inteiro(dados.input_tokens) +
          inteiro(dados.cache_creation_input_tokens) +
          inteiro(dados.cache_read_input_tokens),
        tokensSaida: inteiro(dados.output_tokens),
        duracaoMs: inteiro(registro.duration_api_ms)
      }
    ]
  }

  // `system`, `rate_limit_event` e o que o CLI inventar: ruído de sessão, não a geração.
  return []
}

function eventosDoBloco(bloco: BlocoDeConteudo): readonly GenerationEvent[] {
  if (bloco.type === 'text') {
    const texto = bloco.text
    if (typeof texto !== 'string' || texto === '') return []
    return [{ tipo: 'texto', delta: texto }]
  }

  if (bloco.type === 'tool_use') {
    const chamadaId = typeof bloco.id === 'string' ? bloco.id : ''
    const nome = typeof bloco.name === 'string' ? bloco.name : 'desconhecida'
    if (chamadaId === '') return []

    return [
      {
        tipo: 'ferramenta-inicio',
        chamadaId,
        nome,
        resumoDoArgumento: resumoDoArgumento(nome, bloco.input)
      }
    ]
  }

  if (bloco.type === 'tool_result') {
    const chamadaId = typeof bloco.tool_use_id === 'string' ? bloco.tool_use_id : ''
    if (chamadaId === '') return []

    const { resumo, tamanhoOriginal } = truncarBytes(textoDoResultado(bloco.content))
    const status: StatusDaFerramenta = bloco.is_error === true ? 'erro' : 'ok'

    return [
      { tipo: 'ferramenta-fim', chamadaId, status, resumoDoResultado: resumo, tamanhoOriginal }
    ]
  }

  return []
}
