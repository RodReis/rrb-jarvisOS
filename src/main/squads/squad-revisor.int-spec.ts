/**
 * A revisão independente contra Git e SQLite reais (SPEC-Squads-04, critérios 2, 3, 4 e 6).
 *
 * Git de verdade (o diff e o arquivo vêm do commit), banco de verdade (os achados e o ciclo de
 * vida moram no `AchadoRepository`) e um agente dublê: o que precisa ser provado é que o kernel
 * confere cada achado no arquivo, deduplica por assinatura, revalida pelo resultado novo e não
 * resolve conflito entre revisores por voto.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { montarAmbienteDeGit, temGit, USUARIO_DE_TESTE, WORKSPACE_DE_TESTE } =
  await import('./squad-fixture-git')
const { RevisorService } = await import('./squad-revisor')
const { AchadoRepository } = await import('./achado-repository')

const comGit = temGit() ? describe : describe.skip

type Amb = ReturnType<typeof montarAmbienteDeGit>
type Pedido = Parameters<InstanceType<typeof RevisorService>['revisar']>[0]
type Fontes = readonly { caminho: string; texto: string }[]

let amb: Amb
let repo: InstanceType<typeof AchadoRepository>
let chamadas: AiRequest[]
let responder: (request: AiRequest) => unknown
let fontesDoPack: Fontes
let contextoRecusa: string | undefined

const ia = {
  call(request: AiRequest): AsyncIterable<AiStreamEvent> {
    chamadas.push(request)
    return (async function* () {
      const resposta = responder(request)
      if (resposta instanceof Error) {
        yield { tipo: 'fim', id: 'x', estado: 'falhou', erro: resposta.message } as AiStreamEvent
        return
      }
      yield { tipo: 'chunk', id: 'x', texto: JSON.stringify(resposta) } as AiStreamEvent
      yield { tipo: 'fim', id: 'x', estado: 'concluido' } as AiStreamEvent
    })()
  }
}

const contexto = {
  montarDaTarefa: vi.fn((pedido: { fontes: Fontes }) => {
    fontesDoPack = pedido.fontes
    return contextoRecusa === undefined
      ? { pack: { id: 'pack-1', hash: 'h', itens: [] } }
      : { reason: contextoRecusa, mensagem: 'recusado' }
  })
}

beforeEach(() => {
  amb = montarAmbienteDeGit()
  repo = new AchadoRepository(amb.db)
  chamadas = []
  fontesDoPack = []
  contextoRecusa = undefined
  responder = () => new Error('nenhuma resposta combinada')
})

afterEach(() => {
  amb.limpar()
})

function servico() {
  return new RevisorService({
    git: amb.squadGit,
    contexto: contexto as never,
    ia,
    achados: repo,
    audit: amb.audit,
    userId: () => USUARIO_DE_TESTE,
    workspaceId: () => WORKSPACE_DE_TESTE
  })
}

const REVISORES = [
  { id: 'rev-1', modelo: { provider: 'codex', modelo: 'rev-1' } },
  { id: 'rev-2', modelo: { provider: 'gemini', modelo: 'rev-2' } }
] as const

/** O resultado: um commit sobre a base com o arquivo dado. */
function resultado(arquivos: Record<string, string>, nome = 'r'): string {
  return amb.commitarComo(amb.worktree(nome), arquivos, 'resultado integrado')
}

function pedido(resultadoSha: string, extra: Partial<Pedido> = {}): Pedido {
  return {
    runId: 'run-1',
    projectId: 'p-1',
    repositorio: amb.repo,
    baseSha: amb.baseSha,
    resultadoSha,
    rota: 'claude-code',
    revisores: [REVISORES[0]],
    spec: { caminho: 'docs/spec/x.md', texto: '# SPEC\nCritério 1.' },
    contratoDeRevisao: '# REVIEW\nP0 e P1 bloqueiam.',
    manifesto: 'manifesto: 2 preservados',
    testes: 'suíte verde: 10 testes',
    rodada: 1,
    ...extra
  }
}

const achado = (extra: Record<string, unknown> = {}) => ({
  categoria: 'corretude',
  severidade: 'P1',
  titulo: 'O parser perde o último item',
  arquivo: 'src/a.ts',
  trecho: 'items.slice(0, -1)',
  impacto: 'Dado perdido em listas com vírgula final.',
  correcao: 'Usar items.slice().',
  foraDaSpec: false,
  ...extra
})

