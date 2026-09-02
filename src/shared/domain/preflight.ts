/**
 * Preflight e sandbox: o que precisa ser verdade **antes** de o executor começar
 * (SPEC-Entrega-03).
 *
 * A pergunta que este arquivo responde: **este run pode começar, e onde exatamente ele vai
 * mexer?** As duas metades são inseparáveis — liberar a execução sem ter fixado o alvo é o que
 * transforma um agente autônomo em um processo com acesso irrestrito à máquina.
 *
 * ## Por que o preflight é fail closed
 *
 * Cada verificação aqui responde "não" com um motivo, nunca com uma suposição. É a mesma
 * postura do Policy Engine (ADR) e da reconciliação da M9-F02: o caro não é o preflight parar
 * para perguntar; é ele liberar um executor sobre um worktree que outro run está usando, ou
 * sobre uma árvore com trabalho não commitado de alguém.
 *
 * ## O container é a fronteira, e por isso o cwd não é negociável
 *
 * O MVP-004 proibiu comando arbitrário, mas um agente que constrói software precisa exatamente
 * disso (test, lint, build). A decisão do PI de 2026-08-29 move a fronteira: a allowlist de
 * comandos segue governando o terminal **do usuário**, e o executor passa a ser governado pelo
 * **container**. Daí o critério 8 — *não existe caminho de execução no host* — ser uma regra de
 * tipo aqui, não uma convenção: `SandboxPreparado` não tem campo para cwd do host, então
 * nenhum chamador futuro consegue passar um por engano.
 *
 * **O que este arquivo não faz:** não fala com o Docker, não toca o disco, não mede o tempo.
 * Ele decide *o que conta como pronto*; quem executa mora no main.
 */

/**
 * De onde veio a lista de paths que o run pode alterar (critério 13).
 *
 * Enum fechado e não booleano porque a origem muda o que a lista **garante**: `spec` é escopo
 * que o PI aprovou explicitamente; `derivada` é inferência do preflight a partir da arquitetura
 * aprovada. Quem audita um diff precisa saber qual das duas autorizou aquele arquivo — e a
 * emenda 2 de 2026-08-30 registra que a derivação é decisão cravada pelo Cowork, não do PI.
 */
export const ORIGENS_DE_PATHS = ['spec', 'derivada'] as const

export type OrigemDePaths = (typeof ORIGENS_DE_PATHS)[number]

/**
 * A lista de paths permitidos, com a origem que a autoriza.
 *
 * **Registrada antes da execução, e é a registrada que vale** (critérios 6 e 13). A alternativa
 * — inferir o escopo no instante do commit — deixaria o run definir o próprio limite depois de
 * já ter escrito, que é precisamente o que o critério existe para impedir.
 */
export interface PathsPermitidos {
  readonly origem: OrigemDePaths
  /** Prefixos relativos à raiz do worktree. Vazio é inválido — ver `listaDePathsValida`. */
  readonly paths: readonly string[]
  /** Por que esta lista é esta, para quem lê a evidência sem conhecer a fatia. */
  readonly justificativa: string
}

/**
 * Uma lista vazia não é "sem restrição": é ausência de decisão.
 *
 * Tratar vazio como "pode tudo" inverteria o fail closed no exato ponto em que ele mais importa
 * — é o mesmo raciocínio de `isPathAllowed`, onde allowlist vazia não permite nada.
 */
export function listaDePathsValida(lista: PathsPermitidos | undefined): lista is PathsPermitidos {
  return lista !== undefined && lista.paths.length > 0 && lista.paths.every((p) => p.trim() !== '')
}

/**
 * Uma mudança está dentro do escopo declarado? (critério 6)
 *
 * Comparação **por segmento**, não por prefixo de string: `src/app` não pode autorizar
 * `src/application.ts`. É a mesma armadilha que `isPathAllowed` resolve para diretórios do SO,
 * e ela reaparece aqui porque o dado é o mesmo tipo de dado.
 */
export function caminhoDentroDoEscopo(caminho: string, lista: PathsPermitidos): boolean {
  const alvo = segmentos(caminho)
  // `..` no caminho nunca é legítimo vindo do Git — rejeita o caminho inteiro em vez de só
  // filtrar o segmento: um matcher de segurança que normalizasse `..` silenciosamente ainda
  // teria que provar que a normalização é correta em todo separador e SO; recusar é mais barato
  // e mais seguro (fail closed).
  if (alvo.includes('..')) return false
  return lista.paths.some((permitido) => {
    const base = segmentos(permitido)
    if (base.length === 0 || base.length > alvo.length) return false
    return base.every((parte, i) => parte === alvo[i])
  })
}

/** Os caminhos que saíram do escopo declarado. Vazio = diff dentro do combinado. */
export function fugasDoEscopo(
  caminhos: readonly string[],
  lista: PathsPermitidos
): readonly string[] {
  return caminhos.filter((caminho) => !caminhoDentroDoEscopo(caminho, lista))
}

function segmentos(caminho: string): readonly string[] {
  return caminho.split(/[\\/]+/).filter((parte) => parte !== '' && parte !== '.')
}

/**
 * Por que o preflight recusou — ou `liberado`, o único desfecho que inicia o executor.
 *
 * Enum fechado pela razão de sempre nesta base: a tela e a evidência precisam distinguir
 * "Docker desligado" (o usuário sobe e retoma) de "árvore suja" (alguém precisa decidir o que
 * fazer com o trabalho local). Uma string livre faria as duas virarem "falhou".
 */
