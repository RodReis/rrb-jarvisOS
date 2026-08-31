/**
 * Contratos do núcleo de conectores (SPEC-Conectores-01).
 *
 * A pergunta que este arquivo responde: **o que é uma capacidade externa, e como se pede uma
 * sem conhecer quem a atende?** Cada adapter declara o que sabe fazer; o núcleo resolve,
 * valida e normaliza — e não conhece GitHub nem Tavily (F03–F06 entram como registros novos,
 * sem tocar nada daqui).
 *
 * **Runtime separado do ponto único de IA** (decisão do PI de 2026-08-29, spec § pergunta 1):
 * `ConnectorRequest`/`ConnectorResult` são paralelos a `callProvider` e **não passam por ele**.
 * Os contratos são incompatíveis — stream de chunks com `usage` ao fim versus mutação
 * idempotente com `ExternalRef` — e unificá-los produziria uma abstração genérica que serviria
 * mal aos dois. O que os dois runtimes compartilham é o Vault, o `AuditEvent` encadeado e o
 * ledger de uso; nada além disso.
 *
 * A regra que governa este arquivo é a mesma de `credentials.ts` e `ai.ts`, e pela mesma razão:
 * **nenhum tipo daqui tem campo onde um segredo caiba**. O `ConnectorCredentialRef` é
 * referência, não valor; o `ConnectorResult` carrega dado normalizado, nunca o objeto nativo do
 * SDK que traria headers de autorização junto (critério 3).
 *
 * O que este arquivo **não** decide: health, retry, rate limit, custo e circuit breaker — tudo
 * isso é a F02, uma vez só, para todos os adapters (spec § decisões cravadas).
 *
 * Mora em `src/shared/domain` porque o renderer consome capacidades e erros normalizados, e o
 * contrato precisa ser verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'

/**
 * A versão do contrato que este arquivo define.
 *
 * Existe porque a spec a pede explicitamente (§ Contratos: "`ConnectorId`,
 * `ConnectorCapability` e versão do contrato"), e o motivo é a evolução dos adapters: um
 * adapter compilado contra a v1 precisa poder dizer contra qual forma de `ConnectorRequest`
 * ele foi escrito. Enquanto só existe uma versão, é declaração; quando existir a segunda, é o
 * que impede um adapter velho de receber um request que ele leria errado.
 */
export const CONNECTOR_CONTRACT_VERSION = 1 as const

export type ConnectorContractVersion = typeof CONNECTOR_CONTRACT_VERSION

/**
 * Os conectores que o app conhece — **dado, não lógica**, como `AI_PROVIDERS` e
 * `CREDENTIAL_KEYS`.
 *
 * Enum fechado e não texto livre: `ConnectorId` vindo do renderer como string abriria a
 * resolução do adapter a um valor que a UI escolhe, que é a porta de entrada do proxy genérico
 * que o critério 6 proíbe. Registrar um conector é acrescentar uma linha aqui **e** registrar o
 * adapter — as duas coisas, no main.
 *
 * `github` e `tavily` já constam porque são os conectores previstos do MVP-006 (F03–F06). Estar
 * na lista não é estar implementado: o registro é que diz quem tem adapter, e pedir por um
 * conector conhecido mas não registrado falha com `connector-nao-registrado` (critério 1).
 */
export const CONNECTOR_IDS = ['github', 'tavily'] as const

export type ConnectorId = (typeof CONNECTOR_IDS)[number]

/** Rótulo em pt-BR de cada conector, para a tela não derivar texto de identificador. */
export const ROTULO_DO_CONECTOR: Readonly<Record<ConnectorId, string>> = {
  github: 'GitHub',
  tavily: 'Tavily'
}

