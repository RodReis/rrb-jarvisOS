/**
 * O isolamento concorrente (SPEC-Scheduler-03): o que faz de cada run **dono exclusivo** dos seus
 * recursos — worktree, branch, container, rede, sidecar, portas, perfis — e o que permite achá-los
 * de novo depois de um crash sem tocar nos de outro run.
 *
 * Este arquivo é regra pura: nada de Docker, Git ou SQLite. O que decide aqui é *o que conta como
 * recurso do run, que porta é inédita e o que é credencial proibida dentro do sandbox*; quem
 * executa é `isolamento-service.ts`.
 */

import { conteudoTemSegredo, nomeProibido } from './segredos'

/** Os recursos que um run ocupa e que o inventário precisa conhecer. */
export const TIPOS_DE_RECURSO = [
  'worktree',
  'branch',
  'container',
  'rede',
  'sidecar',
  'porta',
  'perfil'
] as const

export type TipoDeRecurso = (typeof TIPOS_DE_RECURSO)[number]

/**
 * O ciclo de vida de um recurso no inventário.
 *
 * `planejado` é gravado **antes** de criar (a intenção), `criado` depois de confirmar. É a
 * mesma ordem do diário de efeitos: um crash entre os dois deixa `planejado`, e a reconciliação
 * sabe que o recurso pode ou não existir — e olha o disco antes de decidir.
 */
export const ESTADOS_DO_RECURSO = ['planejado', 'criado', 'parado', 'removido'] as const

export type EstadoDoRecurso = (typeof ESTADOS_DO_RECURSO)[number]

const TRANSICOES: Readonly<Record<EstadoDoRecurso, readonly EstadoDoRecurso[]>> = {
  planejado: ['criado', 'parado', 'removido'],
  criado: ['parado', 'removido'],
  parado: ['removido'],
  removido: []
}

/** `removido` é terminal e ninguém volta atrás: um recurso recriado é um registro novo. */
export function transicaoValida(de: EstadoDoRecurso, para: EstadoDoRecurso): boolean {
  return TRANSICOES[de].includes(para)
}

export const LABEL_GERIDO = 'jarvisos.gerido'
export const LABEL_RUN = 'jarvisos.run'
export const LABEL_FATIA = 'jarvisos.fatia'
export const LABEL_PROJETO = 'jarvisos.projeto'
export const LABEL_TENTATIVA = 'jarvisos.tentativa'

export interface IdentidadeDoRun {
  readonly runId: string
  readonly sliceId: string
  readonly projectId: string
  /** A tentativa do run (M9-F04). Ausente = 1, o run comum. */
  readonly tentativa?: number
}

/**
 * As labels que o Docker guarda em container, rede e sidecar.
 *
 * É o que torna o recurso **verificável**: a descoberta é por label do run, nunca por glob de
 * nome. Um `docker ps --filter name=jarvisos-*` também pegaria o container de outro usuário da
 * máquina; a label `jarvisos.run=<id>` só pega o do run.
 */
export function labelsDoRecurso(identidade: IdentidadeDoRun): Readonly<Record<string, string>> {
  return {
    [LABEL_GERIDO]: 'true',
    [LABEL_RUN]: identidade.runId,
    [LABEL_FATIA]: identidade.sliceId,
    [LABEL_PROJETO]: identidade.projectId,
    [LABEL_TENTATIVA]: String(identidade.tentativa ?? 1)
  }
}

/** `--label k=v` para cada par. Um argumento por valor: não há shell para reinterpretar. */
export function argsDeLabel(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels).flatMap(([chave, valor]) => ['--label', `${chave}=${valor}`])
}

/**
 * A faixa de onde saem as portas dos runs.
 *
 * Alta e fora do que o projeto usa (web 5180, API 3311, Postgres 5433, Redis 6380) e do que o
 * sistema reserva: a faixa existe para não disputar com nada que já esteja configurado.
 */
export const FAIXA_DE_PORTAS = { inicio: 20000, fim: 20999 } as const

export interface FaixaDePortas {
  readonly inicio: number
  readonly fim: number
}

/** A primeira porta da faixa que ninguém tem — ou `undefined` se a faixa acabou. */
export function escolherPorta(
  faixa: FaixaDePortas,
  indisponiveis: ReadonlySet<number>
): number | undefined {
  for (let porta = faixa.inicio; porta <= faixa.fim; porta += 1) {
    if (!indisponiveis.has(porta)) return porta
  }
  return undefined
}

