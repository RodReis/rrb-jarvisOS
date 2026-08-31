/**
 * O Docker como **sandbox do executor** (SPEC-Entrega-03, decisão do PI de 2026-08-29).
 *
 * A pergunta que este arquivo responde: **o container existe, está sadio, e o que está montado
 * nele?** Não é um cliente Docker genérico — é o conjunto fechado de operações que o preflight
 * precisa, e nada além.
 *
 * ## Por que não há fallback para o host
 *
 * O MVP-004 proibiu comando arbitrário; um agente que constrói software precisa exatamente
 * disso. A fronteira que reconcilia os dois é o container: se ele não sobe, o run vira
 * `BLOCKED_EXTERNAL` com ação concreta (critério 10). Executar no host "só desta vez" seria
 * justamente o buraco que a decisão do PI fechou — e por isso não existe um caminho aqui que o
 * ofereça, nem sob flag.
 *
 * ## Por que passa pelo `TerminalEngine`
 *
 * Todo comando do app é auditado, redigido e governado por política num ponto só. Um `spawn`
 * direto daqui criaria uma segunda porta de execução — sem `AuditEvent`, sem redação de
 * segredo — que é a duplicação que o MVP-004 existe para impedir. O custo é que `docker` precisa
 * estar na allowlist de comandos do workspace; a alternativa (burlar o ponto único) é pior.
 *
 * **Timeout:** o engine injetado aqui é instanciado com prazo maior que os 30 s do terminal do
 * usuário — `docker run` de imagem ainda não baixada leva minutos. O prazo é do engine, não
 * deste arquivo, porque quem governa execução é ele.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import { cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalEngine } from '../execution/terminal-engine'

/**
 * O prazo do terminal que executa Docker.
 *
 * Cinco minutos, contra os 30 s do terminal do usuário: `docker run` de imagem ainda não baixada
 * puxa centenas de MB, e o prazo curto transformaria a primeira execução de qualquer máquina
 * nova em `timeout-excedido` — uma falha que não é falha. O prazo é do engine, e por isso o boot
 * instancia um segundo `TerminalEngine` em vez de afrouxar o do usuário.
 */
export const TIMEOUT_DOCKER_MS = 5 * 60_000

/** O binário. Constante, nunca vindo de entrada — a mesma regra do `claude` e do `git`. */
export const BINARIO_DOCKER = 'docker'

/**
 * A imagem do sandbox.
 *
 * Pinada por tag e não `latest` implícito: o executor precisa de ambiente reproduzível, e uma
 * imagem que muda sob os pés faz o mesmo run produzir resultados diferentes em dias diferentes.
 */
export const IMAGEM_PADRAO = 'node:22-bookworm'

/** Onde o worktree aparece dentro do container. Fixo: o cwd do executor deriva daqui. */
export const RAIZ_NO_CONTAINER = '/work'

/** Onde o `.git` do worktree e o `.git` principal aparecem dentro do container. */
export const GITMETA_NO_CONTAINER = `${RAIZ_NO_CONTAINER}/.gitmeta`
export const GITCOMMON_NO_CONTAINER = '/gitcommon'

export interface MontagemDoSandbox {
  readonly worktreeNoHost: string
  /**
   * A **cópia** do `.git/worktrees/<lease>`, feita para o container.
   *
   * Cópia e não o original: o `commondir` precisa apontar para caminhos diferentes no host e no
   * container, e é **um arquivo só**. Reescrevê-lo no lugar quebra o host — medido: depois da
   * reescrita, `git status` no worktree responde `fatal: not a git repository`, e o app perde
   * justamente a capacidade de versionar que a SPEC lhe reserva. A cópia dá a cada lado o seu.
   */
  readonly gitMetaNoHost: string
  /** O `.git` principal. Montado **somente-leitura** (emenda 5 de 2026-08-31). */
  readonly gitCommonNoHost: string
  readonly containerNome: string
  /** A URL do proxy do host. Única forma de o executor alcançar modelo. */
  readonly proxyUrl: string
  readonly imagem?: string
}

/**
 * Prepara o metadado do Git para o container: copia `.git/worktrees/<lease>` e aponta o
 * `commondir` da **cópia** para o caminho de dentro do container.
 *
 * Por que copiar em vez de reescrever no lugar: o `commondir` é um arquivo só, e host e
 * container precisam de caminhos diferentes nele. Reescrever o original quebra o host — medido
 * com Git real: depois da reescrita, `git status` no worktree responde `fatal: not a git
 * repository`, e o app perde a capacidade de versionar que a SPEC lhe reserva.
 *
 * A cópia mora **dentro do worktree** (`.gitmeta`), que já é o diretório do run: assim a limpeza
 * da M9-F06 leva o metadado junto ao remover o worktree, sem um segundo caminho a lembrar.
 */