/**
 * O que uma operação faz ao mundo — e é isto que decide se ela pode ser repetida.
 *
 * `leitura` é seguro repetir por definição. `mutacao` só é seguro repetir com chave de
 * idempotência, e é a F02 que aplica essa regra (critério 3 de lá); aqui o contrato apenas
 * **carrega o dado** que torna a regra possível de aplicar. Sem o discriminante no contrato, a
 * F02 teria de inferir a natureza da operação pelo nome dela — que é adivinhação, não política.
 */
export const CONNECTOR_EFFECTS = ['leitura', 'mutacao'] as const

export type ConnectorEffect = (typeof CONNECTOR_EFFECTS)[number]

/**
 * Uma capacidade declarada por um adapter: uma operação nomeada, com o efeito que ela causa.
 *
 * **Declarada e não descoberta.** O núcleo pergunta ao adapter o que ele sabe fazer e recusa o
 * resto antes de qualquer I/O (critério 1). O contrário — tentar e ver se dá — é o proxy
 * genérico: qualquer operação passaria adiante e a fronteira viraria a documentação do serviço
 * externo em vez do que este app permite.
 *
 * `operation` é o nome estável da operação dentro do conector (`issues.create`,
 * `search.query`). Namespaced com ponto por convenção, como as ações do Policy Engine — o
 * mesmo hábito de leitura, e agrupável por prefixo na auditoria sem parsear payload.
 */
export interface ConnectorCapability {
  readonly connector: ConnectorId
  readonly operation: string
  readonly effect: ConnectorEffect
  /** Frase curta em pt-BR do que a operação faz. É o que a UI mostra ao listar capacidades. */
  readonly descricao: string
}

/**
 * As chaves de credencial que os conectores usam — **separadas das chaves de IA**, por decisão
 * do PI (2026-08-29).
 *
 * `CREDENTIAL_KEYS` (SPEC-Providers-01) governa `JARVIS_CREDENTIAL_<KEY>` e alimenta a tela de
 * credenciais do Settings, que lista o que **falta** por chave. Acrescentar `github`/`tavily`
 * lá faria a tela anunciar duas credenciais ausentes que ninguém consegue usar até a F03 — uma
 * promessa que o app não cumpre. Um conjunto próprio mantém a M5-F01 fechada e deixa a emenda
 * do Vault (payload estruturado com access/refresh/`expires_at`, rotação atômica) exatamente
 * onde o PI a cravou: na M6-F03.
 *
 * O valor coincide com `ConnectorId` hoje porque cada conector previsto tem uma credencial. São
 * tipos distintos de propósito: um conector sem credencial (ou com duas) não obrigaria a mexer
 * na lista de conectores, do mesmo modo que `CREDENCIAL_DO_PROVIDER` mantém provider e chave
 * separados no MVP-005.
 */
export const CONNECTOR_CREDENTIAL_KEYS = ['github', 'tavily'] as const

export type ConnectorCredentialKey = (typeof CONNECTOR_CREDENTIAL_KEYS)[number]

/**
 * Referência a uma credencial de conector — **nunca o segredo**.
 *
 * Espelha o `CredentialRef` do Vault (SPEC-Providers-01) no que importa: escopo `user_id` +
 * `workspace_id` (spec § decisões cravadas), e nenhum campo onde o valor caiba. É este tipo que
 * viaja no `ConnectorRequest`; o material secreto é lido no main, no instante da chamada, pela
 * F03 em diante.
 *
 * `project_id` **não** entra aqui: projeto só nasce no MVP-008, e um campo opcional que
 * ninguém preenche por dois MVPs é campo que se aprende a ignorar. Quando existir, entra no
 * ledger de uso da F02, que é onde a spec o cita.
 */
export interface ConnectorCredentialRef {
  readonly key: ConnectorCredentialKey
  readonly user_id: string
  readonly workspace_id: WorkspaceId
}

