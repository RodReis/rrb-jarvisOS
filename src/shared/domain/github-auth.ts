/**
 * Device Flow do GitHub App — as decisões puras (SPEC-Conectores-03).
 *
 * O que mora aqui: interpretar a resposta do GitHub e decidir o que fazer com ela. O que **não**
 * mora: fazer a requisição, esperar, gravar no cofre. Mesma separação de `connector-governance.ts`
 * e pela mesma razão — afirmar que `slow_down` aumenta o intervalo não precisa de rede, e um
 * teste que precisasse de rede para dizer isso estaria medindo a rede.
 *
 * O ponto que a spec cobra e que só é verificável aqui: o polling termina em **sucesso,
 * cancelamento, expiração ou erro normalizado** (critério 3) — nunca em loop infinito. Como a
 * decisão é uma união fechada de desfechos, o compilador exige que todo caminho produza um deles.
 */

import type { ConnectorError, ConnectorErrorCode } from './connectors'

/**
 * Os endpoints do Device Flow.
 *
 * Constantes e não configuração: o Device Flow fala com o GitHub, e um endpoint que a UI ou o
 * `.env` pudessem mudar seria o proxy genérico que a SPEC-Conectores-01 (critério 6) proíbe —
 * por um caminho diferente, mas com o mesmo efeito. O teste substitui o `fetch`, não a URL.
 */
export const GITHUB_OAUTH_ORIGIN = 'https://github.com'
export const GITHUB_DEVICE_CODE_PATH = '/login/device/code'
export const GITHUB_ACCESS_TOKEN_PATH = '/login/oauth/access_token'

export const GITHUB_DEVICE_CODE_URL = `${GITHUB_OAUTH_ORIGIN}${GITHUB_DEVICE_CODE_PATH}`
export const GITHUB_ACCESS_TOKEN_URL = `${GITHUB_OAUTH_ORIGIN}${GITHUB_ACCESS_TOKEN_PATH}`

/**
 * A origem efetiva do OAuth, com o override de **ambiente do main** quando presente.
 *
 * Existe por uma razão só: provar o Device Flow no app real, contra um servidor local que conta
 * requisições, sem falar com o GitHub de verdade — a mesma técnica do `ANTHROPIC_BASE_URL` que
 * os E2E do MVP-005 já usam, e a decisão de método do PI que separa "o mock não foi chamado" de
 * "a requisição não saiu".
 *
 * **Isto não é o proxy genérico que a SPEC-Conectores-01 (critério 6) proíbe**, e a diferença é
 * quem escolhe: ali seria o *renderer* mandando um endereço pelo IPC; aqui é uma variável do
 * processo main, o mesmo grau de confiança do `.env` que já guarda credencial. Não há canal que
 * a alcance, e a UI não tem como influenciá-la.
 *
 * **Só origem, nunca caminho.** Os paths continuam constantes e são concatenados aqui — um
 * override que carregasse caminho poderia apontar o polling para outro endpoint da mesma
 * origem, e o que este ponto de teste precisa é trocar o *servidor*, não a rota.
 *
 * Valor inválido é ignorado em vez de derrubar o boot: uma variável mal digitada não deve
 * impedir alguém de usar o GitHub de verdade.
 */
export function origemDoOAuth(override?: string): string {
  const limpo = override?.trim()
  if (limpo === undefined || limpo === '') return GITHUB_OAUTH_ORIGIN

  try {
    // `new URL(…).origin` descarta caminho, query e fragmento — é o que faz "só origem" ser
    // uma garantia da forma, e não uma regra que alguém precisa lembrar de respeitar.
    const url = new URL(limpo)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : GITHUB_OAUTH_ORIGIN
  } catch {
    return GITHUB_OAUTH_ORIGIN
  }
}

