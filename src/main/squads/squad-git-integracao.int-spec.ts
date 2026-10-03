/**
 * O Git do kernel na integração de dois escritores (SPEC-Squads-04, critérios 1 e 4).
 *
 * **Git de verdade, pelo `TerminalEngine` de verdade**: o que precisa ser provado é que o merge,
 * a resolução de um arquivo e o commit de integração saem só do kernel — pelo gate do
 * `TerminalEngine`, sem hook do repositório e com a identidade fixa do kernel.
 */

import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { montarAmbienteDeGit, temGit } = await import('./squad-fixture-git')
const { IDENTIDADE_DO_KERNEL } = await import('./squad-git')

const comGit = temGit() ? describe : describe.skip

let amb: ReturnType<typeof montarAmbienteDeGit>

beforeEach(() => {
  amb = montarAmbienteDeGit()
})

afterEach(() => {
  amb.limpar()
})

/** Dois escritores a partir da base; devolve os commits e um worktree de integração no do primeiro. */
function doisEscritores(
  a: Record<string, string>,
  b: Record<string, string>
): { commitA: string; commitB: string } {
  const wa = amb.worktree('a')
  const wb = amb.worktree('b')
  const commitA = amb.commitarComo(wa, a, 'escritor a')
  const commitB = amb.commitarComo(wb, b, 'escritor b')
  return { commitA, commitB }
}

function integracaoEm(commitA: string) {
  const r = amb.squadGit.criarWorktree({
    repositorio: amb.repo,
    worktree: join(amb.appDir, 'wt-integracao'),
    branch: 'jarvis/integracao',
    baseSha: commitA
  })
  if (!r.ok) throw new Error(r.motivo)
  return r.valor
}

comGit('mesclar', () => {
  it('trabalhos em arquivos diferentes entram sem conflito, e o merge fica por commitar', () => {
    const { commitA, commitB } = doisEscritores(
      { 'src/a.ts': 'export const a = 10\n' },
      { 'src/b.ts': 'export const b = 20\n' }
    )
    const w = integracaoEm(commitA)

    const r = amb.squadGit.mesclar(w, commitB)

    expect(r).toEqual({ ok: true, valor: { conflitos: [], emAndamento: true } })
    expect(readFileSync(join(w.worktree, 'src', 'a.ts'), 'utf8')).toBe('export const a = 10\n')
    expect(readFileSync(join(w.worktree, 'src', 'b.ts'), 'utf8')).toBe('export const b = 20\n')
    expect(amb.git(['rev-parse', '--verify', 'MERGE_HEAD'], w.worktree)).toBe(commitB)
  })

  it('a mesma linha alterada pelos dois é conflito, no estilo diff3 (com a base)', () => {
    const { commitA, commitB } = doisEscritores(
      { 'src/a.ts': 'export const a = 10\n' },
      { 'src/a.ts': 'export const a = 20\n' }
    )
    const w = integracaoEm(commitA)

    const r = amb.squadGit.mesclar(w, commitB)

    expect(r).toEqual({ ok: true, valor: { conflitos: ['src/a.ts'], emAndamento: true } })
    const texto = readFileSync(join(w.worktree, 'src', 'a.ts'), 'utf8')
    expect(texto).toContain('<<<<<<<')
    expect(texto).toContain('|||||||')
    expect(texto).toContain('export const a = 1\n')
    expect(texto).toContain('>>>>>>>')
  })

  it('commit inválido é recusa, não exceção', () => {
    const { commitA } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)

    expect(amb.squadGit.mesclar(w, 'nao-e-sha').ok).toBe(false)
    expect(amb.squadGit.mesclar(w, '--abort').ok).toBe(false)
  })
})

