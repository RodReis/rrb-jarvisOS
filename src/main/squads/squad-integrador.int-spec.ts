/**
 * O integrador contra Git real (SPEC-Squads-04, critérios 1 e 4).
 *
 * Git de verdade, pelo `TerminalEngine` de verdade, e um agente dublê: o que precisa ser provado é
 * o acoplamento — que o manifesto de hunks pega o hunk que o integrador deixou perder, que o
 * agente não tem como tocar o Git nem o arquivo, e que o resultado só existe se as três provas
 * (commit do kernel, manifesto conferido, conflito resolvido) fecham.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { montarAmbienteDeGit, temGit, USUARIO_DE_TESTE, WORKSPACE_DE_TESTE } =
  await import('./squad-fixture-git')
const { IntegradorService } = await import('./squad-integrador')
const { IDENTIDADE_DO_KERNEL } = await import('./squad-git')

const comGit = temGit() ? describe : describe.skip

type Amb = ReturnType<typeof montarAmbienteDeGit>
type Pedido = Parameters<InstanceType<typeof IntegradorService>['integrar']>[0]

let amb: Amb
let chamadas: AiRequest[]
let responder: (request: AiRequest) => unknown
let contextoRecusa: string | undefined

/** O agente dublê: devolve o JSON que o teste mandar, no formato do stream do ponto único. */
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
      yield {
        tipo: 'fim',
        id: 'x',
        estado: 'concluido',
        custo: {
          provider: 'claude-code',
          model: 'claude-fable-5-1',
          workspace: WORKSPACE_DE_TESTE,
          estimadoUsd: 0,
          realUsd: 0,
          usage: { tokensEntrada: 20, tokensSaida: 10 },
          latenciaTotalMs: 10,
          unmetered: true
        }
      } as AiStreamEvent
    })()
  }
}

const orcamento = {
  reservarIntegracao: vi.fn(() => ({ permitido: true })),
  registrarConsumo: vi.fn(() => true),
  marcarIndeterminado: vi.fn(),
  liberarAntesDoDispatch: vi.fn()
}
const approvals = { exigir: vi.fn(async () => true) }

const contexto = {
  montarDaTarefa: vi.fn((pedido: { fontes: readonly { caminho: string }[] }) =>
    contextoRecusa === undefined
      ? {
          pack: {
            id: 'pack-1',
            hash: 'h',
            itens: pedido.fontes.map((f) => ({ caminho: f.caminho }))
          }
        }
      : { reason: contextoRecusa, mensagem: 'recusado' }
  )
}

beforeEach(() => {
  amb = montarAmbienteDeGit()
  chamadas = []
  contextoRecusa = undefined
  responder = () => new Error('nenhuma resposta combinada')
  orcamento.reservarIntegracao.mockClear()
  orcamento.registrarConsumo.mockClear()
  orcamento.marcarIndeterminado.mockClear()
  approvals.exigir.mockClear()
})

afterEach(() => {
  amb.limpar()
})

function servico() {
  return new IntegradorService({
    git: amb.squadGit,
    contexto: contexto as never,
    ia,
    audit: amb.audit,
    userId: () => USUARIO_DE_TESTE,
    workspaceId: () => WORKSPACE_DE_TESTE,
    orcamento,
    approvals
  })
}

function pedidoDe(commitA: string, commitB: string): Pedido {
  return {
    runId: 'run-1',
    projectId: 'p-1',
    repositorio: amb.repo,
    baseSha: amb.baseSha,
    escritores: [
      { escritor: 'a', commitSha: commitA },
      { escritor: 'b', commitSha: commitB }
    ],
    worktree: join(amb.appDir, 'wt-integracao'),
    branch: 'jarvis/run-1/integracao',
    modelo: { provider: 'claude-code', modelo: 'claude-fable-5-1' },
    rota: 'claude-code'
  }
}

/** Dois escritores a partir da base, cada um commitado pelo kernel no seu worktree. */
function escritores(a: Record<string, string>, b: Record<string, string>): Pedido {
  const commitA = amb.commitarComo(amb.worktree('a'), a, 'escritor a')
  const commitB = amb.commitarComo(amb.worktree('b'), b, 'escritor b')
  return pedidoDe(commitA, commitB)
}

