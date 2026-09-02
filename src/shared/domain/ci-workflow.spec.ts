import { describe, expect, it } from 'vitest'
import {
  CAMINHO_DO_WORKFLOW,
  NOME_DO_JOB_DE_CI,
  gerarWorkflowDeCi,
  precisaReescreverWorkflow,
  type ComandosDeValidacao
} from './ci-workflow'

const COMANDOS: ComandosDeValidacao = {
  test: ['npm', 'test'],
  lint: ['npm', 'run', 'lint'],
  typecheck: ['npm', 'run', 'typecheck'],
  build: ['npm', 'run', 'build']
}

describe('gerarWorkflowDeCi — critério 9', () => {
  it('põe os quatro comandos declarados no arquivo', () => {
    // São os **mesmos** que o executor roda no container. Gerar comandos diferentes faria o verde
    // da origem afirmar algo que a validação local nunca verificou — a equivalência que a emenda
    // de 2026-08-30 recusou.
    const yml = gerarWorkflowDeCi(COMANDOS)

    expect(yml).toContain('run: npm test')
    expect(yml).toContain('run: npm run lint')
    expect(yml).toContain('run: npm run typecheck')
    expect(yml).toContain('run: npm run build')
  })

  it('nomeia o job com o nome fixo que a proteção vai exigir', () => {
    // É este nome que vira o *context* obrigatório na branch-base. Um nome gerado a cada run
    // produziria um check novo que a proteção não exige, e o gate nunca o encontraria.
    const yml = gerarWorkflowDeCi(COMANDOS)

    expect(yml).toContain(`${NOME_DO_JOB_DE_CI}:`)
    expect(NOME_DO_JOB_DE_CI).toBe('validacao')
  })

  it('dispara em pull_request, que é onde o gate lê o resultado', () => {
    expect(gerarWorkflowDeCi(COMANDOS)).toContain('pull_request:')
  })

  it('é determinístico: mesmos comandos, mesmo arquivo', () => {
    // Sem isto, cada run reescreveria o arquivo e o critério 9 ("o run seguinte não o reescreve")
    // dependeria de sorte na serialização.
    expect(gerarWorkflowDeCi(COMANDOS)).toBe(gerarWorkflowDeCi({ ...COMANDOS }))
  })

  it('escapa argumento com espaço em vez de quebrar a linha do YAML', () => {
    // `join(' ')` ingênuo produziria `run: npm run test -- --grep dois casos`, que o runner
    // interpreta como argumentos separados. O comando declarado tem um argumento só.
    const yml = gerarWorkflowDeCi({
      ...COMANDOS,
      test: ['npm', 'run', 'test', '--', '--grep', 'dois casos']
    })

    expect(yml).toContain("'dois casos'")
  })

  it('escapa aspas simples dentro do argumento', () => {
    const yml = gerarWorkflowDeCi({ ...COMANDOS, test: ['echo', "o'brien"] })

    // Em shell POSIX, `'` dentro de aspas simples fecha e reabre: `'o'\''brien'`.
    expect(yml).toContain("'o'\\''brien'")
  })

  it('não deixa o comando escapar para outra linha do YAML', () => {
    // Um argumento com quebra de linha viraria uma linha solta no YAML — no melhor caso um
    // arquivo inválido, no pior um passo que ninguém declarou.
    const yml = gerarWorkflowDeCi({ ...COMANDOS, test: ['echo', 'a\nb'] })
    const linhasDeRun = yml.split('\n').filter((l) => l.includes('run:'))

    expect(linhasDeRun).toHaveLength(5) // npm ci + os quatro declarados
  })
})

describe('precisaReescreverWorkflow — critério 9', () => {
  it('cria quando o arquivo ainda não existe', () => {
    expect(precisaReescreverWorkflow(undefined, COMANDOS)).toBe(true)
  })

  it('não reescreve o arquivo que já declara os mesmos comandos', () => {
    expect(precisaReescreverWorkflow(gerarWorkflowDeCi(COMANDOS), COMANDOS)).toBe(false)
  })

  it('reescreve quando um comando declarado muda', () => {
    const atual = gerarWorkflowDeCi(COMANDOS)

    expect(precisaReescreverWorkflow(atual, { ...COMANDOS, test: ['npm', 'run', 'test:ci'] })).toBe(
      true
    )
  })

  it('não reescreve por diferença cosmética fora dos comandos', () => {
    // Compara **os comandos**, não o texto: um arquivo que alguém comentou ou reindentou continua
    // declarando os mesmos comandos, e reescrevê-lo apagaria a edição de um humano por cosmética —
    // o que a spec proíbe em letra.
    const editado = `${gerarWorkflowDeCi(COMANDOS)}\n# rodamos isto também no nightly\n`

    expect(precisaReescreverWorkflow(editado, COMANDOS)).toBe(false)
  })

  it('não reescreve arquivo que alguém reescreveu à mão mantendo os comandos', () => {
    const aMao = [
      'name: ci-do-time',
      'on: [pull_request]',
      'jobs:',
      '  validacao:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm run lint',
      '      - run: npm run typecheck',
      '      - run: npm test',
      '      - run: npm run build'
    ].join('\n')

    expect(precisaReescreverWorkflow(aMao, COMANDOS)).toBe(false)
  })

  it('reescreve quando um comando some do arquivo editado à mão', () => {
    const semBuild = gerarWorkflowDeCi(COMANDOS)
      .split('\n')
      .filter((l) => !l.includes('npm run build'))
      .join('\n')

    expect(precisaReescreverWorkflow(semBuild, COMANDOS)).toBe(true)
  })

  it('o caminho do workflow é o que o GitHub Actions lê', () => {
    expect(CAMINHO_DO_WORKFLOW).toBe('.github/workflows/ci.yml')
  })
})