const parecer = (
  achados: unknown[] = [],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  schema: 'parecer-de-revisao@1',
  parecer: achados.length > 0 ? 'FIX_REQUIRED' : 'PASS',
  achados,
  observacoes: [],
  contestacoes: [],
  ...extra
})

const COM_BUG = { 'src/a.ts': 'export const f = (items) => items.slice(0, -1)\n' }
const SEM_BUG = { 'src/a.ts': 'export const f = (items) => items.slice()\n' }

comGit('revisão com achados', () => {
  it('sem achado: PASS, e nada é registrado', async () => {
    responder = () => parecer()

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({ estado: 'revisada', veredito: { resultado: 'PASS' }, achados: [] })
    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')).toEqual([])
  })

  it('achado bloqueante com trecho no arquivo: FIX_REQUIRED, registrado e aceito para o escritor', async () => {
    responder = () => parecer([achado()])

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'FIX_REQUIRED' },
      novos: 1
    })
    const [registrado] = repo.listar(USUARIO_DE_TESTE, 'run-1')
    expect(registrado).toMatchObject({ estado: 'accepted', severidade: 'P1', vistoPor: ['rev-1'] })
    expect(registrado?.assinatura).toMatch(/^[0-9a-f]{64}$/)
  })

  it('critério 2: o mesmo problema dito de dois jeitos por dois revisores é uma assinatura só', async () => {
    responder = (req) =>
      parecer([
        req.model === 'rev-1'
          ? achado()
          : achado({ titulo: 'Perda do último elemento', trecho: '  ITEMS.slice(0,-1) ' })
      ])

    const r = await servico().revisar(pedido(resultado(COM_BUG), { revisores: [...REVISORES] }))

    expect(r.estado).toBe('revisada')
    const lista = repo.listar(USUARIO_DE_TESTE, 'run-1')
    expect(lista).toHaveLength(1)
    expect(lista[0]?.vistoPor).toEqual(['rev-1', 'rev-2'])
  })

  it('achado cujo trecho não está no arquivo é observação: não é defeito confirmado', async () => {
    responder = () => parecer([achado({ trecho: 'linha que não existe' })])

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({ estado: 'revisada', veredito: { resultado: 'PASS' }, achados: [] })
    if (r.estado === 'revisada') expect(r.observacoes[0]).toContain('sem localização verificável')
  })

  it('P2 e P3 são registrados e não bloqueiam; fora da SPEC não bloqueia nem volta ao escritor', async () => {
    responder = () =>
      parecer([
        achado({ severidade: 'P2' }),
        achado({ severidade: 'P1', foraDaSpec: true, trecho: 'export const f' })
      ])

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({ estado: 'revisada', veredito: { resultado: 'PASS' } })
    const lista = repo.listar(USUARIO_DE_TESTE, 'run-1')
    expect(lista).toHaveLength(2)
    expect(lista.every((a) => a.estado === 'open')).toBe(true)
  })

  it('o veredito é do kernel: o parecer PASS do agente com achado bloqueante verificado não vale', async () => {
    responder = () => parecer([achado()], { parecer: 'PASS' })

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({ estado: 'revisada', veredito: { resultado: 'FIX_REQUIRED' } })
  })
})

comGit('revalidação entre rodadas', () => {
  it('critério 3: achado corrigido muda de estado pela revalidação objetiva, sem ninguém dizer', async () => {
    responder = () => parecer([achado()])
    await servico().revisar(pedido(resultado(COM_BUG, 'r1')))
    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')[0]?.estado).toBe('accepted')

    responder = () => parecer()
    const r = await servico().revisar(pedido(resultado(SEM_BUG, 'r2'), { rodada: 2 }))

    expect(r).toMatchObject({ estado: 'revisada', veredito: { resultado: 'PASS' } })
    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')[0]).toMatchObject({
      estado: 'fixed',
      motivoDoEstado: 'trecho-removido'
    })
  })

  it('achado persistente não vira achado novo: mesma assinatura, vista de novo', async () => {
    responder = () => parecer([achado()])
    await servico().revisar(pedido(resultado(COM_BUG, 'r1')))

    const r = await servico().revisar(pedido(resultado(COM_BUG, 'r2'), { rodada: 2 }))

    expect(r).toMatchObject({ estado: 'revisada', novos: 0 })
    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')).toHaveLength(1)
  })

  it('achado corrigido que volta num delta novo reabre, e conta a reabertura', async () => {
    responder = () => parecer([achado()])
    await servico().revisar(pedido(resultado(COM_BUG, 'r1')))
    responder = () => parecer()
    await servico().revisar(pedido(resultado(SEM_BUG, 'r2'), { rodada: 2 }))
    responder = () => parecer([achado()])

    await servico().revisar(pedido(resultado(COM_BUG, 'r3'), { rodada: 3 }))

    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')[0]).toMatchObject({
      estado: 'accepted',
      reaberturas: 1
    })
  })
})

