/**
 * O perfil de CI: validação e geração (SPEC-Pipeline-01 R2, critérios 1 a 4 e 18).
 *
 * Os testes que mais importam aqui são os **contrafactuais**: um perfil quebrado tem de ser
 * recusado, e recusado *antes* de qualquer escrita. Um teste que só prova o caminho feliz passaria
 * igual com o validador devolvendo lista vazia sempre.
 */

import { describe, expect, it } from 'vitest'

import type { PerfilDeCi } from './ci-profile'
import { VERSAO_DO_SCHEMA_DO_PERFIL, validarPerfilDeCi } from './ci-profile'
import { gerarWorkflowDoPerfil } from './ci-profile-workflow'
import { perfilLegado, perfilNodeEmWindows, perfilPythonEmWindows } from './ci-profile-perfis'

const problemas = (perfil: PerfilDeCi): readonly string[] =>
  validarPerfilDeCi(perfil).map((p) => p.problema)

describe('validarPerfilDeCi — critério 3', () => {
  it('aceita os dois perfis de stack que a R2 prova', () => {
    expect(validarPerfilDeCi(perfilNodeEmWindows('node'))).toEqual([])
    expect(validarPerfilDeCi(perfilPythonEmWindows('py'))).toEqual([])
  })

  it('recusa schema de outra versão em vez de converter por adivinhação', () => {
    const perfil = { ...perfilNodeEmWindows('node'), schemaVersion: VERSAO_DO_SCHEMA_DO_PERFIL + 1 }
    expect(problemas(perfil)).toContain('schema-incompativel')
  })

  it('recusa runtime que a pipeline não prova, sem cair no Node por padrão', () => {
    const perfil = { ...perfilNodeEmWindows('node'), runtime: 'ruby' as never }
    expect(problemas(perfil)).toContain('runtime-incompativel')
  })

  it('recusa shell que não é o provado para o sistema declarado', () => {
    const perfil = { ...perfilNodeEmWindows('node'), shell: 'bash' as const }
    expect(problemas(perfil)).toContain('shell-incompativel')
  })

  it('recusa id de validação repetido', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: [...base.validacoes, { ...base.validacoes[0]!, nome: 'outro' }]
    }
    expect(problemas(perfil)).toContain('id-repetido')
  })

  it('recusa dependência que não existe no perfil', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) =>
        v.id === 'test' ? { ...v, dependeDe: ['inexistente'] } : v
      )
    }
    expect(problemas(perfil)).toContain('dependencia-ausente')
  })

  it('recusa auto-dependência com categoria própria, não como ciclo', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) => (v.id === 'test' ? { ...v, dependeDe: ['test'] } : v))
    }
    const p = problemas(perfil)
    expect(p).toContain('auto-dependencia')
    expect(p).not.toContain('ciclo')
  })

  it('recusa ciclo entre validações', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) => {
        if (v.id === 'lint') return { ...v, dependeDe: ['test'] }
        if (v.id === 'test') return { ...v, dependeDe: ['lint'] }
        return v
      })
    }
    expect(problemas(perfil)).toContain('ciclo')
  })

  it('não acusa ciclo em losango: duas validações dependendo da mesma terceira', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) =>
        v.id === 'test' || v.id === 'build' ? { ...v, dependeDe: ['lint'] } : v
      )
    }
    expect(problemas(perfil)).not.toContain('ciclo')
  })

  it('recusa argv vazio', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) => (v.id === 'test' ? { ...v, argv: [] } : v))
    }
    expect(problemas(perfil)).toContain('argv-vazio')
  })

  it('recusa cwd que sai do checkout', () => {
    const base = perfilNodeEmWindows('node')
    for (const cwd of ['/etc', '../fora', 'C:\\Windows', 'sub/../../fora']) {
      const perfil = {
        ...base,
        validacoes: base.validacoes.map((v) => (v.id === 'test' ? { ...v, cwd } : v))
      }
      expect(problemas(perfil), cwd).toContain('cwd-fora-do-checkout')
    }
  })

  it('aceita cwd que desce e volta sem sair do checkout', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) => (v.id === 'test' ? { ...v, cwd: 'apps/../pkg' } : v))
    }
    expect(problemas(perfil)).not.toContain('cwd-fora-do-checkout')
  })

  it('recusa timeout que não é positivo', () => {
    for (const timeoutEmMinutos of [0, -5, Number.NaN]) {
      const perfil = { ...perfilNodeEmWindows('node'), timeoutEmMinutos }
      expect(problemas(perfil), String(timeoutEmMinutos)).toContain('limite-invalido')
    }
  })

  it('recusa perfil em que toda validação é opcional', () => {
    const base = perfilNodeEmWindows('node')
    const perfil = {
      ...base,
      validacoes: base.validacoes.map((v) => ({ ...v, obrigatoria: false }))
    }
    expect(problemas(perfil)).toContain('sem-validacao-obrigatoria')
  })

  it('devolve todos os problemas, não só o primeiro', () => {
    const perfil = {
      ...perfilNodeEmWindows('node'),
      schemaVersion: 99,
      timeoutEmMinutos: 0
    }
    expect(problemas(perfil).length).toBeGreaterThanOrEqual(2)
  })
})