/**
 * O que o renderer vê sobre uma credencial de conector — **nunca o valor** (crit. 7 da F05).
 *
 * Tipo próprio e não `CredentialStatusView`, pela mesma razão que as chaves são um conjunto
 * próprio: as duas taxonomias respondem a listas diferentes, e um tipo compartilhado obrigaria
 * `key` a ser a união das duas — o que faria a tela de IA ter de filtrar chave de conector e
 * vice-versa, em dois lugares, para sempre.
 *
 * A diferença de forma é real, não cosmética: **não há `source` nem `envDisponivel`**. A
 * credencial de conector vive só no vault — não existe `JARVIS_CREDENTIAL_TAVILY`, e não é
 * esquecimento: um caminho por `.env` seria uma segunda fonte de verdade que nenhuma spec pediu,
 * e que faria "configurada" na tela significar duas coisas diferentes.
 *
 * `gerenciavel: false` é o caso do GitHub, que tem credencial mas não campo de chave — ela nasce
 * do Device Flow (F03), e oferecer um campo de texto para colá-la convidaria o usuário a inventar
 * um valor que nada consumiria.
 */
export interface ConnectorCredentialStatusView {
  readonly key: ConnectorCredentialKey
  /** Rótulo do conector, para a tela não derivar texto de identificador. */
  readonly conector: string
  readonly workspace: WorkspaceId
  readonly status: 'present' | 'missing'
  /** A credencial é cadastrável por campo de chave nesta tela? */
  readonly gerenciavel: boolean
}

/**
 * O pedido a um conector.
 *
 * `input` é `unknown` de propósito: o núcleo **não** conhece a forma do payload de cada
 * operação — quem conhece é o adapter, e é ele que valida (critério 2). Tipar isto como um
 * `Record` de campos conhecidos obrigaria o núcleo a saber o que um `issues.create` recebe, que
 * é exatamente o acoplamento que a fatia existe para não ter. O `unknown` força o adapter a
 * estreitar antes de usar, em vez de confiar.
 */
export interface ConnectorRequest {
  readonly contractVersion: ConnectorContractVersion
  readonly connector: ConnectorId
  readonly operation: string
  /**
   * Casa pedido, log e auditoria (CONVENTION §3). Mesmo papel do `id` do `AiStreamEvent`: o
   * mesmo valor nos dois lados, para que entrada e saída sejam casáveis na investigação.
   */
  readonly correlationId: string
  /**
   * Chave de idempotência. **Obrigatória em `mutacao`**, e é o que autoriza a F02 a retentar
   * (critério 3 de lá: "mutação sem idempotency key nunca é repetida automaticamente").
   * Ausente em leitura, onde repetir é seguro por natureza.
   */
  readonly idempotencyKey?: string
  readonly timeoutMs: number
  /**
   * A credencial a usar — **referência, não valor**. Ausente quando a operação não precisa de
   * uma (busca pública, health de serviço aberto): opcional e não string vazia, pelo mesmo
   * motivo do `apiKey` do `AdapterRequest` (F04 do MVP-005) — `''` obrigaria cada adapter a
   * decidir se aquilo é "sem credencial" ou "credencial em branco", e um deles decidiria
   * errado.
   */
  readonly credential?: ConnectorCredentialRef
  readonly input: unknown
}

/** De onde o dado veio — a proveniência que a spec pede no `ConnectorResult`. */
export interface ConnectorProvenance {
  readonly connector: ConnectorId
  readonly operation: string
  /** Carimbo ISO de quando o conector respondeu. */
  readonly obtidoEm: string
}

/**
 * Referência a algo que passou a existir (ou já existia) no serviço externo.
 *
 * É o que uma mutação idempotente devolve para que repetir o pedido seja reconhecível: sem uma
 * referência estável, "criei" e "já estava criado" são indistinguíveis do lado de cá.
 */
export interface ExternalRef {
  /** Identificador do recurso no serviço externo. */
  readonly id: string
  /** Endereço legível, quando o serviço expõe um. Nunca carrega token na query. */
  readonly url?: string
}

