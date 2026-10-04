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
import {
  argsDeLabel,
  LABEL_GERIDO,
  LABEL_RUN,
  portasDaSaidaDoDocker,
  type EntradaDoScanner
} from '@shared/domain/isolamento'
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

/**
 * Onde o perfil do Claude **deste run** aparece no container (SPEC-Scheduler-03).
 *
 * Um diretório por run, no host, montado só nele: dois runs nunca compartilham diretório gravável.
 * O nome no host não começa com ponto de propósito — `.claude` é o que o scanner proíbe montar.
 */
export const PERFIL_CLAUDE_NO_CONTAINER = '/perfil/claude'

/** Onde o scanner procura arquivo de credencial dentro do container: fora do worktree do usuário. */
const RAIZES_DO_SCANNER = ['/root', '/home', '/tmp'] as const

/**
 * A imagem do sidecar de egress (critério 12).
 *
 * `alpine/socat`, e não a imagem do executor: o sidecar não roda código do agente, só encaminha
 * uma porta — trazer `node:22-bookworm` para isso seria centenas de MB para uma tarefa de rede
 * pura. Pinada por tag, pela mesma razão da `IMAGEM_PADRAO`.
 */
export const IMAGEM_DO_PROXY_DE_EGRESS = 'alpine/socat:1.8.0.1'

/** O resultado de um comando rodado dentro do container (critério 11). */
export interface ExecucaoNoContainer {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timeoutExcedido: boolean
}

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
  /**
   * A rede de egress do run (critério 12). O executor se conecta **só** a ela — nunca à `bridge`
   * padrão, que teria rota de saída para a internet.
   */
  readonly redeDeEgress: string
  /**
   * A URL do proxy que o container recebe: o sidecar de egress, não o proxy do host diretamente.
   * O executor não tem rota nenhuma até `host.docker.internal` de dentro da rede `--internal`.
   */
  readonly proxyUrl: string
  readonly imagem?: string
  /** As labels do run (`labelsDoRecurso`): é por elas que o recurso é achado e reconciliado. */
  readonly labels?: Readonly<Record<string, string>>
  /**
   * O diretório do perfil do Claude exclusivo deste run. Montado em `PERFIL_CLAUDE_NO_CONTAINER`,
   * com `CLAUDE_CONFIG_DIR` apontando para ele. Vazio de credencial: a autenticação segue sendo o
   * proxy do host.
   */
  readonly perfilClaudeNoHost?: string
}

/** Um recurso Docker achado pela label de gerido, com o run que a label declara. */
export interface RecursoNoDocker {
  readonly nome: string
  readonly runId: string | undefined
}

export interface RecursosGeridos {
  readonly containers: readonly RecursoNoDocker[]
  readonly redes: readonly RecursoNoDocker[]
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
   * A porta já está publicada por algum container? (critério 3)
   *
   * Pergunta ao Docker, e **só** a ele: um container de outro projeto aparece aqui, um processo
   * qualquer do host não. É a metade da resposta que serve tanto ao preflight (antes de subir)
   * quanto à reconciliação (o recurso ainda está em uso?) — e é deliberadamente conservadora:
   * subir o recurso e descobrir a colisão pelo erro é justamente o que o critério proíbe.
   *
   * **Limite honesto:** não tenta o bind, então uma porta tomada por processo fora do Docker
   * não é vista aqui. Fechar isso exige um `net.createServer` de sonda, e a M9-F03 não tem
   * projeto que declare serviços para exercitá-lo — ver o limite registrado na entrega.
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
   *
   * **`--network` é a única rede do container** (critério 12) — nada de `--add-host
   * host.docker.internal`: medido com Docker real, essa entrada dá rota até o host por fora da
   * rede `--internal`, o que reabriria exatamente o caminho que o sandbox de egress existe para
   * fechar. O container só alcança quem estiver na `redeDeEgress` — hoje, só o sidecar.
   */
  subir(montagem: MontagemDoSandbox, cwd: string): boolean {
    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: [
          'run',
          '--detach',
          // `--rm` é o que permite a limpeza da M9-F06 **remover** o container sem `docker rm`:
          // aquele comando casa a política de destrutivos do MVP-004 e abriria `ApprovalRequest`,
          // travando a limpeza automática num gate humano. Com a flag na criação, `docker stop`
          // já remove. Decisão do PI em 2026-09-02.
          '--rm',
          '--name',
          montagem.containerNome,
          '--network',
          montagem.redeDeEgress,
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
          '--env',
          `ANTHROPIC_BASE_URL=${montagem.proxyUrl}`,
          ...(montagem.perfilClaudeNoHost === undefined
            ? []
            : [
                '--volume',
                `${montagem.perfilClaudeNoHost}:${PERFIL_CLAUDE_NO_CONTAINER}`,
                '--env',
                `CLAUDE_CONFIG_DIR=${PERFIL_CLAUDE_NO_CONTAINER}`
              ]),
          ...argsDeLabel(montagem.labels ?? {}),
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
   * A rede de egress do run existe? Base da reutilização/reconciliação, como `containerExiste`.
   */
  redeDeEgressExiste(nome: string, cwd: string): boolean {
    const execucao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['network', 'inspect', nome], cwd },
      this.workspaceId()
    )
    return execucao.state === 'concluido'
  }

