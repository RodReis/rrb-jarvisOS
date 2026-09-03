/**
 * Criação, importação e versionamento documental de projetos (SPEC-Planejamento-01).
 *
 * A ordem das etapas é a garantia inteira, e cada uma existe por um motivo distinto:
 *
 *   1. **Nome válido?** Fora ⇒ recusa. Antes de tudo, porque é a checagem que não toca nada.
 *   2. **Colisão de slug ou de diretório?** ⇒ recusa, com o projeto que colidiu para a UI
 *      oferecer *retomar* ou *importar*. Consulta ao SQLite, **antes de qualquer escrita**:
 *      é isto que sustenta o critério 3 (colisão não cria diretório parcial nem modifica o
 *      alvo). Descobrir colisão por exceção de `mkdir` já teria escrito.
 *   3. **Diretório na allowlist?** Fora ⇒ recusa. O projeto nasce sob `userData` por padrão
 *      (decisão 1 do PI), e **criar projeto nunca amplia a allowlist**: se o alvo está fora,
 *      a resposta é recusar, jamais adicionar o diretório por conta própria.
 *   4. **Escreve a estrutura documental.** Só aqui o disco é tocado.
 *   5. **Inicializa o Git** — pelo terminal controlado, sempre (`GitRunner`).
 *   6. **Persiste** `Project` e `PlanningSession`.
 *
 * **A importação é o caminho conservador por construção**: ela pula os passos 4 e 5 quando o
 * conteúdo já existe. `git init` só roda onde ainda não há `.git`, e nenhum arquivo do usuário
 * é sobrescrito — o critério 9 (importar o próprio `rrb-jarvisOS` sem tocar em nada) é o teste
 * mais forte disso.
 *
 * **Commit só em marco documental** (spec § Fluxo 6). O autosave do wizard grava no SQLite e
 * não commita: cada tecla não é uma revisão, e commitar rascunho encheria o histórico do ruído
 * que enterraria os marcos reais.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPathAllowed } from '@shared/policies'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  MarcoDocumental,
  MarcoOutcome,
  PlanningSession,
  Project,
  ProjectOutcome
} from '@shared/domain/projects'
import { MENSAGEM_DO_MARCO, isNomeDeProjetoValido, slugificar } from '@shared/domain/projects'
import { log } from '../logging/logger'
import { canonicalize } from '../policy/allowlist-canon'
import type { AllowlistRepository } from '../policy/allowlist-repository'
import type { AuditRepository } from '../storage/audit-repository'
import { GitRunner } from './git-runner'
import type { ProjectRepository } from './project-repository'

/**
 * A estrutura documental mínima de um projeto novo (spec § Fluxo 3).
 *
 * **Espelha este repositório** (`docs/` com `spec/`, `mvp/`, `adr/`) por decisão cravada do
 * Cowork: é o formato que a M8-F06 e o MVP-009 consomem, e gerar outro obrigaria as duas a
 * traduzir. O critério 9 — importar o próprio `rrb-jarvisOS` — é a verificação de que o formato
 * está certo: se a importação quebrar aqui, o layout gerado é que está errado.
 */
const DIRETORIOS_DA_ESTRUTURA: readonly string[] = ['docs', 'docs/spec', 'docs/mvp', 'docs/adr']

/**
 * O `.gitkeep` dos diretórios vazios. Sem ele o Git não versiona diretório nenhum — e o
 * primeiro commit do marco `estrutura-inicial` sairia com um único arquivo, fazendo a estrutura
 * documental parecer que não foi criada.
 */
const GITKEEP = '.gitkeep'

/** Nome do arquivo raiz do projeto. Um só: o resto nasce com as fatias que o preenchem. */
const README = 'README.md'

interface ProjectServiceDeps {
  readonly repository: ProjectRepository
  readonly allowlist: AllowlistRepository
  readonly git: GitRunner
  readonly audit: AuditRepository
  readonly userId: () => string
}