/**
 * Consumo de uma chamada, em **créditos** do próprio conector.
 *
 * Créditos e não USD, por decisão do PI (SPEC-Conectores-02): a Tavily cobra em créditos e o
 * GitHub não cobra; converter para dólar dependeria do plano contratado e produziria número
 * falso, além de esconder qual orçamento estourou. Quem soma e gateia isto é o ledger da F02 —
 * aqui o número é só medido e reportado, como o `CostEvent` era report-only na M5-F02.
 */
export interface ConnectorUsage {
  readonly creditos: number
  readonly latenciaMs: number
}

/**
 * O que uma chamada bem-sucedida devolve.
 *
 * `data` é `unknown` pela mesma razão que `input` é: a forma pertence à operação. O que o
 * contrato garante é o que está **em volta** — proveniência, uso e referência externa —, que é
 * o que o orquestrador precisa para decidir o próximo passo sem entender o payload.
 *
 * O que **não** cabe aqui (critério 3): objeto nativo do SDK. Um `Octokit.Response` traz os
 * headers da requisição junto — `authorization` incluído — e serializá-lo pelo IPC publicaria o
 * token na tela. O adapter normaliza para dado simples antes de devolver; é obrigação dele, e
 * o `unknown` não a dispensa.
 */
export interface ConnectorResult {
  readonly ok: true
  readonly data: unknown
  readonly provenance: ConnectorProvenance
  readonly usage: ConnectorUsage
  readonly externalRef?: ExternalRef
}

/**
 * Os códigos de erro estáveis — o vocabulário comum que faz o critério 4 valer.
 *
 * "Erros equivalentes de adapters diferentes podem ser tratados pelo orquestrador": um 401 do
 * GitHub e um 401 da Tavily precisam chegar como a **mesma** coisa, senão cada consumidor
 * reimplementa a tradução e as duas versões divergem. Por isso o código é enum fechado, e não
 * a string que o serviço externo mandou.
 *
 * A divisão é por **o que fazer a respeito**, não por faixa de status HTTP:
 * - `validacao-invalida`, `capacidade-desconhecida`, `connector-nao-registrado`,
 *   `contrato-incompativel` — o pedido está errado; repetir igual erra igual.
 * - `credencial-ausente`, `credencial-recusada`, `permissao-negada` — falta autorização;
 *   quem resolve é o usuário, e retentar entra em loop (regra da F02).
 * - `limite-excedido`, `indisponivel`, `timeout` — o serviço está no limite ou fora do ar;
 *   aqui retentar faz sentido, com backoff.
 * - `resposta-invalida` — respondeu, mas não com o que o contrato prevê.
 * - `cancelado` — o usuário (ou o timeout) abortou; não é falha do serviço.
 */
export const CONNECTOR_ERROR_CODES = [
  'connector-nao-registrado',
  'capacidade-desconhecida',
  'contrato-incompativel',
  'validacao-invalida',
  'credencial-ausente',
  'credencial-recusada',
  'permissao-negada',
  'limite-excedido',
  'indisponivel',
  'timeout',
  'resposta-invalida',
  'cancelado'
] as const

export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number]

/**
 * O que o consumidor pode fazer com o erro.
 *
 * Campo próprio, e não uma tabela que o orquestrador consulta: a **ação de retomada** é o que a
 * spec pede no `ConnectorError`, e quem sabe se aquele 429 específico vale retentar é quem
 * produziu o erro. Uma tabela fixa por código acertaria na maioria e erraria justamente nos
 * casos que importam (o 403 que é rate limit secundário do GitHub, não permissão).
 */
export const CONNECTOR_RECOVERY_ACTIONS = [
  /** Repetir tal e qual, respeitando o backoff. Só faz sentido com `retryable: true`. */
  'retentar',
  /** Corrigir o pedido antes de repetir. */
  'corrigir-entrada',
  /** Configurar ou reautenticar a credencial — ato do usuário. */
  'reautenticar',
  /** Não há o que fazer automaticamente; reportar ao usuário. */
  'reportar'
] as const