/**
 * Onde o usuário instala a GitHub App.
 *
 * A spec pede que instalação insuficiente vire `BLOCKED_EXTERNAL` "cuja ação concreta é a URL
 * de instalação, não uma mensagem genérica" (§ decisões cravadas). A URL depende do **slug**
 * público da App, que só é conhecido quando a App existe — por isso é derivada, não constante.
 */
export function urlDeInstalacao(appSlug: string): string {
  return `https://github.com/apps/${appSlug}/installations/new`
}

/**
 * O `client_id` embutido no desktop.
 *
 * **Vazio nesta fatia, por decisão do PI (2026-08-29):** a GitHub App do projeto ainda não foi
 * registrada, e inventar um identificador produziria um app que falha na primeira chamada com um
 * erro do GitHub em vez de dizer o que falta. Vazio é o fato, e `resolverClientId` o trata como
 * ausente — o override em Configurações é o caminho que funciona hoje.
 *
 * Não é segredo: o `client_id` de uma App é público por desenho no Device Flow (é ele que vai na
 * URL que o usuário abre). O que **nunca** entra aqui é private key ou client secret.
 */
export const GITHUB_CLIENT_ID_EMBUTIDO = ''

/**
 * Qual `client_id` usar: o override do usuário quando preenchido, senão o embutido.
 *
 * Precedência do override (critério 7), e a mesma forma do vault>env do `CredentialService`: o
 * valor que o usuário configurou vence o de fábrica, porque senão a tela diria "salvo" e a rede
 * usaria outro — a divergência silenciosa que a M5-F01 já tinha fechado.
 *
 * Espaços são aparados antes de decidir: um override colado com quebra de linha é a intenção de
 * configurar, não um `client_id` cujo último caractere é uma quebra.
 */
export function resolverClientId(override?: string): string | undefined {
  const limpo = override?.trim()
  if (limpo !== undefined && limpo !== '') return limpo

  const embutido = GITHUB_CLIENT_ID_EMBUTIDO.trim()
  return embutido === '' ? undefined : embutido
}

/** O que o GitHub devolve ao abrir o Device Flow (`POST /login/device/code`). */
export interface DeviceCodeGrant {
  readonly deviceCode: string
  /** O código de 8 caracteres que o usuário digita no navegador. É público — vai na tela. */
  readonly userCode: string
  readonly verificationUri: string
  /** Quando o `deviceCode` deixa de valer, em ISO UTC. Absoluto e não `expires_in` relativo. */
  readonly expiraEm: string
  /** Intervalo mínimo entre dois pollings, em ms — já convertido dos segundos do GitHub. */
  readonly intervaloMs: number
}

/**
 * O material que o Device Flow produz — **o payload estruturado que vai cifrado no cofre**
 * (critério 8).
 *
 * Um objeto e não três chaves separadas no vault, porque as três só fazem sentido juntas: um
 * refresh token gravado sem o access token que ele renova é lixo, e gravá-los em três linhas
 * faria "rotação atômica" depender de três escritas darem certo. Uma linha, uma escrita.
 *
 * `refreshToken` e as expirações são opcionais porque a GitHub App só os emite quando a expiração
 * de user token está ligada na configuração da App; sem ela, o access token não expira e não há o
 * que renovar.
 */
export interface GithubOAuthPayload {
  readonly accessToken: string
  readonly refreshToken?: string
  /** ISO UTC. Ausente quando a App não expira user tokens. */
  readonly expiraEm?: string
  readonly refreshExpiraEm?: string
  readonly tokenType: string
  /** Escopos concedidos, quando o GitHub os informa. GitHub App usa permissões, não escopos. */
  readonly scope?: string
}

/**
 * O que o polling decidiu fazer a seguir.
 *
 * União fechada de três desfechos, e é ela que **prova** o critério 3: `esperar` é o único que
 * continua o laço, e ele carrega o próximo intervalo em vez de deixar o chamador escolher. Um
 * `boolean` de "continuar?" deixaria o intervalo do lado de fora, que é exatamente onde o
 * `slow_down` seria esquecido.
 */