/**
 * As portas **do host** que uma saída do Docker declara.
 *
 * Entende as duas formas que o projeto usa: `docker ps --format {{.Ports}}`
 * (`0.0.0.0:20001->5432/tcp, [::]:20001->5432/tcp`) e a lista de `HostPort` que o
 * `docker inspect` entrega para container **parado** (`20010 20011`). A segunda importa porque
 * "porta já configurada por outro container" inclui o que não está rodando agora e volta no
 * próximo `docker start`.
 */
export function portasDaSaidaDoDocker(saida: string): number[] {
  const portas = new Set<number>()
  const somar = (de: string, ate: string | undefined): void => {
    const inicio = Number(de)
    const fim = ate === undefined ? inicio : Number(ate)
    // Faixa invertida ou fora de 1–65535 não é porta: nada a somar.
    if (inicio < 1 || fim > 65_535 || fim < inicio) return
    for (let porta = inicio; porta <= fim; porta += 1) portas.add(porta)
  }
  // `0.0.0.0:8000-8002->80-82/tcp`: a faixa do host é a que vem **antes** da seta.
  for (const m of saida.matchAll(/:(\d+)(?:-(\d+))?->/g)) somar(m[1] ?? '', m[2])
  for (const token of saida.split(/\s+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (m !== null) somar(m[1] ?? '', m[2])
  }
  return [...portas]
}

// ─── o scanner de credenciais proibidas ──────────────────────────────────────────────────────────

export type OrigemDoAchado = 'env' | 'montagem' | 'arquivo' | 'comando'

/**
 * Um achado do scanner. **Nunca carrega o valor**: o relatório do scanner vai para a auditoria e
 * para a tela, e um scanner que imprime o segredo que achou é um segundo vazamento.
 */
export interface AchadoDoScanner {
  readonly origem: OrigemDoAchado
  readonly referencia: string
  readonly motivo: string
}

export interface MontagemInspecionada {
  readonly origem: string
  readonly destino: string
  readonly somenteLeitura: boolean
}

export interface EntradaDoScanner {
  /** `NOME=valor`, como `docker inspect` entrega em `Config.Env`. */
  readonly env: readonly string[]
  readonly montagens: readonly MontagemInspecionada[]
  readonly comando: readonly string[]
  /** Caminhos de arquivo vistos dentro do container (`find`). */
  readonly arquivos: readonly string[]
  /**
   * O conteúdo do `config` do `.git` principal, montado em `/gitcommon`. Um remote com
   * `https://usuario:token@host` ali fica legível ao agente, e nenhum outro lugar do scanner o vê.
   */
  readonly configDoGit?: string
}

/**
 * Nomes que, por si, indicam credencial. `ANTHROPIC_BASE_URL` e `GIT_AUTHOR_NAME` não casam: o
 * primeiro é só um endereço, e `auth` só conta como palavra inteira (`AUTH`, `MY_AUTH_HEADER`).
 */
const NOME_DE_CREDENCIAL =
  /(token|secret|passw|senha|api[_-]?key|credential|private[_-]?key|access[_-]?key|bearer|cookie|(^|_)auth(_|$))/i

/**
 * Formatos de valor que o `segredos.ts` (feito para o contexto de IA) não cobre e o sandbox precisa:
 * Stripe, Slack, JWT e, sobretudo, **URL com usuário e senha** (`postgres://u:p@host/db`,
 * `https://x-access-token:...@github.com`) — o formato que a redação do terminal mascara e que o
 * scanner, por isso, recebe a saída crua (`saidaEhSensivel`).
 */
const VALORES_EXTRAS: readonly RegExp[] = [
  /\bsk_(live|test)_[A-Za-z0-9]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i
]

const temSegredo = (texto: string): boolean =>
  conteudoTemSegredo(texto) || VALORES_EXTRAS.some((padrao) => padrao.test(texto))

/** Arquivos de credencial que o `NOMES_PROIBIDOS` do contexto não pega (ponto na frente, sem extensão). */
const ARQUIVOS_EXTRAS: readonly RegExp[] = [
  /(^|\/)\.credentials\.json$/,
  /(^|\/)\.git-credentials$/,
  /(^|\/)\.pgpass$/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.kube\/config$/
]

/** O que do host jamais pode ser montado dentro de um sandbox. */
const MONTAGENS_PROIBIDAS: readonly RegExp[] = [
  /(^|\/)\.(claude|codex|ssh|aws|gnupg|kube|docker|azure)(\/|$)/,
  /(^|\/)\.config\/(gh|gcloud)(\/|$)/,
  /(^|\/)\.git-credentials/,
  // Socket do Docker no Linux e named pipe no Windows (`//./pipe/docker_engine`).
  /docker\.sock$/,
  /(^|\/)pipe\/docker/,
  /(^|\/)vault(\/|$)/
]

const arquivoDeCredencial = (caminho: string): boolean =>
  nomeProibido(caminho) || ARQUIVOS_EXTRAS.some((padrao) => padrao.test(normalizar(caminho)))

const normalizar = (caminho: string): string => caminho.replace(/\\/g, '/').toLowerCase()

/**
 * O sandbox carrega credencial proibida? (SPEC-Scheduler-03, critério 4)
 *
 * Quatro lugares onde ela entra: variável de ambiente, montagem do host, arquivo dentro do
 * container e o comando de entrada. Cobre o que a SPEC proíbe — GitHub, Vault e segredos do
 * projeto dentro do container — pelos mesmos padrões da detecção de contexto (`segredos.ts`).
 * Como todo detector por padrão, fecha o caminho comum; não prova ausência.
 */
export function escanearSandbox(entrada: EntradaDoScanner): AchadoDoScanner[] {
  const achados: AchadoDoScanner[] = []

  for (const linha of entrada.env) {
    const corte = linha.indexOf('=')
    const nome = corte === -1 ? linha : linha.slice(0, corte)
    const valor = corte === -1 ? '' : linha.slice(corte + 1)
    if (NOME_DE_CREDENCIAL.test(nome)) {
      achados.push({
        origem: 'env',
        referencia: nome,
        motivo: 'Nome de variável indica credencial.'
      })
    } else if (temSegredo(valor)) {
      achados.push({ origem: 'env', referencia: nome, motivo: 'Valor tem formato de segredo.' })
    }
  }

  for (const montagem of entrada.montagens) {
    const origem = normalizar(montagem.origem)
    if (MONTAGENS_PROIBIDAS.some((padrao) => padrao.test(origem)) || arquivoDeCredencial(origem)) {
      achados.push({
        origem: 'montagem',
        referencia: montagem.origem,
        motivo: 'Diretório do host com credencial montado no sandbox.'
      })
    }
  }

  for (const arquivo of entrada.arquivos) {
    if (arquivoDeCredencial(arquivo)) {
      achados.push({
        origem: 'arquivo',
        referencia: arquivo,
        motivo: 'Arquivo com nome de credencial dentro do container.'
      })
    }
  }

  if (entrada.configDoGit !== undefined && temSegredo(entrada.configDoGit)) {
    achados.push({
      origem: 'arquivo',
      referencia: '/gitcommon/config',
      motivo: 'O config do Git montado no sandbox traz credencial num remote.'
    })
  }

  if (entrada.comando.some((argumento) => temSegredo(argumento))) {
    achados.push({
      origem: 'comando',
      referencia: 'comando',
      motivo: 'O comando de entrada carrega um segredo.'
    })
  }

  return achados
}

// ─── a exceção da limpeza ────────────────────────────────────────────────────────────────────────

export interface InventarioParaLimpeza {
  /** Redes do inventário em estado não removido. */
  readonly redes: ReadonlySet<string>
}

/**
 * O comando é a remoção de **uma rede que o inventário lista**?
 *
 * É a exceção do ADR-007 à política de comandos destrutivos: `docker network rm` casa `rm`, e a
 * limpeza automática não pode parar num gate humano. A exceção é estreita de propósito — um único
 * formato exato, `docker network rm <rede>`, e só para o nome que o inventário conhece. Qualquer
 * outro argumento, outra rede ou outro binário continua pedindo aprovação. Fail closed.
 */
export function comandoDeLimpezaDoInventario(
  binario: string,
  args: readonly string[],
  inventario: InventarioParaLimpeza
): boolean {
  if (binario !== 'docker' || args.length !== 3) return false
  const [grupo, verbo, alvo] = args
  return grupo === 'network' && verbo === 'rm' && alvo !== undefined && inventario.redes.has(alvo)
}

/**
 * O run — ou a **unidade de sandbox** de um run — está ativo?
 *
 * O Squad e a suíte passam ao preflight uma unidade (`<run>-<escritor>-<tarefa>-t<n>`,
 * `<run>-teste-t<n>`) no lugar do `runId`, e é ela que o inventário registra. Procurar a unidade
 * entre os runs ativos a daria por morta e a reconciliação devolveria o sandbox de um run que
 * segue em execução. Prefixo **por segmento** (`<run>-`): `run-10` não é unidade de `run-1`.
 */
export function runOuUnidadeAtiva(id: string, runsAtivos: readonly string[]): boolean {
  return runsAtivos.some((run) => id === run || id.startsWith(`${run}-`))
}