describe('gerarWorkflowDoPerfil — critérios 1, 4, 6, 7 e 8', () => {
  it('gera Python sem npm ci: a stack vem do perfil, não de adivinhação', () => {
    const yml = gerarWorkflowDoPerfil(perfilPythonEmWindows('py'))
    expect(yml).toContain('actions/setup-python@v5')
    expect(yml).toContain('python-version: "3.12"')
    expect(yml).toContain('pip install -r requirements.txt')
    expect(yml).not.toContain('npm ci')
    expect(yml).not.toContain('setup-node')
  })

  it('gera Node com a linha declarada e sem tocar em Python', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    expect(yml).toContain('actions/setup-node@v4')
    expect(yml).toContain('node-version: "24"')
    expect(yml).not.toContain('setup-python')
  })

  it('usa o runner e o shell do sistema declarado — Windows é prova obrigatória', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    expect(yml).toContain('runs-on: windows-latest')
    expect(yml).toContain('shell: pwsh')
    expect(yml).not.toContain('ubuntu-latest')
  })

  it('é determinístico: mesmo perfil, mesmos bytes', () => {
    const perfil = perfilNodeEmWindows('node')
    expect(gerarWorkflowDoPerfil(perfil)).toBe(gerarWorkflowDoPerfil(perfil))
  })

  it('põe grupos independentes em jobs distintos, que o provedor roda em paralelo', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    expect(yml).toContain('  qualidade:')
    expect(yml).toContain('  testes:')
    // `testes` não depende de ninguém: nada o serializa atrás de `qualidade`.
    const blocoTestes = yml.slice(yml.indexOf('  testes:'), yml.indexOf('  build:'))
    expect(blocoTestes).not.toContain('needs:')
  })

  it('traduz dependência entre validações em dependência entre jobs', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    const blocoBuild = yml.slice(yml.indexOf('  build:'))
    expect(blocoBuild).toContain('needs: [qualidade]')
  })

  it('não dispara em push: branch com PR aberto não duplica o CI', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    expect(yml).toContain('pull_request:')
    expect(yml).not.toMatch(/^\s*push:/m)
  })

  it('agrupa concorrência pelo ref, cancelando só execução do mesmo PR', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    expect(yml).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(yml).toContain('cancel-in-progress: true')
  })

  it('mantém o context agregado com o nome que a proteção da branch exige', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    expect(yml).toContain('  validacao:')
    expect(yml).toContain('if: always()')
  })

  it('o agregado exige success dos obrigatórios — skipped e ausente não passam', () => {
    const yml = gerarWorkflowDoPerfil(perfilNodeEmWindows('node'))
    const bloco = yml.slice(yml.indexOf('  validacao:'))
    for (const id of ['qualidade', 'testes', 'build']) {
      expect(bloco).toContain(`needs.${id}.result == 'success'`)
    }
  })

  it('não exige sucesso de grupo declarado opcional', () => {
    const base = perfilNodeEmWindows('node')
    const perfil: PerfilDeCi = {
      ...base,
      validacoes: base.validacoes.map((v) =>
        v.grupo === 'build' ? { ...v, obrigatoria: false } : v
      )
    }
    const bloco = gerarWorkflowDoPerfil(perfil).slice(
      gerarWorkflowDoPerfil(perfil).indexOf('  validacao:')
    )
    expect(bloco).toContain("needs.qualidade.result == 'success'")
    expect(bloco).not.toContain("needs.build.result == 'success'")
    // Mas continua no `needs`: o agregado espera o job terminar antes de decidir.
    expect(bloco).toContain('needs: [qualidade, testes, build]')
  })
})