  /**
   * Cria a rede `--internal` do run (critério 12).
   *
   * `--internal` é a garantia inteira: sem ela, a rede teria rota de saída e `api.github.com`
   * continuaria alcançável — medido com Docker real. Devolve `true` também quando a rede já
   * existe (o `docker network create` idempotente do lado do app): retomar um run cujo preflight
   * morreu depois de criar a rede não deve falhar por "já existe".
   */
  criarRedeDeEgress(
    nome: string,
    cwd: string,
    labels: Readonly<Record<string, string>> = {}
  ): boolean {
    if (this.redeDeEgressExiste(nome, cwd)) return true

    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: ['network', 'create', '--internal', ...argsDeLabel(labels), nome],
        cwd
      },
      this.workspaceId()
    )
    if (execucao.state !== 'concluido') {
      log.agent.warn('Rede de egress não subiu', { rede: nome, estado: execucao.state })
      return false
    }
    return true
  }

  /**
   * Sobe o sidecar de egress: a ponte entre a rede `--internal` do run e o proxy do host.
   *
   * **Duas redes, uma conexão de cada vez** — `docker run --network` só aceita uma rede na
   * criação; a segunda entra por `docker network connect` logo depois (medido: é o padrão que
   * funciona). O sidecar nasce na rede de egress do run — onde o executor está — e depois se
   * conecta à `bridge` padrão, que tem rota até `host.docker.internal`. É esse segundo pé que
   * fecha o circuito sem dar ao executor rota nenhuma para fora da rede `--internal`.
   *
   * `socat TCP-LISTEN:porta,fork,reuseaddr TCP:host.docker.internal:portaDoProxy` é encaminhamento
   * puro — não interpreta, não decide, só repassa bytes de uma ponta a outra.
   */
  subirProxyDeEgress(
    dados: {
      readonly nome: string
      readonly redeDeEgress: string
      readonly porta: number
      readonly proxyDoHost: string
      readonly imagem?: string
      readonly labels?: Readonly<Record<string, string>>
    },
    cwd: string
  ): boolean {
    const subiu = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: [
          'run',
          '--detach',
          // Mesma razão do container do executor: `--rm` é o que deixa `stop` remover o sidecar
          // sem nenhum comando destrutivo na allowlist.
          '--rm',
          '--name',
          dados.nome,
          '--network',
          dados.redeDeEgress,
          ...argsDeLabel(dados.labels ?? {}),
          // A imagem já tem `socat` como entrypoint (medido: repeti-lo aqui duplica o comando e
          // o container morre com "exactly 2 addresses required (there are 3)"). Os dois
          // argumentos seguintes são os endereços do `socat`, não um comando a executar.
          dados.imagem ?? IMAGEM_DO_PROXY_DE_EGRESS,
          `TCP-LISTEN:${dados.porta},fork,reuseaddr`,
          `TCP:${dados.proxyDoHost}`
        ],
        cwd
      },
      this.workspaceId()
    )
    if (subiu.state !== 'concluido') {
      log.agent.warn('Sidecar de egress não subiu', { sidecar: dados.nome, estado: subiu.state })
      return false
    }

    const conectou = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['network', 'connect', 'bridge', dados.nome], cwd },
      this.workspaceId()
    )
    if (conectou.state !== 'concluido') {
      log.agent.warn('Sidecar de egress não alcançou a bridge padrão', {
        sidecar: dados.nome,
        estado: conectou.state
      })
      return false
    }
    return true
  }

  /**
   * O IP do sidecar **na rede de egress** — não o nome.
   *
   * Medido com Docker real: o DNS embutido do Docker (`127.0.0.11`) não resolve nome de
   * container dentro de uma rede `--internal`, mesmo entre dois membros dela — toda consulta
   * volta `SERVFAIL`. O executor recebe este IP como `ANTHROPIC_BASE_URL`, nunca o nome do
   * sidecar; um hostname ali seria uma URL que o próprio container não consegue resolver.
   */
  ipDoProxyNaRedeDeEgress(
    nomeDoSidecar: string,
    redeDeEgress: string,
    cwd: string
  ): string | undefined {
    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: [
          'inspect',
          '--format',
          `{{(index .NetworkSettings.Networks "${redeDeEgress}").IPAddress}}`,
          nomeDoSidecar
        ],
        cwd
      },
      this.workspaceId()
    )
    const ip = execucao.stdout.trim()
    return execucao.state === 'concluido' && ip !== '' ? ip : undefined
  }

  /**
   * Encerra o container do run.
   *
   * `stop` e não `rm`: `docker rm|rmi|prune|down` casa a política de destrutivos do MVP-004 e
   * abriria `ApprovalRequest`, travando a limpeza num gate humano. **Parar já remove**, porque o
   * container nasce com `--rm` (ver `subir`) — foi assim que a M9-F06 fechou o critério 5 sem
   * pôr um comando destrutivo na allowlist (decisão do PI, 2026-09-02).
   */
  parar(nome: string, cwd: string): boolean {
    const execucao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['stop', nome], cwd },
      this.workspaceId()
    )
    return execucao.state === 'concluido'
  }

  /**
   * Roda um comando **dentro** do container já em pé (SPEC-Entrega-04, critérios 1 e 11).
   *
   * `docker exec`, e não um segundo `docker run`: o container já está montado com o worktree e
   * a rede de egress corretos (M9-F03) — um novo `run` duplicaria o sandbox. Passa pelo
   * `TerminalEngine`, nunca `spawn` direto, para manter a auditoria e a allowlist num ponto só.
   */
  exec(container: string, comando: readonly string[], cwd: string): ExecucaoNoContainer {
    const execucao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['exec', container, ...comando], cwd },
      this.workspaceId()
    )

    return {
      ok: execucao.state === 'concluido' && execucao.exitCode === 0,
      stdout: execucao.stdout,
      stderr: execucao.stderr,
      exitCode: execucao.exitCode,
      timeoutExcedido: execucao.reason === 'timeout-excedido'
    }
  }

  /**
   * Mata os processos do usuário dentro do container, **sem parar o container** (critério 5).
   *
   * Cancelamento de uma tentativa não pode derrubar o sandbox inteiro: o worktree montado nele
   * é o mesmo entre tentativas, e `docker stop` obrigaria a M9-F04 a refazer todo o preflight
   * para a tentativa seguinte. `pkill -u` mata só o que o executor rodou.
   */
  matarProcesso(container: string, cwd: string): void {
    this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['exec', container, 'pkill', '-u', 'root'], cwd },
      this.workspaceId()
    )
  }

  /**
   * Todas as portas do host que algum container publica **ou tem configurada** (SPEC-Scheduler-03,
   * critério 3). `docker ps` só vê o container que está de pé; o parado volta no próximo
   * `docker start` com a porta que configurou, e reusá-la seria uma colisão adiada.
   *
   * `undefined` quando o Docker falha: a lista que não pôde ser lida não é uma lista vazia, e quem
   * trata falha como "nenhuma porta ocupada" aloca em cima de uma porta tomada.
   */
  portasEmUso(cwd: string): ReadonlySet<number> | undefined {
    const publicadas = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['ps', '--format', '{{.Ports}}'], cwd },
      this.workspaceId()
    )
    const ids = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['ps', '--all', '--format', '{{.ID}}'], cwd },
      this.workspaceId()
    )
    if (publicadas.state !== 'concluido' || ids.state !== 'concluido') return undefined

    const portas = new Set(portasDaSaidaDoDocker(publicadas.stdout))
    const lista = ids.stdout.split(/\s+/).filter((id) => id !== '')
    if (lista.length === 0) return portas

    const configuradas = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: [
          'inspect',
          '--format',
          '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostPort}} {{end}}{{end}}',
          ...lista
        ],
        cwd
      },
      this.workspaceId()
    )
    if (configuradas.state !== 'concluido') return undefined

    for (const porta of portasDaSaidaDoDocker(configuradas.stdout)) portas.add(porta)
    return portas
  }

  /**
   * Os containers e redes que o app gerencia, achados **pela label** — nunca por glob de nome.
   * Devolve o run que cada label declara; recurso gerido sem label de run vem com `runId`
   * indefinido, e quem o achar não o destrói (é órfão a reportar, não a apagar).
   *
   * `undefined` se qualquer listagem falhar, pela mesma razão de `portasEmUso`.
   */
  listarGeridos(cwd: string): RecursosGeridos | undefined {
    const filtro = `label=${LABEL_GERIDO}=true`
    const formato = (campo: string): string => `{{.${campo}}}\t{{.Label "${LABEL_RUN}"}}`
    const containers = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: ['ps', '--all', '--filter', filtro, '--format', formato('Names')],
        cwd
      },
      this.workspaceId()
    )
    const redes = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: ['network', 'ls', '--filter', filtro, '--format', formato('Name')],
        cwd
      },
      this.workspaceId()
    )
    if (containers.state !== 'concluido' || redes.state !== 'concluido') return undefined

    return { containers: lerRecursos(containers.stdout), redes: lerRecursos(redes.stdout) }
  }

  /**
   * Remove a rede do run. O comando casa a política de destrutivos (`rm`); quem o libera é a
   * exceção do ADR-007, que só vale para rede que o inventário lista — este método não decide
   * isso, e se o terminal recusar o desfecho é `false`.
   */
  removerRede(nome: string, cwd: string): boolean {
    const execucao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['network', 'rm', nome], cwd },
      this.workspaceId()
    )
    return execucao.state === 'concluido'
  }

  /**
   * O que o container carrega, na forma que o scanner de credenciais lê: variáveis de ambiente,
   * montagens, comando de entrada e arquivos fora do worktree (SPEC-Scheduler-03, critério 4).
   *
   * Os arquivos são procurados em `/root`, `/home`, `/tmp` e no perfil do run — **não** em
   * `/work`, onde mora o repositório do usuário e um `.env.example` versionado acusaria falso
   * positivo; o que o executor escreve ali é o `verificarEscopo` do construtor quem vigia.
   *
   * `undefined` quando não deu para olhar: sem ver o container, "nenhum achado" seria mentira.
   */
  inspecionarSandbox(container: string, cwd: string): EntradaDoScanner | undefined {
    const inspecao = this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['inspect', '--format', '{{json .}}', container], cwd },
      this.workspaceId()
    )
    if (inspecao.state !== 'concluido') return undefined
    const lido = lerInspecao(inspecao.stdout)
    if (lido === undefined) return undefined

    const raizes = lido.montagens.some((m) => m.destino.startsWith('/perfil'))
      ? [...RAIZES_DO_SCANNER, '/perfil']
      : [...RAIZES_DO_SCANNER]
    const arquivos = this.exec(
      container,
      ['find', ...raizes, '-xdev', '-maxdepth', '6', '-type', 'f'],
      cwd
    )
    if (!arquivos.ok) return undefined

    return {
      ...lido,
      arquivos: arquivos.stdout.split('\n').filter((linha) => linha.trim() !== '')
    }
  }
}