export const PREFLIGHT_REASONS = [
  'liberado',
  /** Docker ausente ou desligado. `BLOCKED_EXTERNAL` — nunca há fallback para o host. */
  'docker-indisponivel',
  /** O proxy do host não está no ar: sem ele o executor não alcança modelo nenhum. */
  'proxy-indisponivel',
  /** A base não resolve (branch/SHA inexistente) — não dá para fixar de onde o run parte. */
  'base-nao-resolvida',
  /** O worktree tem modificação não commitada: não é lixo, e apagar seria destruir trabalho. */
  'arvore-suja',
  /** Outro run já possui o worktree, a porta ou o container. */
  'recurso-ocupado',
  /** Sem lista de paths registrada não há como medir fuga de escopo (critério 13). */
  'sem-paths-permitidos',
  /** O cwd pedido é o checkout ativo (critério 1) ou está fora da raiz operacional. */
  'cwd-invalido'
] as const

export type PreflightReason = (typeof PREFLIGHT_REASONS)[number]

/** O desfecho do preflight. `liberado` é o único que produz um `SandboxPreparado`. */
export interface PreflightOutcome {
  readonly reason: PreflightReason
  readonly sandbox?: SandboxPreparado
  readonly mensagem: string
  /** O que fazer para destravar — obrigatório quando a causa é externa (critério 10). */
  readonly retomada?: string
}

/**
 * O sandbox pronto: onde o executor roda, e sobre o quê.
 *
 * **`cwd` é sempre um caminho dentro do container.** O critério 8 pede que não exista caminho
 * de execução no host, e a forma de garantir isso sem depender de disciplina é não oferecer o
 * outro caminho: `worktreeNoHost` existe para o app versionar, e é nomeado de modo que passá-lo
 * como cwd do executor seja um erro visível na leitura, não um descuido silencioso.
 */
export interface SandboxPreparado {
  readonly runId: string
  readonly containerNome: string
  /** Caminho **dentro do container**. Ver a nota acima. */
  readonly cwd: string
  /** O SHA de onde a branch nasceu, fixado antes de qualquer escrita (critério 2). */
  readonly baseSha: string
  readonly branch: string
  /** Caminho do worktree no host — para o app versionar; nunca vai ao executor como cwd. */
  readonly worktreeNoHost: string
  readonly pathsPermitidos: PathsPermitidos
  /**
   * A URL do proxy que o container recebe — sem credencial embutida.
   *
   * Aponta para o **sidecar de egress do run** (critério 12), não direto para o proxy do host: o
   * executor só está na rede `--internal` do run, e o sidecar é o único outro membro dela.
   */
  readonly proxyUrl: string
}

/** Prefixos de lease desta fatia. O `UNIQUE(user_id, recurso)` faz o resto. */
export const RECURSO_WORKTREE = 'worktree:'
export const RECURSO_CONTAINER = 'container:'
export const RECURSO_PORTA = 'porta:'

/**
 * O nome do container e da branch derivam do **run**, não do projeto.
 *
 * Decisão cravada da spec: *"o container é do run"*. Derivar do projeto faria dois runs da mesma
 * fatia colidirem no nome — e o segundo reusaria silenciosamente o container do primeiro, que é
 * a reutilização indevida que a SPEC proíbe.
 */
export function nomeDoContainer(runId: string): string {
  return `jarvisos-run-${sanitizar(runId)}`
}

/**
 * A rede de egress do run — a fronteira do critério 12.
 *
 * `--internal`, sem rota de saída: é ela que faz `api.github.com` genuinamente inalcançável,
 * não uma instrução ao agente. O executor só se conecta a esta rede; o único outro membro é o
 * sidecar de proxy, que também tem pé na rede `bridge` padrão do Docker (a que alcança
 * `host.docker.internal`) — ver `nomeDoProxyDeEgress`.
 */
export function nomeDaRedeDeEgress(runId: string): string {
  return `jarvisos-egress-${sanitizar(runId)}`
}

/**
 * O sidecar dual-homed que faz o executor alcançar o proxy do host sem alcançar mais nada.
 *
 * Medido com Docker real: uma rede `--internal` bloqueia `api.github.com` (o que o critério 12
 * pede), mas bloqueia **também** `host.docker.internal` — a rota que o Docker Desktop usa para
 * alcançar o host depende de saída externa, que `--internal` corta por igual. Dois containers na
 * mesma rede `--internal` **se enxergam** entre si mesmo sem essa rota; por isso o sidecar entra
 * nas duas redes e encaminha uma porta fixa para o proxy real, sem nunca expor rota nenhuma para
 * fora da rede de egress.
 */
export function nomeDoProxyDeEgress(runId: string): string {
  return `jarvisos-proxy-${sanitizar(runId)}`
}

/** A porta que o sidecar escuta, do lado da rede de egress. Fixa: o sidecar só encaminha 1:1. */
export const PORTA_DO_PROXY_DE_EGRESS = 8080

export function nomeDaBranch(sliceId: string, runId: string): string {
  return `feat/${sanitizar(sliceId)}-${sanitizar(runId).slice(0, 8)}`
}

export function recursoDoWorktree(runId: string): string {
  return `${RECURSO_WORKTREE}${sanitizar(runId)}`
}

export function recursoDoContainer(runId: string): string {
  return `${RECURSO_CONTAINER}${sanitizar(runId)}`
}

export function recursoDaPorta(porta: number): string {
  return `${RECURSO_PORTA}${porta}`
}

/**
 * Só `[a-z0-9-]`, porque o resultado vira nome de container Docker e nome de branch Git.
 *
 * Sanitizar em vez de validar é deliberado: o `runId` é um UUID nosso, não entrada do usuário,
 * e recusar aqui transformaria um detalhe de formatação em falha de execução.
 */
function sanitizar(valor: string): string {
  return valor
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
