/**
 * A leitura do Git que sustenta o painel de marcos e o gate da Construção (SPEC-Fases-04).
 *
 * Este serviço **só lê**. Não commita, não escreve, não cria remote — e a ausência é a decisão,
 * não um recorte de escopo. O commit de marco já tem dono desde a M8-F01
 * (`ProjectService.concluirMarco`, que é também a retomada), e o botão "Commitar marco" do painel
 * chama aquele caminho. Um `git commit` aqui seria o segundo caminho de escrita que a M9-F01
 * cravou não existir, com a agravante de ser o mais fácil de introduzir sem ninguém notar: um
 * commit a mais parece inofensivo até divergir do outro em mensagem, em `--allow-empty` ou em
 * auditoria.
 *
 * **Por que o hash não é `git hash-object`.** A spec descreve a coerência como *"hash da revisão
 * = `git hash-object` do arquivo no commit"*, e essa igualdade é impossível de fato: os hashes de
 * revisão gravados por `PacoteService`, `PrdService` e `ArquiteturaService` são SHA-256 do texto
 * (utf8), e `git hash-object` produz SHA-1 do blob com header `blob <n>\0`. Compará-los daria
 * `blob-divergente` em 100% dos casos — um gate que nunca abre. O que este serviço faz é a mesma
 * pergunta pelo caminho que funciona: lê o conteúdo **como está no commit** (`git show`) e
 * recalcula o SHA-256 do mesmo jeito que a gravação calculou. Decisão do PI em 2026-09-04.
 */

import { createHash } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import type { CommandExecution } from '@shared/domain/terminal'
import type {
  EstadoDoRepositorio,
  FatoDoMarco,
  ResultadoDaVerificacao,
  VistaDeMarcos
} from '@shared/domain/marcos'
import { linhasDeMarcos, verificarMarcos } from '@shared/domain/marcos'
import type { AuditRepository } from '../storage/audit-repository'
import type { AnexoService } from './anexo-service'
import { GitRunner } from './git-runner'
import type { PacoteRepository } from './pacote-repository'
import type { ProjectRepository } from './project-repository'

interface MarcosDeps {
  readonly git: GitRunner
  readonly projects: ProjectRepository
  readonly pacotes: PacoteRepository
  readonly anexos: AnexoService
  readonly audit: AuditRepository
  readonly userId: () => string
}

export class MarcosService {
  constructor(private readonly deps: MarcosDeps) {}

  /**
   * O painel: uma linha por documento com revisão conhecida, mais o estado do repositório.
   *
   * **Uma leitura por chamada** (spec § Painel): o `status` e o `rev-parse` rodam uma vez, e cada
   * documento custa um `log -1` e um `show`. A tela tem "Verificar de novo" justamente para que
   * esta leitura não precise acontecer a cada render.
   */
  vista(projectId: string, workspaceId: WorkspaceId): VistaDeMarcos {
    const projeto = this.deps.projects.findById(this.deps.userId(), projectId)
    if (projeto === undefined) {
      return { disponivel: false, linhas: [], repositorio: VAZIO, mensagem: 'Projeto não encontrado.' }
    }

    /*
     * O `HEAD` — e o repositório **sem commit nenhum** não é falha.
     *
     * Um projeto recém-criado está exatamente nesse estado: `createProject` roda `git init`, e o
     * primeiro commit só vem com o marco `estrutura-inicial`. O `rev-parse HEAD` ali falha com
     * *"ambiguous argument 'HEAD'"*, e tratar isso como Git indisponível faria o painel acusar
     * problema de ferramenta no caminho mais comum que existe — o projeto novo. Foi o E2E contra
     * o app real que mostrou: com dublê, `HEAD` sempre respondia.
     *
     * A distinção que importa não é o código de saída, e sim **se o Git rodou**: `git rev-parse`
     * num repositório sem commit executa e sai não-zero, enquanto Git ausente ou barrado pela
     * allowlist não chega a executar. O `--verify -q` cala o ruído do primeiro caso.
     */
    const cabeca = this.deps.git.run(
      ['rev-parse', '--verify', '-q', 'HEAD'],
      projeto.diretorio,
      workspaceId
    )

    if (!cabeca.ok && !executou(cabeca.execucao)) {
      return {
        disponivel: false,
        linhas: [],
        repositorio: VAZIO,
        mensagem: GitRunner.explicarFalha(cabeca.execucao)
      }
    }

    const repositorio = this.estadoDoRepositorio(projeto.diretorio, cabeca.saida, workspaceId)
    const fatos = this.fatosDosDocumentos(projectId, projeto.diretorio, workspaceId)

    return { disponivel: true, linhas: linhasDeMarcos(fatos), repositorio }
  }

