/**
 * O perfil isolado do Codex (SPEC-Multi-Executor-02).
 *
 * A pergunta que este arquivo responde: **em que estado está a identidade Codex da pipeline, e
 * o que o app tem direito de fazer com ela?**
 *
 * ## O segredo não é campo de nenhum tipo daqui
 *
 * A mesma regra de `credentials.ts` e `ai.ts`, e pela mesma razão — só que aqui ela é mais
 * forte: o app **nunca vê** o segredo do Codex, nem para guardá-lo. Quem autentica é o PI,
 * direto no CLI, e o que sobra deste lado é uma **referência opaca** ao perfil (o caminho do
 * `CODEX_HOME`) mais o estado que o CLI reporta. Não existe campo para token, cookie ou chave
 * porque não existe momento em que o app os tenha (critério 1).
 *
 * ## Por que `quota_unknown` não é conservadorismo
 *
 * Medido no CLI 0.149.0 com `CODEX_HOME` limpo: os 24 checks de `codex doctor --json` não
 * reportam quota, uso, rate limit nem crédito — zero ocorrências. Não há telemetria oficial
 * legível, então `quota_unknown` é o **único** estado honesto, e é o que a regra 2 da spec
 * manda ("sem telemetria oficial legível, quota é `quota_unknown`; não é tratada como
 * ilimitada"). Inferir um número aqui seria inventar o dado que a regra 1 proíbe tratar como
 * invariante.
 *
 * **O que este arquivo não faz:** não executa o CLI, não toca disco, não decide orçamento. Ele
 * define o que conta como estado válido; quem mede mora no main.
 */

/**
 * Os estados de saúde do perfil (critério 6).
 *
 * Enum fechado pela razão de sempre nesta base: a tela e a evidência precisam distinguir "o PI
 * ainda não autenticou" (ele resolve em um passo) de "o CLI não está instalado" (outra ação
 * inteiramente). Uma string livre faria as duas virarem "não funciona".
 *
 * `quota_limited` e `quota_unknown` são estados **distintos** de propósito: o primeiro afirma
 * que há um teto atingido, o segundo afirma que não se sabe. Colapsá-los faria a rota parecer
 * disponível quando pode estar limitada, ou o contrário — e é justamente a distinção que a
 * regra 2 da spec existe para preservar.
 */
export const CODEX_HEALTH_STATES = [
  /** Autenticado e pronto para executar. */
  'ready',
  /** Sem credencial no perfil: o PI precisa rodar o login. */
  'auth_required',
  /** Teto de uso atingido, quando a origem o expõe. */
  'quota_limited',
  /** Não há telemetria legível — o estado normal deste CLI hoje. Ver a nota do arquivo. */
  'quota_unknown',
  /** O CLI não respondeu: não instalado, sem rede, ou o binário falhou. */
  'offline'
] as const

export type CodexHealthState = (typeof CODEX_HEALTH_STATES)[number]

export function isCodexHealthState(value: unknown): value is CodexHealthState {
  return typeof value === 'string' && (CODEX_HEALTH_STATES as readonly string[]).includes(value)
}

/**
 * Os modos de cobrança do Codex (critério 4, e regras 3 e 4).
 *
 * `subscription_limited` é o padrão e o único que não gasta dinheiro por execução. Os outros
 * dois **nunca** são alcançados por queda automática: a regra 3 diz que rate limit de assinatura
 * não autoriza créditos nem API, e a decisão 3 da emenda de 2026-09-04 estende ao Codex a mesma
 * regra da assinatura do Claude — nenhuma rota cai na outra por conta própria.
 */
export const CODEX_BILLING_MODES = [
  /** Assinatura com teto de uso. Sem custo por execução. O padrão. */
  'subscription_limited',
  /** Créditos da assinatura. Gasta dinheiro; exige habilitação explícita e teto do projeto. */
  'subscription_credits',
  /** Chave de API própria. Gasta dinheiro; exige opt-in por projeto. */
  'api'
] as const

export type CodexBillingMode = (typeof CODEX_BILLING_MODES)[number]

export function isCodexBillingMode(value: unknown): value is CodexBillingMode {
  return typeof value === 'string' && (CODEX_BILLING_MODES as readonly string[]).includes(value)
}

/**
 * O modo com que um perfil nasce.
 *
 * `subscription_limited` e não "nenhum": o modo que não gasta é o default seguro, e obrigar uma
 * escolha antes do primeiro uso transformaria a configuração inicial numa decisão de cobrança
 * que o PI ainda não precisa tomar.
 */
export const MODO_DE_COBRANCA_PADRAO: CodexBillingMode = 'subscription_limited'

/** Os modos que gastam dinheiro por execução — os que exigem gate antes de executar. */
export const MODOS_MONETARIOS: readonly CodexBillingMode[] = ['subscription_credits', 'api']

/** `true` quando executar neste modo custa dinheiro (critério 5). */
export function modoGastaDinheiro(modo: CodexBillingMode): boolean {
  return MODOS_MONETARIOS.includes(modo)
}

/** O rótulo pt-BR de cada estado, para a tela. Dado, não lógica — como `ROTULO_DO_PROVIDER`. */
export const ROTULO_DA_SAUDE: Readonly<Record<CodexHealthState, string>> = {
  ready: 'Pronto',
  auth_required: 'Login necessário',
  quota_limited: 'Limite de uso atingido',
  quota_unknown: 'Uso não reportado',
  offline: 'Indisponível'
}