export function prepararGitMeta(origem: string, worktree: string): string | undefined {
  const destino = join(worktree, '.gitmeta')
  try {
    cpSync(origem, destino, { recursive: true })
    writeFileSync(
      join(destino, 'commondir'),
      `${GITCOMMON_NO_CONTAINER}
`,
      'utf8'
    )
    return destino
  } catch {
    return undefined
  }
}

export class DockerRunner {
  constructor(
    private readonly terminal: TerminalEngine,
    private readonly workspaceId: () => WorkspaceId
  ) {}

  /**
   * O Docker responde? (critério 10)
   *
   * `docker info` e não `docker --version`: a versão responde com o daemon desligado — é o
   * binário falando de si mesmo. O que precisamos saber é se há daemon do outro lado, e essa é
   * exatamente a diferença entre "Docker instalado" e "Docker no ar".
   */
  disponivel(cwd: string): boolean {
    const execucao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['info', '--format', '{{.ServerVersion}}'], cwd },
      this.workspaceId()
    )
    return execucao.state === 'concluido'
  }

  /**
   * A porta está livre? (critério 3)
   *
   * Pergunta ao Docker quais portas ele já publicou **e** tenta o bind de verdade: um container
   * de outro projeto aparece na primeira lista, mas um processo qualquer do host não — e subir
   * o recurso para descobrir a colisão pelo erro é justamente o que o critério proíbe.
   */
  portaOcupadaPorContainer(porta: number, cwd: string): boolean {
    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: ['ps', '--format', '{{.Ports}}'],
        cwd
      },
      this.workspaceId()
    )
    if (execucao.state !== 'concluido') return false
    return execucao.stdout.includes(`:${porta}->`)
  }

  /** O container com este nome existe (rodando ou parado)? Base da reutilização e do lease. */
  containerExiste(nome: string, cwd: string): boolean {
    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: ['ps', '--all', '--filter', `name=^${nome}$`, '--format', '{{.Names}}'],
        cwd
      },
      this.workspaceId()
    )
    return execucao.state === 'concluido' && execucao.stdout.trim() === nome
  }

  /**
   * Sobe o sandbox: worktree montado, `.git` legível, **nenhum segredo** (critério 9).
   *
   * As três montagens são o coração da emenda 5. Medido com Docker real: montar só o worktree e
   * o `.git/worktrees/<lease>` **não funciona** — o `commondir` é relativo (`../..`) e resolve
   * para `/` dentro do container, e `git` responde `fatal: not a git repository`. Objects e refs
   * vivem no `.git` principal, então ele entra, `:ro`. A escrita é rejeitada pelo próprio Docker,
   * o que mantém "quem versiona é o app, no host" como garantia de montagem e não de instrução.
   *
   * O ambiente carrega **só** `ANTHROPIC_BASE_URL`. Nenhum token, nenhuma chave, nenhum
   * `~/.claude`: a credencial fica no main e o proxy a injeta (critérios 9 e 11).
   */
  subir(montagem: MontagemDoSandbox, cwd: string): boolean {
    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: [
          'run',
          '--detach',
          '--name',
          montagem.containerNome,
          '--volume',
          `${montagem.worktreeNoHost}:${RAIZ_NO_CONTAINER}`,
          '--volume',
          `${montagem.gitMetaNoHost}:${GITMETA_NO_CONTAINER}:ro`,
          '--volume',
          `${montagem.gitCommonNoHost}:${GITCOMMON_NO_CONTAINER}:ro`,
          '--workdir',
          RAIZ_NO_CONTAINER,
          // `GIT_DIR`/`GIT_WORK_TREE` em vez de reescrever o `.git` do worktree: o arquivo é
          // compartilhado com o host, e mexer nele derruba o Git do lado de cá (medido).
          '--env',
          `GIT_DIR=${GITMETA_NO_CONTAINER}`,
          '--env',
          `GIT_WORK_TREE=${RAIZ_NO_CONTAINER}`,
          // O proxy do host visto de dentro do container. É o único destino de rede que o
          // executor precisa alcançar além do registro de pacotes do projeto.
          '--add-host',
          'host.docker.internal:host-gateway',
          '--env',
          `ANTHROPIC_BASE_URL=${montagem.proxyUrl}`,
          montagem.imagem ?? IMAGEM_PADRAO,
          'sleep',
          'infinity'
        ],
        cwd
      },
      this.workspaceId()
    )

    if (execucao.state !== 'concluido') {
      log.agent.warn('Container do sandbox não subiu', {
        container: montagem.containerNome,
        estado: execucao.state
      })
      return false
    }
    return true
  }

  /**
   * Encerra o container do run.
   *
   * `stop` e não `rm`: `docker rm|rmi|prune|down` casa a política de destrutivos do MVP-004 e
   * abriria `ApprovalRequest`, travando a limpeza num gate humano. Remover é escopo da M9-F06,
   * que decide como fazê-lo (emenda 8 de 2026-08-31) — aqui só paramos.
   */
  parar(nome: string, cwd: string): boolean {
    const execucao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['stop', nome], cwd },
      this.workspaceId()
    )
    return execucao.state === 'concluido'
  }
}
