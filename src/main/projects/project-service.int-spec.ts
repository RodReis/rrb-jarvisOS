/**
 * Projeto local, SQLite e Git automático (SPEC-Planejamento-01, categoria Banco).
 *
 * A prova é **por efeito**, como no terminal controlado: não basta o serviço *dizer* que criou
 * o projeto ou que recusou a colisão — o disco e o repositório Git têm de confirmar. Verificar
 * só o `ProjectOutcome` provaria que o serviço relata o que pretendia fazer, não o que fez.
 *
 * **Git de verdade, em diretório temporário.** É o ponto da fatia: o caminho é o terminal
 * controlado executando o `git` do sistema, e um dublê de Git testaria a nossa imitação em vez
 * do acoplamento real. A suíte pula sozinha se a máquina não tiver `git` — a alternativa seria
 * um teste vermelho por motivo alheio ao código.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { AllowlistRepository } = await import('../policy/allowlist-repository')
const { CommandAllowlistRepository } = await import('../policy/command-allowlist-repository')
const { ExecutionRepository } = await import('../execution/execution-repository')
const { ApprovalRepository } = await import('../execution/approval-repository')
const { TerminalEngine } = await import('../execution/terminal-engine')
const { ProjectRepository } = await import('./project-repository')
const { ProjectService } = await import('./project-service')
const { GitRunner } = await import('./git-runner')

const USER = 'u-1'

/**
 * O `git` existe nesta máquina? Sem ele a fatia inteira é `BLOCKED_EXTERNAL` por desenho, e um
 * teste vermelho aqui apontaria para o ambiente, não para o código.
 */
function temGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const comGit = temGit() ? describe : describe.skip

let dir: string
let appDir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let comandos: InstanceType<typeof CommandAllowlistRepository>
let repository: InstanceType<typeof ProjectRepository>
let service: InstanceType<typeof ProjectService>

/**
 * Monta o serviço com o terminal controlado real. `permitirGit` é o interruptor da 1ª barreira:
 * com ele desligado, o `git` está instalado mas **não permitido** — o cenário do critério 8, em
 * que o caminho único precisa recusar em vez de contornar.
 */
function montar(permitirGit: boolean): InstanceType<typeof ProjectService> {
  const policy = new PolicyService(audit, () => USER)
  const diretorios = new AllowlistRepository(db, audit, appDir)
  comandos = new CommandAllowlistRepository(db, audit, policy)
  // Remove **antes** de decidir: a allowlist vive no banco, e o `beforeEach` já montou um
  // serviço com o `git` permitido. Sem esta linha, `montar(false)` construiria um objeto novo
  // sobre uma tabela que continua permitindo o binário — e o teste do critério 8 passaria
  // verde sem nunca ter exercitado a recusa.
  comandos.remove(USER, 'jarvis', 'git')
  if (permitirGit) comandos.add(USER, 'jarvis', 'git')

  const terminal = new TerminalEngine(
    policy,
    comandos,
    diretorios,
    new ExecutionRepository(db),
    new ApprovalRepository(db),
    audit,
    () => USER
  )

  repository = new ProjectRepository(db)
  return new ProjectService({
    repository,
    allowlist: diretorios,
    git: new GitRunner(terminal),
    audit,
    userId: () => USER
  })
}

