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
import type { RenderDoPrototipo } from '@shared/domain/validacao-de-prototipo'
import { achadosQueImpedem } from '@shared/domain/validacao-de-prototipo'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('./project-repository')
const { AnexoRepository } = await import('./anexo-repository')
const { AnexoService } = await import('./anexo-service')

const USER = 'u-1'
const PROJETO = 'p-1'


let dir: string
let raiz: string
let externo: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let projects: InstanceType<typeof ProjectRepository>
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



function anexosNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM design_attachment').get() as { n: number }).n
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
    audit,
    userId: () => USER,
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
   * O mesmo fato, medido **sobre o que a geração lê**.
   *
   * O teste acima consulta `pendencias()`, que é o que a tela chama; este mede a lista de anexos
   * **registrados**, que é de onde o `ArquiteturaService` calcula o gate. A distinção não é
   * redundância: um contrafactual que fez o gate contar arquivo do disco **passou** com o teste
   * anterior sozinho. Uma garantia só vale onde a decisão acontece.
   */
  it('arquivo largado por fora não entra na lista que a geração lê', () => {
    mkdirSync(join(raiz, 'docs/prototipos'), { recursive: true })
    writeFileSync(join(raiz, 'docs/DESIGN-SYSTEM.md'), '# largado', 'utf8')
    writeFileSync(join(raiz, 'docs/prototipos/home.html'), '<h1>largado</h1>', 'utf8')

    expect(service.listar(PROJETO)).toHaveLength(0)
    expect(service.pendencias(PROJETO)).toEqual(['design-system', 'prototipo'])
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

describe('a validação dos protótipos (SPEC-Planejamento-05, critério 2)', () => {
  /**
   * O parser toca o disco de verdade: a pergunta "este asset existe sob o projeto?" só tem
   * resposta lá. Um asset referenciado e não anexado produz achado que impede a arquitetura — e
   * é o `ArquiteturaService` que lê este resultado antes de chamar o modelo.
   */
  it('asset referenciado e não anexado impede — parser sobre o disco real', async () => {
    anexarOMinimo('<h1>Início</h1><img src="assets/logo.png">')

    const impedem = achadosQueImpedem(await service.validar(PROJETO))

    expect(impedem.some((a) => a.evidencia.includes('assets/logo.png'))).toBe(true)
  })

  it('o mesmo asset, uma vez anexado, deixa de impedir', async () => {
    anexarOMinimo('<h1>Início</h1><img src="assets/logo.png">')
    service.anexar(PROJETO, 'asset', arquivoExterno('logo.png', 'png'), 'jarvis')

    expect(achadosQueImpedem(await service.validar(PROJETO))).toHaveLength(0)
  })

  it('referência remota não impede', async () => {
    anexarOMinimo('<h1>Início</h1><link href="https://cdn.test/a.css">')

    expect(achadosQueImpedem(await service.validar(PROJETO))).toHaveLength(0)
  })

  it('protótipo que não abre impede, com pergunta e recomendação', async () => {
    anexarOMinimo('<h1>Início</h1>')
    renders['docs/prototipos/home.html'] = {
      carregou: false,
      errosDeConsole: ['Uncaught ReferenceError'],
      elementosVisiveis: 0,
      jornadas: []
    }

    const impedem = achadosQueImpedem(await service.validar(PROJETO))

    expect(impedem).not.toHaveLength(0)
    expect(impedem[0]?.pergunta).not.toBe('')
    expect(impedem[0]?.recomendacao).not.toBe('')
  })

  it('as jornadas do protótipo saem da validação — é o que a âncora da arquitetura cita', async () => {
    anexarOMinimo('<h1>Início</h1>')

    const validacoes = await service.validar(PROJETO)

    expect(validacoes[0]?.jornadasCobertas).toContain('Início')
  })
})