/**
 * Conteúdo inicial do README. Mínimo de propósito: as fatias seguintes do MVP-008 escrevem o
 * PRD, o Landscape e o Convention, e um template rico aqui seria conteúdo que elas jogariam
 * fora — ou pior, que sobreviveria e pareceria decisão do usuário.
 */
function readmeInicial(nome: string): string {
  return `# ${nome}\n\nProjeto criado pelo JARVIS OS. O planejamento vive em \`docs/\`.\n`
}

export class ProjectService {
  private readonly repository: ProjectRepository
  private readonly allowlist: AllowlistRepository
  private readonly git: GitRunner
  private readonly audit: AuditRepository
  private readonly userId: () => string

  constructor(deps: ProjectServiceDeps) {
    this.repository = deps.repository
    this.allowlist = deps.allowlist
    this.git = deps.git
    this.audit = deps.audit
    this.userId = deps.userId
  }

  list(workspaceId: WorkspaceId): readonly Project[] {
    return this.repository.list(this.userId(), workspaceId)
  }

  /**
   * Cria um projeto novo. O diretório nasce **sob o diretório gerido pelo app** quando o
   * chamador não indica outro (decisão 1 do PI): é o único lugar permitido sem opt-in, e
   * escolher qualquer outro default faria a criação depender de uma permissão que o usuário
   * pode não ter dado.
   */
  criar(nome: string, workspaceId: WorkspaceId, diretorioBase?: string): ProjectOutcome {
    const userId = this.userId()

    // Passo 1 — o nome produz um slug utilizável? É a checagem que não toca em nada.
    if (!isNomeDeProjetoValido(nome)) {
      return this.recusar(
        userId,
        workspaceId,
        'nome-invalido',
        'Escolha um nome com letras ou números — ele vira o nome da pasta do projeto.',
        { nome }
      )
    }

    const slug = slugificar(nome)
    const base = diretorioBase ?? this.allowlist.appDirectory()
    const destino = canonicalize(join(base, slug))

    // Passo 2 — colisão, por consulta e **antes de escrever**. Duas perguntas distintas: o
    // slug já é de outro projeto? o diretório já é de outro projeto? A segunda existe porque
    // dois nomes diferentes podem apontar para o mesmo lugar.
    const porSlug = this.repository.findBySlug(userId, workspaceId, slug)
    const porDiretorio = this.repository.findByDiretorio(userId, destino)
    const conflitante = porSlug ?? porDiretorio

    if (conflitante) {
      return this.recusar(
        userId,
        workspaceId,
        'colisao',
        `Já existe um projeto chamado "${conflitante.nome}" nesse lugar. Retome-o ou escolha outro nome.`,
        { slug, diretorio: destino },
        conflitante.diretorio
      )
    }

    // Diretório que já existe no disco sem projeto registrado também é colisão — e a recusa é
    // o que impede o app de despejar `docs/` dentro de uma pasta do usuário que ele criou para
    // outra coisa. Para *usar* uma pasta existente há o caminho explícito: importar.
    if (existsSync(destino)) {
      return this.recusar(
        userId,
        workspaceId,
        'colisao',
        'Já existe uma pasta nesse caminho. Importe-a como projeto ou escolha outro nome.',
        { slug, diretorio: destino },
        destino
      )
    }

    // Passo 3 — allowlist. **Não ampliamos**: recusar é a resposta correta (critério 7).
    if (!isPathAllowed(destino, this.allowlist.list(userId))) {
      return this.recusar(
        userId,
        workspaceId,
        'diretorio-fora-da-allowlist',
        'Esse diretório não está permitido. Permita-o em Diretórios Permitidos antes de criar o projeto ali.',
        { diretorio: destino }
      )
    }

    // Passo 4 — escreve. É o primeiro momento em que o disco é tocado.
    try {
      mkdirSync(destino, { recursive: true })
      for (const relativo of DIRETORIOS_DA_ESTRUTURA) {
        const dir = join(destino, relativo)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, GITKEEP), '', 'utf8')
      }
      writeFileSync(join(destino, README), readmeInicial(nome), 'utf8')
    } catch (erro) {
      log.db.error('Falha ao criar a estrutura do projeto', { erro })
      return this.recusar(
        userId,
        workspaceId,
        'falha-de-escrita',
        'Não foi possível criar a pasta do projeto. Verifique as permissões do diretório.',
        { diretorio: destino }
      )
    }

    // Passo 5 — Git, pelo terminal controlado.
    //
    // **Falha aqui desfaz a estrutura que esta chamada criou.** A primeira versão deixava os
    // arquivos para trás, com o argumento de que o usuário ficava "com os arquivos e o remédio".
    // O E2E mostrou que isso é falso: a pasta órfã faz a *próxima* tentativa bater em `colisao`,
    // então instalar ou permitir o `git` e tentar de novo — o remédio que a mensagem manda
    // aplicar — devolve outra recusa. Um estado que impede a própria correção é pior que não ter
    // criado nada.
    //
    // O rollback é seguro **porque só existe aqui**: chegamos a este ponto tendo verificado que
    // o destino não existia (passo 2), logo tudo que está nele foi escrito no passo 4. A
    // importação, que roda sobre diretório do usuário, nunca passa por este caminho.
    const inicializado = this.inicializarGit(destino, workspaceId)
    if (!inicializado.ok) {
      try {
        rmSync(destino, { recursive: true, force: true })
      } catch (erro) {
        // Não escalar: a recusa do Git é o que o usuário precisa saber, e trocá-la por uma falha
        // de limpeza esconderia a causa. O diretório remanescente aparece como colisão numa
        // próxima tentativa — visível, com a saída de importar.
        log.db.warn('Não foi possível remover a estrutura parcial após falha do Git', { erro })
      }

      return this.recusar(userId, workspaceId, inicializado.reason, inicializado.mensagem, {
        diretorio: destino
      })
    }

    return this.registrar(userId, workspaceId, {
      nome,
      slug,
      diretorio: destino,
      origem: 'criado',
      gitPreexistente: false
    })
  }

  /**
   * Importa um diretório existente como projeto.
   *
   * **Não escreve nada dentro dele.** Nem estrutura documental, nem README: o critério 2 exige
   * preservar conteúdo e histórico, e "criar só o que falta" seria a porta pela qual um
   * `docs/spec/` do app apareceria num repositório que organiza a documentação de outro jeito.
   * A única escrita possível é `git init` — e só onde não há `.git`.
   */
  importar(diretorio: string, workspaceId: WorkspaceId, nomeSugerido?: string): ProjectOutcome {
    const userId = this.userId()
    const destino = canonicalize(diretorio)

    if (!existsSync(destino)) {
      return this.recusar(
        userId,
        workspaceId,
        'diretorio-inexistente',
        'Esse diretório não existe. Escolha uma pasta existente para importar.',
        { diretorio: destino }
      )
    }

    if (!isPathAllowed(destino, this.allowlist.list(userId))) {
      return this.recusar(
        userId,
        workspaceId,
        'diretorio-fora-da-allowlist',
        'Esse diretório não está permitido. Permita-o em Diretórios Permitidos antes de importar.',
        { diretorio: destino }
      )
    }

    // O nome default vem da própria pasta: importar `rrb-jarvisOS` deve produzir um projeto
    // chamado assim, não pedir ao usuário que redigite o que ele acabou de escolher.
    const nome = nomeSugerido?.trim() || (destino.replaceAll('\\', '/').split('/').pop() ?? '')
    if (!isNomeDeProjetoValido(nome)) {
      return this.recusar(
        userId,
        workspaceId,
        'nome-invalido',
        'Não consegui derivar um nome dessa pasta. Informe um nome para o projeto.',
        { diretorio: destino }
      )
    }

    const slug = slugificar(nome)
    const conflitante =
      this.repository.findByDiretorio(userId, destino) ??
      this.repository.findBySlug(userId, workspaceId, slug)

    if (conflitante) {
      return this.recusar(
        userId,
        workspaceId,
        'colisao',
        `Esse diretório já está registrado como "${conflitante.nome}".`,
        { slug, diretorio: destino },
        conflitante.diretorio
      )
    }

    // Repositório existente **nunca** é reinicializado (spec § Regras): `git init` num repo já
    // versionado não apaga histórico, mas a regra é sobre não mexer — e checar antes é o que
    // torna a promessa verificável em vez de depender do comportamento do Git.
    const gitPreexistente = existsSync(join(destino, '.git'))

    if (!gitPreexistente) {
      const inicializado = this.inicializarGit(destino, workspaceId)
      if (!inicializado.ok) {
        return this.recusar(userId, workspaceId, inicializado.reason, inicializado.mensagem, {
          diretorio: destino
        })
      }
    }

    return this.registrar(userId, workspaceId, {
      nome,
      slug,
      diretorio: destino,
      origem: 'importado',
      gitPreexistente
    })
  }

  /**
   * Renomeia o projeto — **só o nome de exibição** (decisão do PI, 2026-08-29).
   *
   * O slug e o diretório ficam onde estão, e isso é o ponto: o nome muda para o leitor, não
   * para o disco. Mover o repositório invalidaria todo caminho que já aponta para ele, e o
   * ganho seria cosmético.
   *
   * Valida com a **mesma** regra da criação, apesar de o nome não virar pasta aqui: aceitar
   * `"!!!"` num rename permitiria chegar, por edição, a um estado que a criação recusa — e um
   * projeto sem nome legível é ilegível na lista, tenha ele pasta ou não.
   */
  renomear(projectId: string, nome: string, workspaceId: WorkspaceId): ProjectOutcome {
    const userId = this.userId()
    const project = this.repository.findById(userId, projectId)

    if (!project) {
      return this.recusar(userId, workspaceId, 'colisao', 'Projeto não encontrado.', { projectId })
    }

    if (!isNomeDeProjetoValido(nome)) {
      return this.recusar(
        userId,
        workspaceId,
        'nome-invalido',
        'Escolha um nome com letras ou números.',
        { projectId, nome }
      )
    }

    const renomeado = this.repository.rename(userId, projectId, nome.trim())
    if (!renomeado) {
      return this.recusar(userId, workspaceId, 'falha-de-escrita', 'Não foi possível renomear.', {
        projectId
      })
    }

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-lifecycle',
      payload: { reason: 'renomeado', projectId, de: project.nome, para: renomeado.nome }
    })

    log.agent.info('Projeto renomeado', { projectId })
    return {
      reason: project.origem,
      project: renomeado,
      mensagem: `Projeto renomeado para "${renomeado.nome}".`
    }
  }

  /**
   * Desregistra o projeto. **Nada é apagado do disco** (decisão do PI, 2026-08-29): a pasta, a
   * documentação e o histórico Git continuam lá, e o projeto pode ser reimportado depois.
   *
   * Por isso a operação **não** passa pelo fluxo de aprovação: não há efeito destrutivo a
   * aprovar. Se um dia excluir passar a apagar arquivos, é outra operação — e aí precisa da
   * aprovação humana, não deste caminho com um parâmetro a mais.
   */
  remover(projectId: string, workspaceId: WorkspaceId): boolean {
    const userId = this.userId()
    const project = this.repository.findById(userId, projectId)
    if (!project) return false

    const removido = this.repository.remove(userId, projectId)
    if (!removido) return false

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-lifecycle',
      payload: {
        reason: 'desregistrado',
        projectId,
        slug: project.slug,
        diretorio: project.diretorio,
        // Explícito na evidência: quem auditar depois precisa saber que o disco ficou intacto,
        // e não deduzir isso da ausência de um evento de remoção de arquivo.
        arquivosPreservados: true
      }
    })

    log.agent.info('Projeto desregistrado sem apagar arquivos', { projectId })
    return true
  }

  /** A sessão de planejamento do projeto, criando-a na primeira leitura. */
  abrirSessao(projectId: string, workspaceId: WorkspaceId): PlanningSession | undefined {
    const userId = this.userId()
    const project = this.repository.findById(userId, projectId)
    if (!project) return undefined

    const existente = this.repository.findSession(userId, projectId)
    if (existente) return existente

    const agora = new Date().toISOString()
    return this.repository.saveSession({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      etapa: 'inicio',
      // Projeto novo nasce no começo da jornada (SPEC-Jornada-01). Coincide com o cálculo de
      // `etapaDerivada([])`, então não há divergência a auditar na primeira leitura.
      etapaDaJornada: 'prompt',
      motivoDaRegressao: null,
      respostas: {},
      ultimoMarco: null,
      updated_at: agora,
      created_at: agora
    })
  }

  /**
   * Autosave do wizard. **Não commita e não audita** (spec § Regras): resposta de wizard é
   * estado de trabalho, não revisão documental — e um `AuditEvent` por tecla afogaria a cadeia
   * de auditoria em ruído, tornando ilegível justamente o que ela existe para mostrar.
   */
  salvarRespostas(
    projectId: string,
    etapa: string,
    respostas: Readonly<Record<string, unknown>>,
    workspaceId: WorkspaceId
  ): PlanningSession | undefined {
    const sessao = this.abrirSessao(projectId, workspaceId)
    if (!sessao) return undefined

    return this.repository.saveSession({
      ...sessao,
      etapa,
      // Mescla em vez de substituir: o wizard salva a etapa corrente, e trocar o mapa inteiro
      // apagaria as respostas das etapas anteriores a cada gravação.
      respostas: { ...sessao.respostas, ...respostas },
      updated_at: new Date().toISOString()
    })
  }

  /**
   * Conclui um marco documental: **o único gatilho de commit** (spec § Fluxo 6).
   *
   * Falha de commit devolve `commitado: false` em vez de estourar. É o critério 5 literal: os
   * dados ficam no SQLite e a retomada continua possível — chamar de novo depois de resolver o
   * problema tenta o mesmo commit, porque nada do estado se perdeu.
   */
  concluirMarco(
    projectId: string,
    marco: MarcoDocumental,
    workspaceId: WorkspaceId
  ): MarcoOutcome | undefined {
    const userId = this.userId()
    const project = this.repository.findById(userId, projectId)
    if (!project) return undefined

    const mensagem = MENSAGEM_DO_MARCO[marco]

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-milestone',
      payload: { marco, projectId, fase: 'inicio', mensagem }
    })

    // `git add -A` e não `git commit -a`: o `-a` ignora arquivo novo, e a estrutura documental
    // de um marco é feita justamente de arquivos novos — o commit sairia vazio ou parcial.
    const adicionado = this.git.run(['add', '-A'], project.diretorio, workspaceId)
    if (!adicionado.ok) {
      return this.falharMarco(userId, workspaceId, projectId, marco, adicionado.execucao)
    }

    const commitado = this.git.run(['commit', '-m', mensagem], project.diretorio, workspaceId)
    if (!commitado.ok) {
      return this.falharMarco(userId, workspaceId, projectId, marco, commitado.execucao)
    }

    // O hash é o que torna a revisão rastreável (spec § Evidência). Lido do repositório, não
    // derivado da saída do `commit`, porque o formato dela varia entre versões do Git.
    const hash = this.git.run(['rev-parse', 'HEAD'], project.diretorio, workspaceId)
    const commitHash = hash.ok ? hash.saida : undefined

    this.repository.marcarMarco(userId, projectId, marco)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-milestone',
      payload: { marco, projectId, fase: 'commitado', mensagem, commitHash: commitHash ?? null }
    })

    log.agent.info('Marco documental commitado', { projectId, marco, commitHash })
    return { marco, commitado: true, mensagem, ...(commitHash ? { commitHash } : {}) }
  }

  /**
   * `git init` + branch `main`, pelo terminal controlado.
   *
   * `--initial-branch=main` e não `init` seguido de `branch -M`: o segundo é uma escrita a mais
   * num repositório recém-criado, e o primeiro já nomeia a branch de saída. Git 2.28+ suporta a
   * flag; abaixo disso o comando falha explicitamente em vez de criar `master` silenciosamente —
   * o que é o desfecho correto, porque uma branch com o nome errado é pior que uma falha visível.
   */
  private inicializarGit(
    diretorio: string,
    workspaceId: WorkspaceId
  ): { ok: true } | { ok: false; reason: 'git-indisponivel' | 'falha-no-git'; mensagem: string } {
    const resultado = this.git.run(['init', '--initial-branch=main'], diretorio, workspaceId)
    if (resultado.ok) return { ok: true }

    const mensagem = GitRunner.explicarFalha(resultado.execucao)
    // `git-indisponivel` é o `BLOCKED_EXTERNAL` da spec: o binário não está lá ou não foi
    // permitido. Distinto de `falha-no-git` (o Git rodou e recusou) porque as ações do usuário
    // são diferentes — instalar/permitir versus olhar o erro do próprio Git.
    const indisponivel =
      resultado.execucao.reason === 'binario-fora-da-allowlist' ||
      resultado.execucao.stderr.includes('ENOENT')

    return {
      ok: false,
      reason: indisponivel ? 'git-indisponivel' : 'falha-no-git',
      mensagem
    }
  }

  /** Grava `Project` + `PlanningSession` e audita o nascimento. */
  private registrar(
    userId: string,
    workspaceId: WorkspaceId,
    dados: Omit<Project, 'id' | 'user_id' | 'workspace_id' | 'created_at'>
  ): ProjectOutcome {
    const project: Project = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      created_at: new Date().toISOString(),
      ...dados
    }

    this.repository.save(project)
    this.abrirSessao(project.id, workspaceId)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-lifecycle',
      payload: {
        reason: dados.origem,
        projectId: project.id,
        slug: project.slug,
        diretorio: project.diretorio,
        gitPreexistente: project.gitPreexistente
      }
    })

    log.agent.info('Projeto registrado', {
      projectId: project.id,
      origem: project.origem,
      slug: project.slug
    })

    return {
      reason: dados.origem === 'criado' ? 'criado' : 'importado',
      project,
      mensagem:
        dados.origem === 'criado'
          ? `Projeto "${project.nome}" criado com Git local inicializado.`
          : `Projeto "${project.nome}" importado sem alterar o conteúdo existente.`
    }
  }

  /**
   * Recusa auditada. **Toda** recusa audita: a tentativa barrada é o fato interessante para a
   * auditoria, e registrar só o que deu certo faria sumir exatamente o que se quer inspecionar
   * — mesma postura do `TerminalEngine.recusar`.
   */
  private recusar(
    userId: string,
    workspaceId: WorkspaceId,
    reason: ProjectOutcome['reason'],
    mensagem: string,
    detalhe: Readonly<Record<string, unknown>>,
    diretorioEmConflito?: string
  ): ProjectOutcome {
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-lifecycle',
      payload: { reason, ...detalhe }
    })

    log.agent.warn('Criação/importação de projeto recusada', { reason, ...detalhe })

    return {
      reason,
      mensagem,
      ...(diretorioEmConflito ? { diretorioEmConflito } : {})
    }
  }

  /** Marco que não virou commit. Audita e devolve — o estado no SQLite fica intacto. */
  private falharMarco(
    userId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    marco: MarcoDocumental,
    execucao: Parameters<typeof GitRunner.explicarFalha>[0]
  ): MarcoOutcome {
    const mensagem = GitRunner.explicarFalha(execucao)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'project-milestone',
      payload: { marco, projectId, fase: 'falhou', reason: execucao.reason }
    })

    log.agent.error('Marco documental não pôde ser commitado', {
      projectId,
      marco,
      reason: execucao.reason
    })

    return { marco, commitado: false, mensagem }
  }
}
