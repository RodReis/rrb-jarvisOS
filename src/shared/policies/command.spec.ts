/**
 * Política de comando — parte pura (SPEC-ExecucaoReal-02, categoria Regras).
 *
 * As duas barreiras são testadas separadas de propósito: elas respondem perguntas diferentes
 * ("posso rodar este binário?" e "este uso é destrutivo?"), e um teste que as misturasse
 * esconderia o dia em que uma delas parasse de funcionar.
 */

import { describe, expect, it } from 'vitest'
import { canonicalizeBinary, isCommandAllowed, isElevationAttempt } from './command'
import { matchDestructivePattern } from './destructive-commands'

describe('canonicalizeBinary', () => {
  it('descarta diretório e extensão executável e normaliza caixa', () => {
    expect(canonicalizeBinary('GIT.EXE')).toBe('git')
    expect(canonicalizeBinary('C:\\Program Files\\Git\\git.exe')).toBe('git')
    expect(canonicalizeBinary('/usr/bin/git')).toBe('git')
    expect(canonicalizeBinary('npm.cmd')).toBe('npm')
  })
})

describe('isCommandAllowed (1ª barreira)', () => {
  it('permite binário presente na allowlist, em qualquer variação de escrita', () => {
    expect(isCommandAllowed('git', ['git'])).toBe(true)
    expect(isCommandAllowed('GIT.EXE', ['git'])).toBe(true)
    expect(isCommandAllowed('/usr/bin/git', ['git'])).toBe(true)
  })

  it('barra binário ausente da allowlist', () => {
    expect(isCommandAllowed('curl', ['git', 'npm'])).toBe(false)
  })

  it('barra tudo quando a allowlist está vazia (default de fábrica)', () => {
    expect(isCommandAllowed('git', [])).toBe(false)
  })

  it('não deixa um path terminado no nome permitido passar como o permitido', () => {
    // `/tmp/malicioso/git` canoniza para `git` — e é justamente por isso que a allowlist é
    // por nome: quem escolhe o binário resolvido é o PATH do processo, não o texto submetido.
    // O que este teste trava é o inverso: um nome que apenas *contém* o permitido.
    expect(isCommandAllowed('gitleaks', ['git'])).toBe(false)
    expect(isCommandAllowed('mygit', ['git'])).toBe(false)
  })
})

describe('isElevationAttempt', () => {
  it('reconhece as formas de elevação em ambos os sistemas', () => {
    for (const binary of ['sudo', 'su', 'doas', 'runas', 'pkexec', 'gsudo', 'RUNAS.EXE']) {
      expect(isElevationAttempt(binary)).toBe(true)
    }
  })

  it('não confunde binário comum com elevação', () => {
    expect(isElevationAttempt('git')).toBe(false)
    expect(isElevationAttempt('summary')).toBe(false)
  })
})

describe('matchDestructivePattern (2ª barreira)', () => {
  it('pega remoção mesmo sem -rf (postura ampla do PI)', () => {
    expect(matchDestructivePattern('rm', ['arquivo.txt'])?.id).toBe('remocao')
    expect(matchDestructivePattern('rm', ['-rf', '/tmp/x'])?.id).toBe('remocao')
    expect(matchDestructivePattern('del', ['a.txt'])?.id).toBe('remocao')
  })

  it('pega os destrutivos por natureza', () => {
    expect(matchDestructivePattern('mkfs.ext4', ['/dev/sda1'])).toBeDefined()
    expect(matchDestructivePattern('dd', ['if=/dev/zero'])?.id).toBe('escrita-em-bloco')
    expect(matchDestructivePattern('shutdown', ['-h', 'now'])?.id).toBe('desligamento')
    expect(matchDestructivePattern('chmod', ['777', 'a'])?.id).toBe('permissao')
  })

  it('distingue uso normal de uso destrutivo do mesmo binário', () => {
    expect(matchDestructivePattern('git', ['status'])).toBeUndefined()
    expect(matchDestructivePattern('git', ['push'])).toBeUndefined()
    expect(matchDestructivePattern('git', ['push', '--force'])).toBeDefined()
    expect(matchDestructivePattern('git', ['clean', '-fd'])).toBeDefined()
    expect(matchDestructivePattern('npm', ['ci'])).toBeUndefined()
    expect(matchDestructivePattern('npm', ['publish'])?.id).toBe('publicacao-de-pacote')
  })

  it('pega argumento forçado em binário que a lista não previu', () => {
    // O ponto da postura ampla: não sabemos o que `ferramenta-x --force` força, e é por não
    // saber que o humano decide.
    expect(matchDestructivePattern('ferramenta-x', ['--force'])?.id).toBe('forcado')
    expect(matchDestructivePattern('ferramenta-x', ['-rf'])?.id).toBe('recursivo-destrutivo')
  })

  it('pega alvo na raiz e em dispositivo de bloco', () => {
    expect(matchDestructivePattern('ferramenta-x', ['/'])?.id).toBe('raiz-do-sistema')
    expect(matchDestructivePattern('ferramenta-x', ['C:\\'])?.id).toBe('raiz-do-sistema')
    expect(matchDestructivePattern('ferramenta-x', ['of=/dev/sda'])?.id).toBe(
      'dispositivo-de-bloco'
    )
  })

  it('deixa comando inofensivo passar sem pedir aprovação', () => {
    expect(matchDestructivePattern('node', ['--version'])).toBeUndefined()
    expect(matchDestructivePattern('ls', ['-la'])).toBeUndefined()
    expect(matchDestructivePattern('echo', ['ola'])).toBeUndefined()
  })

  it('devolve a entrada casada para a auditoria dizer o motivo', () => {
    const casou = matchDestructivePattern('rm', ['-rf', '/'])
    expect(casou?.descricao).toBe('Remove arquivos ou diretórios')
  })
})
