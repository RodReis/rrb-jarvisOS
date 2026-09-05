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
 * ## Texto de `assistant` é documento; texto de `user`, não
 *
 * O CLI usa mensagens `user` para injetar coisas que ninguém digitou: o corpo de uma skill que o
 * modelo invocou, um `system-reminder`, o resultado de uma ferramenta. Tratá-las como
 * `assistant` — o que este parser fazia — despejava esse conteúdo no documento: numa geração de
 * refinamento, os ~30 KB da skill `claude-api` saíram como se fossem a resposta do modelo (#272).
 *
 * A spec é literal: `texto` é "texto do modelo, em pedaços", e conteúdo de mensagem `user` não é
 * texto do modelo. Ele vira evidência no console — truncado pela mesma régua de 2 KB do
 * `tool_result` — e **nunca** documento.
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
 * O que o parser precisa lembrar entre linhas: a última chamada de ferramenta sem resultado.
 *
 * Existe por causa do #272. O conteúdo que o CLI injeta numa mensagem `user` — o corpo de uma
 * skill, um `system-reminder` — chega **sem** `tool_use_id`, então não há como atribuí-lo a uma
 * chamada olhando só para a linha. A `GenerationEvent` é união fechada pela spec e não ganha
 * tipo novo sem passar pelo PI; o que a spec autoriza é reusar `ferramenta-fim` com o
 * `chamadaId` do `tool_use` pendente, e é isso que este estado guarda.
 *
 * Objeto passado pelo chamador, e não variável de módulo: duas gerações simultâneas
 * compartilhariam a global, e uma atribuiria à outra o resultado da sua ferramenta. O adapter
 * cria um por `generateStream`, que é exatamente o escopo de uma geração.
 */
export interface EstadoDoParser {
  /** O `id` do último `tool_use` que ainda não recebeu `tool_result`. */
  chamadaPendente?: string
  /** O `id` da chamada de `StructuredOutput`, cujo aceite não vai ao console. */
  saidaEstruturada?: string
}

/**
 * O nome da ferramenta que o CLI injeta quando recebe `--json-schema`.
 *
 * Não é uma ferramenta de agente: é o canal pelo qual a saída estruturada volta. Confirmado no
 * `system/init` do CLI 2.1.258, que com `--tools "" --json-schema <s>` reporta
 * `"tools":["StructuredOutput"]` — a lista fica com esta e mais nada, que é exatamente o
 * isolamento que a emenda E1 quer.
 */
const NOME_DA_SAIDA_ESTRUTURADA = 'StructuredOutput'

/** Um estado novo, para uma geração nova. */
export function novoEstadoDoParser(): EstadoDoParser {
  return {}
}

/**
 * Traduz uma linha do `stream-json` nos eventos que ela contém.
 *
 * Devolve **lista** porque uma linha de `assistant` pode carregar vários blocos — texto e duas
 * chamadas de ferramenta na mesma mensagem é comum. Lista vazia significa "linha irrelevante"
 * (telemetria, init, hooks), que é diferente de erro.
 *
 * O `estado` tem padrão para os testes que olham uma linha só; em produção o adapter passa
 * sempre o mesmo, porque é ele que liga o texto injetado à ferramenta que o trouxe.
 */
export function parsearLinha(
  linha: string,
  estado: EstadoDoParser = novoEstadoDoParser()
): readonly GenerationEvent[] {
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

    // **Quem falou** decide o que o bloco `text` vira. A correção do #272 vive aqui e não no
    // adapter de propósito: o adapter empurra todo `texto` para o documento, então filtrar lá
    // seria ensinar a ele o formato do CLI que este arquivo existe para esconder.
    const doModelo = tipo === 'assistant'

    return blocos.flatMap((bloco: unknown): readonly GenerationEvent[] => {
      if (typeof bloco !== 'object' || bloco === null) return []
      return eventosDoBloco(bloco as BlocoDeConteudo, doModelo, estado)
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

function eventosDoBloco(
  bloco: BlocoDeConteudo,
  doModelo: boolean,
  estado: EstadoDoParser
): readonly GenerationEvent[] {
  if (bloco.type === 'text') {
    const texto = bloco.text
    if (typeof texto !== 'string' || texto === '') return []

    // Texto do modelo: documento, inteiro e sem truncar. É o produto.
    if (doModelo) return [{ tipo: 'texto', delta: texto }]

    return [textoInjetado(texto, estado)]
  }

  if (bloco.type === 'tool_use') {
    const chamadaId = typeof bloco.id === 'string' ? bloco.id : ''
    const nome = typeof bloco.name === 'string' ? bloco.name : 'desconhecida'
    if (chamadaId === '') return []

    // A saída estruturada **é** o documento, não uma ferramenta que o modelo resolveu chamar.
    //
    // Com `--json-schema`, o CLI não pede JSON em texto: ele injeta a ferramenta
    // `StructuredOutput` e o modelo responde chamando-a, com o documento inteiro no `input`.
    // Nenhum bloco `text` aparece na geração. Tratá-la como as outras faria o documento nascer
    // vazio — e, pior, dispararia o corte do critério 3, que mata a geração quando uma
    // ferramenta é usada numa fase que não tem ferramentas.
    if (nome === NOME_DA_SAIDA_ESTRUTURADA) {
      estado.saidaEstruturada = chamadaId
      const documento = JSON.stringify(bloco.input)
      return documento === undefined ? [] : [{ tipo: 'texto', delta: documento }]
    }

    // Guardada para o texto que o CLI injetar em seguida sem dizer de qual chamada veio.
    estado.chamadaPendente = chamadaId

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

    // O aceite da saída estruturada ("Structured output provided successfully") é confirmação de
    // protocolo, não resultado de ferramenta. Mostrá-lo no console encheria o painel de uma
    // linha por geração que não diz nada ao PI.
    if (estado.saidaEstruturada === chamadaId) {
      estado.saidaEstruturada = undefined
      return []
    }

    if (estado.chamadaPendente === chamadaId) estado.chamadaPendente = undefined

    const { resumo, tamanhoOriginal } = truncarBytes(textoDoResultado(bloco.content))
    const status: StatusDaFerramenta = bloco.is_error === true ? 'erro' : 'ok'

    return [
      { tipo: 'ferramenta-fim', chamadaId, status, resumoDoResultado: resumo, tamanhoOriginal }
    ]
  }

  return []
}

/**
 * O texto que o CLI **injetou** numa mensagem `user`: corpo de skill, `system-reminder`, aviso.
 *
 * Vira `ferramenta-fim` truncado, e não `texto` — que é o defeito do #272 — nem `erro`, que
 * mentiria: conteúdo injetado é rotina do CLI, não falha. Com `tool_use` pendente, o resumo
 * aparece embaixo da chamada que o trouxe, que é onde o PI o procura; sem ele — um
 * `system-reminder` fora de qualquer ferramenta —, `chamadaId` fica vazio e a tela o mostra como
 * bloco solto. `status` é `ok` porque nada falhou.
 *
 * A régua de 2 KB é a mesma do `tool_result` (SPEC-Fases-03 § Eventos), e é a que o código de
 * antes não alcançava: `truncarBytes` só cobria `tool_result`, então a skill de 30 KB passava
 * inteira e ia parar no documento.
 */
function textoInjetado(texto: string, estado: EstadoDoParser): GenerationEvent {
  const { resumo, tamanhoOriginal } = truncarBytes(texto)

  return {
    tipo: 'ferramenta-fim',
    chamadaId: estado.chamadaPendente ?? '',
    status: 'ok',
    resumoDoResultado: resumo,
    tamanhoOriginal
  }
}