/** Lê o histórico do repositório direto do disco — evidência, não o que o serviço relatou. */
function historico(diretorio: string): string {
  return execFileSync('git', ['log', '--pretty=%s'], { cwd: diretorio, encoding: 'utf8' }).trim()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-projetos-'))
  appDir = join(dir, 'userData')
  mkdirSync(appDir, { recursive: true })

  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  service = montar(true)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

comGit('criação de projeto', () => {
  it('cria estrutura documental e repositório Git com branch main', () => {
    const resultado = service.criar('Projeto Alfa', 'jarvis')

    expect(resultado.reason).toBe('criado')
    const diretorio = resultado.project?.diretorio ?? ''

    // Efeito no disco: a estrutura que a M8-F06 e o MVP-009 consomem.
    expect(existsSync(join(diretorio, 'README.md'))).toBe(true)
    expect(existsSync(join(diretorio, 'docs', 'spec'))).toBe(true)
    expect(existsSync(join(diretorio, 'docs', 'mvp'))).toBe(true)
    expect(existsSync(join(diretorio, 'docs', 'adr'))).toBe(true)

    // Efeito no Git: repositório de verdade, na branch `main`.
    expect(existsSync(join(diretorio, '.git'))).toBe(true)
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: diretorio,
      encoding: 'utf8'
    }).trim()
    expect(branch).toBe('main')
  })

  it('nasce sob o diretório do app sem tocar a allowlist (critério 7)', () => {
    const antes = new AllowlistRepository(db, audit, appDir).list(USER)
    const resultado = service.criar('Sob o App', 'jarvis')
    const depois = new AllowlistRepository(db, audit, appDir).list(USER)

    expect(resultado.project?.diretorio.startsWith(appDir)).toBe(true)
    // A allowlist é **a mesma** depois de criar: criar projeto nunca amplia permissão.
    expect(depois).toEqual(antes)
  })

  it('recusa diretório externo em vez de adicioná-lo à allowlist (critério 7)', () => {
    const externo = join(dir, 'fora-da-allowlist')
    mkdirSync(externo, { recursive: true })

    const resultado = service.criar('Projeto Externo', 'jarvis', externo)

    expect(resultado.reason).toBe('diretorio-fora-da-allowlist')
    // Nada foi escrito **e** a permissão não foi ampliada — as duas metades da recusa.
    expect(existsSync(join(externo, 'projeto-externo'))).toBe(false)
    expect(new AllowlistRepository(db, audit, appDir).list(USER)).toEqual([appDir])
  })

  it('recusa nome que não produz slug utilizável', () => {
    const resultado = service.criar('!!!', 'jarvis')
    expect(resultado.reason).toBe('nome-invalido')
    expect(repository.list(USER, 'jarvis')).toHaveLength(0)
  })
})

comGit('colisão', () => {
  it('não cria diretório parcial nem modifica o alvo (critério 3)', () => {
    const primeiro = service.criar('Projeto Alfa', 'jarvis')
    const diretorio = primeiro.project?.diretorio ?? ''

    // Marca o alvo com conteúdo do usuário: se a colisão tocar em algo, isto muda.
    const marcador = join(diretorio, 'README.md')
    writeFileSync(marcador, 'conteúdo do usuário', 'utf8')

    const segundo = service.criar('Projeto Alfa', 'jarvis')

    expect(segundo.reason).toBe('colisao')
    expect(segundo.diretorioEmConflito).toBe(diretorio)
    // O alvo está intacto — a recusa aconteceu antes de qualquer escrita.
    expect(readFileSync(marcador, 'utf8')).toBe('conteúdo do usuário')
    // E só existe **um** projeto: a colisão não registrou um segundo.
    expect(repository.list(USER, 'jarvis')).toHaveLength(1)
  })

  it('trata pasta existente sem projeto registrado como colisão', () => {
    // O cenário em que o app despejaria `docs/` dentro de uma pasta que o usuário criou para
    // outra coisa. A saída correta é recusar e oferecer importar.
    const ocupado = join(appDir, 'ja-existe')
    mkdirSync(ocupado, { recursive: true })
    writeFileSync(join(ocupado, 'meu-arquivo.txt'), 'meu conteúdo', 'utf8')

    const resultado = service.criar('Ja Existe', 'jarvis')

    expect(resultado.reason).toBe('colisao')
    expect(existsSync(join(ocupado, 'docs'))).toBe(false)
    expect(readFileSync(join(ocupado, 'meu-arquivo.txt'), 'utf8')).toBe('meu conteúdo')
  })
})