/** Os dois acrescentam uma linha no mesmo ponto: conflito em que cada lado cabe inteiro no resultado. */
const INSERCOES = {
  a: { 'src/a.ts': 'export const a = 1\nexport const x = 10\n' },
  b: { 'src/a.ts': 'export const a = 1\nexport const y = 20\n' }
}
const JUNTAS = 'export const x = 10\nexport const y = 20'

/** Os dois reescrevem a mesma linha: cada lado só cabe no resultado se for combinado. */
const MESMA_LINHA = {
  a: { 'src/a.ts': 'export const a = 10\n' },
  b: { 'src/a.ts': 'export const a = 20\n' }
}

const naBranch = (arquivo: string): string =>
  amb.git(['show', `jarvis/run-1/integracao:${arquivo}`])

comGit('integração sem conflito', () => {
  it('trabalhos em arquivos diferentes entram sozinhos, sem chamar o agente', async () => {
    const pedido = escritores(
      { 'src/a.ts': 'export const a = 10\n' },
      { 'src/b.ts': 'export const b = 20\n' }
    )

    const r = await servico().integrar(pedido)

    expect(r).toMatchObject({ estado: 'integrado', blocos: 0, arquivosEmConflito: [] })
    expect(chamadas).toHaveLength(0)
    expect(naBranch('src/a.ts')).toBe('export const a = 10')
    expect(naBranch('src/b.ts')).toBe('export const b = 20')
    if (r.estado === 'integrado') {
      expect(r.manifesto).toMatchObject({ aprovada: true, preservados: 2, perdidosSemRegistro: 0 })
    }
  })

  it('o commit é do kernel, com os dois pais e a identidade fixa', async () => {
    const pedido = escritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })

    const r = await servico().integrar(pedido)

    expect(r.estado).toBe('integrado')
    if (r.estado !== 'integrado') return
    expect(amb.git(['rev-list', '--parents', '-n', '1', r.commitSha]).split(' ')).toHaveLength(3)
    expect(amb.git(['show', '-s', '--format=%an <%ae>', r.commitSha])).toBe(
      `${IDENTIDADE_DO_KERNEL.nome} <${IDENTIDADE_DO_KERNEL.email}>`
    )
  })

  it('o worktree de integração é removido ao fim, e a branch fica com o resultado', async () => {
    const pedido = escritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })

    await servico().integrar(pedido)

    expect(amb.git(['worktree', 'list'])).not.toContain('wt-integracao')
    expect(amb.git(['branch', '--list', 'jarvis/run-1/integracao'])).toContain(
      'jarvis/run-1/integracao'
    )
  })

  it('o outro escritor já contido no primeiro: não há merge, o resultado é o do primeiro', async () => {
    const commitA = amb.commitarComo(amb.worktree('a'), { 'src/a.ts': 'export const a = 10\n' })
    const commitB = amb.commitarComo(amb.worktree('b', commitA), { 'src/b.ts': 'y\n' })

    // `a` é ancestral de `b`: integrar `a` em `b` não tem o que juntar.
    const r = await servico().integrar(pedidoDe(commitB, commitA))

    expect(r).toMatchObject({ estado: 'integrado', commitSha: commitB })
  })
})

