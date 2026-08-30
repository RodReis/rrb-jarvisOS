/**
 * Os anexos e a arquitetura contra o SQLite e o disco reais (SPEC-Planejamento-05, Banco).
 *
 * A prova é **por efeito**, como na M8-F04: não basta o serviço dizer que recusou — o disco tem
 * de confirmar que nenhum documento foi escrito e o banco que nenhuma linha foi gravada. Os
 * critérios 1 e 2 são exatamente sobre o que **não** acontece quando falta anexo, e verificar só
 * o outcome provaria a intenção do serviço, não o efeito dele.
 *
 * **O carregamento do protótipo é dublado, e a fronteira do dublê é declarada.** O que se
 * exercita aqui é a decisão desta fatia — quando o gate abre, o que impede a arquitetura, o que
 * vai para o documento —, não o Chromium: o `BrowserWindow` real precisa de Electron vivo e tem
 * prova própria no E2E. O parser de referências **não** é dublado: ele toca o disco de verdade,
 * porque "este asset existe sob o projeto?" é a pergunta que ele responde.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pergunta } from '@shared/domain/wizard'
import type { RenderDoPrototipo } from '@shared/domain/validacao-de-prototipo'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { DecisionRepository } = await import('./decision-repository')
const { PacoteRepository } = await import('./pacote-repository')
const { AnexoRepository } = await import('./anexo-repository')
const { AnexoService, hashDaArquitetura } = await import('./anexo-service')

const USER = 'u-1'
const PROJETO = 'p-1'

const CATALOGO: readonly Pergunta[] = ['superficie', 'design-de-origem'].map((id) => ({
  id,
  etapa: 'contexto',
  titulo: `Título ${id}`,
  enunciado: 'Enunciado',
  opcoes: [
    { id: 'a', rotulo: 'Opção A', impacto: 'impacto de A' },
    { id: 'b', rotulo: 'Opção B', impacto: 'impacto de B' }
  ],
  recomendada: 'a',
  justificativa: 'porque sim',
  aceitaTextoLivre: true,
  delegavel: false
}))

let dir: string
let raiz: string
let externo: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
let decisions: InstanceType<typeof DecisionRepository>
let pacotes: InstanceType<typeof PacoteRepository>
let repository: InstanceType<typeof AnexoRepository>
let service: InstanceType<typeof AnexoService>
let marcos: string[]
/** O que o dublê do carregamento devolve, por caminho de protótipo. */
let renders: Record<string, RenderDoPrototipo>

/** Um render saudável, cobrindo os quatro estados exigidos. */
function renderOk(jornadas: readonly string[] = ['Início']): RenderDoPrototipo {
  return {
    carregou: true,
    errosDeConsole: [],
    elementosVisiveis: 20,
    jornadas: ['Lista vazia', 'Carregando', 'Erro', 'Bloqueado', ...jornadas]
  }
}

/** Cria um arquivo fora do projeto, para o seletor escolher. */
function arquivoExterno(nome: string, conteudo = 'conteúdo'): string {
  const caminho = join(externo, nome)
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, conteudo, 'utf8')
  return caminho
}

function decidir(perguntaId: string): void {
  decisions.registrar({
    id: `d-${perguntaId}`,
    user_id: USER,
    workspace_id: 'jarvis',
    projectId: PROJETO,
    perguntaId,
    etapa: 'contexto',
    escolha: 'a',
    texto: null,
    recomendacao: 'a',
    justificativa: 'porque sim',
    autor: 'pi',
    motivo: 'escolhida',
    substituiu: null,
    created_at: '2026-08-30T10:00:00.000Z'
  })
}