export type ConnectorRecoveryAction = (typeof CONNECTOR_RECOVERY_ACTIONS)[number]

/**
 * O que uma chamada malsucedida devolve.
 *
 * União com `ConnectorResult` pelo discriminante `ok` (`ConnectorOutcome`), e não exceção: o
 * mesmo recurso do `AiStreamEvent` com `estado: 'falhou'` — um erro que só existe como throw no
 * main não chega à tela, e cada chamador teria de lembrar de traduzi-lo.
 *
 * `evidencia` é o detalhe técnico **já sanitizado**: mensagem curta, sem corpo cru e sem
 * header. A sanitização de verdade — allowlist de campos e redaction — é da F02 (critério 6 de
 * lá); o que o contrato faz é dar ao detalhe um campo separado da `mensagem`, para que a UI
 * mostre uma coisa e a auditoria guarde outra sem que ninguém precise concatenar as duas.
 */
export interface ConnectorError {
  readonly ok: false
  readonly code: ConnectorErrorCode
  /** Motivo legível em pt-BR — é o que a tela mostra. Nunca carrega credencial. */
  readonly mensagem: string
  /**
   * `true` quando repetir o **mesmo** pedido pode dar certo. É o dado, não a decisão: quem
   * decide se vai retentar, quantas vezes e com que backoff é a F02.
   */
  readonly retryable: boolean
  readonly acao: ConnectorRecoveryAction
  readonly provenance: ConnectorProvenance
  /** Detalhe técnico sanitizado, para auditoria e investigação. */
  readonly evidencia?: string
  /**
   * Quanto o **serviço** pediu para esperar antes de tentar de novo, em ms — o `Retry-After` ou
   * equivalente (SPEC-Conectores-02: "backoff respeita orientação do serviço").
   *
   * Campo próprio e **número**, não texto dentro de `evidencia`: a governança precisa decidir
   * com ele, e uma orientação que só existe como string na mensagem é uma orientação que
   * ninguém obedece — foi exatamente o que o teste do backoff pegou. Quem traduz o cabeçalho
   * é o adapter, que conhece o formato do seu serviço (segundos, data HTTP, milissegundos).
   */
  readonly retryAfterMs?: number
}

/**
 * O desfecho de uma chamada — sucesso ou erro, discriminados por `ok`.
 *
 * É este tipo que atravessa o IPC. União discriminada e não `{ data?, error? }`: campos
 * opcionais fariam o renderer testar `undefined` em vez de tratar o caso, e o caminho não
 * testado seria justamente o de erro.
 */
export type ConnectorOutcome = ConnectorResult | ConnectorError

export function isConnectorId(value: unknown): value is ConnectorId {
  return typeof value === 'string' && (CONNECTOR_IDS as readonly string[]).includes(value)
}

export function isConnectorCredentialKey(value: unknown): value is ConnectorCredentialKey {
  return (
    typeof value === 'string' && (CONNECTOR_CREDENTIAL_KEYS as readonly string[]).includes(value)
  )
}

/**
 * O pedido tem a forma de um `ConnectorRequest`?
 *
 * Existe para a fronteira do IPC: o que chega do renderer é `unknown`, e confiar no tipo
 * declarado seria confiar no chamador. Checa só o que é estrutura — os campos obrigatórios e
 * seus tipos primitivos —, porque a regra (timeout positivo, idempotência em mutação) é de
 * `validarConnectorRequest`, e duplicá-la aqui criaria duas versões da mesma decisão para
 * divergirem depois.
 */