comGit('integração com conflito', () => {
  it('solicita aprovação antes da integração quando commit altera schema', async () => {
    const pedido = {
      ...escritores({ 'db/schema.sql': 'create table a (id int);\n' }, { 'src/a.ts': 'y\n' }),
      aprovarEstrutura: () => false
    }
    approvals.exigir.mockResolvedValueOnce(false)
    const r = await servico().integrar(pedido)
    expect(r).toMatchObject({
      estado: 'parado',
      motivo: 'resolucao-invalida',
      detalhe: 'aprovacao-estrutural-negada'
    })
    expect(approvals.exigir).toHaveBeenCalledOnce()
    expect(chamadas).toHaveLength(0)
  })

  it('o agente resolve o bloco, o kernel monta o arquivo e o manifesto confere', async () => {
    responder = () => ({ resolucao: JUNTAS, descartes: [] })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({
      estado: 'integrado',
      blocos: 1,
      arquivosEmConflito: ['src/a.ts'],
      manifesto: { aprovada: true, preservados: 2 }
    })
    expect(naBranch('src/a.ts')).toBe(`export const a = 1\n${JUNTAS}`)
    expect(chamadas).toHaveLength(1)
    expect(orcamento.reservarIntegracao).toHaveBeenCalledOnce()
    expect(orcamento.registrarConsumo).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-1' }),
      'run-1',
      '__integrador__-1',
      1,
      expect.objectContaining({ chamadas: 1, tokensEntrada: 20, tokensSaida: 10, usd: 0 })
    )
  })

  it('o prompt traz os dois lados e o contexto; o agente roda sem ferramenta e com esquema imposto', async () => {
    responder = () => ({ resolucao: JUNTAS, descartes: [] })

    await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    const [chamada] = chamadas
    expect(chamada?.prompt).toContain('export const x = 10')
    expect(chamada?.prompt).toContain('export const y = 20')
    expect(chamada?.prompt).toContain('export const a = 1')
    expect(chamada?.fase).toBe('planejamento')
    expect(chamada?.jsonSchema).toContain('descartes')
    expect(chamada?.contextPackId).toBe('pack-1')
  })

  it('critério 1: o integrador que remove um hunk sem registrar para o run', async () => {
    // Só o lado A sobrevive; o lado B some em silêncio.
    responder = () => ({ resolucao: 'export const x = 10', descartes: [] })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({
      estado: 'parado',
      motivo: 'hunk-perdido-sem-registro',
      manifesto: { perdidosSemRegistro: 1, preservados: 1, aprovada: false }
    })
  })

  it('o descarte com motivo que cita o trecho explica o hunk, e o run segue', async () => {
    responder = () => ({
      resolucao: 'export const x = 10',
      descartes: [{ trecho: 'export const y = 20', motivo: 'incompatível com o lado A' }]
    })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({
      estado: 'integrado',
      manifesto: { descartadosComMotivo: 1, perdidosSemRegistro: 0, aprovada: true }
    })
  })

  it('o descarte de um trecho que não é o perdido não salva o run', async () => {
    responder = () => ({
      resolucao: 'export const x = 10',
      descartes: [{ trecho: 'export const zzz = 99', motivo: 'qualquer motivo' }]
    })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'hunk-perdido-sem-registro' })
  })

  it('a mesma linha reescrita pelos dois: combinar sem declarar os lados é perda', async () => {
    responder = () => ({ resolucao: 'export const a = 10 + 20', descartes: [] })

    const r = await servico().integrar(escritores(MESMA_LINHA.a, MESMA_LINHA.b))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'hunk-perdido-sem-registro' })
  })

  it('a mesma linha reescrita pelos dois: combinar declarando os dois lados é aceito', async () => {
    responder = () => ({
      resolucao: 'export const a = 10 + 20',
      descartes: [
        { trecho: 'export const a = 10', motivo: 'combinado em a = 10 + 20' },
        { trecho: 'export const a = 20', motivo: 'combinado em a = 10 + 20' }
      ]
    })

    const r = await servico().integrar(escritores(MESMA_LINHA.a, MESMA_LINHA.b))

    expect(r).toMatchObject({
      estado: 'integrado',
      manifesto: { descartadosComMotivo: 2, aprovada: true }
    })
    expect(naBranch('src/a.ts')).toBe('export const a = 10 + 20')
  })

  it('arquivo com dois blocos: uma chamada por bloco, na ordem', async () => {
    const base = ['uno', 'm1', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'm2', 'oito', '']
    amb.limpar()
    amb = montarAmbienteDeGit({ 'src/a.ts': base.join('\n') })
    const com = (m1: string, m2: string): string =>
      base.map((l) => (l === 'm1' ? m1 : l === 'm2' ? m2 : l)).join('\n')
    responder = (req) =>
      req.prompt.includes('A1')
        ? {
            resolucao: 'A1+B1',
            descartes: [
              { trecho: 'A1', motivo: 'combinado' },
              { trecho: 'B1', motivo: 'combinado' }
            ]
          }
        : {
            resolucao: 'A2+B2',
            descartes: [
              { trecho: 'A2', motivo: 'combinado' },
              { trecho: 'B2', motivo: 'combinado' }
            ]
          }
    const pedido = escritores({ 'src/a.ts': com('A1', 'A2') }, { 'src/a.ts': com('B1', 'B2') })

    const r = await servico().integrar(pedido)

    expect(r).toMatchObject({ estado: 'integrado', blocos: 2 })
    expect(chamadas).toHaveLength(2)
    expect(naBranch('src/a.ts')).toContain('A1+B1')
    expect(naBranch('src/a.ts')).toContain('A2+B2')
  })

  it('resolução com marcador de conflito é recusada: o arquivo não passa por resolvido', async () => {
    responder = () => ({ resolucao: '<<<<<<< x\na\n=======\nb\n>>>>>>> y', descartes: [] })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'resolucao-invalida' })
  })

  it('resposta que não é o JSON do esquema é recusada', async () => {
    responder = () => ({ texto: 'resolvi, confia' })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'resolucao-invalida' })
  })

  it('o agente que tenta mandar comando só produz texto no bloco: Git continua sendo do kernel', async () => {
    responder = () => ({ resolucao: `${JUNTAS}\n// $(git push --force)`, descartes: [] })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r.estado).toBe('integrado')
    expect(naBranch('src/a.ts')).toContain('git push --force')
    expect(amb.git(['log', '--all', '--format=%an'])).not.toMatch(/agente/i)
  })

  it('marca reserva indeterminada quando stream não informa uso', async () => {
    responder = () => ({ resolucao: JUNTAS, descartes: [] })
    const original = ia.call
    vi.spyOn(ia, 'call').mockImplementation((request) =>
      (async function* () {
        chamadas.push(request)
        yield { tipo: 'chunk', id: 'x', texto: JSON.stringify(responder(request)) }
        yield { tipo: 'fim', id: 'x', estado: 'concluido' }
      })()
    )
    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))
    expect(r).toMatchObject({
      estado: 'parado',
      motivo: 'resolucao-invalida',
      detalhe: 'consumo-nao-observado'
    })
    expect(orcamento.marcarIndeterminado).toHaveBeenCalledOnce()
    vi.mocked(ia.call).mockRestore()
    void original
  })

  it('falha da chamada ao agente para o run, com o estado', async () => {
    responder = () => new Error('provider fora do ar')

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'falhou' })
  })

  it('cancelado de fora antes de chamar: para como cancelada', async () => {
    const controle = new AbortController()
    controle.abort()
    responder = () => ({ resolucao: JUNTAS, descartes: [] })

    const r = await servico().integrar({
      ...escritores(INSERCOES.a, INSERCOES.b),
      signal: controle.signal
    })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'cancelada' })
  })

  it('depois de parar, não sobra worktree nem merge aberto', async () => {
    responder = () => ({ resolucao: '=======', descartes: [] })
    const pedido = escritores(INSERCOES.a, INSERCOES.b)

    await servico().integrar(pedido)

    expect(amb.git(['worktree', 'list'])).not.toContain('wt-integracao')
  })

  it('conflito que não é de texto (um lado apaga, o outro altera) não é do integrador', async () => {
    const commitA = amb.commitarComo(amb.worktree('a'), { 'src/a.ts': 'export const a = 10\n' })
    const wb = amb.worktree('b')
    amb.git(['rm', 'src/a.ts'], wb.worktree)
    amb.git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'apaga'], wb.worktree)
    const commitB = amb.git(['rev-parse', 'HEAD'], wb.worktree)

    const r = await servico().integrar(pedidoDe(commitA, commitB))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'conflito-nao-suportado' })
    expect(chamadas).toHaveLength(0)
  })

  it('contexto recusado (segredo no bloco) para o run, sem chamar o agente', async () => {
    contextoRecusa = 'segredo-no-contexto'

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({
      estado: 'parado',
      motivo: 'contexto-recusado',
      detalhe: 'segredo-no-contexto'
    })
    expect(chamadas).toHaveLength(0)
  })
})

