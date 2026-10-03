/**
 * O Git do kernel sobre os worktrees dos escritores (SPEC-Squads-03).
 *
 * **Quem executa Git é o kernel, nunca o agente** (critério 1). O agente escreve arquivos no seu
 * worktree, dentro do container; o kernel é quem cria o worktree, prova o que mudou, commita e
 * remove. Cada operação aqui é uma *intenção* — criar, listar alterações, commitar, remover —, e
 * não uma linha de comando que o chamador monta.
 *
 * **O worktree é território do agente, então o kernel não confia no `.git` dele.** O worktree tem
 * um arquivo `.git` que aponta para o gitdir, e esse arquivo vive no diretório que o agente edita.
 * Um agente que o reescrevesse para um gitdir seu, com `core.fsmonitor` ou um hook, executaria
 * código **no host** na próxima vez que o kernel rodasse `git status` ali. Por isso o gitdir é
 * lido uma vez, no momento da criação — antes de o agente rodar — e todo comando seguinte passa
 * `--git-dir` e `--work-tree` explícitos; o `.git` do worktree deixa de ser consultado.
 *
 * Todo Git sai pelo `GitRunner` e, portanto, pelo `TerminalEngine`: allowlist, auditoria e
 * timeout valem aqui como em qualquer outro lugar.
 */

import { lstatSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import { GitRunner } from '../projects/git-runner'

export interface WorktreeDeEscritor {
  /** O repositório do projeto, no host. Confiável: o agente não o alcança. */
  readonly repositorio: string
  /** O diretório que o agente edita. */
  readonly worktree: string
  /** O gitdir **do host**, lido na criação: `<repositorio>/.git/worktrees/<nome>`. */
  readonly gitDir: string
  readonly branch: string
  /** O SHA de onde a branch nasceu: o diff é sempre contra ele. */
  readonly baseSha: string
}

export type ResultadoGit<T> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly motivo: string }

export interface AlteracoesDoWorktree {
  /** Tudo que difere da base — modificado, criado ou removido —, ordenado e sem repetição. */
  readonly caminhos: readonly string[]
  /** Os caminhos que são link simbólico: o escritor não os cria (podem apontar para fora). */
  readonly simbolicos: readonly string[]
}

export interface DependenciasDoSquadGit {
  readonly git: Pick<GitRunner, 'run'>
  readonly workspaceId: () => WorkspaceId
}

/** A identidade do commit do kernel: o trabalho de um escritor nunca leva o nome de uma pessoa. */
export const IDENTIDADE_DO_KERNEL = {
  nome: 'JARVIS OS',
  email: 'kernel@jarvisos.local'
} as const

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const COMMIT_POR_LOTE = 100
const MAX_MENSAGEM = 200

/** Onde um hook do repositório deixaria de existir: o caminho nulo do sistema. */
const SEM_HOOKS = process.platform === 'win32' ? 'NUL' : '/dev/null'

/**
 * Configuração passada em **toda** execução, por linha de comando — que vence a do repositório.
 * Hooks e `fsmonitor` são as duas formas de um repositório fazer o `git` rodar um programa dele.
 * O `autocrlf` desligado vale também na criação do worktree (ARCHITECTURE): no Windows o checkout
 * padrão grava CRLF, o Git do container lê a árvore inteira como modificada e o gate de escopo
 * acusaria fuga em todo arquivo.
 */
const CONFIG_DO_KERNEL = [
  '-c',
  `core.hooksPath=${SEM_HOOKS}`,
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.autocrlf=false'
] as const

const recusa = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo })

function caminhoRelativoSeguro(caminho: string): boolean {
  if (caminho === '' || isAbsolute(caminho) || caminho.startsWith('-')) return false
  return !caminho.split(/[\\/]/).some((parte) => parte === '..')
}

export class SquadGit {
  constructor(private readonly deps: DependenciasDoSquadGit) {}

  /**
   * Cria o worktree do escritor, a partir de um SHA fixo, numa branch própria.
   */
  criarWorktree(pedido: {
    readonly repositorio: string
    readonly worktree: string
    readonly branch: string
    readonly baseSha: string
  }): ResultadoGit<WorktreeDeEscritor> {
    const invalido = this.validarCriacao(pedido)
    if (invalido !== undefined) return recusa(invalido)

    const criado = this.executar(
      ['worktree', 'add', '-b', pedido.branch, pedido.worktree, pedido.baseSha],
      pedido.repositorio
    )
    if (!criado.ok) return recusa(criado.motivo)

    // Lido agora, antes de o agente rodar: depois disso o `.git` do worktree não é de confiança.
    const gitDir = this.executar(['rev-parse', '--absolute-git-dir'], pedido.worktree)
    if (!gitDir.ok) return recusa(gitDir.motivo)

    const esperado = resolve(pedido.repositorio, '.git', 'worktrees') + sep
    if (!resolve(gitDir.saida).startsWith(esperado)) {
      return recusa('o gitdir do worktree não está sob o .git do repositório')
    }
    return {
      ok: true,
      valor: {
        repositorio: pedido.repositorio,
        worktree: pedido.worktree,
        gitDir: resolve(gitDir.saida),
        branch: pedido.branch,
        baseSha: pedido.baseSha
      }
    }
  }