describe('gerarWorkflowDoPerfil — critério 18, argv hostil', () => {
  const comArgv = (argv: readonly string[]): string =>
    gerarWorkflowDoPerfil({
      ...perfilNodeEmWindows('node'),
      validacoes: [{ id: 'x', nome: 'x', argv, grupo: 'g' }]
    })

  it('não deixa argumento com espaço virar dois argumentos', () => {
    expect(comArgv(['npm', 'test', '--grep', 'dois casos'])).toContain(
      "npm test --grep 'dois casos'"
    )
  })

  it('escapa aspas simples dentro do argumento', () => {
    expect(comArgv(['echo', "o'brien"])).toContain(`'o'\\''brien'`)
  })

  it('não deixa o comando escapar para outra linha do YAML', () => {
    const yml = comArgv(['echo', 'linha1\nlinha2'])

    // O argumento inteiro fica numa linha só, com a quebra escapada. Sem isto, `linha2'` nasceria
    // como linha solta do YAML e o arquivo não faria parse — o modo de falha que o critério 18
    // descreve, e que o gerador legado ainda tem.
    const linhaDoEcho = yml.split('\n').filter((l) => l.includes('echo'))
    expect(linhaDoEcho).toHaveLength(1)
    expect(linhaDoEcho[0]).toContain(String.raw`"linha1\nlinha2"`)

    // Nenhuma linha do arquivo é o resto de um argumento vazado.
    expect(yml.split('\n').some((l) => l.startsWith('linha2'))).toBe(false)
  })

  it('neutraliza expressão do provedor, que o escape POSIX sozinho não alcança', () => {
    const yml = comArgv(['echo', '${{ secrets.TOKEN }}'])
    // A sequência que o GitHub expande não pode sobreviver inteira no arquivo.
    const linhaDoEcho = yml.split('\n').find((l) => l.includes('echo'))
    expect(linhaDoEcho).toBeDefined()
    expect(linhaDoEcho).not.toContain('${{ secrets.TOKEN }}')
    expect(linhaDoEcho).toContain('secrets.TOKEN')
  })

  it('não deixa metacaractere de shell virar execução', () => {
    const yml = comArgv(['echo', '$(whoami)'])
    expect(yml).toContain(`'$(whoami)'`)
  })

  it('normaliza nome de grupo hostil em id de job válido', () => {
    const yml = gerarWorkflowDoPerfil({
      ...perfilNodeEmWindows('node'),
      validacoes: [{ id: 'x', nome: 'x', argv: ['echo', 'oi'], grupo: 'testes de banco!' }]
    })
    expect(yml).toContain('  testes-de-banco:')
  })
})

describe('perfilLegado — critério 2', () => {
  const comandos = {
    lint: ['npm', 'run', 'lint'],
    typecheck: ['npm', 'run', 'typecheck'],
    test: ['npm', 'test'],
    build: ['npm', 'run', 'build']
  }

  it('é um perfil válido', () => {
    expect(validarPerfilDeCi(perfilLegado('legado', comandos))).toEqual([])
  })

  it('marca legacy: representação do pacote antigo, não descoberta da stack', () => {
    expect(perfilLegado('legado', comandos).legacy).toBe(true)
  })

  it('preserva os quatro comandos do pacote antigo', () => {
    const yml = gerarWorkflowDoPerfil(perfilLegado('legado', comandos))
    expect(yml).toContain('npm run lint')
    expect(yml).toContain('npm run typecheck')
    expect(yml).toContain('npm test')
    expect(yml).toContain('npm run build')
  })

  it('não paraleliza por iniciativa própria: um grupo só, sem migração tácita', () => {
    const yml = gerarWorkflowDoPerfil(perfilLegado('legado', comandos))
    const jobs = yml.split('\n').filter((l) => /^ {2}[a-z0-9-]+:$/.test(l))
    expect(jobs).toEqual(['  legacy:', '  validacao:'])
  })

  it('preserva o ambiente que o workflow legado usava, sem migrar para Windows', () => {
    const yml = gerarWorkflowDoPerfil(perfilLegado('legado', comandos))
    expect(yml).toContain('runs-on: ubuntu-latest')
    expect(yml).not.toContain('windows-latest')
  })
})
