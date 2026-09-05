/**
 * Qual modelo gera cada fase (SPEC-Fases-02).
 *
 * A pergunta que este arquivo responde: **a geração desta fase, nesta rota, sai por qual
 * modelo?** Até aqui a resposta era `MODELO_PADRAO[provider]` — um modelo por provider, igual
 * para as três fases. O PI decidiu em 2026-09-04 que refinar um prompt e construir um slice não
 * merecem o mesmo modelo, e é essa distinção que o arquivo passa a carregar.
 *
 * Quatro decisões governam o desenho:
 *
 *  - **Modelo por rota dentro da fase**, e não um só por fase. A rota de assinatura oferece
 *    `claude-fable-5-1`, que a rota paga não tem (decisão 4 do MVP-026). Um par único obrigaria
 *    a validar em runtime o que o catálogo já resolve estaticamente — e a validação em runtime
 *    só falharia depois da chamada sair.
 *  - **Esta função não escolhe rota.** A rota vem de `escolherRota` (M25-F02), com o bloqueio do
 *    critério 6 já aplicado. Escolher de novo aqui desfaria aquela decisão, e o caminho mais
 *    provável de um segundo `escolherRota` é cair na rota paga que ninguém autorizou.
 *  - **Ausência de política é o padrão valendo**, nunca erro — mesma postura de
 *    `ROTEAMENTO_PADRAO` e `MODELO_PADRAO`. O app gera desde o primeiro boot, sem semear linha
 *    por usuário.
 *  - **Override do projeto vence o workspace, e removê-lo volta ao workspace.** Herança de um
 *    nível só: `undefined` significa herda, e não "sem modelo". Um valor copiado do workspace
 *    para dentro do projeto viraria cópia que envelhece sozinha quando o padrão muda.
 *
 * Mora em `src/shared/domain` pela razão de sempre: a aba Modelos e o selo do projeto são
 * desenhados no renderer, e a regra precisa ser verificável sem carregar o Electron.
 */

import type { AiProvider } from './ai'
import type { WorkspaceId } from './entities'
import type { Fase } from './fase'
import { AI_PROVIDERS, TABELA_DE_PRECO } from './ai'
import { FASES, isFase } from './fase'

/**
 * As rotas que **têm** modelo. Espelha `PROVIDER_DA_ROTA` (M25-F02), e pela mesma razão não tem
 * entrada para `bloqueado`: rota bloqueada não gera, então não tem modelo a escolher.
 */
export const ROTAS_COM_MODELO = ['assinatura', 'paga'] as const

export type RotaComModelo = (typeof ROTAS_COM_MODELO)[number]

export function isRotaComModelo(value: unknown): value is RotaComModelo {
  return typeof value === 'string' && (ROTAS_COM_MODELO as readonly string[]).includes(value)
}

/** O rótulo pt-BR de cada rota, para os combos. Dado, não `switch` na tela. */
export const ROTULO_DA_ROTA: Readonly<Record<RotaComModelo, string>> = {
  assinatura: 'Assinatura',
  paga: 'Rota paga'
}

/**
 * O par que atende uma geração: quem chama e com qual modelo.
 *
 * Os dois juntos, e nunca o modelo sozinho, porque `claude-opus-5` existe em dois providers com
 * contas diferentes — o id sem o provider não diz quem paga.
 */
export interface ModeloEscolhido {
  readonly provider: AiProvider
  readonly modelo: string
}

/**
 * O rótulo curto de cada modelo, para o combo (`Fable 5.1 · claude-fable-5-1`).
 *
 * Dado versionado e **parcial de propósito**: modelo sem rótulo cai no próprio id, que é o que
 * o `ollama list` devolve para tags que o produto não conhece. Um `Record` completo obrigaria a
 * inventar nome para tag de terceiro, e a lista do Ollama muda na máquina do usuário, não aqui.
 */
export const ROTULO_DO_MODELO: Readonly<Record<string, string>> = {
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'llama3.1': 'Llama 3.1',
  'qwen2.5-coder': 'Qwen 2.5 Coder',
  'qwen3:8b': 'Qwen3 8B'
}

/** O rótulo do modelo, ou o próprio id quando o produto não o nomeia. */
export function rotuloDoModelo(modelo: string): string {
  return ROTULO_DO_MODELO[modelo] ?? modelo
}

/**
 * O par de cada fase, **por rota**.
 *
 * As duas rotas sempre presentes: a de assinatura é a que gera normalmente, e a paga precisa de
 * um valor pronto para o dia em que o projeto der opt-in. Deixar a paga opcional adiaria a
 * escolha para dentro da geração, que é onde não se decide nada.
 */
export type ModeloPorRota = Readonly<Record<RotaComModelo, ModeloEscolhido>>

/**
 * A política de um escopo (`user_id` + `workspace_id`), espelhando `RoutingPolicy` (F04).
 *
 * `snake_case` nos campos de escopo porque espelham a coluna; camelCase no payload de negócio.
 */