comGit('conflito entre revisores', () => {
  it('critério 6: contestar sem evidência conclusiva não resolve por voto — o run para', async () => {
    responder = () => parecer([achado()])
    await servico().revisar(pedido(resultado(COM_BUG, 'r1')))
    const [existente] = repo.listar(USUARIO_DE_TESTE, 'run-1')
    responder = (req) =>
      req.model === 'rev-2'
        ? parecer([], {
            contestacoes: [{ assinatura: existente?.assinatura, motivo: 'não é bug' }]
          })
        : parecer()

    const r = await servico().revisar(
      pedido(resultado(COM_BUG, 'r2'), { rodada: 2, revisores: [...REVISORES] })
    )

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'BLOCKED', motivo: 'conflito-entre-revisores' }
    })
    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')[0]).toMatchObject({
      estado: 'accepted',
      contestadoPor: ['rev-2']
    })
  })

  it('contestação de assinatura que o kernel não conhece é ignorada', async () => {
    responder = () => parecer([], { contestacoes: [{ assinatura: 'inventada', motivo: 'x' }] })

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({ estado: 'revisada', veredito: { resultado: 'PASS' } })
  })

  it('revisor que declara BLOCKED para o run: o kernel não passa por cima', async () => {
    responder = () => parecer([], { parecer: 'BLOCKED', observacoes: ['não consegui ler o diff'] })

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'BLOCKED', motivo: 'revisor-bloqueou' }
    })
  })
})

comGit('revisão sem parecer', () => {
  it('nenhum parecer válido: BLOCKED, e os achados anteriores ficam como estavam', async () => {
    responder = () => parecer([achado()])
    await servico().revisar(pedido(resultado(COM_BUG, 'r1')))
    responder = () => ({ texto: 'achei tudo bom' })

    const r = await servico().revisar(pedido(resultado(COM_BUG, 'r2'), { rodada: 2 }))

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'BLOCKED', motivo: 'revisao-sem-parecer' },
      revisores: [{ id: 'rev-1', estado: 'invalido' }]
    })
    expect(repo.listar(USUARIO_DE_TESTE, 'run-1')[0]?.estado).toBe('accepted')
  })

  it('um revisor inválido e outro válido: a revisão segue com o que tem parecer', async () => {
    responder = (req) => (req.model === 'rev-1' ? { lixo: true } : parecer())

    const r = await servico().revisar(pedido(resultado(COM_BUG), { revisores: [...REVISORES] }))

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'PASS' },
      revisores: [
        { id: 'rev-1', estado: 'invalido' },
        { id: 'rev-2', estado: 'parecer' }
      ]
    })
  })

  it('falha da chamada é estado do revisor, e sem outro parecer o run para', async () => {
    responder = () => new Error('provider fora do ar')

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'BLOCKED', motivo: 'revisao-sem-parecer' },
      revisores: [{ id: 'rev-1', estado: 'falhou' }]
    })
  })

  it('cancelado de fora: estado cancelado, e o run para', async () => {
    const controle = new AbortController()
    controle.abort()
    responder = () => parecer()

    const r = await servico().revisar(pedido(resultado(COM_BUG), { signal: controle.signal }))

    expect(r).toMatchObject({
      estado: 'revisada',
      veredito: { resultado: 'BLOCKED' },
      revisores: [{ id: 'rev-1', estado: 'cancelado' }]
    })
  })
})