  /** O que mudou no worktree desde a base: a prova de escopo (critério 2). */
  alteracoes(w: WorktreeDeEscritor): ResultadoGit<AlteracoesDoWorktree> {
    const versionados = this.noWorktree(w, [
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      w.baseSha,
      '--'
    ])
    if (!versionados.ok) return recusa(versionados.motivo)
    const novos = this.noWorktree(w, ['ls-files', '--others', '--exclude-standard', '-z'])
    if (!novos.ok) return recusa(novos.motivo)

    const caminhos = [...new Set([...partir(versionados.bruto), ...partir(novos.bruto)])].sort()
    return { ok: true, valor: { caminhos, simbolicos: caminhos.filter((c) => ehSimbolico(w, c)) } }
  }

  /**
   * Commita **exatamente** estes caminhos. O chamador já provou que estão no escopo; o que sobrar
   * fora da lista fica sem commit, e `alteracoes` o mostra de novo.
   */
  commitar(
    w: WorktreeDeEscritor,
    mensagem: string,
    caminhos: readonly string[]
  ): ResultadoGit<string> {
    if (mensagem.trim() === '' || mensagem.length > MAX_MENSAGEM || /[\r\n]/.test(mensagem)) {
      return recusa('mensagem de commit inválida')
    }
    if (caminhos.length === 0) return recusa('sem caminhos para commitar')
    if (!caminhos.every(caminhoRelativoSeguro)) return recusa('caminho inválido na lista')

    for (let i = 0; i < caminhos.length; i += COMMIT_POR_LOTE) {
      const lote = caminhos.slice(i, i + COMMIT_POR_LOTE)
      const adicionado = this.noWorktree(w, ['--literal-pathspecs', 'add', '--all', '--', ...lote])
      if (!adicionado.ok) return recusa(adicionado.motivo)
    }

    const preparados = this.noWorktree(w, ['diff', '--cached', '--name-only', '-z'])
    if (!preparados.ok) return recusa(preparados.motivo)
    if (partir(preparados.bruto).length === 0) return recusa('sem-alteracoes')

    const commit = this.noWorktree(w, [
      '-c',
      `user.name=${IDENTIDADE_DO_KERNEL.nome}`,
      '-c',
      `user.email=${IDENTIDADE_DO_KERNEL.email}`,
      '-c',
      'commit.gpgsign=false',
      'commit',
      // Cinto e suspensório: o `hooksPath` já desliga os hooks; o `--no-verify` cobre o dia em que
      // alguém tirar essa configuração por engano.
      '--no-verify',
      '--no-gpg-sign',
      '-m',
      mensagem
    ])
    if (!commit.ok) return recusa(commit.motivo)

    const sha = this.noWorktree(w, ['rev-parse', 'HEAD'])
    return sha.ok ? { ok: true, valor: sha.saida } : recusa(sha.motivo)
  }

  /**
   * Remove o worktree **sem `--force`**. O `--force` casa o padrão destrutivo do `TerminalEngine` e
   * viraria pedido de aprovação — e o kernel não tem como pedir aprovação no meio de uma
   * limpeza. Sem ele o Git recusa o worktree com arquivo não commitado, que é o certo: a limpeza
   * não destrói trabalho que o kernel não registrou.
   */
  remover(w: WorktreeDeEscritor): ResultadoGit<void> {
    const r = this.executar(['worktree', 'remove', w.worktree], w.repositorio)
    if (r.ok) return { ok: true, valor: undefined }
    return recusa(/modified or untracked/i.test(r.motivo) ? 'worktree-sujo' : r.motivo)
  }

  // ─── execução ─────────────────────────────────────────────────────────────────────────────────

  private validarCriacao(p: {
    readonly repositorio: string
    readonly worktree: string
    readonly branch: string
    readonly baseSha: string
  }): string | undefined {
    if (!SHA.test(p.baseSha)) return 'baseSha inválido'
    if (!BRANCH.test(p.branch) || p.branch.includes('..') || p.branch.endsWith('/')) {
      return 'nome de branch inválido'
    }
    if (!isAbsolute(p.repositorio) || !isAbsolute(p.worktree)) {
      return 'repositório e worktree precisam ser caminhos absolutos'
    }
    return undefined
  }

  /** Um comando no worktree, com o gitdir do host e a configuração do kernel. */
  private noWorktree(
    w: WorktreeDeEscritor,
    args: readonly string[]
  ): { ok: true; saida: string; bruto: string } | { ok: false; motivo: string } {
    return this.executar(
      ['--git-dir', w.gitDir, '--work-tree', w.worktree, ...args],
      w.worktree,
      true
    )
  }

  private executar(
    args: readonly string[],
    cwd: string,
    semAuditarSaida = false
  ): { ok: true; saida: string; bruto: string } | { ok: false; motivo: string } {
    const r = this.deps.git.run([...CONFIG_DO_KERNEL, ...args], cwd, this.deps.workspaceId(), {
      // A lista de arquivos é conteúdo do projeto: não vai para a trilha de auditoria.
      saidaEhConteudo: semAuditarSaida
    })
    if (!r.ok) return { ok: false, motivo: GitRunner.explicarFalha(r.execucao) }
    return { ok: true, saida: r.saida, bruto: r.execucao.stdout }
  }
}

/** Saída com `-z`: nomes separados por NUL, sem aspas nem escape — espaço e acento chegam inteiros. */
function partir(bruto: string): string[] {
  return bruto.split('\0').filter((c) => c !== '')
}

function ehSimbolico(w: WorktreeDeEscritor, caminho: string): boolean {
  try {
    return lstatSync(join(w.worktree, caminho)).isSymbolicLink()
  } catch {
    // Arquivo removido: não há o que ser link.
    return false
  }
}