  /**
   * A verificação que bloqueia o `SLICE_ENTRY` (critério 4), auditada (critério 5).
   *
   * Devolve o resultado **com o `HEAD`** para que o chamador possa exigir que ele ainda valha no
   * instante do aceite. Git indisponível resulta em bloqueio, nunca em liberação: uma verificação
   * que não pôde rodar não é uma verificação que passou.
   */
  verificar(projectId: string, workspaceId: WorkspaceId): ResultadoDaVerificacao {
    const vista = this.vista(projectId, workspaceId)

    const resultado = vista.disponivel
      ? verificarMarcos(vista.linhas, vista.repositorio)
      : {
          ok: false,
          head: '',
          pendencias: [
            {
              caminho: 'git',
              estado: 'head-interrompido' as const,
              mensagem: vista.mensagem ?? 'Não foi possível ler o repositório do projeto.',
              acao: 'Resolver o acesso ao Git e verificar de novo.'
            }
          ]
        }

    // O evento carrega o veredito e a contagem — **nunca** o conteúdo dos arquivos (ADR-004).
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: workspaceId,
      type: 'project-milestone',
      payload: {
        projectId,
        fase: 'verificacao-de-marcos',
        ok: resultado.ok,
        head: resultado.head,
        pendencias: resultado.pendencias.map((p) => p.estado)
      }
    })

    return resultado
  }

  /**
   * `status --porcelain` + estado do `HEAD` + remoto.
   *
   * O `--untracked-files=all` é deliberado e segue o `ConstrutorService`: sem ele, um diretório
   * novo inteiro aparece como uma linha só, e o painel diria "1 arquivo" para dez documentos não
   * commitados. `core.quotepath=false` mantém acento legível em nome de arquivo — projeto
   * brasileiro nomeia documento com acento, e `\303\247` no painel não ajuda ninguém.
   */
  private estadoDoRepositorio(
    diretorio: string,
    head: string,
    workspaceId: WorkspaceId
  ): EstadoDoRepositorio {
    const status = this.deps.git.run(
      ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'],
      diretorio,
      workspaceId
    )

    // Só o caminho entra, nunca o conteúdo (critério 2): as duas primeiras colunas do porcelain
    // são o código de estado, e o resto é o path.
    const sujos = status.ok
      ? status.saida
          .split('\n')
          .map((linha) => linha.slice(3).trim())
          .filter((caminho) => caminho !== '')
      : []

    // `rev-parse` de `MERGE_HEAD`/`REBASE_HEAD`: existir é a evidência de operação interrompida.
    // Um `status` parseado diria o mesmo, mas dependeria do texto localizado do Git.
    const interrompido = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'].some(
      (ref) => this.deps.git.run(['rev-parse', '--verify', '-q', ref], diretorio, workspaceId).ok
    )

    const remoto = this.deps.git.run(
      ['rev-parse', '--verify', '-q', '@{upstream}'],
      diretorio,
      workspaceId
    )

    return {
      sujos,
      headInterrompido: interrompido,
      head,
      ...(remoto.ok && remoto.saida !== '' ? { publicadoEm: remoto.saida } : {})
    }
  }

  /**
   * Um fato por documento com revisão conhecida.
   *
   * As revisões vêm dos **mesmos repositórios** que `RoadmapService.revisoesDoGate` consulta, e
   * não de uma lista fixa de nomes de arquivo: uma segunda lista divergiria da primeira no dia em
   * que um documento fosse acrescentado, e o painel passaria a mostrar um conjunto diferente do
   * que o gate cobra.
   */
  private fatosDosDocumentos(
    projectId: string,
    diretorio: string,
    workspaceId: WorkspaceId
  ): readonly FatoDoMarco[] {
    const userId = this.deps.userId()
    const [prd] = this.deps.pacotes.listarPacotes(userId, projectId)
    const [arquitetura] = this.deps.anexos.listarArquiteturas(projectId)
    const anexos = this.deps.anexos.listar(projectId)

    const revisoes = [
      ...(prd?.documentos ?? []).map((d) => ({ caminho: d.caminho, hash: d.hash })),
      ...(arquitetura?.documentos ?? []).map((d) => ({ caminho: d.caminho, hash: d.hash })),
      ...anexos.map((a) => ({ caminho: a.caminho, hash: a.hash }))
    ]

    return revisoes.map((revisao) => this.fatoDoDocumento(revisao, diretorio, workspaceId))
  }

  private fatoDoDocumento(
    revisao: { readonly caminho: string; readonly hash: string },
    diretorio: string,
    workspaceId: WorkspaceId
  ): FatoDoMarco {
    // `%H%x00%cI`: hash e data ISO separados por NUL — o separador que não aparece em saída de
    // Git, ao contrário de qualquer caractere imprimível que uma mensagem de commit poderia ter.
    const log = this.deps.git.run(
      ['log', '-1', '--format=%H%x00%cI', '--', revisao.caminho],
      diretorio,
      workspaceId
    )

    if (!log.ok || log.saida === '') {
      return { caminho: revisao.caminho, hashDaRevisao: revisao.hash }
    }

    const [commit, data] = log.saida.split('\0')
    if (commit === undefined || commit === '') {
      return { caminho: revisao.caminho, hashDaRevisao: revisao.hash }
    }

    return {
      caminho: revisao.caminho,
      hashDaRevisao: revisao.hash,
      commit,
      ...(data === undefined || data === '' ? {} : { data }),
      ...(this.hashDoBlob(commit, revisao.caminho, diretorio, workspaceId) ?? {})
    }
  }

  /**
   * O SHA-256 do arquivo **como ele está no commit**.
   *
   * `git show <commit>:<caminho>` e não `readFileSync`: o arquivo no disco é o worktree, que pode
   * ter mudado depois do commit. Ler o disco responderia "o texto atual bate com a revisão", que
   * é outra pergunta — e a que deixaria passar exatamente o caso do critério 1.
   */
  private hashDoBlob(
    commit: string,
    caminho: string,
    diretorio: string,
    workspaceId: WorkspaceId
  ): { readonly hashDoBlob: string } | undefined {
    const blob = this.deps.git.run(['show', `${commit}:${caminho}`], diretorio, workspaceId)
    if (!blob.ok) return undefined

    // `execucao.stdout` cru, não `saida`: `saida` vem com `trim()`, e um documento que termina em
    // linha em branco teria hash diferente do que a gravação calculou sobre o texto inteiro.
    return {
      hashDoBlob: createHash('sha256').update(blob.execucao.stdout, 'utf8').digest('hex')
    }
  }
}

const VAZIO: EstadoDoRepositorio = { sujos: [], headInterrompido: false, head: '' }

/**
 * O comando **rodou**, ainda que tenha saído não-zero?
 *
 * A pergunta separa "o Git respondeu que não há commit" de "o Git não está aqui" — dois desfechos
 * que o `ok: false` do `GitOutcome` funde num só e que têm ações opostas: o primeiro não é
 * problema nenhum (projeto novo), o segundo é `BLOCKED_EXTERNAL` com remédio.
 *
 * A distinção é o `exitCode`, e não o `reason`: o `TerminalEngine` classifica **toda** saída
 * não-zero como `falha-na-execucao` (é a mesma etiqueta de um `npm test` que reprova), e só um
 * processo que não chegou a rodar fica com `exitCode: null` — barrado pela allowlist, sem
 * binário, ou morto por timeout.
 */
function executou(execucao: CommandExecution): boolean {
  return execucao.exitCode !== null
}