comGit('o que o revisor recebe', () => {
  it('SPEC, contrato, diff, arquivo, manifesto, testes e achados abertos; sem Git nem ferramenta', async () => {
    responder = () => parecer([achado()])
    await servico().revisar(pedido(resultado(COM_BUG, 'r1')))
    responder = () => parecer()

    await servico().revisar(pedido(resultado(COM_BUG, 'r2'), { rodada: 2 }))

    const caminhos = fontesDoPack.map((f) => f.caminho)
    expect(caminhos).toEqual(
      expect.arrayContaining([
        'docs/REVIEW.md',
        'docs/spec/x.md',
        'revisao/manifesto.txt',
        'revisao/testes.txt',
        'revisao/achados-abertos.json',
        'revisao/diff/src/a.ts.patch',
        'src/a.ts'
      ])
    )
    const abertos = fontesDoPack.find((f) => f.caminho === 'revisao/achados-abertos.json')?.texto
    expect(abertos).toContain('"estado": "accepted"')
    expect(abertos).toContain('"assinatura"')
    const [, segunda] = chamadas
    expect(segunda?.fase).toBe('planejamento')
    expect(segunda?.jsonSchema).toContain('parecer-de-revisao@1')
    expect(segunda?.tentativa).toBe(2)
    expect(segunda?.system).toContain('não tem Git')
  })

  it('o diff vem do Git real: só o que mudou contra a base', async () => {
    responder = () => parecer()

    await servico().revisar(pedido(resultado(COM_BUG)))

    const diff = fontesDoPack.find((f) => f.caminho === 'revisao/diff/src/a.ts.patch')?.texto
    expect(diff).toContain('+export const f = (items) => items.slice(0, -1)')
    expect(diff).toContain('-export const a = 1')
  })
})

comGit('pedido que não cabe', () => {
  it('sem revisor, a revisão não existe: o run para em vez de aprovar sozinho', async () => {
    const r = await servico().revisar(pedido(resultado(COM_BUG), { revisores: [] }))

    expect(r).toEqual({ estado: 'parada', motivo: 'sem-revisor' })
  })

  it('delta grande demais para uma fonte: para, em vez de revisar um diff cortado', async () => {
    const grande = 'x'.repeat(300 * 1024)

    const r = await servico().revisar(pedido(resultado({ 'src/grande.ts': grande })))

    expect(r).toMatchObject({ estado: 'parada', motivo: 'delta-grande-demais' })
    expect(chamadas).toHaveLength(0)
  })

  it('contexto recusado (segredo no diff) para a revisão', async () => {
    contextoRecusa = 'segredo-no-contexto'

    const r = await servico().revisar(pedido(resultado(COM_BUG)))

    expect(r).toMatchObject({
      estado: 'parada',
      motivo: 'contexto-recusado',
      detalhe: 'segredo-no-contexto'
    })
    expect(chamadas).toHaveLength(0)
  })

  it('modelo local sem janela de contexto é recusado antes de rodar', async () => {
    const r = await servico().revisar(
      pedido(resultado(COM_BUG), {
        revisores: [{ id: 'rev-l', modelo: { provider: 'ollama', modelo: 'qwen3:8b' } }]
      })
    )

    expect(r).toMatchObject({ estado: 'parada', motivo: 'modelo-local-sem-janela' })
  })

  it('commit do resultado que não existe: para, sem exceção', async () => {
    const r = await servico().revisar(pedido('0'.repeat(40)))

    expect(r.estado).toBe('parada')
  })
})

comGit('auditoria', () => {
  it('registra início e fim com ids e contagens, sem o texto do achado nem do código', async () => {
    responder = () => parecer([achado()])

    await servico().revisar(pedido(resultado(COM_BUG)))

    const eventos = amb.audit.list(USUARIO_DE_TESTE).filter((e) => e.type === 'squad-revisao')
    expect(eventos.map((e) => (e.payload as { marco: string }).marco)).toEqual(['inicio', 'fim'])
    const texto = JSON.stringify(eventos.map((e) => e.payload))
    expect(texto).toContain('"veredito":"FIX_REQUIRED"')
    expect(texto).not.toContain('slice')
    expect(texto).not.toContain('perde o último item')
  })

  it('o repositório do projeto não é tocado pela revisão', async () => {
    responder = () => parecer()
    const sha = resultado(COM_BUG)

    await servico().revisar(pedido(sha))

    expect(amb.git(['rev-parse', 'main'])).toBe(amb.baseSha)
    expect(amb.git(['status', '--porcelain'])).toBe('')
  })
})
