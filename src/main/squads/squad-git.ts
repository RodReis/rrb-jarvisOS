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

import {
  existsSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import { ehControleOuDirecao } from '@shared/domain/squad-plano'
import {
  MAX_BYTES_POR_ARQUIVO_DO_PAINEL,
  caminhoRelativoDoPainelValido
} from '@shared/domain/painel-tarefa'
import type { SnapshotCapturado } from '../pipeline/painel-tarefa-repository'
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

/** Um arquivo regular da árvore de uma revisão: o oid identifica o conteúdo, e é por ele que se lê. */
export interface ArquivoNaRevisao {
  readonly caminho: string
  readonly oid: string
  readonly bytes: number
}

export interface ResultadoDoMerge {
  /** Os arquivos que o Git não conseguiu juntar sozinho: o integrador decide cada um. */
  readonly conflitos: readonly string[]
  /** `false` quando o outro lado já estava contido: não há merge a commitar. */
  readonly emAndamento: boolean
}

export interface OcorrenciaDeBusca {
  readonly caminho: string
  /** A linha, a partir de 1. */
  readonly linha: number
}

export interface ResultadoDaBusca {
  readonly ocorrencias: readonly OcorrenciaDeBusca[]
  /** Havia mais ocorrências que o teto: o que veio é um recorte. */
  readonly truncada: boolean
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
/** `<modo> <tipo> <oid> <tamanho>\t<caminho>`: a saída de `ls-tree -l -z`. */
const LINHA_DA_ARVORE = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(\d+|-)\t([\s\S]+)$/
/** Arquivo comum: não é link simbólico (120000) nem submódulo (160000). */
const MODOS_DE_ARQUIVO_COMUM = ['100644', '100755']
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const COMMIT_POR_LOTE = 100
const MAX_TERMO_DE_BUSCA = 200
/** O teto de ocorrências devolvidas: uma busca que casa tudo não vira contexto. */
export const MAX_OCORRENCIAS_DA_BUSCA = 500
const MAX_MENSAGEM = 200
/** O teto de leitura em conflito permanece independente do snapshot do painel. */
const MAX_BYTES_DO_ARQUIVO_EM_CONFLITO = 1024 * 1024

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

type SaidaDoGit =
  | { readonly ok: true; readonly saida: string; readonly bruto: string }
  | { readonly ok: false; readonly motivo: string; readonly codigo: number | null }

/**
 * Os diretórios que o **sandbox** (o Preflight) cria dentro do worktree antes de o agente rodar —
 * hoje o `.gitmeta`, a cópia do gitdir que o container enxerga (ARCHITECTURE, M9-F03). Não são
 * trabalho do escritor: sem esta exclusão, todo escritor real terminaria em `escopo-violado`.
 *
 * É seguro ignorá-los porque o kernel nunca lê o Git por eles (usa `--git-dir` explícito) e só
 * commita os caminhos que provou dentro do write set. O container os monta somente-leitura; um
 * agente que os alterasse mesmo assim não teria efeito algum no host nem no commit.
 */
export const ARTEFATOS_DO_SANDBOX = ['.gitmeta'] as const

const ehArtefatoDoSandbox = (caminho: string): boolean =>
  ARTEFATOS_DO_SANDBOX.some((a) => caminho.startsWith(`${a}/`))

const recusa = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo })

/** Controle e override de direção: nada disso é texto de busca legítimo. */
function temControle(texto: string): boolean {
  return Array.from(texto).some((ch) => ehControleOuDirecao(ch.codePointAt(0) ?? 0))
}

function caminhoRelativoSeguro(caminho: string): boolean {
  if (caminho === '' || isAbsolute(caminho) || caminho.startsWith('-')) return false
  return !caminho.split(/[\\/]/).some((parte) => parte === '..')
}

export class SquadGit {
  constructor(private readonly deps: DependenciasDoSquadGit) {}

