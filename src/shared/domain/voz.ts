/**
 * Os tipos da voz que atravessam a ponte (SPEC-Voz-01).
 *
 * Moram em `shared` porque main e renderer precisam dos dois lados do mesmo contrato. O que
 * **não** está aqui é tão importante quanto o que está: nenhum campo carrega caminho de modelo,
 * comando do sidecar ou PID (critério 3). A tela fala com uma capacidade, não com uma
 * implementação — é o mesmo motivo pelo qual o app fala com `SttEngine` e não com o runtime.
 */

/** Um trecho reconhecido, com os tempos que o engine reportou. */
export interface SegmentoDaFala {
  readonly inicioMs: number
  readonly fimMs: number
  readonly texto: string
}

export interface ResultadoDaTranscricao {
  readonly texto: string
  /** O idioma que o engine reconheceu — não necessariamente o pedido. */
  readonly idioma: string
  readonly segmentos: readonly SegmentoDaFala[]
}

/**
 * O desfecho de uma transcrição, do ponto de vista de quem desenha a tela.
 *
 * Cada estado corresponde a uma **próxima ação** diferente (critério 2): `indisponivel` pede
 * baixar, `falhou` pede tentar de novo, `sem-audio` não pede nada. Fundir os dois primeiros
 * daria à primeira execução do app a ação errada.
 */
export type DesfechoDaTranscricao =
  | { readonly estado: 'ok'; readonly resultado: ResultadoDaTranscricao }
  | { readonly estado: 'sem-audio' }
  | { readonly estado: 'indisponivel' }
  | { readonly estado: 'falhou'; readonly motivo: string }

export type DesfechoDoDownload =
  | { readonly estado: 'ok' }
  | { readonly estado: 'bloqueado' }
  | { readonly estado: 'hash-divergente' }
  | { readonly estado: 'falhou'; readonly motivo: string }

/** Como o engine vai calcular — a UI indica o modo (critério 7). */
export type ModoDeCompute = 'cuda' | 'cpu-int8'

/** O que falta para a voz funcionar, e como ela vai rodar. */
export interface ProntidaoDaVoz {
  readonly pronta: boolean
  /** Os ids dos artefatos que ainda faltam. Vazio quando está tudo no lugar. */
  readonly faltando: readonly string[]
  readonly compute: ModoDeCompute
}

/** Uma troca da conversa. O histórico da sessão é uma lista disto (SPEC-Voz-03, critério 7). */
export interface TrocaDaConversa {
  readonly pergunta: string
  readonly resposta: string
}

/**
 * O desfecho de uma pergunta à persona (SPEC-Voz-03), do ponto de vista de quem desenha a tela
 * **e** de quem vai falar.
 *
 * `indisponivel` carrega a `proximaAcao` porque o critério 4 exige recusa **com** próxima ação,
 * visual e falada. Um estado sem texto obrigaria a tela a inventar a frase e a fala a ficar muda.
 * Ela é escolhida no main, onde se sabe qual das duas indisponibilidades ocorreu: serviço fora
 * pede subir o Ollama, modelo ausente pede `ollama pull` — próximas ações diferentes que um
 * estado só, sem texto, achataria numa frase que não resolve nem uma nem outra.
 */
export type DesfechoDaConversa =
  | { readonly estado: 'ok'; readonly resposta: string }
  | { readonly estado: 'sem-pergunta' }
  | { readonly estado: 'indisponivel'; readonly proximaAcao: string }
  | { readonly estado: 'falhou'; readonly motivo: string }

/**
 * Quantas trocas da sessão entram no contexto da conversa (SPEC-Voz-03, critério 7).
 *
 * Dez é o default cravado na spec. É configurável porque a janela troca contexto por custo: cada
 * troca a mais é prompt a mais em toda pergunta seguinte, e quem conversa longo quer o
 * follow-up funcionando enquanto quem faz perguntas soltas não quer pagar por isso.
 */
export const JANELA_PADRAO_DA_CONVERSA = 10

/** Os limites da janela. Fora deles a preferência é recusada na escrita. */
export const JANELA_MINIMA_DA_CONVERSA = 0
export const JANELA_MAXIMA_DA_CONVERSA = 50

/**
 * A janela do histórico é válida?
 *
 * Fronteira de confiança e teto por construção: cada troca guardada é prompt a mais em **toda**
 * pergunta seguinte, e um número vindo do renderer sem limite deixaria a conversa arrastar a
 * sessão inteira para dentro de cada chamada até estourar o contexto do modelo.
 *
 * Zero é válido e significa **sem histórico** — perguntas independentes, sem follow-up. É
 * escolha legítima de quem não quer pagar contexto por ela, não ausência de configuração; quem
 * quer o default deixa `null`.
 */
export function ehJanelaDaConversa(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isInteger(valor) &&
    valor >= JANELA_MINIMA_DA_CONVERSA &&
    valor <= JANELA_MAXIMA_DA_CONVERSA
  )
}

/**
 * A persona como a tela de Settings a vê (SPEC-Voz-03, critério 5).
 *
 * Os dois blocos viajam juntos, com donos diferentes: `textoLivre` é do usuário e volta como
 * escrita; `blocoFixo` é do produto e vai **só de ida**, para a tela exibi-lo como leitura. Se
 * ele voltasse como dado gravável, uma edição poderia removê-lo, e a resposta voltaria em
 * markdown para ser lida em voz alta — que é exatamente o que o critério 5 impede.
 */