comGit('pedido inválido', () => {
  const base = (): Pedido => escritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })

  it('recusa um só escritor', async () => {
    const p = base()

    const r = await servico().integrar({ ...p, escritores: p.escritores.slice(0, 1) })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'escritores-invalidos' })
  })

  it('recusa o mesmo commit duas vezes', async () => {
    const p = base()
    const [a] = p.escritores

    const r = await servico().integrar({
      ...p,
      escritores: [a, { escritor: 'b', commitSha: a?.commitSha ?? '' }] as never
    })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'escritores-invalidos' })
  })

  it('recusa commit que não é SHA, inclusive opção disfarçada', async () => {
    const p = base()

    const r = await servico().integrar({
      ...p,
      escritores: [p.escritores[0], { escritor: 'b', commitSha: '--abort' }] as never
    })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'escritores-invalidos' })
  })

  it('recusa o mesmo escritor duas vezes', async () => {
    const p = base()

    const r = await servico().integrar({
      ...p,
      escritores: [p.escritores[0], { ...p.escritores[1], escritor: 'a' }] as never
    })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'escritores-invalidos' })
  })

  it('modelo local sem janela de contexto é recusado antes de rodar', async () => {
    const r = await servico().integrar({
      ...base(),
      modelo: { provider: 'ollama', modelo: 'qwen3:8b' }
    } as Pedido)

    expect(r).toMatchObject({ estado: 'parado', motivo: 'modelo-local-sem-janela' })
  })
})