export type DecisaoDePolling =
  | { readonly tipo: 'concluido'; readonly payload: GithubOAuthPayload }
  | { readonly tipo: 'esperar'; readonly intervaloMs: number }
  | { readonly tipo: 'falhou'; readonly code: ConnectorErrorCode; readonly mensagem: string }

/**
 * Quanto o `slow_down` acrescenta ao intervalo.
 *
 * Cinco segundos é o que a documentação do GitHub manda ("wait for the interval plus 5 seconds").
 * Constante nomeada e não `+ 5000` no meio da conta: o número vem do serviço, não de nós, e um
 * literal solto vira o tipo de coisa que alguém "otimiza" para 1000 sem saber de onde veio.
 */
export const SLOW_DOWN_ACRESCIMO_MS = 5_000

/**
 * Interpreta uma resposta do endpoint de token e decide o próximo passo.
 *
 * Função pura sobre o JSON já parseado. Os erros que a spec nomeia (`authorization_pending`,
 * `slow_down`, expiração, cancelamento) são tratados por nome; o resto cai no `default` como erro
 * normalizado — e é isso que faz "erro desconhecido do GitHub" ser um desfecho previsto em vez de
 * um `undefined` atravessando o serviço.
 *
 * `intervaloAtualMs` entra porque `slow_down` é **incremento**, não valor absoluto: o GitHub manda
 * esperar mais do que estava esperando, e recomeçar do intervalo inicial a cada `slow_down`
 * levaria de volta ao ritmo que ele acabou de recusar.
 */
export function interpretarRespostaDeToken(
  corpo: Record<string, unknown>,
  intervaloAtualMs: number,
  agoraMs: number = Date.now()
): DecisaoDePolling {
  const erro = typeof corpo.error === 'string' ? corpo.error : undefined

  if (erro === undefined) {
    const payload = lerPayloadDeToken(corpo, agoraMs)
    return payload === undefined
      ? {
          tipo: 'falhou',
          code: 'resposta-invalida',
          mensagem: 'O GitHub respondeu sem access token e sem erro.'
        }
      : { tipo: 'concluido', payload }
  }

  switch (erro) {
    case 'authorization_pending':
      // O usuário ainda não digitou o código. É o caminho normal, não uma falha.
      return { tipo: 'esperar', intervaloMs: intervaloAtualMs }

    case 'slow_down': {
      // O GitHub pode mandar um `interval` novo junto; quando manda, ele é a ordem, e o acréscimo
      // fixo é só o piso para quando não manda.
      const sugerido = segundosParaMs(corpo.interval)
      return {
        tipo: 'esperar',
        intervaloMs: Math.max(sugerido ?? 0, intervaloAtualMs + SLOW_DOWN_ACRESCIMO_MS)
      }
    }

    case 'expired_token':
      return {
        tipo: 'falhou',
        code: 'credencial-ausente',
        mensagem: 'O código expirou antes de ser autorizado. Recomece a autenticação.'
      }

    case 'access_denied':
      return {
        tipo: 'falhou',
        code: 'cancelado',
        mensagem: 'A autorização foi negada no navegador.'
      }

    case 'incorrect_client_credentials':
      return {
        tipo: 'falhou',
        code: 'credencial-recusada',
        mensagem: 'O GitHub não reconheceu o client ID. Confira o override em Configurações.'
      }

    case 'device_flow_disabled':
      return {
        tipo: 'falhou',
        code: 'permissao-negada',
        mensagem: 'O Device Flow está desligado na configuração desta GitHub App.'
      }

    default:
      return {
        tipo: 'falhou',
        code: 'resposta-invalida',
        // A mensagem do GitHub **não** entra: ela é texto do serviço e a spec pede erro
        // normalizado. O código bruto vira evidência sanitizada no serviço, não mensagem de tela.
        mensagem: 'O GitHub recusou a autorização por um motivo não previsto.'
      }
  }
}

