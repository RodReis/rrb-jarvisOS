/**
 * A persona da conversa por voz (SPEC-Voz-03, critério 5 e decisão 3 do PI).
 *
 * Dois blocos com donos diferentes, e essa é a decisão inteira:
 *
 * - **texto livre** — do usuário. Nome, tom, saudações. Editável em Settings, vale na chamada
 *   seguinte, sem rebuild.
 * - **bloco fixo de sistema** — do produto. Formato de voz: resposta curta, pt-BR, sem markdown,
 *   não inventar dado fora do snapshot.
 *
 * ## Por que o bloco fixo não mora no banco
 *
 * Se estivesse lá, uma edição — em Settings ou direto no SQLite — poderia removê-lo, e a resposta
 * voltaria em markdown para ser lida em voz alta, ou inventaria dados que o snapshot não trouxe.
 * O critério 5 exige que **esvaziar o texto livre não remova o bloco fixo**; a única forma de isso
 * ser verdade por construção é ele não ser dado do usuário.
 *
 * ## Por que "sem markdown" é regra e não estilo
 *
 * A resposta vai para o TTS. Asterisco, cerquilha e crase lidos em voz alta viram ruído — o Piper
 * pronuncia os símbolos. É o mesmo motivo pelo qual o `textoDoSnapshot` também os evita.
 */

/**
 * O que o produto garante, independentemente do que o usuário escreva.
 *
 * Em pt-BR porque a saída é falada em pt-BR: pedir o formato num idioma e a resposta em outro é
 * como o modelo mais erra o registro.
 */
export const BLOCO_FIXO_DA_PERSONA = [
  'Responda em português do Brasil, sempre.',
  'Sua resposta será falada em voz alta: use frases curtas e diretas.',
  'Nunca use markdown, listas com marcadores, código, links ou emoji — os símbolos seriam lidos em voz alta.',
  'Responda apenas com o que está no contexto. Se a informação não estiver lá, diga que não sabe em vez de supor.',
  'Não descreva o que você é nem como funciona, a menos que perguntem.'
].join('\n')

/** A persona de fábrica, quando o usuário ainda não escreveu a dele. */
export const TEXTO_LIVRE_PADRAO =
  'Você é o JARVIS, assistente do operador. Trate-o por "operador". Seja cordial e direto, sem formalidade excessiva.'

/** Teto do texto livre. Persona longa come o contexto que o snapshot e o histórico precisam. */
export const TETO_DO_TEXTO_LIVRE = 2000

export interface Persona {
  readonly texto_livre: string
  readonly updated_at: string
}

/**
 * Monta o system da chamada.
 *
 * O bloco fixo vem **por último** de propósito: instrução posterior pesa mais na maioria dos
 * modelos, e é o formato de voz que não pode ser negociado por um texto livre criativo. Um
 * usuário que escrevesse "responda em inglês com bullets" mudaria o tom, não o formato.
 */
export function systemDaPersona(textoLivre: string): string {
  const livre = textoLivre.trim()

  // Texto livre vazio não é erro: o critério 5 exige que o bloco fixo continue valendo sozinho.
  return livre === '' ? BLOCO_FIXO_DA_PERSONA : `${livre}\n\n${BLOCO_FIXO_DA_PERSONA}`
}

/**
 * Valida o texto livre vindo do renderer.
 *
 * Fronteira de confiança: o texto entra no system de toda conversa, e um teto ausente deixaria
 * uma persona de 100 KB consumir o contexto inteiro — o snapshot e o histórico ficariam de fora,
 * e o usuário veria o Jarvis "esquecer" o estado do app sem explicação.
 */
export function isTextoLivreValido(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length <= TETO_DO_TEXTO_LIVRE
}