comGit('resolver e commitar a integração', () => {
  it('commita o merge com os dois pais e a identidade fixa do kernel', () => {
    const { commitA, commitB } = doisEscritores(
      { 'src/a.ts': 'export const a = 10\n' },
      { 'src/a.ts': 'export const a = 20\n' }
    )
    const w = integracaoEm(commitA)
    amb.squadGit.mesclar(w, commitB)

    const resolvido = amb.squadGit.resolverArquivo(w, 'src/a.ts', 'export const a = 10 + 20\n')
    const commit = amb.squadGit.commitarIntegracao(w, 'integração do run')

    expect(resolvido.ok).toBe(true)
    expect(commit.ok).toBe(true)
    if (!commit.ok) return
    expect(amb.git(['rev-list', '--parents', '-n', '1', commit.valor]).split(' ')).toHaveLength(3)
    expect(amb.git(['show', '-s', '--format=%an <%ae>', commit.valor])).toBe(
      `${IDENTIDADE_DO_KERNEL.nome} <${IDENTIDADE_DO_KERNEL.email}>`
    )
    expect(amb.git(['show', `${commit.valor}:src/a.ts`])).toBe('export const a = 10 + 20')
  })

  it('com conflito aberto, não commita: não existe "aceitar mesmo assim"', () => {
    const { commitA, commitB } = doisEscritores(
      { 'src/a.ts': 'export const a = 10\n' },
      { 'src/a.ts': 'export const a = 20\n' }
    )
    const w = integracaoEm(commitA)
    amb.squadGit.mesclar(w, commitB)

    expect(amb.squadGit.commitarIntegracao(w, 'integração')).toEqual({
      ok: false,
      motivo: 'conflitos-abertos'
    })
  })

  it('sem merge em andamento, não commita', () => {
    const { commitA } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)

    expect(amb.squadGit.commitarIntegracao(w, 'integração')).toEqual({
      ok: false,
      motivo: 'sem-merge-em-andamento'
    })
  })

  it('o hook do repositório não roda no commit do kernel', () => {
    const { commitA, commitB } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)
    const marca = join(amb.dir, 'hook-rodou')
    const hooks = join(amb.repo, '.git', 'hooks')
    mkdirSync(hooks, { recursive: true })
    writeFileSync(
      join(hooks, 'pre-merge-commit'),
      `#!/bin/sh\necho 1 > "${marca.replace(/\\/g, '/')}"\n`,
      {
        mode: 0o755
      }
    )
    amb.squadGit.mesclar(w, commitB)

    const commit = amb.squadGit.commitarIntegracao(w, 'integração')

    expect(commit.ok).toBe(true)
    expect(existsSync(marca)).toBe(false)
  })

  it.each(['../fora.ts', '/abs.ts', '-x.ts', ''])('recusa resolver o caminho %j', (caminho) => {
    const { commitA, commitB } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)
    amb.squadGit.mesclar(w, commitB)

    expect(amb.squadGit.resolverArquivo(w, caminho, 'texto').ok).toBe(false)
  })

  it('mensagem com quebra de linha é recusada', () => {
    const { commitA, commitB } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)
    amb.squadGit.mesclar(w, commitB)

    expect(amb.squadGit.commitarIntegracao(w, 'a\nb').ok).toBe(false)
  })
})

comGit('lerArquivoDoWorktree', () => {
  it('lê o arquivo regular do worktree', () => {
    const { commitA } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)

    expect(amb.squadGit.lerArquivoDoWorktree(w, 'src/a.ts')).toEqual({ ok: true, valor: 'x\n' })
  })

  it('não segue link simbólico: o destino pode estar fora do worktree', () => {
    const { commitA } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)
    const segredo = join(amb.dir, 'segredo.txt')
    writeFileSync(segredo, 'não leia')
    try {
      symlinkSync(segredo, join(w.worktree, 'src', 'elo.ts'))
    } catch {
      return // sem permissão de link simbólico nesta máquina: nada a provar
    }

    expect(amb.squadGit.lerArquivoDoWorktree(w, 'src/elo.ts').ok).toBe(false)
  })

  it('recusa caminho fora da raiz e arquivo grande demais', () => {
    const { commitA } = doisEscritores({ 'src/a.ts': 'x\n' }, { 'src/b.ts': 'y\n' })
    const w = integracaoEm(commitA)
    writeFileSync(join(w.worktree, 'grande.txt'), 'x'.repeat(2 * 1024 * 1024))

    expect(amb.squadGit.lerArquivoDoWorktree(w, '../x').ok).toBe(false)
    expect(amb.squadGit.lerArquivoDoWorktree(w, 'grande.txt').ok).toBe(false)
  })
})

comGit('diffEntre', () => {
  it('devolve o diff textual do que o escritor mudou, sem contexto', () => {
    const { commitA } = doisEscritores(
      { 'src/a.ts': 'export const a = 10\n' },
      { 'src/b.ts': 'y\n' }
    )

    const r = amb.squadGit.diffEntre(amb.repo, amb.baseSha, commitA)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(r.valor).toContain('-export const a = 1')
    expect(r.valor).toContain('+export const a = 10')
    expect(r.valor).not.toContain('src/b.ts')
  })

  it('revisão que não é SHA é recusada, inclusive opção disfarçada', () => {
    expect(amb.squadGit.diffEntre(amb.repo, amb.baseSha, '--output=x').ok).toBe(false)
    expect(amb.squadGit.diffEntre(amb.repo, 'HEAD', amb.baseSha).ok).toBe(false)
  })
})