comGit('importação', () => {
  it('preserva conteúdo e histórico de um repositório existente (critério 2)', () => {
    // Um repositório com histórico próprio — o que a importação não pode tocar.
    const externo = join(appDir, 'repo-existente')
    mkdirSync(externo, { recursive: true })
    writeFileSync(join(externo, 'ARQUIVO.md'), 'documento do usuário', 'utf8')
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: externo, stdio: 'ignore' })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'add', '-A'], {
      cwd: externo,
      stdio: 'ignore'
    })
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'commit do usuário'],
      { cwd: externo, stdio: 'ignore' }
    )

    const resultado = service.importar(externo, 'jarvis')

    expect(resultado.reason).toBe('importado')
    expect(resultado.project?.gitPreexistente).toBe(true)
    // Conteúdo intacto e **sem** a estrutura documental do app por cima.
    expect(readFileSync(join(externo, 'ARQUIVO.md'), 'utf8')).toBe('documento do usuário')
    expect(existsSync(join(externo, 'docs', 'spec'))).toBe(false)
    // Histórico intacto: o commit do usuário continua sendo o único.
    expect(historico(externo)).toBe('commit do usuário')
  })

  it('inicializa Git quando o diretório importado ainda não é repositório', () => {
    const externo = join(appDir, 'pasta-sem-git')
    mkdirSync(externo, { recursive: true })
    writeFileSync(join(externo, 'nota.txt'), 'anotação', 'utf8')

    const resultado = service.importar(externo, 'jarvis')

    expect(resultado.reason).toBe('importado')
    expect(resultado.project?.gitPreexistente).toBe(false)
    expect(existsSync(join(externo, '.git'))).toBe(true)
    // O arquivo do usuário segue lá: `git init` versiona, não reescreve.
    expect(readFileSync(join(externo, 'nota.txt'), 'utf8')).toBe('anotação')
  })

  it('recusa diretório inexistente', () => {
    const resultado = service.importar(join(appDir, 'nao-existe'), 'jarvis')
    expect(resultado.reason).toBe('diretorio-inexistente')
  })
})

comGit('marco documental e commit', () => {
  it('commita apenas no marco, com mensagem determinística (critério 4)', () => {
    const projeto = service.criar('Projeto Alfa', 'jarvis').project
    const diretorio = projeto?.diretorio ?? ''

    // Identidade de Git local ao repositório temporário: a máquina de CI pode não ter uma
    // global configurada, e o commit falharia por motivo alheio ao que se testa.
    execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
    execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })

    // Autosave **não** commita: é o que separa estado de trabalho de revisão documental.
    service.salvarRespostas(projeto?.id ?? '', 'contexto', { objetivo: 'testar' }, 'jarvis')
    const commitsAntes = execFileSync('git', ['rev-list', '--all', '--count'], {
      cwd: diretorio,
      encoding: 'utf8'
    }).trim()
    expect(commitsAntes).toBe('0')

    const marco = service.concluirMarco(projeto?.id ?? '', 'estrutura-inicial', 'jarvis')

    expect(marco?.commitado).toBe(true)
    expect(marco?.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(historico(diretorio)).toBe('docs: estrutura documental inicial do projeto')
  })

  it('preserva o estado no SQLite quando o commit falha (critério 5)', () => {
    const projeto = service.criar('Projeto Alfa', 'jarvis').project
    const projectId = projeto?.id ?? ''
    service.salvarRespostas(projectId, 'contexto', { objetivo: 'preservar' }, 'jarvis')

    // Sem identidade de Git configurada, `git commit` falha. É a falha mais realista do
    // caminho — e a que o critério 5 nomeia.
    execFileSync('git', ['config', 'user.email', ''], { cwd: projeto?.diretorio ?? '' })
    execFileSync('git', ['config', 'user.name', ''], { cwd: projeto?.diretorio ?? '' })

    const marco = service.concluirMarco(projectId, 'estrutura-inicial', 'jarvis')

    expect(marco?.commitado).toBe(false)
    // Os dados continuam lá, e o marco **não** foi registrado: retomar é possível.
    const sessao = repository.findSession(USER, projectId)
    expect(sessao?.respostas).toEqual({ objetivo: 'preservar' })
    expect(sessao?.ultimoMarco).toBeNull()
  })
})