/**
 * Extrai o payload de uma resposta bem-sucedida — a mesma leitura serve ao Device Flow e ao
 * refresh, que devolvem o mesmo formato.
 *
 * `undefined` quando falta o access token — a única parte realmente obrigatória. Um payload sem
 * ele seria gravado no cofre e falharia na primeira chamada de API, longe daqui, com um erro que
 * não diz que a autenticação nunca completou.
 *
 * As expirações chegam relativas (`expires_in`, em segundos) e são gravadas **absolutas**: um
 * "faltam 28800 segundos" guardado no disco começa a mentir no instante seguinte, e é sobre o
 * disco que a decisão de renovar é tomada, possivelmente dias depois.
 */
export function lerPayloadDeToken(
  corpo: Record<string, unknown>,
  agoraMs: number = Date.now()
): GithubOAuthPayload | undefined {
  const accessToken = typeof corpo.access_token === 'string' ? corpo.access_token : undefined
  if (accessToken === undefined || accessToken === '') return undefined

  const refreshToken =
    typeof corpo.refresh_token === 'string' && corpo.refresh_token !== ''
      ? corpo.refresh_token
      : undefined
  const expiraEmMs = segundosParaMs(corpo.expires_in)
  const refreshExpiraEmMs = segundosParaMs(corpo.refresh_token_expires_in)

  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiraEmMs === undefined ? {} : { expiraEm: new Date(agoraMs + expiraEmMs).toISOString() }),
    ...(refreshExpiraEmMs === undefined
      ? {}
      : { refreshExpiraEm: new Date(agoraMs + refreshExpiraEmMs).toISOString() }),
    tokenType: typeof corpo.token_type === 'string' ? corpo.token_type : 'bearer',
    ...(typeof corpo.scope === 'string' && corpo.scope !== '' ? { scope: corpo.scope } : {})
  }
}

/**
 * Lê o grant do Device Flow (`POST /login/device/code`).
 *
 * `undefined` quando falta `device_code` ou `user_code`: sem os dois não há o que mostrar ao
 * usuário nem o que enviar no polling, e um grant meio-lido levaria o laço a perguntar por um
 * código que não existe até expirar.
 */
export function lerGrantDeDeviceCode(
  corpo: Record<string, unknown>,
  agoraMs: number = Date.now()
): DeviceCodeGrant | undefined {
  const deviceCode = typeof corpo.device_code === 'string' ? corpo.device_code : ''
  const userCode = typeof corpo.user_code === 'string' ? corpo.user_code : ''
  if (deviceCode === '' || userCode === '') return undefined

  // Padrões do GitHub quando o campo não vem: 900s de validade, 5s de intervalo.
  const expiraEmMs = segundosParaMs(corpo.expires_in) ?? 900_000
  const intervaloMs = segundosParaMs(corpo.interval) ?? 5_000

  return {
    deviceCode,
    userCode,
    verificationUri:
      typeof corpo.verification_uri === 'string' && corpo.verification_uri !== ''
        ? corpo.verification_uri
        : 'https://github.com/login/device',
    expiraEm: new Date(agoraMs + expiraEmMs).toISOString(),
    intervaloMs
  }
}

/**
 * Segundos do GitHub para milissegundos nossos.
 *
 * Aceita número e string porque a resposta form-encoded traz tudo como texto e a JSON traz número
 * — e o mesmo campo mudar de tipo conforme o `Accept` não deve virar dois caminhos no chamador.
 * Valor não-finito ou não-positivo vira `undefined`: prazo negativo não é prazo.
 */
function segundosParaMs(valor: unknown): number | undefined {
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN
  return Number.isFinite(numero) && numero > 0 ? numero * 1000 : undefined
}