function lerRecursos(saida: string): RecursoNoDocker[] {
  return saida
    .split('\n')
    .filter((linha) => linha.trim() !== '')
    .map((linha) => {
      const [nome = '', run = ''] = linha.split('\t')
      return { nome: nome.trim(), runId: run.trim() === '' ? undefined : run.trim() }
    })
}

const ehTexto = (valor: unknown): valor is string => typeof valor === 'string'
const textos = (valor: unknown): string[] => (Array.isArray(valor) ? valor.filter(ehTexto) : [])

/** A saída do `docker inspect`, sem confiar na forma: o que não vier como esperado é `undefined`. */
function lerInspecao(saida: string): Omit<EntradaDoScanner, 'arquivos'> | undefined {
  try {
    const bruto: unknown = JSON.parse(saida)
    if (typeof bruto !== 'object' || bruto === null) return undefined
    const { Config, Mounts } = bruto as { Config?: Record<string, unknown>; Mounts?: unknown }
    const montagens = (Array.isArray(Mounts) ? Mounts : []).flatMap((m: unknown) => {
      const { Source, Destination, RW } = (m ?? {}) as Record<string, unknown>
      return ehTexto(Source) && ehTexto(Destination)
        ? [{ origem: Source, destino: Destination, somenteLeitura: RW === false }]
        : []
    })
    return {
      env: textos(Config?.['Env']),
      montagens,
      comando: [...textos(Config?.['Entrypoint']), ...textos(Config?.['Cmd'])]
    }
  } catch {
    return undefined
  }
}