comGit('renomear e desregistrar', () => {
  it('renomeia sem mover o diretório nem o repositório', () => {
    const criado = service.criar('Projeto Alfa', 'jarvis').project
    const diretorio = criado?.diretorio ?? ''

    const resultado = service.renomear(criado?.id ?? '', 'Projeto Beta', 'jarvis')

    expect(resultado.project?.nome).toBe('Projeto Beta')
    // Slug e diretório **não** se movem: renomear é para o leitor, não para o disco. Mover o
    // repositório invalidaria todo caminho que já aponta para ele.
    expect(resultado.project?.slug).toBe('projeto-alfa')
    expect(resultado.project?.diretorio).toBe(diretorio)
    expect(existsSync(join(diretorio, '.git'))).toBe(true)
  })

  it('recusa renomear para um nome sem slug utilizável', () => {
    const projectId = service.criar('Projeto Alfa', 'jarvis').project?.id ?? ''

    const resultado = service.renomear(projectId, '!!!', 'jarvis')

    // Mesma regra da criação: aceitar aqui permitiria chegar por edição a um estado que a
    // criação recusa.
    expect(resultado.reason).toBe('nome-invalido')
    expect(repository.findById(USER, projectId)?.nome).toBe('Projeto Alfa')
  })

  it('desregistra sem apagar arquivos nem histórico Git (decisão do PI)', () => {
    const criado = service.criar('Projeto Alfa', 'jarvis').project
    const diretorio = criado?.diretorio ?? ''
    const projectId = criado?.id ?? ''
    service.salvarRespostas(projectId, 'contexto', { objetivo: 'some' }, 'jarvis')

    expect(service.remover(projectId, 'jarvis')).toBe(true)

    // Fora do registro…
    expect(repository.list(USER, 'jarvis')).toHaveLength(0)
    expect(repository.findSession(USER, projectId)).toBeUndefined()
    // …e **intacto** no disco: é o que torna a remoção reversível por reimportação.
    expect(existsSync(join(diretorio, 'README.md'))).toBe(true)
    expect(existsSync(join(diretorio, 'docs', 'spec'))).toBe(true)
    expect(existsSync(join(diretorio, '.git'))).toBe(true)
  })

  it('permite reimportar o que foi desregistrado', () => {
    const diretorio = service.criar('Projeto Alfa', 'jarvis').project?.diretorio ?? ''
    const projectId = repository.list(USER, 'jarvis')[0]?.id ?? ''
    service.remover(projectId, 'jarvis')

    const reimportado = service.importar(diretorio, 'jarvis')

    // O slug volta a estar livre, e o Git preexistente é reconhecido: o desregistro não deixou
    // resíduo que impedisse o retorno.
    expect(reimportado.reason).toBe('importado')
    expect(reimportado.project?.gitPreexistente).toBe(true)
  })

  it('audita o desregistro declarando que os arquivos ficaram', () => {
    const projectId = service.criar('Projeto Alfa', 'jarvis').project?.id ?? ''
    service.remover(projectId, 'jarvis')

    const evento = audit
      .list(USER)
      .find((e) => e.type === 'project-lifecycle' && e.payload['reason'] === 'desregistrado')

    // Explícito na evidência: quem auditar depois não precisa deduzir da ausência de um evento
    // de remoção de arquivo.
    expect(evento?.payload['arquivosPreservados']).toBe(true)
  })
})