/**
 * O que a UI pode saber sobre a autenticação — **e nada além** (critério 2).
 *
 * Mora no domínio compartilhado e não no main porque atravessa o IPC: é o retorno de
 * `github:auth-status`, e o contrato em `contracts/ipc.ts` não pode importar de `src/main`.
 *
 * `estado` e não um booleano `conectado`, porque três situações precisam de tratamento distinto
 * na tela: nunca autenticou (`missing`), autenticou e vale (`present`), autenticou e venceu
 * (`expirado`). Um booleano faria "expirado" parecer "nunca conectou", e o usuário
 * reautenticaria sem entender por quê.
 *
 * **Nenhum campo carrega token** — nem prefixo, nem tamanho, nem hash. Mesma forma do
 * `CredentialStatusView` da M5-F01, e é a forma que garante o critério, não a disciplina de quem
 * preenche: não existe campo onde o segredo caiba. `expiraEm` é metadado não-secreto, e é o que
 * a coluna `expires_at` torna respondível sem decifrar.
 */
export interface GithubAuthSnapshot {
  readonly estado: 'missing' | 'present' | 'expirado'
  readonly expiraEm?: string
  /** Há refresh token guardado — a tela distingue "vai renovar" de "vai pedir login de novo". */
  readonly renovavel: boolean
  /** O `client_id` está resolvido? `false` = falta preencher o override em Configurações. */
  readonly clientIdConfigurado: boolean
}

/**
 * O que o renderer recebe quando um Device Flow é aberto.
 *
 * `userCode` e `verificationUri` **são públicos por desenho**: o usuário precisa lê-los para
 * autorizar, e o Device Flow existe justamente porque eles podem ser mostrados numa tela. O que
 * não sai daqui é o `deviceCode` — esse é o que troca por token, e mandá-lo ao renderer entregaria
 * a metade do fluxo que vale como segredo de curta duração.
 */
export interface GithubDeviceFlowView {
  readonly userCode: string
  readonly verificationUri: string
  readonly expiraEm: string
}

/** O grant já expirou? Comparação absoluta — o `expiraEm` é ISO, o relógio é do serviço. */
export function grantExpirou(grant: DeviceCodeGrant, agoraMs: number): boolean {
  return Date.parse(grant.expiraEm) <= agoraMs
}

/**
 * A margem com que um token é considerado "vencendo" antes de vencer.
 *
 * Sem ela, um token que expira em três segundos passa na comparação crua e expira no meio da
 * chamada, e o usuário vê um 401 que a renovação teria evitado. A margem transforma "ainda vale"
 * em "vale pelo tempo de uma chamada".
 */
export const MARGEM_DE_RENOVACAO_MS = 60_000

/**
 * O access token precisa ser renovado antes de ser usado? (critério 5: "renovar antes do uso".)
 *
 * Sem `expiraEm` = não expira (App sem expiração de user token) = nunca precisa renovar.
 */
export function precisaRenovar(
  payload: GithubOAuthPayload,
  agoraMs: number,
  margemMs: number = MARGEM_DE_RENOVACAO_MS
): boolean {
  if (payload.expiraEm === undefined) return false
  return Date.parse(payload.expiraEm) - margemMs <= agoraMs
}

/**
 * O erro normalizado de "a App não está instalada onde precisa" (critério 5).
 *
 * Fábrica e não constante porque a **ação concreta** é a URL de instalação, que depende do slug da
 * App. `acao: 'reautenticar'` e não `'reportar'`: há o que fazer, e quem faz é o usuário.
 * `permissao-negada` mapeia para `BLOCKED_EXTERNAL` na tabela da F02, que é o que a spec pede.
 */
export function erroDeInstalacaoAusente(
  appSlug: string,
  obtidoEm: string,
  operation: string
): ConnectorError {
  return {
    ok: false,
    code: 'permissao-negada',
    mensagem: `A GitHub App não está instalada nesta conta. Instale em ${urlDeInstalacao(appSlug)} e tente de novo.`,
    retryable: false,
    acao: 'reautenticar',
    provenance: { connector: 'github', operation, obtidoEm }
  }
}