export interface PhaseModelPolicy {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly fases: Readonly<Record<Fase, ModeloPorRota>>
}

/**
 * O padrão de quem nunca editou — a escolha do PI de 2026-09-04 (SPEC-Fases-02 § Modelo por
 * fase).
 *
 * Planejamento e Especificação por Fable: são conversa e documento, onde velocidade importa mais
 * que profundidade. Construção por Opus: é onde o erro custa caro.
 *
 * Na rota paga, as três fases caem em Opus porque **Fable não existe lá** — não é preferência,
 * é o catálogo. Repetir Opus três vezes é o preço de manter as duas rotas simétricas na forma;
 * a alternativa (a rota paga herdar o modelo da assinatura) ofereceria Fable numa rota que não
 * o atende.
 */
export const POLITICA_DE_MODELO_PADRAO: Readonly<Record<Fase, ModeloPorRota>> = {
  planejamento: {
    assinatura: { provider: 'claude-code', modelo: 'claude-fable-5-1' },
    paga: { provider: 'anthropic', modelo: 'claude-opus-5' }
  },
  especificacao: {
    assinatura: { provider: 'claude-code', modelo: 'claude-fable-5-1' },
    paga: { provider: 'anthropic', modelo: 'claude-opus-5' }
  },
  construcao: {
    assinatura: { provider: 'claude-code', modelo: 'claude-opus-5' },
    paga: { provider: 'anthropic', modelo: 'claude-opus-5' }
  }
}

export function politicaDeModeloPadrao(userId: string, workspace: WorkspaceId): PhaseModelPolicy {
  return { user_id: userId, workspace_id: workspace, fases: POLITICA_DE_MODELO_PADRAO }
}

/**
 * O que um projeto sobrescreve. Uma linha por `(project_id, fase, rota)`.
 *
 * Granularidade fina de propósito: o PI que troca o modelo da Construção neste projeto não está
 * dizendo nada sobre o Planejamento dele. Um override por projeto inteiro obrigaria a repetir as
 * três fases para mudar uma.
 */
export interface ProjectModelOverride {
  readonly project_id: string
  readonly fase: Fase
  readonly rota: RotaComModelo
  readonly provider: AiProvider
  readonly modelo: string
}

/**
 * O modelo existe no catálogo daquele provider?
 *
 * A pergunta que o guard de fronteira faz antes de qualquer chamada (critério 4). Ler de
 * `TABELA_DE_PRECO` e não de uma segunda lista é o ponto: catálogo e preço são o mesmo fato, e
 * duas listas divergiriam na primeira adição.
 */
export function modeloExisteNoCatalogo(provider: AiProvider, modelo: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABELA_DE_PRECO[provider], modelo)
}

/**
 * Os modelos que um provider oferece, ordenados como o catálogo os declara.
 *
 * Existe aqui, e não só no repositório, porque o renderer precisa da mesma lista para filtrar o
 * combo — e uma lista que só o main soubesse montar faria a tela oferecer o que a fronteira
 * recusa.
 */
export function modelosDoCatalogo(provider: AiProvider): readonly string[] {
  return Object.keys(TABELA_DE_PRECO[provider])
}

/**
 * Uma opção de modelo no combo da fase, com o motivo quando ela não atende (SPEC-Fases-06,
 * critério 7).
 */
export interface OpcaoDeModelo {
  readonly provider: AiProvider
  readonly modelo: string
  /** Presente quando a opção aparece **desabilitada**; ausente quando ela pode ser escolhida. */
  readonly indisponivel?: string
}

/**
 * Os providers que atendem cada rota — **plural desde a SPEC-Fases-06**.
 *
 * A rota de assinatura passou a ter dois (Claude Code e Codex), e é por isso que o combo da fase
 * não pode mais derivar um provider único da rota. Dado e não `if`: a terceira assinatura entra
 * como uma linha.
 */
export const PROVIDERS_DA_ROTA: Readonly<Record<RotaComModelo, readonly AiProvider[]>> = {
  assinatura: ['claude-code', 'codex'],
  paga: ['anthropic']
}

/**
 * As opções que o combo de uma fase oferece, com o que estiver indisponível **listado e
 * desabilitado** (SPEC-Fases-06, critério 7).
 *
 * **Listar e desabilitar, em vez de omitir**, é a decisão da spec: o Codex ainda não executa a
 * Construção (isso é M10-F03/F04), e um combo que simplesmente escondesse `gpt-5.5` ali deixaria
 * o PI sem saber que a opção existe e por que não pode usá-la. Omitir é silêncio; desabilitar com
 * motivo é resposta.
 *
 * O inverso também seria pior: **listar e atender** faria a Construção sair por um executor que
 * não existe — fallback que não funciona, exatamente o que a spec chama de errado.
 */