export interface PersonaEditavel {
  readonly textoLivre: string
  readonly blocoFixo: string
  /** Teto do texto livre, para a tela mostrar o limite em vez de recusar em silêncio. */
  readonly teto: number
}

/**
 * O modelo da rota `conversa-de-voz` quando o usuário ainda não escolheu (SPEC-Voz-03, decisão 1
 * do PI: "Qwen3 8B via Ollama, default da rota, configurável em Settings").
 *
 * **Default da rota, não do provider.** `MODELO_PADRAO.ollama` é `llama3.1` e serve as outras
 * rotas locais; usá-lo aqui faria a conversa recusar por "modelo não baixado" numa máquina com o
 * Ollama no ar e o `qwen3:8b` instalado — que foi exatamente o que o E2E no app real mostrou. O
 * default de uma rota é fato sobre a rota, e é por isso que ele mora ao lado dela.
 *
 * Trocar continua sendo Settings: o modelo ativo do provider, quando o usuário o define, vence
 * este valor.
 */
export const MODELO_PADRAO_DA_CONVERSA = 'qwen3:8b'

/**
 * As janelas que Settings oferece (SPEC-Voz-03, critério 7).
 *
 * Lista fechada e não campo livre: o custo do número não é óbvio para quem escolhe — cada troca
 * guardada é prompt a mais em **toda** pergunta seguinte —, e um campo aberto convidaria a digitar
 * 500 sem sinal de que isso arrasta a sessão inteira para dentro de cada chamada.
 *
 * Zero está na lista porque é escolha legítima: perguntas independentes, sem follow-up.
 */
export const JANELAS_DA_CONVERSA = [0, 5, 10, 20, 50] as const

/**
 * O estado da escuta contínua de wake word (SPEC-Escuta-01, critérios 8, 9, 11 e 12).
 *
 * Moram em `shared` porque renderer e main precisam do mesmo contrato.
 * A tela usa para desenhar o indicador permanente, o kill switch e a sensibilidade.
 */
export interface EstadoDaEscuta {
  /** Se a escuta contínua está ligada (kill switch). */
  readonly ativa: boolean
  /** Se o interpretador e o modelo da wake word estão prontos no disco. */
  readonly disponivel: boolean
  /** Sensibilidade calibrada [0.1, 0.95]. */
  readonly sensibilidade: number
  /** Gatilhos ligáveis separadamente (decisão do PI de 2026-10-03): a frase e as duas palmas. */
  readonly frase: boolean
  readonly palmas: boolean
  /** A hotkey global de mute escolhida (critério 11). */
  readonly hotkey: HotkeyDeMuteDaEscuta
  /** Se o SO aceitou registrá-la; `false` quando outro app já tem o atalho. */
  readonly hotkeyRegistrada: boolean
}

/**
 * O desfecho de pedir a escuta ligada. Desligar não falha, então só ligar tem desfecho: sem
 * modelo pronto a escuta não abre o microfone, e `ENTRADA_INVALIDA` é a chamada malformada.
 */
export type DesfechoDeLigarEscuta =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: 'MODELO_AUSENTE' | 'ENTRADA_INVALIDA' }

/**
 * O que a tela sabe de um disparo: **quem** disparou e se a sessão estava bloqueada. Nem áudio,
 * nem confiança, nem caminho de modelo atravessam a ponte. O relógio local permite medir
 * a latência até a reserva do turno sem carregar áudio.
 */
export interface DisparoDaEscuta {
  readonly gatilho: 'frase' | 'palmas'
  readonly sessaoBloqueada: boolean
  readonly fimDoGatilhoMs?: number
}

/**
 * Um disparo visto no modo de teste de Settings (critério 12): a confiança medida e o limiar que
 * valia. É o **único** caminho em que a confiança do detector atravessa a ponte — no disparo
 * normal ela fica no main.
 */
export interface DisparoDeTesteDaEscuta {
  readonly gatilho: 'frase' | 'palmas'
  /** Só a frase tem confiança medida. */
  readonly confianca?: number
  readonly limiar: number
}

/**
 * As hotkeys globais de mute da escuta (SPEC-Escuta-01, critério 11).
 *
 * Lista fechada, como a do push-to-talk: registrar atalho global intercepta a tecla no sistema
 * inteiro, e campo livre deixaria o renderer sequestrar qualquer combinação. Disjunta de
 * `HOTKEYS_DE_VOZ` de propósito — as duas funções convivem, e o atalho de uma não pode ser o da
 * outra.
 */
export const HOTKEYS_DE_MUTE_DA_ESCUTA = [
  'Control+Alt+M',
  'Control+Shift+M',
  'Control+Alt+K',
  'Control+Shift+K'
] as const

export type HotkeyDeMuteDaEscuta = (typeof HOTKEYS_DE_MUTE_DA_ESCUTA)[number]

export const HOTKEY_DE_MUTE_PADRAO: HotkeyDeMuteDaEscuta = 'Control+Alt+M'

export function isHotkeyDeMuteDaEscuta(valor: unknown): valor is HotkeyDeMuteDaEscuta {
  return (
    typeof valor === 'string' && (HOTKEYS_DE_MUTE_DA_ESCUTA as readonly string[]).includes(valor)
  )
}

/** Palavra de ativação oficial do sistema. */
export const WAKE_WORD_OFICIAL = 'Ei, amigo'

/** Limiares padrão de sensibilidade para UI e validação. */
export const SENSIBILIDADE_PADRAO_WAKE_WORD = 0.95
export const SENSIBILIDADE_MINIMA_WAKE_WORD = 0.1
export const SENSIBILIDADE_MAXIMA_WAKE_WORD = 0.95