export function isConnectorRequest(value: unknown): value is ConnectorRequest {
  if (typeof value !== 'object' || value === null) return false

  const v = value as Record<string, unknown>
  const credencialOk =
    v.credential === undefined ||
    (typeof v.credential === 'object' &&
      v.credential !== null &&
      isConnectorCredentialKey((v.credential as Record<string, unknown>).key))

  return (
    typeof v.contractVersion === 'number' &&
    isConnectorId(v.connector) &&
    typeof v.operation === 'string' &&
    typeof v.correlationId === 'string' &&
    typeof v.timeoutMs === 'number' &&
    (v.idempotencyKey === undefined || typeof v.idempotencyKey === 'string') &&
    credencialOk &&
    'input' in v
  )
}

/**
 * Valida a **forma** do request, antes de o adapter existir na história (critério 2).
 *
 * Função pura, e é o que torna o critério afirmável sem infraestrutura: "request inválida não
 * chega ao adapter" é uma frase sobre a ordem das operações, e testá-la exige poder rodar a
 * validação isolada.
 *
 * O que ela checa é o que o **núcleo** sabe: versão do contrato, conector conhecido, operação
 * não vazia, correlação presente, timeout positivo e a regra da idempotência (mutação sem
 * chave não é pedido válido). O que ela **não** checa é o `input` — a forma do payload pertence
 * à operação, e quem valida é o adapter, com a informação que só ele tem.
 *
 * Devolve o erro em vez de lançar, pelo mesmo motivo do `ConnectorOutcome`: o caminho de recusa
 * é normal, não excepcional.
 */
export function validarConnectorRequest(
  request: ConnectorRequest,
  capability: ConnectorCapability | undefined
): ConnectorError | undefined {
  const provenance: ConnectorProvenance = {
    connector: request.connector,
    operation: request.operation,
    obtidoEm: new Date().toISOString()
  }

  const recusa = (
    code: ConnectorErrorCode,
    mensagem: string,
    acao: ConnectorRecoveryAction = 'corrigir-entrada'
  ): ConnectorError => ({ ok: false, code, mensagem, retryable: false, acao, provenance })

  if (request.contractVersion !== CONNECTOR_CONTRACT_VERSION) {
    return recusa(
      'contrato-incompativel',
      `Versão de contrato ${String(request.contractVersion)} não é suportada (esperada ${CONNECTOR_CONTRACT_VERSION}).`
    )
  }

  if (!isConnectorId(request.connector)) {
    return recusa('connector-nao-registrado', 'Conector desconhecido.', 'reportar')
  }

  if (request.operation.trim() === '') {
    return recusa('validacao-invalida', 'A operação é obrigatória.')
  }

  if (request.correlationId.trim() === '') {
    return recusa('validacao-invalida', 'O identificador de correlação é obrigatório.')
  }

  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    return recusa('validacao-invalida', 'O tempo limite precisa ser um número positivo.')
  }

  // A capacidade é resolvida pelo registro antes de chegar aqui; `undefined` é o adapter
  // dizendo que não sabe fazer isso. Recusar **aqui**, junto das outras checagens de forma, é
  // o que garante o critério 1: a falha acontece antes de qualquer I/O porque nada nesta
  // função toca rede, disco ou credencial.
  if (capability === undefined) {
    return recusa(
      'capacidade-desconhecida',
      `O conector ${ROTULO_DO_CONECTOR[request.connector]} não oferece a operação "${request.operation}".`,
      'reportar'
    )
  }

  // A regra da idempotência é do contrato e não da F02 **porque é sobre o pedido, não sobre a
  // política**: uma mutação sem chave é um pedido que ninguém pode repetir com segurança, e a
  // F02 não teria como consertar isso depois — só como recusar-se a retentar, o que já é
  // tarde. Recusar na entrada é o que mantém a promessa do critério 3 de lá viável.
  if (capability.effect === 'mutacao' && (request.idempotencyKey ?? '').trim() === '') {
    return recusa(
      'validacao-invalida',
      'Operação de mutação exige chave de idempotência — sem ela, repetir o pedido não é seguro.'
    )
  }

  return undefined
}