/** Grava um PRD, que a arquitetura precisa citar (critério 3). */
function gravarPrd(escopo: readonly string[] = ['Tela de login']): string {
  const id = `pacote-${Math.random().toString(36).slice(2)}`
  pacotes.registrarPacote({
    id,
    user_id: USER,
    workspace_id: 'jarvis',
    projectId: PROJETO,
    documentos: [
      {
        documento: 'PRD',
        caminho: 'docs/PRD.md',
        conteudo: '# PRD',
        hash: 'p'.repeat(64),
        afirmacoes: escopo.map((texto, i) => ({
          id: `a-${i}`,
          secao: 'Escopo',
          texto,
          origem: { tipo: 'decisao' as const, decisaoId: 'd-escopo', perguntaId: 'escopo' }
        }))
      }
    ],
    hash: `h-${id}`,
    commitHash: null,
    created_at: new Date().toISOString()
  })
  return id
}

function anexosNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM design_attachment').get() as { n: number }).n
}

function arquiteturasNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pacote_arquitetura').get() as { n: number }).n
}

/** Anexa design system + um protótipo: o mínimo que abre o gate. */
function anexarOMinimo(htmlDoPrototipo = '<h1>Início</h1>'): void {
  service.anexar(PROJETO, 'design-system', arquivoExterno('DESIGN-SYSTEM.md'), 'jarvis')
  service.anexar(PROJETO, 'prototipo', arquivoExterno('home.html', htmlDoPrototipo), 'jarvis')
  renders['docs/prototipos/home.html'] = renderOk()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-anexo-'))
  raiz = join(dir, 'projeto')
  externo = join(dir, 'externo')
  mkdirSync(raiz, { recursive: true })
  mkdirSync(externo, { recursive: true })

  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  projects = new ProjectRepository(db)
  decisions = new DecisionRepository(db)
  pacotes = new PacoteRepository(db)
  repository = new AnexoRepository(db)
  marcos = []
  renders = {}

  projects.save({
    id: PROJETO,
    user_id: USER,
    workspace_id: 'jarvis',
    nome: 'Projeto Alfa',
    slug: 'projeto-alfa',
    diretorio: raiz,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })

  service = new AnexoService({
    repository,
    projects,
    projectService: {
      concluirMarco: (_id: string, marco: string) => {
        marcos.push(marco)
        return { marco, commitado: true, mensagem: 'ok', commitHash: 'c0ffee' }
      }
    } as never,
    decisions,
    pacotes,
    audit,
    userId: () => USER,
    catalogo: CATALOGO,
    carregar: (absoluto: string) => {
      const relativo = absoluto.slice(raiz.length + 1).replace(/\\/g, '/')
      return Promise.resolve(
        renders[relativo] ?? {
          carregou: false,
          errosDeConsole: ['sem dublê para este protótipo'],
          elementosVisiveis: 0,
          jornadas: []
        }
      )
    }
  })
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('o ato de anexar (critério 7)', () => {
  it('copia o arquivo para dentro do projeto e hasheia no ato', () => {
    const origem = arquivoExterno('DESIGN-SYSTEM.md', '# Design System')

    const r = service.anexar(PROJETO, 'design-system', origem, 'jarvis')

    expect(r.reason).toBe('anexado')
    expect(r.anexo?.caminho).toBe('docs/DESIGN-SYSTEM.md')
    // A cópia existe no projeto, com o conteúdo do original.
    expect(readFileSync(join(raiz, 'docs/DESIGN-SYSTEM.md'), 'utf8')).toBe('# Design System')
    expect(r.anexo?.hash).toHaveLength(64)
    expect(r.anexo?.anexadoEm).toBeTruthy()
  })

  /**
   * A decisão do PI inteira: o gate conta a partir do **ato**, não da presença do arquivo.
   * Sem esta distinção, largar um arquivo na pasta satisfaria o gate e o instante em que ele
   * passa a valer ficaria indefinido.
   */
  it('arquivo largado no diretório por fora NÃO satisfaz o gate', () => {
    mkdirSync(join(raiz, 'docs/prototipos'), { recursive: true })
    writeFileSync(join(raiz, 'docs/DESIGN-SYSTEM.md'), '# largado', 'utf8')
    writeFileSync(join(raiz, 'docs/prototipos/home.html'), '<h1>largado</h1>', 'utf8')

    // Os arquivos estão lá, no lugar certo...
    expect(existsSync(join(raiz, 'docs/DESIGN-SYSTEM.md'))).toBe(true)
    expect(existsSync(join(raiz, 'docs/prototipos/home.html'))).toBe(true)
    // ...e o gate continua fechado, porque não houve ato.
    expect(service.pendencias(PROJETO)).toEqual(['design-system', 'prototipo'])
    expect(anexosNoBanco()).toBe(0)
  })

  /**
   * O mesmo fato, medido **no caminho que decide**.
   *
   * O teste acima consulta `pendencias()`, que é o que a tela chama; este exercita
   * `gerarArquitetura`, que é quem barra. A distinção não é redundância: um contrafactual que
   * fez o gate contar arquivo do disco **passou** com o teste anterior sozinho, porque ele mede
   * um método que a geração não usa. Uma garantia só vale onde a decisão acontece.
   */
  it('arquivo largado por fora não libera a arquitetura', async () => {
    decidir('superficie')
    gravarPrd()
    mkdirSync(join(raiz, 'docs/prototipos'), { recursive: true })
    writeFileSync(join(raiz, 'docs/DESIGN-SYSTEM.md'), '# largado', 'utf8')
    writeFileSync(join(raiz, 'docs/prototipos/home.html'), '<h1>largado</h1>', 'utf8')

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('anexos-pendentes')
    expect(r.pendencias).toEqual(['design-system', 'prototipo'])
    expect(existsSync(join(raiz, 'docs/ARCHITECTURE.md'))).toBe(false)
    expect(arquiteturasNoBanco()).toBe(0)
  })

  it('o mesmo arquivo anexado de novo substitui em vez de duplicar', () => {
    const origem = arquivoExterno('home.html', '<h1>v1</h1>')
    const primeiro = service.anexar(PROJETO, 'prototipo', origem, 'jarvis')

    writeFileSync(origem, '<h1>v2</h1>', 'utf8')
    const segundo = service.anexar(PROJETO, 'prototipo', origem, 'jarvis')

    expect(anexosNoBanco()).toBe(1)
    // O destino é um só; o hash acompanha o conteúdo novo.
    expect(segundo.anexo?.caminho).toBe(primeiro.anexo?.caminho)
    expect(segundo.anexo?.hash).not.toBe(primeiro.anexo?.hash)
    expect(readFileSync(join(raiz, 'docs/prototipos/home.html'), 'utf8')).toBe('<h1>v2</h1>')
  })

  it('recusa extensão incompatível sem copiar nada', () => {
    const r = service.anexar(PROJETO, 'prototipo', arquivoExterno('telas.pdf'), 'jarvis')

    expect(r.reason).toBe('tipo-incompativel')
    expect(anexosNoBanco()).toBe(0)
    expect(existsSync(join(raiz, 'docs/prototipos'))).toBe(false)
  })

  it('recusa origem inexistente', () => {
    const r = service.anexar(PROJETO, 'prototipo', join(externo, 'nao-existe.html'), 'jarvis')

    expect(r.reason).toBe('origem-ilegivel')
    expect(anexosNoBanco()).toBe(0)
  })

  it('gera AuditEvent com hash e caminho, nunca com o conteúdo', () => {
    service.anexar(
      PROJETO,
      'design-system',
      arquivoExterno('DESIGN-SYSTEM.md', 'segredo'),
      'jarvis'
    )

    const evento = audit.list(USER).find((e) => e.type === 'design-anexo')
    const payload = JSON.stringify(evento?.payload ?? {})
    expect(payload).toContain('docs/DESIGN-SYSTEM.md')
    expect(payload).not.toContain('segredo')
  })

  it('remover desregistra sem apagar o arquivo do disco', () => {
    service.anexar(PROJETO, 'prototipo', arquivoExterno('home.html'), 'jarvis')

    expect(service.remover(PROJETO, 'docs/prototipos/home.html', 'jarvis')).toBe(true)
    expect(anexosNoBanco()).toBe(0)
    // Apagar arquivo do usuário é destrutivo, e destrutivo não é efeito colateral.
    expect(existsSync(join(raiz, 'docs/prototipos/home.html'))).toBe(true)
  })
})

describe('o gate barra a arquitetura (critério 1)', () => {
  it('recusa nomeando o que falta', async () => {
    decidir('superficie')
    gravarPrd()

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('anexos-pendentes')
    expect(r.pendencias).toEqual(['design-system', 'prototipo'])
  })

  it('não escreve documento nem grava linha quando o gate está fechado', async () => {
    decidir('superficie')
    gravarPrd()

    await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(existsSync(join(raiz, 'docs/ARCHITECTURE.md'))).toBe(false)
    expect(arquiteturasNoBanco()).toBe(0)
    expect(marcos).toEqual([])
  })

  it('com design system mas sem protótipo, ainda barra', async () => {
    decidir('superficie')
    gravarPrd()
    service.anexar(PROJETO, 'design-system', arquivoExterno('DESIGN-SYSTEM.md'), 'jarvis')

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('anexos-pendentes')
    expect(r.pendencias).toEqual(['prototipo'])
  })

  /**
   * O critério 3 tem de ter a que se referir. Sem PRD, "a mesma revisão" não existiria, e a
   * arquitetura sairia ligada a nada.
   */
  it('sem PRD, recusa antes de qualquer escrita', async () => {
    decidir('superficie')
    anexarOMinimo()

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('prd-ausente')
    expect(existsSync(join(raiz, 'docs/ARCHITECTURE.md'))).toBe(false)
  })
})

describe('protótipo inválido impede a arquitetura (critério 2)', () => {
  it('protótipo que não abre barra, com pergunta e recomendação', async () => {
    decidir('superficie')
    gravarPrd()
    service.anexar(PROJETO, 'design-system', arquivoExterno('DESIGN-SYSTEM.md'), 'jarvis')
    service.anexar(PROJETO, 'prototipo', arquivoExterno('home.html'), 'jarvis')
    renders['docs/prototipos/home.html'] = {
      carregou: false,
      errosDeConsole: ['ERR_FILE_NOT_FOUND'],
      elementosVisiveis: 0,
      jornadas: []
    }

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('prototipos-invalidos')
    expect(r.achados?.[0]?.pergunta).toContain('?')
    expect(r.achados?.[0]?.recomendacao).toBeTruthy()
    expect(existsSync(join(raiz, 'docs/ARCHITECTURE.md'))).toBe(false)
    expect(arquiteturasNoBanco()).toBe(0)
  })

  /**
   * O parser toca o disco de verdade: a pergunta "este asset existe sob o projeto?" só tem
   * resposta lá. Um asset referenciado e não anexado impede prometer a tela.
   */
  it('asset referenciado e não anexado impede — parser sobre o disco real', async () => {
    decidir('superficie')
    gravarPrd()
    anexarOMinimo('<h1>Início</h1><img src="assets/logo.png">')

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('prototipos-invalidos')
    expect(r.achados?.some((a) => a.evidencia.includes('assets/logo.png'))).toBe(true)
  })

  it('o mesmo asset, uma vez anexado, deixa de impedir', async () => {
    decidir('superficie')
    gravarPrd()
    anexarOMinimo('<h1>Início</h1><img src="assets/logo.png">')
    service.anexar(PROJETO, 'asset', arquivoExterno('logo.png', 'png'), 'jarvis')

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('gerada')
  })

  it('referência remota não impede', async () => {
    decidir('superficie')
    gravarPrd()
    anexarOMinimo('<h1>Início</h1><link href="https://cdn.test/a.css">')

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('gerada')
  })
})

describe('a arquitetura gerada', () => {
  beforeEach(() => {
    decidir('superficie')
    decidir('design-de-origem')
  })

  it('escreve os quatro documentos no disco', async () => {
    const prdId = gravarPrd()
    anexarOMinimo()

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('gerada')
    for (const arquivo of ['ARCHITECTURE', 'DECISIONS', 'TESTING', 'REVIEW']) {
      expect(existsSync(join(raiz, `docs/${arquivo}.md`))).toBe(true)
    }
    expect(r.pacote?.pacoteEstruturalId).toBe(prdId)
  })

  /**
   * O critério 4 pela raiz: os fluxos saem das jornadas que o protótipo mostrou. Uma jornada que
   * não está no protótipo não pode aparecer no `ARCHITECTURE.md`.
   */
  it('só promete fluxo que o protótipo cobre (critério 4)', async () => {
    gravarPrd()
    service.anexar(PROJETO, 'design-system', arquivoExterno('DESIGN-SYSTEM.md'), 'jarvis')
    service.anexar(PROJETO, 'prototipo', arquivoExterno('home.html', '<h1>x</h1>'), 'jarvis')
    renders['docs/prototipos/home.html'] = renderOk(['Cadastro de cliente'])

    await service.gerarArquitetura(PROJETO, 'jarvis')

    const texto = readFileSync(join(raiz, 'docs/ARCHITECTURE.md'), 'utf8')
    expect(texto).toContain('Cadastro de cliente')
    expect(texto).not.toContain('Relatório financeiro')
  })

  it('cada afirmação carrega a marca de origem no arquivo', async () => {
    gravarPrd()
    anexarOMinimo()

    await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(readFileSync(join(raiz, 'docs/ARCHITECTURE.md'), 'utf8')).toContain('<!-- origem:')
  })

  /** Critério 6: o pacote registra os hashes de todos os anexos e saídas. */
  it('registra os hashes dos anexos e das saídas', async () => {
    gravarPrd()
    anexarOMinimo()

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.pacote?.anexos.every((a) => a.hash.length === 64)).toBe(true)
    expect(r.pacote?.documentos.every((d) => d.hash.length === 64)).toBe(true)
    // E o TESTING cita os anexos por hash, não só por nome.
    expect(readFileSync(join(raiz, 'docs/TESTING.md'), 'utf8')).toContain('sha256:')
  })

  /**
   * O achado que é **pergunta** não barra a geração — ele fica registrado como questão em
   * aberto. É o critério 2 tomando forma de documento: "o PI viu e seguiu" e "ninguém percebeu"
   * precisam ser distinguíveis depois do fato.
   *
   * O caminho exercitado é o estado ausente, e não a tela do PRD sem par: aquela comparação foi
   * removida quando o E2E mostrou que o Escopo do PRD carrega decisões, não nomes de tela (ver
   * `telasDoPrd`). Um teste sobre um caminho que não existe mais provaria o dublê, não o produto.
   */
  it('os achados que não impedem viram questões em aberto no DECISIONS', async () => {
    gravarPrd()
    service.anexar(PROJETO, 'design-system', arquivoExterno('DESIGN-SYSTEM.md'), 'jarvis')
    service.anexar(PROJETO, 'prototipo', arquivoExterno('home.html', '<h1>x</h1>'), 'jarvis')
    // Protótipo que abre e mostra conteúdo, mas não cobre o estado de bloqueio.
    renders['docs/prototipos/home.html'] = {
      carregou: true,
      errosDeConsole: [],
      elementosVisiveis: 10,
      jornadas: ['Início', 'Lista vazia', 'Carregando', 'Erro']
    }

    const r = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(r.reason).toBe('gerada')
    expect(r.achados?.some((a) => a.id.includes('estado-ausente:bloqueio'))).toBe(true)
    expect(readFileSync(join(raiz, 'docs/DECISIONS.md'), 'utf8')).toContain('bloqueio')
  })

  /**
   * Cada marco no ato que ele registra: `design-anexado` quando o arquivo do PI entra,
   * `arquitetura-aprovada` quando a revisão sai.
   *
   * Os dois em sequência no mesmo ponto era o desenho inicial, e o E2E mostrou que estava
   * errado: o primeiro commit levava tudo e o segundo não tinha o que commitar, deixando a
   * revisão sem hash de commit. Aqui o `ProjectService` é dublê e sempre diz "commitado" — por
   * isso este teste checa a **ordem e a origem** de cada marco, que é o que ele consegue provar;
   * que o commit realmente sai é do E2E.
   */
  it('emite design-anexado no ato e arquitetura-aprovada na geração', async () => {
    gravarPrd()
    anexarOMinimo()

    // Dois anexos ⇒ dois marcos de design, antes de qualquer geração.
    expect(marcos).toEqual(['design-anexado', 'design-anexado'])

    await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(marcos).toEqual(['design-anexado', 'design-anexado', 'arquitetura-aprovada'])
  })

  it('regerar o mesmo conteúdo é a mesma revisão', async () => {
    gravarPrd()
    anexarOMinimo()

    const primeira = await service.gerarArquitetura(PROJETO, 'jarvis')
    const segunda = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(segunda.pacote?.hash).toBe(primeira.pacote?.hash)
    expect(arquiteturasNoBanco()).toBe(1)
  })

  /**
   * O motivo de os anexos entrarem no hash: dois pacotes com o mesmo texto mas anexos
   * diferentes **não** são a mesma revisão, e colidir no UNIQUE apagaria a diferença.
   */
  it('trocar o anexo muda o hash, mesmo com o mesmo texto', async () => {
    gravarPrd()
    anexarOMinimo()
    const primeira = await service.gerarArquitetura(PROJETO, 'jarvis')

    const origem = arquivoExterno('home.html', '<h1>outro conteúdo</h1>')
    service.anexar(PROJETO, 'prototipo', origem, 'jarvis')
    const segunda = await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(segunda.pacote?.hash).not.toBe(primeira.pacote?.hash)
  })

  it('gera AuditEvent da arquitetura com o ponteiro para o PRD', async () => {
    const prdId = gravarPrd()
    anexarOMinimo()

    await service.gerarArquitetura(PROJETO, 'jarvis')

    const evento = audit
      .list(USER)
      .find(
        (e) =>
          e.type === 'design-anexo' &&
          (e.payload as Record<string, unknown>).fase === 'arquitetura-gerada'
      )
    expect((evento?.payload as Record<string, unknown>).pacoteEstruturalId).toBe(prdId)
  })

  it('a cadeia de auditoria continua íntegra', async () => {
    gravarPrd()
    anexarOMinimo()

    await service.gerarArquitetura(PROJETO, 'jarvis')

    expect(audit.verify(USER).ok).toBe(true)
  })
})