comGit('retomada e autosave', () => {
  it('retoma respostas e identidade depois de reabrir o banco (critério 1)', () => {
    const projeto = service.criar('Projeto Alfa', 'jarvis').project
    const projectId = projeto?.id ?? ''
    service.salvarRespostas(projectId, 'contexto', { objetivo: 'reabrir' }, 'jarvis')
    service.salvarRespostas(projectId, 'escopo', { publico: 'interno' }, 'jarvis')

    // Simula o reinício do app: fecha e reabre o mesmo arquivo de banco.
    db.close()
    db = openDatabase(join(dir, 'app.db'))
    audit = new AuditRepository(db, 'chave-de-teste')
    service = montar(true)

    const projetos = service.list('jarvis')
    expect(projetos).toHaveLength(1)
    expect(projetos[0]?.id).toBe(projectId)

    const sessao = service.abrirSessao(projectId, 'jarvis')
    // As duas etapas sobreviveram: o autosave mescla, não substitui.
    expect(sessao?.respostas).toEqual({ objetivo: 'reabrir', publico: 'interno' })
    expect(sessao?.etapa).toBe('escopo')
  })

  it('não cria uma segunda sessão ao reabrir o mesmo projeto', () => {
    const projectId = service.criar('Projeto Alfa', 'jarvis').project?.id ?? ''
    const primeira = service.abrirSessao(projectId, 'jarvis')
    const segunda = service.abrirSessao(projectId, 'jarvis')

    // Duas sessões abertas significariam duas verdades sobre onde o usuário parou.
    expect(segunda?.id).toBe(primeira?.id)
  })
})

comGit('caminho único de Git', () => {
  it('recusa com ação concreta quando o git não está permitido (critério 8)', () => {
    // O `git` está instalado, mas fora da allowlist de comandos. O caminho único tem de
    // recusar — jamais contornar por uma implementação embarcada.
    service = montar(false)

    const resultado = service.criar('Sem Git Permitido', 'jarvis')

    expect(resultado.reason).toBe('git-indisponivel')
    expect(resultado.mensagem).toContain('Terminal Controlado')
    // Nenhum projeto registrado: sem Git não há projeto versionado.
    expect(repository.list(USER, 'jarvis')).toHaveLength(0)
  })

  it('audita toda operação de Git como terminal-command (critério 8)', () => {
    const projeto = service.criar('Projeto Alfa', 'jarvis').project
    const diretorio = projeto?.diretorio ?? ''
    execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
    execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })
    service.concluirMarco(projeto?.id ?? '', 'estrutura-inicial', 'jarvis')

    const eventos = audit.list(USER)
    const comandosGit = eventos.filter(
      (e) => e.type === 'terminal-command' && e.payload['binary'] === 'git'
    )

    // Todo `git` executado deixou rastro: init, add, commit e rev-parse, com par antes/depois.
    expect(comandosGit.length).toBeGreaterThanOrEqual(4)
    // E o ciclo de vida do projeto tem os próprios eventos, distintos da execução.
    expect(eventos.some((e) => e.type === 'project-lifecycle')).toBe(true)
    expect(eventos.some((e) => e.type === 'project-milestone')).toBe(true)
  })

  it('falha do Git não deixa estrutura órfã que impeça a retentativa', () => {
    // O bug que o E2E achou: sem rollback, a primeira tentativa escrevia `docs/` e o README
    // antes de o `git init` falhar, e a **segunda** batia em `colisao` — ou seja, aplicar o
    // remédio que a própria mensagem manda aplicar (permitir o `git`) devolvia outra recusa.
    // Um estado que impede a própria correção é pior que não ter criado nada.
    service = montar(false)
    const recusa = service.criar('Projeto Alfa', 'jarvis')
    expect(recusa.reason).toBe('git-indisponivel')

    // Nada ficou para trás no disco.
    expect(existsSync(join(appDir, 'projeto-alfa'))).toBe(false)

    // E a retentativa, depois de permitir o binário, funciona — que é o ponto todo.
    comandos.add(USER, 'jarvis', 'git')
    const depois = service.criar('Projeto Alfa', 'jarvis')

    expect(depois.reason).toBe('criado')
    expect(existsSync(join(depois.project?.diretorio ?? '', '.git'))).toBe(true)
  })

  it('audita a recusa, não só o sucesso', () => {
    service.criar('!!!', 'jarvis')

    const recusa = audit
      .list(USER)
      .find((e) => e.type === 'project-lifecycle' && e.payload['reason'] === 'nome-invalido')

    expect(recusa).toBeDefined()
  })
})
