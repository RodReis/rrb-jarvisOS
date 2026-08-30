/**
 * Contexto, skills e orçamento antes da IA (SPEC-Planejamento-02, categoria Banco).
 *
 * A prova é **por efeito**, como na M8-F01: não basta o serviço dizer que recusou o pack — o
 * banco tem de confirmar que nenhuma linha foi gravada, e o disco tem de confirmar que o hash
 * do item corresponde ao arquivo que existia no momento do envio. Verificar só o
 * `ContextPackOutcome` provaria que o serviço relata o que pretendia fazer, não o que fez.
 *
 * **Arquivos de verdade, em diretório temporário.** O ponto da fatia é o manifesto descrever o
 * que saiu da máquina, e um dublê de filesystem testaria a nossa imitação de leitura em vez da
 * leitura. Os arquivos são escritos aqui e lidos pelo serviço, como em produção.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidatoDeContexto, PedidoDeContexto } from './context-service'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ProjectRepository } = await import('../projects/project-repository')
const { ContextRepository } = await import('./context-repository')
const { ContextService, fingerprintDaFalha, hashDoPack } = await import('./context-service')

const USER = 'u-1'
const PROJETO = 'p-1'

let dir: string
let raiz: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let repository: InstanceType<typeof ContextRepository>
let service: InstanceType<typeof ContextService>

/** Escreve um arquivo sob a raiz do projeto, criando os diretórios do caminho. */
function escrever(caminho: string, conteudo: string): void {
  const alvo = join(raiz, caminho)
  mkdirSync(dirname(alvo), { recursive: true })
  writeFileSync(alvo, conteudo, 'utf8')
}

function candidato(parcial: Partial<CandidatoDeContexto> = {}): CandidatoDeContexto {
  return {
    caminho: 'docs/PRD.md',
    origem: 'explicito',
    motivo: 'anexado pelo usuário',
    ...parcial
  }
}

function pedido(parcial: Partial<PedidoDeContexto> = {}): PedidoDeContexto {
  return {
    projectId: PROJETO,
    tarefa: 'SPEC-Planejamento-02',
    etapa: 'contexto',
    candidatos: [candidato()],
    rota: 'anthropic',
    ...parcial
  }
}

/** Monta o serviço, opcionalmente com skills instaladas (o padrão é **nenhuma**). */
function montar(skills: readonly { id: string; capacidades: readonly never[] }[] = []): void {
  service = new ContextService({
    repository,
    projects: new ProjectRepository(db),
    audit,
    userId: () => USER,
    skills: () => skills
  })
}

function packsNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM context_pack').get() as { n: number }).n
}

function itensNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM context_item').get() as { n: number }).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-ctx-'))
  raiz = join(dir, 'projeto')
  mkdirSync(raiz, { recursive: true })
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  repository = new ContextRepository(db)

  new ProjectRepository(db).save({
    id: PROJETO,
    user_id: USER,
    workspace_id: 'jarvis',
    nome: 'Projeto de teste',
    slug: 'projeto-de-teste',
    diretorio: raiz,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })

  escrever('docs/PRD.md', '# PRD\n\nO produto faz X.\n')
  montar()
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('manifesto e hashes (critério 2)', () => {
  it('monta o pack com o hash do conteúdo exato de cada arquivo', () => {
    const desfecho = service.montar(pedido(), 'jarvis')

    expect(desfecho.reason).toBe('montado')
    expect(desfecho.pack?.itens).toHaveLength(1)
    // 64 hex = SHA-256. O que importa não é o formato: é que o hash **existe por item**, que é
    // o que torna "esta geração viu esta revisão?" respondível meses depois.
    expect(desfecho.pack?.itens[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(desfecho.pack?.itens[0]?.bytes).toBeGreaterThan(0)
  })

  it('o hash do item muda quando o arquivo muda — é a revisão, não o caminho', () => {
    const antes = service.montar(pedido(), 'jarvis').pack?.itens[0]?.hash

    escrever('docs/PRD.md', '# PRD\n\nO produto faz Y agora.\n')
    const depois = service.montar(pedido(), 'jarvis').pack?.itens[0]?.hash

    expect(antes).not.toBe(depois)
  })

  it('o pack é recuperável pelo id, com os itens na ordem em que foram enviados', () => {
    escrever('docs/ARQ.md', '# Arquitetura\n')
    escrever('docs/CONV.md', '# Convenções\n')

    const montado = service.montar(
      pedido({
        candidatos: [
          candidato({ caminho: 'docs/ARQ.md' }),
          candidato({ caminho: 'docs/PRD.md' }),
          candidato({ caminho: 'docs/CONV.md' })
        ]
      }),
      'jarvis'
    )

    const lido = service.buscar(montado.pack?.id ?? '')

    // A ordem **é** o dado: o contexto foi montado numa sequência, e reproduzir o envio exige
    // reproduzi-la. Sem a coluna de ordem, o SELECT devolveria o que o SQLite achasse melhor.
    expect(lido?.itens.map((i) => i.caminho)).toEqual([
      'docs/ARQ.md',
      'docs/PRD.md',
      'docs/CONV.md'
    ])
  })

  it('o mesmo conteúdo produz o mesmo hash de pack; um item a mais, outro', () => {
    escrever('docs/ARQ.md', '# Arquitetura\n')

    const base = service.montar(pedido(), 'jarvis').pack
    const igual = service.montar(pedido(), 'jarvis').pack
    const diferente = service.montar(
      pedido({ candidatos: [candidato(), candidato({ caminho: 'docs/ARQ.md' })] }),
      'jarvis'
    ).pack

    expect(base?.hash).toBe(igual?.hash)
    expect(base?.hash).not.toBe(diferente?.hash)
  })

  it('o hash canônico distingue rota de assinatura de custo zero', () => {
    // `null` (não se converte em USD) e `0` (custou zero) são estados diferentes, e o hash tem
    // de separá-los — senão dois manifestos que dizem coisas distintas colidiriam.
    const comum = {
      user_id: USER,
      workspace_id: 'jarvis' as const,
      projectId: PROJETO,
      tarefa: 't',
      itens: [],
      regras: [],
      falhasAbertas: [],
      rota: 'anthropic' as const
    }

    const unmetered = hashDoPack({
      ...comum,
      orcamento: {
        etapa: 'e',
        unmetered: true,
        tetoDeTokens: 100,
        tokensEstimados: 10,
        estimadoUsd: null
      }
    })
    const zero = hashDoPack({
      ...comum,
      orcamento: {
        etapa: 'e',
        unmetered: false,
        tetoDeTokens: 100,
        tokensEstimados: 10,
        estimadoUsd: 0
      }
    })

    expect(unmetered).not.toBe(zero)
  })
})

describe('leitura ampla exige exceção visível (critério 3)', () => {
  it('recusa leitura ampla sem exceção registrada', () => {
    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ origem: 'leitura-ampla' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('leitura-ampla-sem-excecao')
    // Nada gravado: a recusa acontece **antes** da escrita, então não há manifesto parcial.
    expect(packsNoBanco()).toBe(0)
    expect(itensNoBanco()).toBe(0)
  })

  it('aceita leitura ampla com exceção, e a exceção fica visível no manifesto', () => {
    const desfecho = service.montar(
      pedido({
        candidatos: [candidato({ origem: 'leitura-ampla' })],
        excecaoDeLeituraAmpla: {
          motivo: 'investigação de regressão sem localização conhecida',
          tetoDeBytes: 10_000,
          autorizadoPor: USER,
          autorizadoEm: new Date().toISOString()
        }
      }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('montado')
    // Visível: o motivo e o teto atravessam a persistência, não só a decisão em memória.
    const lido = service.buscar(desfecho.pack?.id ?? '')
    expect(lido?.excecaoDeLeituraAmpla?.motivo).toContain('regressão')
    expect(lido?.excecaoDeLeituraAmpla?.tetoDeBytes).toBe(10_000)
  })

  it('recusa quando a leitura ampla passa do teto que a exceção autorizou', () => {
    escrever('docs/GRANDE.md', 'x'.repeat(5_000))

    const desfecho = service.montar(
      pedido({
        candidatos: [candidato({ caminho: 'docs/GRANDE.md', origem: 'leitura-ampla' })],
        excecaoDeLeituraAmpla: {
          motivo: 'motivo qualquer',
          tetoDeBytes: 100,
          autorizadoPor: USER,
          autorizadoEm: new Date().toISOString()
        }
      }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('teto-da-excecao-excedido')
    expect(packsNoBanco()).toBe(0)
  })

  it('seleção dirigida não exige exceção — a exceção é para leitura ampla, não para tudo', () => {
    // O contrafactual: se este teste ficasse vermelho, a exceção teria virado pedágio do
    // caminho normal, e o usuário aprenderia a registrá-la por hábito — esvaziando o critério.
    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ origem: 'busca-estrutural' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('montado')
    expect(desfecho.pack?.excecaoDeLeituraAmpla).toBeUndefined()
  })
})

describe('falha resolvida não reaparece (critério 4)', () => {
  it('o mesmo relato duas vezes incrementa a contagem, não cria segunda falha', () => {
    service.registrarFalha(PROJETO, 'jarvis', 'build', 'typecheck falhou em src/a.ts:12')
    const segunda = service.registrarFalha(
      PROJETO,
      'jarvis',
      'build',
      // Mesma falha, outra linha e outro instante: o fingerprint normaliza os números.
      'typecheck falhou em src/a.ts:47'
    )

    expect(service.listarFalhas(PROJETO)).toHaveLength(1)
    expect(segunda.ocorrencias).toBe(2)
  })

  it('falhas diferentes não colidem', () => {
    service.registrarFalha(PROJETO, 'jarvis', 'build', 'typecheck falhou')
    service.registrarFalha(PROJETO, 'jarvis', 'build', 'lint reprovou por import não usado')

    expect(service.listarFalhas(PROJETO)).toHaveLength(2)
  })

  it('a falha aberta entra no pack; a resolvida não volta', () => {
    service.registrarFalha(PROJETO, 'jarvis', 'build', 'typecheck falhou')
    const resolvida = fingerprintDaFalha('build', 'typecheck falhou')

    const antes = service.montar(pedido(), 'jarvis').pack
    expect(antes?.falhasAbertas.map((f) => f.fingerprint)).toContain(resolvida)

    service.resolverFalha(PROJETO, 'jarvis', resolvida)

    const depois = service.montar(pedido(), 'jarvis').pack
    expect(depois?.falhasAbertas).toHaveLength(0)
  })

  it('falha resolvida que volta a acontecer reabre — regressão não fica escondida', () => {
    service.registrarFalha(PROJETO, 'jarvis', 'build', 'typecheck falhou')
    const fingerprint = fingerprintDaFalha('build', 'typecheck falhou')
    service.resolverFalha(PROJETO, 'jarvis', fingerprint)

    service.registrarFalha(PROJETO, 'jarvis', 'build', 'typecheck falhou')

    const pack = service.montar(pedido(), 'jarvis').pack
    expect(pack?.falhasAbertas.map((f) => f.fingerprint)).toContain(fingerprint)
  })
})

describe('segredos não entram no contexto (critério 7)', () => {
  it('recusa o pack inteiro quando um item carrega credencial', () => {
    escrever('config/.env', 'ANTHROPIC_API_KEY=sk-ant-api03-chave-real-do-usuario\n')

    const desfecho = service.montar(
      pedido({ candidatos: [candidato(), candidato({ caminho: 'config/.env' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('segredo-no-contexto')
    expect(desfecho.caminhosComSegredo).toEqual(['config/.env'])
    // **Nada** gravado: nem o item limpo. Montar sem o arquivo acusado entregaria um contexto
    // silenciosamente diferente do pedido.
    expect(packsNoBanco()).toBe(0)
  })

  it('recusa por conteúdo mesmo quando o nome do arquivo é inocente', () => {
    escrever('docs/notas.md', 'anotei aqui: ghp_abcdefghijklmnopqrstuvwxyz0123456789\n')

    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ caminho: 'docs/notas.md' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('segredo-no-contexto')
  })

  it('a mensagem de recusa não repete o segredo', () => {
    escrever('docs/notas.md', 'chave: sk-ant-api03-nao-pode-aparecer-em-lugar-nenhum\n')

    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ caminho: 'docs/notas.md' })] }),
      'jarvis'
    )

    // A mensagem é o caminho por onde o segredo escaparia para a tela e para o log.
    expect(JSON.stringify(desfecho)).not.toContain('sk-ant')
  })

  it('a auditoria da recusa registra o caminho, nunca o conteúdo', () => {
    escrever('config/.env', 'SENHA_DO_BANCO=umaSenhaBemLonga123\n')

    service.montar(pedido({ candidatos: [candidato({ caminho: 'config/.env' })] }), 'jarvis')

    const eventos = audit.list(USER).filter((e) => e.type === 'context-pack')
    expect(JSON.stringify(eventos)).toContain('config/.env')
    expect(JSON.stringify(eventos)).not.toContain('umaSenhaBemLonga123')
  })

  it('arquivo limpo passa — o detector não grita em tudo', () => {
    // Contrafactual do critério 7: um detector que acusasse todo arquivo deixaria a suíte
    // verde e o app inútil.
    expect(service.montar(pedido(), 'jarvis').reason).toBe('montado')
  })
})

describe('orçamento por etapa (critérios 1a e 6)', () => {
  it('a rota paga estima em USD', () => {
    const pack = service.montar(pedido({ rota: 'anthropic' }), 'jarvis').pack

    expect(pack?.orcamento.unmetered).toBe(false)
    expect(pack?.orcamento.estimadoUsd).toBeGreaterThan(0)
  })

  it('a rota de assinatura registra uso sem valor monetário — `null`, não zero', () => {
    const pack = service.montar(pedido({ rota: 'claude-code' }), 'jarvis').pack

    expect(pack?.orcamento.unmetered).toBe(true)
    // `null` porque zero afirmaria "custou nada"; o fato é "não se converte em USD".
    expect(pack?.orcamento.estimadoUsd).toBeNull()
    // O teto de tokens continua valendo: contexto grande custa em janela mesmo sem custar em
    // dinheiro. Sem isto, a rota de assinatura ficaria sem orçamento nenhum.
    expect(pack?.orcamento.tetoDeTokens).toBeGreaterThan(0)
    expect(pack?.orcamento.tokensEstimados).toBeGreaterThan(0)
  })

  it('o `null` do orçamento atravessa a persistência', () => {
    const id = service.montar(pedido({ rota: 'claude-code' }), 'jarvis').pack?.id ?? ''

    expect(service.buscar(id)?.orcamento.estimadoUsd).toBeNull()
  })

  it('recusa quando o contexto passa do teto de tokens da etapa', () => {
    escrever('docs/ENORME.md', 'x'.repeat(200_000))

    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ caminho: 'docs/ENORME.md' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('teto-de-tokens-excedido')
    expect(packsNoBanco()).toBe(0)
  })

  it('a expansão só vale com motivo — e o motivo fica no manifesto', () => {
    escrever('docs/ENORME.md', 'x'.repeat(200_000))
    const candidatos = [candidato({ caminho: 'docs/ENORME.md' })]

    // Teto maior **sem** motivo: ignorado. O padrão prevalece e a recusa acontece — que é o
    // critério 6 valendo, porque uma expansão sem causa não é expansão, é teto solto.
    const semMotivo = service.montar(pedido({ candidatos, tetoDeTokens: 100_000 }), 'jarvis')
    expect(semMotivo.reason).toBe('teto-de-tokens-excedido')

    const comMotivo = service.montar(
      pedido({
        candidatos,
        tetoDeTokens: 100_000,
        motivoDaExpansao: 'a SPEC inteira é o contexto mínimo desta etapa'
      }),
      'jarvis'
    )
    expect(comMotivo.reason).toBe('montado')
    expect(comMotivo.pack?.orcamento.motivoDaExpansao).toContain('SPEC inteira')
  })
})

describe('skills aceleram, não decidem (critério 5)', () => {
  it('sem nenhuma skill instalada, toda capacidade continua com procedimento', () => {
    const capacidades = service.capacidades()

    expect(capacidades.length).toBeGreaterThan(0)
    for (const capacidade of capacidades) {
      expect(capacidade.meio).toBe('direto')
      expect(capacidade.procedimento.length).toBeGreaterThan(0)
    }
  })

  it('e o gate continua barrando sem skill — a disciplina não estava na ferramenta', () => {
    // O teste que dá sentido ao critério 5. Nenhuma skill instalada (o padrão do `montar`), e
    // a leitura ampla continua exigindo exceção. Se o gate morasse atrás de uma skill, este
    // pack seria montado.
    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ origem: 'leitura-ampla' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('leitura-ampla-sem-excecao')
  })

  it('a auditoria registra por qual meio cada capacidade foi atendida', () => {
    service.montar(pedido(), 'jarvis')

    const evento = audit.list(USER).find((e) => e.type === 'context-pack')
    expect(JSON.stringify(evento?.payload)).toContain(':direto')
  })
})

describe('o contexto não é um leitor de disco', () => {
  it('ignora candidato que tenta sair do diretório do projeto', () => {
    writeFileSync(join(dir, 'fora.md'), '# fora do projeto\n', 'utf8')

    const desfecho = service.montar(
      pedido({ candidatos: [candidato(), candidato({ caminho: '../fora.md' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('montado')
    // O item de fora **não entrou**: o pack descreve o que saiu, e o que saiu ficou dentro do
    // projeto. Sem esta guarda, `../../.ssh/id_rsa` seria um caminho relativo legítimo.
    expect(desfecho.pack?.itens.map((i) => i.caminho)).toEqual(['docs/PRD.md'])
  })

  it('ignora caminho absoluto', () => {
    const desfecho = service.montar(
      pedido({ candidatos: [candidato(), candidato({ caminho: join(dir, 'fora.md') })] }),
      'jarvis'
    )

    expect(desfecho.pack?.itens).toHaveLength(1)
  })

  it('recusa projeto de outro espaço', () => {
    expect(service.montar(pedido(), 'noa').reason).toBe('projeto-desconhecido')
  })

  it('recusa quando nada legível sobrou — pack vazio não é contexto', () => {
    const desfecho = service.montar(
      pedido({ candidatos: [candidato({ caminho: 'docs/nao-existe.md' })] }),
      'jarvis'
    )

    expect(desfecho.reason).toBe('contexto-vazio')
    expect(packsNoBanco()).toBe(0)
  })
})

describe('o manifesto é imutável', () => {
  it('expandir contexto cria outro pack, encadeado ao anterior', () => {
    escrever('docs/ARQ.md', '# Arquitetura\n')
    const primeiro = service.montar(pedido(), 'jarvis').pack

    const segundo = service.montar(
      pedido({
        candidatos: [candidato(), candidato({ caminho: 'docs/ARQ.md' })],
        packAnterior: primeiro?.id
      }),
      'jarvis'
    ).pack

    expect(segundo?.packAnterior).toBe(primeiro?.id)
    // O primeiro continua lá, intacto: é o registro do que a tentativa anterior enviou.
    expect(service.buscar(primeiro?.id ?? '')?.itens).toHaveLength(1)
    expect(packsNoBanco()).toBe(2)
  })

  it('remontar contexto idêntico devolve o mesmo pack, não um segundo', () => {
    // Mesmo conteúdo canônico ⇒ mesmo manifesto. Duas linhas dariam duas identidades ao mesmo
    // envio, e "qual pack esta geração usou?" passaria a ter duas respostas certas.
    const primeiro = service.montar(pedido(), 'jarvis').pack
    const segundo = service.montar(pedido(), 'jarvis').pack

    expect(segundo?.id).toBe(primeiro?.id)
    expect(packsNoBanco()).toBe(1)
  })

  it('a listagem devolve os packs do projeto, do mais recente ao mais antigo', () => {
    escrever('docs/ARQ.md', '# Arquitetura\n')
    service.montar(pedido(), 'jarvis')
    const ultimo = service.montar(
      pedido({ candidatos: [candidato({ caminho: 'docs/ARQ.md' })] }),
      'jarvis'
    ).pack

    expect(service.listar(PROJETO)[0]?.id).toBe(ultimo?.id)
  })
})
