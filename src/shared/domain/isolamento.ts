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
  const publicadas = [...saida.matchAll(/:(\d+)->/g)].map((m) => Number(m[1]))
  const configuradas = saida
    .split(/\s+/)
    .filter((token) => /^\d+$/.test(token))
    .map(Number)
  return [...new Set([...publicadas, ...configuradas])]
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
}

/** Nomes que, por si, indicam credencial. `ANTHROPIC_BASE_URL` não casa: é só um endereço. */
const NOME_DE_CREDENCIAL = /(token|secret|passw|senha|api[_-]?key|credential|private[_-]?key)/i

/** O que do host jamais pode ser montado dentro de um sandbox. */
const MONTAGENS_PROIBIDAS: readonly RegExp[] = [
  /(^|\/)\.(claude|codex|ssh|aws|gnupg|kube|docker)(\/|$)/,
  /(^|\/)\.config\/gh(\/|$)/,
  /docker\.sock$/,
  /(^|\/)vault(\/|$)/
]

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
    } else if (conteudoTemSegredo(valor)) {
      achados.push({ origem: 'env', referencia: nome, motivo: 'Valor tem formato de segredo.' })
    }
  }

  for (const montagem of entrada.montagens) {
    const origem = normalizar(montagem.origem)
    if (MONTAGENS_PROIBIDAS.some((padrao) => padrao.test(origem)) || nomeProibido(origem)) {
      achados.push({
        origem: 'montagem',
        referencia: montagem.origem,
        motivo: 'Diretório do host com credencial montado no sandbox.'
      })
    }
  }

  for (const arquivo of entrada.arquivos) {
    if (nomeProibido(arquivo)) {
      achados.push({
        origem: 'arquivo',
        referencia: arquivo,
        motivo: 'Arquivo com nome de credencial dentro do container.'
      })
    }
  }

  if (entrada.comando.some((argumento) => conteudoTemSegredo(argumento))) {
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