  /** Resolve uma referência do projeto para um commit imutável antes de planejar ou revisar. */
  resolverSha(repositorio: string, revisao: string): ResultadoGit<string> {
    if (!isAbsolute(repositorio)) return recusa('o repositório precisa ser um caminho absoluto')
    if (revisao.trim() === '' || revisao.startsWith('-') || /[\s\0]/.test(revisao)) {
      return recusa('referência Git inválida')
    }
    const r = this.executar(
      ['rev-parse', '--verify', '--end-of-options', `${revisao}^{commit}`],
      repositorio
    )
    if (!r.ok) return recusa(r.motivo)
    const sha = r.saida.trim().toLowerCase()
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)
      ? { ok: true, valor: sha }
      : recusa('a referência não resolveu para um commit')
  }

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

    return this.fixarGitDir(pedido)
  }

  /**
   * Adota um worktree que **outro** criou — o `PreflightService`, que prepara o sandbox do
   * escritor — e fixa o gitdir do host. Tem de rodar **antes** de o agente executar: é só nesse
   * instante que o `.git` do worktree ainda é de confiança. O worktree adotado precisa estar na
   * base e na branch que o chamador diz, e sob o `.git` do repositório dele.
   */
  adotarWorktree(pedido: {
    readonly repositorio: string
    readonly worktree: string
    readonly branch: string
    readonly baseSha: string
  }): ResultadoGit<WorktreeDeEscritor> {
    const invalido = this.validarCriacao(pedido)
    if (invalido !== undefined) return recusa(invalido)

    const adotado = this.fixarGitDir(pedido)
    if (!adotado.ok) return adotado

    const cabeca = this.noWorktree(adotado.valor, ['rev-parse', 'HEAD'])
    if (!cabeca.ok) return recusa(cabeca.motivo)
    if (cabeca.saida !== pedido.baseSha) return recusa('o worktree não está na base declarada')

    const ramo = this.noWorktree(adotado.valor, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!ramo.ok) return recusa(ramo.motivo)
    if (ramo.saida !== pedido.branch) return recusa('o worktree não está na branch declarada')
    return adotado
  }

  /** Lê o gitdir do worktree e confirma que ele mora sob o `.git` do repositório. */
  private fixarGitDir(pedido: {
    readonly repositorio: string
    readonly worktree: string
    readonly branch: string
    readonly baseSha: string
  }): ResultadoGit<WorktreeDeEscritor> {
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
    // Sem `--exclude-standard`: o `.gitignore` do worktree é do agente, e um `*` num diretório
    // esconderia a si mesmo e tudo o que ele escreveu ali. O que o escritor criou fora do write set
    // é fuga, ignorado pelo Git ou não.
    const novos = this.noWorktree(w, ['ls-files', '--others', '-z'])
    if (!novos.ok) return recusa(novos.motivo)

    const todos = [...partir(versionados.bruto), ...partir(novos.bruto)]
    const caminhos = [...new Set(todos.filter((c) => !ehArtefatoDoSandbox(c)))].sort()
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

    return this.commitarComIdentidade(w, mensagem)
  }

  /**
   * Remove o worktree **sem `--force`**. O `--force` casa o padrão destrutivo do `TerminalEngine` e
   * viraria pedido de aprovação — e o kernel não tem como pedir aprovação no meio de uma
   * limpeza. Sem ele o Git recusa o worktree com arquivo não commitado, que é o certo: a limpeza
   * não destrói trabalho que o kernel não registrou.
   */
  remover(w: WorktreeDeEscritor): ResultadoGit<void> {
    // O que o sandbox deixou no worktree antes de o agente rodar não é trabalho a salvar: sem
    // descartá-lo o Git recusaria todo worktree, até o que o escritor commitou inteiro.
    for (const artefato of ARTEFATOS_DO_SANDBOX) {
      rmSync(join(w.worktree, artefato), { recursive: true, force: true })
    }
    const r = this.executar(['worktree', 'remove', w.worktree], w.repositorio)
    if (r.ok) return { ok: true, valor: undefined }
    return recusa(/modified or untracked/i.test(r.motivo) ? 'worktree-sujo' : r.motivo)
  }

  // ─── integração de dois escritores ────────────────────────────────────────────────────────────
  //
  // O worktree de integração é do kernel: nasce no commit de um escritor, recebe o merge do outro e
  // é onde o kernel grava a resolução que o integrador devolveu. **O agente integrador não toca
  // nele** (decisão do PI de 2026-10-03): ele devolve texto de bloco, e quem escreve, adiciona e
  // commita é o kernel — por isso nada aqui precisa defender o worktree de um agente.

  /**
   * Junta o commit do outro escritor ao worktree de integração, **sem commitar**. O Git faz o que é
   * determinístico; o que sobra em `conflitos` vai ao integrador, com a base (estilo diff3).
   */
  mesclar(w: WorktreeDeEscritor, commit: string): ResultadoGit<ResultadoDoMerge> {
    if (!SHA.test(commit)) return recusa('commit inválido')
    const r = this.noWorktree(w, [
      '-c',
      'merge.conflictStyle=diff3',
      'merge',
      '--no-commit',
      '--no-ff',
      '--no-edit',
      commit
    ])
    // Sair com 1 é conflito; qualquer outro erro é o merge que não aconteceu.
    if (!r.ok && r.codigo !== 1) return recusa(r.motivo)

    const abertos = this.conflitosAbertos(w)
    if (!abertos.ok) return abertos
    return { ok: true, valor: { conflitos: abertos.valor, emAndamento: this.mergeEmAndamento(w) } }
  }

  /** O texto de um arquivo do worktree de integração: regular, pequeno, sem link nem binário. */
  lerArquivoDoWorktree(w: WorktreeDeEscritor, caminho: string): ResultadoGit<string> {
    const alvo = this.caminhoNoWorktree(w, caminho)
    if (typeof alvo !== 'string') return alvo
    try {
      const info = lstatSync(alvo)
      if (!info.isFile()) return recusa('não é arquivo regular')
      if (info.size > MAX_BYTES_DO_ARQUIVO_EM_CONFLITO) return recusa('arquivo grande demais')
      const bytes = readFileSync(alvo)
      const texto = bytes.toString('utf8')
      if (texto.includes('\0')) return recusa('arquivo-binario')
      // Latin-1 e afins: decodificar como UTF-8 troca byte inválido por U+FFFD, e regravar o
      // arquivo o corromperia sem ninguém ver. Sem ida e volta exata, não é texto que se resolve.
      return Buffer.from(texto, 'utf8').equals(bytes)
        ? { ok: true, valor: texto }
        : recusa('arquivo-nao-utf8')
    } catch {
      return recusa('arquivo ilegível')
    }
  }

  /** Captura paths já provados pelo kernel antes do commit/limpeza. Nunca segue links. */
  async capturarSnapshots(
    w: WorktreeDeEscritor,
    caminhos: readonly string[]
  ): Promise<ResultadoGit<readonly SnapshotCapturado[]>> {
    const capturados: SnapshotCapturado[] = []
    for (const caminho of caminhos) {
      if (!caminhoRelativoDoPainelValido(caminho)) return recusa('caminho inválido no snapshot')
      const alvo = this.caminhoNoWorktree(w, caminho)
      if (typeof alvo !== 'string') return alvo
      try {
        const info = lstatSync(alvo, { throwIfNoEntry: false })
        if (info === undefined) {
          const diferenca = this.noWorktree(w, [
            '-c',
            'core.quotePath=false',
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            '-U0',
            w.baseSha,
            '--',
            caminho
          ])
          if (!diferenca.ok) return recusa(diferenca.motivo)
          capturados.push({
            caminho,
            tipo: 'removido',
            bytes: 0,
            sha256: createHash('sha256').update('').digest('hex'),
            ...(diferenca.bruto === '' ? {} : { diff: diferenca.bruto })
          })
          continue
        }
        if (info.isSymbolicLink() || !info.isFile()) {
          const material = info.isSymbolicLink()
            ? `link:${readlinkSync(alvo)}`
            : `arquivo:${info.size}`
          capturados.push({
            caminho,
            tipo: 'binario',
            bytes: info.size,
            sha256: createHash('sha256').update(material).digest('hex')
          })
          continue
        }
        if (info.size > MAX_BYTES_POR_ARQUIVO_DO_PAINEL) {
          const sha256 = await hashArquivo(alvo)
          capturados.push({
            caminho,
            tipo: 'texto',
            bytes: info.size,
            sha256
          })
          continue
        }
        const bytes = readFileSync(alvo)
        const hash = createHash('sha256').update(bytes).digest('hex')
        const texto = bytes.toString('utf8')
        const textoValido = !bytes.includes(0) && Buffer.from(texto, 'utf8').equals(bytes)
        if (!textoValido) {
          capturados.push({ caminho, tipo: 'binario', bytes: bytes.byteLength, sha256: hash })
          continue
        }
        const existente = this.noWorktree(w, ['cat-file', '-e', `${w.baseSha}:${caminho}`])
        let diff: string
        if (!existente.ok) {
          diff = `--- /dev/null\n+++ b/${caminho}\n${texto
            .split('\n')
            .map((linha) => `+${linha}`)
            .join('\n')}`
        } else {
          const diferenca = this.noWorktree(w, [
            '-c',
            'core.quotePath=false',
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            '-U0',
            w.baseSha,
            '--',
            caminho
          ])
          if (!diferenca.ok) return recusa(diferenca.motivo)
          diff = diferenca.bruto
        }
        capturados.push({
          caminho,
          tipo: 'texto',
          bytes: bytes.byteLength,
          sha256: hash,
          conteudo: texto,
          ...(diff === '' ? {} : { diff })
        })
      } catch {
        return recusa('arquivo não pôde ser capturado')
      }
    }
    return { ok: true, valor: capturados }
  }

  /** Grava a resolução de um arquivo em conflito e o marca como resolvido. */
  resolverArquivo(w: WorktreeDeEscritor, caminho: string, texto: string): ResultadoGit<void> {
    const alvo = this.caminhoNoWorktree(w, caminho)
    if (typeof alvo !== 'string') return alvo
    try {
      // Nunca escreve por cima de um link: o destino pode estar fora do worktree.
      if (lstatSync(alvo, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        return recusa('o arquivo é um link simbólico')
      }
      mkdirSync(dirname(alvo), { recursive: true })
      writeFileSync(alvo, texto, 'utf8')
    } catch {
      return recusa('arquivo não gravável')
    }
    const adicionado = this.noWorktree(w, ['--literal-pathspecs', 'add', '--', caminho])
    return adicionado.ok ? { ok: true, valor: undefined } : recusa(adicionado.motivo)
  }

  /**
   * Commita o merge em andamento. Com conflito aberto **não commita**: integração sem todas as
   * resoluções não existe (regra 1). O commit leva os dois pais e a identidade fixa do kernel.
   */
  commitarIntegracao(w: WorktreeDeEscritor, mensagem: string): ResultadoGit<string> {
    if (mensagem.trim() === '' || mensagem.length > MAX_MENSAGEM || /[\r\n]/.test(mensagem)) {
      return recusa('mensagem de commit inválida')
    }
    if (!this.mergeEmAndamento(w)) return recusa('sem-merge-em-andamento')
    const abertos = this.conflitosAbertos(w)
    if (!abertos.ok) return abertos
    if (abertos.valor.length > 0) return recusa('conflitos-abertos')
    return this.commitarComIdentidade(w, mensagem)
  }

  /**
   * Desfaz o merge em andamento, para o worktree de integração poder ser removido sem `--force`.
   * `merge --abort` não casa o padrão destrutivo do `TerminalEngine`; `reset --hard` casaria.
   */
  abortarMerge(w: WorktreeDeEscritor): ResultadoGit<void> {
    if (!this.mergeEmAndamento(w)) return { ok: true, valor: undefined }
    const r = this.noWorktree(w, ['merge', '--abort'])
    return r.ok ? { ok: true, valor: undefined } : recusa(r.motivo)
  }

  /**
   * O diff textual entre dois commits, sem contexto (`-U0`): cada hunk é só o que mudou, que é o
   * que o manifesto identifica por conteúdo. Sem driver externo nem conversão de texto — nada do
   * repositório faz o `git` rodar um programa.
   */
  diffEntre(repositorio: string, de: string, para: string): ResultadoGit<string> {
    if (!SHA.test(de) || !SHA.test(para)) return recusa('revisão inválida')
    if (!isAbsolute(repositorio)) return recusa('o repositório precisa ser um caminho absoluto')
    const r = this.executar(
      [
        // Caminho não ASCII sai como está, e não entre aspas com escape octal.
        '-c',
        'core.quotePath=false',
        'diff',
        '--no-color',
        // Rename seguido: o manifesto casa os hunks pelo caminho da base.
        '-M',
        '--no-ext-diff',
        '--no-textconv',
        '-U0',
        de,
        para,
        '--'
      ],
      repositorio,
      true
    )
    return r.ok ? { ok: true, valor: r.bruto } : recusa(r.motivo)
  }

  /**
   * `ancestral` é ancestral de `commit`? Os dois escritores têm de ter partido da base declarada:
   * um commit que não descende dela traria história e arquivos que o diff da base não mostra.
   */
  ehDescendente(repositorio: string, ancestral: string, commit: string): ResultadoGit<boolean> {
    if (!SHA.test(ancestral) || !SHA.test(commit)) return recusa('revisão inválida')
    if (!isAbsolute(repositorio)) return recusa('o repositório precisa ser um caminho absoluto')
    const r = this.executar(['merge-base', '--is-ancestor', ancestral, commit], repositorio, true)
    if (r.ok) return { ok: true, valor: true }
    // Sair com 1 é "não é ancestral"; qualquer outro código é erro do Git.
    return r.codigo === 1 ? { ok: true, valor: false } : recusa(r.motivo)
  }

  private mergeEmAndamento(w: WorktreeDeEscritor): boolean {
    return this.noWorktree(w, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).ok
  }

  private conflitosAbertos(w: WorktreeDeEscritor): ResultadoGit<readonly string[]> {
    const r = this.noWorktree(w, ['diff', '--name-only', '--diff-filter=U', '-z'])
    return r.ok ? { ok: true, valor: partir(r.bruto).sort() } : recusa(r.motivo)
  }

  /** O caminho absoluto dentro do worktree, ou a recusa. */
  private caminhoNoWorktree(w: WorktreeDeEscritor, caminho: string): string | ResultadoGit<never> {
    if (!caminhoRelativoSeguro(caminho)) return recusa('caminho inválido')
    const alvo = resolve(w.worktree, caminho)
    if (!alvo.startsWith(resolve(w.worktree) + sep)) return recusa('caminho fora do worktree')
    // O `lstat` da folha não vê um **diretório** que seja link simbólico no meio do caminho: o
    // ancestral existente mais próximo, resolvido, tem de continuar dentro do worktree real.
    let ancestral = dirname(alvo)
    while (!existsSync(ancestral) && dirname(ancestral) !== ancestral)
      ancestral = dirname(ancestral)
    try {
      const real = realpathSync(ancestral)
      const raiz = realpathSync(w.worktree)
      if (real !== raiz && !real.startsWith(raiz + sep)) return recusa('caminho passa por um link')
    } catch {
      return recusa('caminho ilegível')
    }
    return alvo
  }

  private commitarComIdentidade(w: WorktreeDeEscritor, mensagem: string): ResultadoGit<string> {
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

  // ─── leitura de uma revisão ───────────────────────────────────────────────────────────────────
  //
  // O contexto da tarefa sai **de uma revisão do Git**, não do disco. O SHA é imutável, e o conteúdo
  // é lido pelo oid do blob — não há caminho para o agente trocar por um link simbólico, nem janela
  // entre "o arquivo existe" e "li o arquivo". Roda no repositório do projeto (confiável), nunca no
  // worktree do agente.

  /**
   * Os arquivos regulares da árvore da revisão, por caminho. Link simbólico e submódulo ficam de
   * fora: ler o blob de um link devolveria o texto do destino, não um arquivo.
   */
  listarNaRevisao(
    repositorio: string,
    revisao: string
  ): ResultadoGit<ReadonlyMap<string, ArquivoNaRevisao>> {
    if (!SHA.test(revisao)) return recusa('revisão inválida')
    if (!isAbsolute(repositorio)) return recusa('o repositório precisa ser um caminho absoluto')

    const r = this.executar(['ls-tree', '-r', '-z', '-l', revisao], repositorio, true)
    if (!r.ok) return recusa(r.motivo)

    const arquivos = new Map<string, ArquivoNaRevisao>()
    for (const registro of partir(r.bruto)) {
      const lido = LINHA_DA_ARVORE.exec(registro)
      if (lido === null) continue
      const [, modo, , oid, tamanho, caminho] = lido
      if (!MODOS_DE_ARQUIVO_COMUM.includes(modo)) continue
      arquivos.set(caminho, { caminho, oid, bytes: Number(tamanho) })
    }
    return { ok: true, valor: arquivos }
  }

  /** O texto do arquivo, lido pelo oid. Binário é recusa: contexto é texto. */
  lerNaRevisao(repositorio: string, arquivo: ArquivoNaRevisao): ResultadoGit<string> {
    if (!SHA.test(arquivo.oid)) return recusa('oid inválido')
    if (!isAbsolute(repositorio)) return recusa('o repositório precisa ser um caminho absoluto')

    const r = this.executar(['cat-file', 'blob', arquivo.oid], repositorio, true)
    if (!r.ok) return recusa(r.motivo)
    if (r.bruto.includes('\0')) return recusa('arquivo-binario')
    return { ok: true, valor: r.bruto }
  }

  /**
   * Busca literal na revisão, **só dentro dos caminhos dados** — sem escopo a busca varreria o
   * repositório inteiro, e leitura ampla é decisão do PI, não do kernel (ContextPack). Sem
   * ocorrência é lista vazia, não erro: o `git grep` sai com 1 e sem mensagem.
   */
  buscarNaRevisao(
    repositorio: string,
    revisao: string,
    termo: string,
    caminhos: readonly string[]
  ): ResultadoGit<ResultadoDaBusca> {
    if (!SHA.test(revisao)) return recusa('revisão inválida')
    if (!isAbsolute(repositorio)) return recusa('o repositório precisa ser um caminho absoluto')
    if (termo.trim() === '' || termo.length > MAX_TERMO_DE_BUSCA || temControle(termo)) {
      return recusa('termo de busca inválido')
    }
    if (caminhos.length === 0) return recusa('a busca precisa de um escopo de caminhos')
    if (!caminhos.every(caminhoRelativoSeguro)) return recusa('caminho inválido no escopo da busca')

    const r = this.executar(
      ['--literal-pathspecs', 'grep', '-n', '-F', '-z', '-e', termo, revisao, '--', ...caminhos],
      repositorio,
      true
    )
    if (!r.ok) {
      return r.codigo === 1
        ? { ok: true, valor: { ocorrencias: [], truncada: false } }
        : recusa(r.motivo)
    }

    const prefixo = `${revisao}:`
    const todas: OcorrenciaDeBusca[] = []
    for (const registro of r.bruto.split('\n')) {
      const [origem, linha] = registro.split('\0')
      if (origem === undefined || linha === undefined || !origem.startsWith(prefixo)) continue
      const numero = Number(linha)
      if (!Number.isInteger(numero) || numero < 1) continue
      todas.push({ caminho: origem.slice(prefixo.length), linha: numero })
    }
    // Cortar em silêncio faria o contexto diferir do pedido sem ninguém saber: `truncada` avisa.
    const truncada = todas.length > MAX_OCORRENCIAS_DA_BUSCA
    return {
      ok: true,
      valor: { ocorrencias: todas.slice(0, MAX_OCORRENCIAS_DA_BUSCA), truncada }
    }
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
  private noWorktree(w: WorktreeDeEscritor, args: readonly string[]): SaidaDoGit {
    return this.executar(
      ['--git-dir', w.gitDir, '--work-tree', w.worktree, ...args],
      w.worktree,
      true
    )
  }

  private executar(args: readonly string[], cwd: string, semAuditarSaida = false): SaidaDoGit {
    const r = this.deps.git.run([...CONFIG_DO_KERNEL, ...args], cwd, this.deps.workspaceId(), {
      // A lista de arquivos é conteúdo do projeto: não vai para a trilha de auditoria.
      saidaEhConteudo: semAuditarSaida
    })
    if (!r.ok) {
      return {
        ok: false,
        motivo: GitRunner.explicarFalha(r.execucao),
        codigo: r.execucao.exitCode
      }
    }
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

async function hashArquivo(caminho: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const bloco of createReadStream(caminho)) hash.update(bloco)
  return hash.digest('hex')
}