describe('hashDaArquitetura', () => {
  it('muda quando um anexo muda, com os mesmos documentos', () => {
    const docs = [
      {
        documento: 'ARCHITECTURE',
        caminho: 'a',
        conteudo: 'x',
        hash: 'd'.repeat(64),
        afirmacoes: []
      }
    ]
    const anexo = {
      id: 'i',
      user_id: USER,
      workspace_id: 'jarvis' as const,
      projectId: PROJETO,
      tipo: 'prototipo' as const,
      caminho: 'docs/prototipos/home.html',
      origem: 'C:/x',
      bytes: 1,
      anexadoEm: 'agora'
    }

    const um = hashDaArquitetura(docs, [{ ...anexo, hash: 'a'.repeat(64) }])
    const outro = hashDaArquitetura(docs, [{ ...anexo, hash: 'b'.repeat(64) }])

    expect(um).not.toBe(outro)
  })

  it('não depende da ordem em que os anexos chegam', () => {
    const docs = [
      {
        documento: 'ARCHITECTURE',
        caminho: 'a',
        conteudo: 'x',
        hash: 'd'.repeat(64),
        afirmacoes: []
      }
    ]
    const base = {
      id: 'i',
      user_id: USER,
      workspace_id: 'jarvis' as const,
      projectId: PROJETO,
      tipo: 'asset' as const,
      origem: 'C:/x',
      bytes: 1,
      anexadoEm: 'agora'
    }
    const a = { ...base, caminho: 'a.png', hash: 'a'.repeat(64) }
    const b = { ...base, caminho: 'b.png', hash: 'b'.repeat(64) }

    expect(hashDaArquitetura(docs, [a, b])).toBe(hashDaArquitetura(docs, [b, a]))
  })
})
