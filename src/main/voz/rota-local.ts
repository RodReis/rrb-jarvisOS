/**
 * A rota local da conversa pode atender agora? (SPEC-Voz-03, critério 4)
 *
 * ## Duas indisponibilidades, duas próximas ações
 *
 * O critério exige os dois cenários **testados separadamente**, e o motivo é a próxima ação, não
 * a taxonomia: serviço fora pede subir o Ollama; modelo ausente pede baixá-lo com o nome exato do
 * modelo configurado. Um estado só, com uma frase que cobrisse ambos, mandaria metade dos
 * usuários fazer a coisa errada — e a frase é **falada**, onde não há como reler procurando qual
 * metade se aplica.
 *
 * ## Texto estático, nunca gerado
 *
 * As frases são constantes locais (decisão do Cowork na spec): anunciar "o modelo caiu" não pode
 * depender do modelo que caiu. A F02 fala estas frases como falaria qualquer outra.
 *
 * ## Por que a checagem existe antes da chamada
 *
 * A alternativa seria chamar e ler o erro. Mas a chamada monta e grava o `ContextPack` antes de
 * sair, e o `AdapterError` do Ollama não distingue "serviço fora" de "modelo não baixado" — a
 * primeira perderia o cenário do critério, e a segunda deixaria manifestos órfãos no banco.
 */

const SEM_SERVICO = 'O modelo local não está respondendo. Suba o Ollama e tente de novo.'

const SEM_MODELO = (modelo: string): string =>
  `O modelo ${modelo} não está baixado. Rode ollama pull ${modelo} e tente de novo.`

export type DisponibilidadeDaRota = { ok: true } | { ok: false; proximaAcao: string }

export interface DepsDaRotaLocal {
  /** `GET /api/tags` do adapter: lista vazia significa servidor fora **ou** nenhum modelo. */
  readonly modelosInstalados: () => Promise<readonly string[]>
  /** O servidor responde? Separado da lista para distinguir "fora" de "no ar e vazio". */
  readonly disponivel: () => Promise<boolean>
  /** O modelo configurado para a rota `conversa-de-voz`, em Settings. */
  readonly modeloConfigurado: () => string
}

/**
 * O Ollama identifica modelo por `nome:tag`, e `ollama pull qwen3:8b` instala uma linha cujo
 * `name` é exatamente isso. Mas o usuário pode ter configurado `qwen3` sem tag, e o servidor
 * responderia `qwen3:latest` — comparar com igualdade estrita acusaria ausência de um modelo
 * presente, e a recusa mandaria baixar o que já está lá.
 */
function temOModelo(instalados: readonly string[], configurado: string): boolean {
  const alvo = configurado.trim().toLowerCase()
  if (alvo === '') return false

  return instalados.some((nome) => {
    const n = nome.trim().toLowerCase()
    if (n === alvo) return true
    // Sem tag dos dois lados: `qwen3` casa `qwen3:latest`, nunca `qwen3-coder:8b`.
    return alvo.includes(':') ? false : n.split(':')[0] === alvo
  })
}

export function criarRotaLocal(deps: DepsDaRotaLocal) {
  return async (): Promise<DisponibilidadeDaRota> => {
    if (!(await deps.disponivel())) return { ok: false, proximaAcao: SEM_SERVICO }

    const modelo = deps.modeloConfigurado()
    const instalados = await deps.modelosInstalados()

    if (!temOModelo(instalados, modelo)) {
      return { ok: false, proximaAcao: SEM_MODELO(modelo) }
    }

    return { ok: true }
  }
}

export const FRASES_DA_RECUSA = { SEM_SERVICO, SEM_MODELO } as const