comGit('auditoria e isolamento', () => {
  it('registra início e fim com ids e contagens, sem o texto do código nem do agente', async () => {
    responder = () => ({ resolucao: JUNTAS, descartes: [] })

    await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    const eventos = amb.audit.list(USUARIO_DE_TESTE).filter((e) => e.type === 'squad-integracao')
    expect(eventos.map((e) => (e.payload as { marco: string }).marco)).toEqual(['inicio', 'fim'])
    const texto = JSON.stringify(eventos.map((e) => e.payload))
    expect(texto).toContain('"runId":"run-1"')
    expect(texto).not.toContain('export const')
  })

  it('o repositório do projeto não é tocado: o resultado mora só na branch de integração', async () => {
    responder = () => ({ resolucao: JUNTAS, descartes: [] })

    await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(readFileSync(join(amb.repo, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1\n')
    expect(amb.git(['rev-parse', 'main'])).toBe(amb.baseSha)
  })
})

comGit('o que o conteúdo do escritor não pode fazer (revisão de segurança e de código)', () => {
  it('H1: linha ">>>>>>>" dentro de um lado não forja a estrutura: o run para, sem chamar o agente', async () => {
    const pedido = escritores(
      { 'src/a.ts': 'export const a = 1\nx\n>>>>>>> quote\ny\n' },
      { 'src/a.ts': 'export const a = 1\nz\n' }
    )
    responder = () => ({ resolucao: 'RESOLVIDO', descartes: [] })

    const r = await servico().integrar(pedido)

    expect(r).toMatchObject({ estado: 'parado', motivo: 'conflito-nao-suportado' })
    expect(chamadas).toHaveLength(0)
  })

  it('H2 (segurança): provider com ferramenta (codex) não integra', async () => {
    const r = await servico().integrar({
      ...escritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' }),
      modelo: { provider: 'codex', modelo: 'gpt' }
    })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'provider-com-ferramenta' })
    expect(chamadas).toHaveLength(0)
  })

  it('M5: arquivo com mais blocos que o teto para antes de gastar uma chamada', async () => {
    const base = ['uno', 'm1', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'm2', 'oito', '']
    amb.limpar()
    amb = montarAmbienteDeGit({ 'src/a.ts': base.join('\n') })
    const com = (m1: string, m2: string): string =>
      base.map((l) => (l === 'm1' ? m1 : l === 'm2' ? m2 : l)).join('\n')
    const pedido = escritores({ 'src/a.ts': com('A1', 'A2') }, { 'src/a.ts': com('B1', 'B2') })

    const r = await servico().integrar({ ...pedido, maxBlocos: 1 })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'blocos-demais' })
    expect(chamadas).toHaveLength(0)
  })

  it('L2: commit que não descende da base não é integrado', async () => {
    const pedido = escritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    amb.git(['checkout', '-q', '--orphan', 'solto'])
    amb.git([
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      's'
    ])
    const orfao = amb.git(['rev-parse', 'HEAD'])
    amb.git(['checkout', '-q', 'main'])

    const r = await servico().integrar({
      ...pedido,
      escritores: [pedido.escritores[0], { escritor: 'b', commitSha: orfao }] as never
    })

    expect(r).toMatchObject({ estado: 'parado', motivo: 'escritores-invalidos' })
  })

  it.each(['.gitattributes', 'sub/.gitmodules', '.lfsconfig'])(
    'L2: escritor que toca %s para o run',
    async (arquivo) => {
      const pedido = escritores({ [arquivo]: '* filter=x\n' }, { 'src/b.ts': 'y\n' })

      const r = await servico().integrar(pedido)

      expect(r).toMatchObject({ estado: 'parado', motivo: 'arquivo-de-configuracao-do-git' })
    }
  )

  it('M3: o descarte só vale para o que está no bloco — citar texto de fora dele não salva', async () => {
    responder = () => ({
      resolucao: 'export const x = 10',
      descartes: [
        { trecho: 'export const y = 20 // e mais coisa que não está no bloco', motivo: 'inventado' }
      ]
    })

    const r = await servico().integrar(escritores(INSERCOES.a, INSERCOES.b))

    expect(r).toMatchObject({ estado: 'parado', motivo: 'hunk-perdido-sem-registro' })
  })

  it('o resultado traz as linhas novas da resolução e o manifesto em texto, com cada descarte', async () => {
    responder = () => ({
      resolucao: 'export const a = 10 + 20',
      descartes: [
        { trecho: 'export const a = 10', motivo: 'combinado em a = 10 + 20' },
        { trecho: 'export const a = 20', motivo: 'combinado em a = 10 + 20' }
      ]
    })

    const r = await servico().integrar(escritores(MESMA_LINHA.a, MESMA_LINHA.b))

    expect(r.estado).toBe('integrado')
    if (r.estado !== 'integrado') return
    expect(r.linhasNovas).toBe(1)
    expect(r.manifestoTexto).toContain('2 descartados')
    expect(r.manifestoTexto).toContain('combinado em a = 10 + 20')
  })
})

