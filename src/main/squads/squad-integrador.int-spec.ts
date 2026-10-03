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
      yield { tipo: 'fim', id: 'x', estado: 'concluido' } as AiStreamEvent
    })()
  }
}

const contexto = {
  montarDaTarefa: vi.fn(() =>
    contextoRecusa === undefined
      ? { pack: { id: 'pack-1', hash: 'h', itens: [] } }
      : { reason: contextoRecusa, mensagem: 'recusado' }
  )
}

beforeEach(() => {
  amb = montarAmbienteDeGit()
  chamadas = []
  contextoRecusa = undefined
  responder = () => new Error('nenhuma resposta combinada')
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
    workspaceId: () => WORKSPACE_DE_TESTE
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