export function opcoesDeModelo(fase: Fase, rota: RotaComModelo): readonly OpcaoDeModelo[] {
  return PROVIDERS_DA_ROTA[rota].flatMap((provider) =>
    modelosDoCatalogo(provider).map((modelo) => {
      const motivo = motivoDeIndisponibilidade(fase, provider)
      return motivo === undefined
        ? { provider, modelo }
        : { provider, modelo, indisponivel: motivo }
    })
  )
}

/**
 * Por que um provider não atende uma fase, ou `undefined` quando atende.
 *
 * Hoje há um caso só: o Codex na Construção, que espera o executor em container da M10-F03/F04.
 * Função e não mapa porque a resposta depende do par — e um `Record<Fase, Record<Provider, …>>`
 * teria dez entradas `undefined` para descrever uma exceção.
 */
export function motivoDeIndisponibilidade(fase: Fase, provider: AiProvider): string | undefined {
  if (provider === 'codex' && fase === 'construcao') {
    return 'O Codex ainda não executa a Construção. Disponível quando o executor em container chegar (MVP-010).'
  }
  return undefined
}

/**
 * **A função da fatia**: qual modelo atende esta fase, nesta rota.
 *
 * Pura e sem banco de propósito — a herança (projeto vence workspace, ausência herda) é a regra
 * que mais erra em integração, e testá-la exigindo SQLite faria o teste caro o bastante para os
 * casos de borda ficarem sem cobertura.
 *
 * O override entra por parâmetro e não por consulta interna pela razão que o `ContextPack` do
 * `AiRequest` estabeleceu: a dependência vira **assinatura**. Não existe forma de chamar isto
 * "esquecendo" de considerar o override — ou ele veio, ou o chamador declarou que não há.
 *
 * Modelo fora do catálogo **cai no padrão do workspace**, e não lança: a política pode ter sido
 * gravada quando o catálogo tinha aquele id, e uma exceção aqui derrubaria a geração por causa
 * de uma linha velha no banco. Quem recusa entrada nova é a fronteira IPC, antes de gravar.
 */
export function modeloDaFase(
  fase: Fase,
  rota: RotaComModelo,
  override: ProjectModelOverride | undefined,
  politica: PhaseModelPolicy
): ModeloEscolhido {
  if (
    override !== undefined &&
    override.fase === fase &&
    override.rota === rota &&
    modeloExisteNoCatalogo(override.provider, override.modelo)
  ) {
    return { provider: override.provider, modelo: override.modelo }
  }

  const doWorkspace = politica.fases[fase]?.[rota]

  if (
    doWorkspace !== undefined &&
    modeloExisteNoCatalogo(doWorkspace.provider, doWorkspace.modelo)
  ) {
    return doWorkspace
  }

  return POLITICA_DE_MODELO_PADRAO[fase][rota]
}

/** Guard de fronteira do par: forma **e** conteúdo, como `isProviderRoute` (F04). */
export function isModeloEscolhido(value: unknown): value is ModeloEscolhido {
  if (typeof value !== 'object' || value === null) return false

  const candidato = value as Record<string, unknown>
  if (typeof candidato.provider !== 'string') return false
  if (!(AI_PROVIDERS as readonly string[]).includes(candidato.provider)) return false
  if (typeof candidato.modelo !== 'string') return false

  // O conteúdo, não só a forma: um par `{ anthropic, claude-fable-5-1 }` tem a forma certa e é
  // exatamente o que a decisão 4 do MVP-026 proíbe.
  return modeloExisteNoCatalogo(candidato.provider as AiProvider, candidato.modelo)
}

/** Guard do override que a fronteira IPC recebe do renderer. */
export function isProjectModelOverride(value: unknown): value is ProjectModelOverride {
  if (typeof value !== 'object' || value === null) return false

  const candidato = value as Record<string, unknown>
  if (typeof candidato.project_id !== 'string' || candidato.project_id.length === 0) return false
  if (!isFase(candidato.fase)) return false
  if (!isRotaComModelo(candidato.rota)) return false

  return isModeloEscolhido({ provider: candidato.provider, modelo: candidato.modelo })
}

/**
 * A política inteira, para o repositório validar o que leu do banco.
 *
 * Completude checada aqui e não no `tsc`: a linha vem do SQLite como `string`, e uma fase nova
 * sem linha gravada é o caso normal (o padrão preenche), não corrupção.
 */
export function isPhaseModelPolicyFases(
  value: unknown
): value is Readonly<Record<Fase, ModeloPorRota>> {
  if (typeof value !== 'object' || value === null) return false

  const candidato = value as Record<string, unknown>

  return FASES.every((fase) => {
    const porRota = candidato[fase]
    if (typeof porRota !== 'object' || porRota === null) return false

    const rotas = porRota as Record<string, unknown>
    return ROTAS_COM_MODELO.every((rota) => isModeloEscolhido(rotas[rota]))
  })
}