/**
 * O que o PI faz para sair de cada estado.
 *
 * Um estado sem ação concreta é um beco sem saída: diz que não dá, e não diz o que fazer. É a
 * mesma régua do `ACAO_DO_BLOQUEIO` (M25-F02) e do `BLOCKED_EXTERNAL` do MVP-009.
 *
 * `ready` e `quota_unknown` **não têm ação** porque não há o que destravar: o primeiro está
 * funcionando, e o segundo é o estado normal deste CLI — pedir uma ação ali ensinaria a ler um
 * aviso permanente como problema.
 */
export const ACAO_DA_SAUDE: Readonly<Record<CodexHealthState, string | undefined>> = {
  ready: undefined,
  auth_required: 'Entrar no Codex para autenticar o perfil da pipeline.',
  quota_limited:
    'O limite da assinatura foi atingido. Aguardar a renovação, ou habilitar outro modo de cobrança para este projeto.',
  quota_unknown: undefined,
  offline:
    'O Codex CLI não respondeu. Conferir se o binário `codex` está instalado e no PATH, e se há rede.'
}

export const ROTULO_DO_MODO: Readonly<Record<CodexBillingMode, string>> = {
  subscription_limited: 'Assinatura (com limite de uso)',
  subscription_credits: 'Créditos da assinatura',
  api: 'Chave de API própria'
}

/**
 * O estado do perfil, como a tela e a evidência o veem (critério 6).
 *
 * **Sem campo de segredo, por construção.** `codexHome` é a referência opaca de que a spec fala:
 * um caminho, não uma credencial — e é o que permite provar isolamento (o perfil da pipeline não
 * é o pessoal) sem nunca expor o conteúdo.
 */
export interface CodexProfileState {
  readonly saude: CodexHealthState
  /** O `CODEX_HOME` da pipeline. Referência ao perfil, nunca o conteúdo dele. */
  readonly codexHome: string
  readonly modo: CodexBillingMode
  /**
   * Diagnóstico **sanitizado** do CLI (critério 6, e critério 3).
   *
   * Vem do `summary` dos checks de `codex doctor --json`, que a própria ferramenta já emite
   * redigido. Nunca do `stderr` cru nem dos `details`, que carregam caminhos e podem carregar
   * mais — a mesma postura do `ClaudeCodeAdapter`, onde o stderr fica fora da mensagem de erro
   * porque texto de erro é caminho clássico de vazamento.
   */
  readonly diagnostico?: string
  /** ISO 8601 da última medição. Ausente quando nunca foi medido. */
  readonly verificadoEm?: string
}

/**
 * A quota do Codex, sempre desconhecida nesta fatia.
 *
 * Constante e não função de medição: não há o que medir (ver a nota do topo). Existe como valor
 * nomeado para que o call site diga *por que* é desconhecida, em vez de espalhar a string —
 * e para que o dia em que o CLI passar a reportar quota tenha um lugar só a mudar.
 */
export const QUOTA_DO_CODEX = 'quota_unknown' as const

/**
 * Trocar o modo de cobrança é permitido? (regras 3 e 4, critério 4)
 *
 * **A pergunta não é sobre a saúde do perfil, e é isso que o teste trava.** A regra 3 é literal:
 * *"rate limit de assinatura não autoriza créditos nem API"*. Um `quota_limited` que liberasse a
 * subida para `subscription_credits` seria exatamente a transição silenciosa que a spec proíbe —
 * o sistema decidindo gastar dinheiro porque o modo grátis acabou.
 *
 * Então: subir para modo monetário exige **habilitação explícita** do PI, sempre, e o estado da
 * assinatura não é argumento. Descer para `subscription_limited` é livre — parar de gastar nunca
 * precisa de autorização.
 */
export function trocaDeModoPermitida(
  de: CodexBillingMode,
  para: CodexBillingMode,
  habilitadoPeloPi: boolean
): boolean {
  if (de === para) return true
  if (!modoGastaDinheiro(para)) return true
  return habilitadoPeloPi
}

/**
 * O run pode começar neste modo, com este teto? (critério 5)
 *
 * **Fail closed nos dois lados da ignorância.** Teto ausente num modo monetário bloqueia, e não
 * libera: "não configurou teto" não é "pode gastar à vontade" — é a mesma inversão que
 * `listaDePathsValida` recusa quando a lista vem vazia. E gasto acumulado igual ao teto já
 * bloqueia (`>=`), porque executar *no* limite é a chamada que o ultrapassa.
 *
 * Modo não monetário passa sempre: não há dinheiro a gatear, e exigir teto ali travaria a rota
 * de assinatura por uma conta que não existe.
 */
export function execucaoPermitida(entrada: {
  readonly modo: CodexBillingMode
  /** Teto de créditos do projeto, em USD. Ausente = o PI não configurou. */
  readonly tetoUsd?: number
  /** Já gasto neste projeto, em USD. */
  readonly gastoUsd: number
}): { readonly permitida: boolean; readonly motivo?: string } {
  if (!modoGastaDinheiro(entrada.modo)) return { permitida: true }

  if (entrada.tetoUsd === undefined) {
    return {
      permitida: false,
      motivo:
        'O modo de cobrança gasta créditos e este projeto não tem teto configurado. Definir o teto antes de executar.'
    }
  }

  if (entrada.gastoUsd >= entrada.tetoUsd) {
    return {
      permitida: false,
      motivo: `O teto de créditos do projeto (US$ ${entrada.tetoUsd.toFixed(2)}) foi atingido. Elevar o teto ou aguardar o próximo ciclo.`
    }
  }

  return { permitida: true }
}