comGit('merge limpo que o auditor não pode reprovar (revisão de código, H1 e H2)', () => {
  it('H1: a linha removida existe também noutro ponto do arquivo: a integração segue', async () => {
    amb.limpar()
    amb = montarAmbienteDeGit({
      'src/f.ts': 'function a() {\n  return false\n}\nfunction b() {\n  return false\n}\n'
    })
    const pedido = escritores(
      { 'src/f.ts': 'function a() {\n  return true\n}\nfunction b() {\n  return false\n}\n' },
      { 'src/novo.ts': 'export const novo = 1\n' }
    )

    const r = await servico().integrar(pedido)

    expect(r).toMatchObject({ estado: 'integrado', manifesto: { aprovada: true } })
    expect(chamadas).toHaveLength(0)
  })

  it('H2: A renomeia o arquivo e B edita o original: o merge limpo é aceito', async () => {
    amb.limpar()
    amb = montarAmbienteDeGit({
      'src/f.ts': 'um\ndois\ntres\nquatro\ncinco\nseis\nsete\noito\nnove\ndez\n'
    })
    const wa = amb.worktree('a')
    amb.git(['mv', 'src/f.ts', 'src/g.ts'], wa.worktree)
    amb.git(
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'renomeia'],
      wa.worktree
    )
    const commitA = amb.git(['rev-parse', 'HEAD'], wa.worktree)
    const commitB = amb.commitarComo(amb.worktree('b'), {
      'src/f.ts': 'um\nDOIS\ntres\nquatro\ncinco\nseis\nsete\noito\nnove\ndez\n'
    })

    const r = await servico().integrar(pedidoDe(commitA, commitB))

    expect(r).toMatchObject({ estado: 'integrado', manifesto: { aprovada: true } })
    expect(naBranch('src/g.ts')).toContain('DOIS')
  })

  it('caminho não ASCII não derruba o auditor', async () => {
    const pedido = escritores({ 'src/café.ts': 'export const c = 1\n' }, { 'src/b.ts': 'y\n' })

    const r = await servico().integrar(pedido)

    expect(r).toMatchObject({ estado: 'integrado', manifesto: { aprovada: true } })
  })
})
