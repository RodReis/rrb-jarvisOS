/**
 * O workflow gerado a partir do perfil (SPEC-Pipeline-01 R2, §5).
 *
 * Separado de `ci-workflow.ts` de propósito. Aquele gerador serve o pacote **legado**, que declara
 * quatro comandos fixos e nada mais; este serve o perfil. Fundi-los faria um único gerador com um
 * `if` na entrada decidindo qual contrato está lendo — e a spec (§4) manda o fallback legado não
 * paralelizar nem migrar por iniciativa própria. Dois geradores, duas garantias.
 *
 * O que este arquivo resolve e o legado não resolvia:
 *
 *  - **Runtime declarado.** Python não recebe `npm ci` porque o perfil diz `python`, não porque o
 *    gerador adivinhou pela presença de um arquivo.
 *  - **Paralelismo por grupo.** Grupos viram jobs distintos, e o GitHub os roda em paralelo. O
 *    agregado `validacao` depende de todos e é o único context que a proteção exige.
 *  - **Sem CI duplicado.** Só `pull_request`. O legado disparava também em `push`, e o critério 8
 *    recusa: um push de branch com PR aberto rodava a suíte duas vezes.
 *  - **Injeção de expressão do provedor.** Escape POSIX não neutraliza `${{ ... }}`, que o GitHub
 *    expande **antes** do shell ver a linha. Ver `comoArgumento`.
 */

import type { PerfilDeCi, ValidacaoDoPerfil } from './ci-profile'
import { NOME_DO_JOB_AGREGADO, VERSAO_DO_GERADOR } from './ci-profile'

/** Onde o GitHub Actions lê o workflow. O mesmo caminho do gerador legado. */
export const CAMINHO_DO_WORKFLOW_DO_PERFIL = '.github/workflows/ci.yml'

/**
 * A marca do cabeçalho do arquivo gerado.
 *
 * É o que distingue "workflow que a pipeline escreveu" de "workflow que um humano escreveu". Sem
 * ela, a única forma de decidir se pode reescrever seria comparar substrings de comandos — que é
 * como o gerador legado decide, e o que a spec (§6) chama de nunca concluir equivalência apenas
 * por encontrar um `run:`.
 */
export const MARCA_DO_WORKFLOW_GERADO = '# Gerado pela pipeline a partir do perfil'

/** A action de setup por runtime, e o nome do campo de versão que cada uma entende. */
const SETUP_POR_RUNTIME = {
  node: { action: 'actions/setup-node@v4', campo: 'node-version' },
  python: { action: 'actions/setup-python@v5', campo: 'python-version' }
} as const

/** O runner por sistema. Fixado por nome, nunca por `latest` implícito de outra plataforma. */
const RUNNER_POR_SISTEMA = {
  windows: 'windows-latest',
  linux: 'ubuntu-latest'
} as const

/** Caractere de controle, incluindo quebra de linha. Testado sem literal cru no fonte. */
function temCaractereDeControle(token: string): boolean {
  for (const c of token) {
    const codigo = c.codePointAt(0) ?? 0
    if (codigo < 0x20 || codigo === 0x7f) return true
  }
  return false
}

/**
 * Um argumento de argv virando token de linha de comando.
 *
 * **Três ameaças, não uma.** O critério 18 exige as três, e o gerador legado só trata a primeira.
 *
 *  1. *O shell.* `['npm','test','--grep','dois casos']` juntado com espaço faz o runner ver dois
 *     argumentos onde o perfil declara um. Aspas simples resolvem: o shell não interpreta nada
 *     dentro delas, e a aspa simples em si fecha, escapa e reabre (`'o'\''brien'`).
 *  2. *O YAML.* Uma quebra de linha **crua** sobrevive às aspas do shell: `run: echo 'a` numa
 *     linha e `b'` na seguinte é YAML quebrado, não um argumento com `\n`. Aspas simples não
 *     protegem aqui porque a ameaça é do formato do arquivo, não do interpretador. O comentário
 *     do gerador legado afirma que "quebra de linha entra escapada pelo mesmo mecanismo": isso
 *     não é verdade, e foi medido gerando o arquivo.
 *  3. *O provedor.* `${{ secrets.X }}` é expandido pelo **GitHub**, antes de existir shell algum.
 *     Aspas simples não o alcançam: elas são texto para o expansor. Um argv hostil contendo
 *     `${{ ... }}` vazaria segredo ou alteraria o YAML.
 *
 * As respostas, na ordem em que se aplicam. Para (2), o token é serializado como **string JSON**
 * quando contém caractere de controle: JSON escapa `\n` como dois caracteres, e o YAML de aspas
 * duplas lê essa escapada com o mesmo significado — o argumento chega ao shell com a quebra
 * dentro, numa linha só. Para (3), quebra-se a sequência `${{`, que só é especial junta.
 */
function comoArgumento(token: string): string {
  // O conjunto seguro exclui `$`, `{` e `}` — os três que compõem uma expressão do provedor.
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(token)) return token

  // Caractere de controle não pode entrar em aspas simples: ele quebraria a linha do YAML.
  // Aspas duplas do YAML entendem as escapadas do JSON, e é isso que mantém o valor intacto.
  if (temCaractereDeControle(token)) return JSON.stringify(token)

  const citado = `'${token.replace(/'/g, "'\\''")}'`
  // Quebra `${{` sem mudar o que o shell lê: fecha a aspa, emite `$` isolado, reabre.
  return citado.replace(/\$\{\{/g, `$'"'"'{{`)
}

/** Um comando de argv virando a linha `run:` do passo. */
function comoLinhaDeRun(argv: readonly string[]): string {
  return argv.map(comoArgumento).join(' ')
}

/**
 * O identificador do job a partir do nome do grupo.
 *
 * O GitHub aceita letra, dígito, `-` e `_` no id do job. Um grupo chamado "testes de banco" viraria
 * YAML inválido. Normaliza sem inventar: minúsculas, o resto vira `-`.
 */
function comoIdDeJob(grupo: string): string {
  const normalizado = grupo
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalizado === '' ? 'grupo' : normalizado
}

/** Os grupos, na ordem em que aparecem no perfil. Ordem estável é o que dá bytes iguais. */
function gruposDoPerfil(perfil: PerfilDeCi): readonly string[] {
  const vistos: string[] = []
  for (const v of perfil.validacoes) {
    if (!vistos.includes(v.grupo)) vistos.push(v.grupo)
  }
  return vistos
}

/**
 * De quais grupos um grupo depende.
 *
 * Uma dependência entre validações de grupos diferentes vira dependência entre os **jobs**. Dentro
 * do mesmo grupo ela já está satisfeita: os passos correm em sequência no mesmo job.
 */
function gruposDeQueDepende(
  grupo: string,
  perfil: PerfilDeCi,
  grupoPorId: ReadonlyMap<string, string>
): readonly string[] {
  const deps: string[] = []
  for (const v of perfil.validacoes) {
    if (v.grupo !== grupo) continue
    for (const dep of v.dependeDe ?? []) {
      const grupoDaDep = grupoPorId.get(dep)
      if (grupoDaDep === undefined || grupoDaDep === grupo) continue
      if (!deps.includes(grupoDaDep)) deps.push(grupoDaDep)
    }
  }
  return deps
}

/** O passo de instalação do runtime. */
function passosDeAmbiente(perfil: PerfilDeCi): string {
  const setup = SETUP_POR_RUNTIME[perfil.runtime]
  return (
    '      - uses: actions/checkout@v4\n' +
    `      - uses: ${setup.action}\n` +
    '        with:\n' +
    `          ${setup.campo}: ${JSON.stringify(perfil.versaoDoRuntime)}\n` +
    '      - name: install\n' +
    `        run: ${comoLinhaDeRun(perfil.instalacao.argv)}\n` +
    (perfil.instalacao.cwd === undefined
      ? ''
      : `        working-directory: ${JSON.stringify(perfil.instalacao.cwd)}\n`)
  )
}

/** Um passo de validação. */
function passoDeValidacao(v: ValidacaoDoPerfil): string {
  return (
    `      - name: ${JSON.stringify(v.nome)}\n` +
    `        run: ${comoLinhaDeRun(v.argv)}\n` +
    (v.cwd === undefined ? '' : `        working-directory: ${JSON.stringify(v.cwd)}\n`)
  )
}

/**
 * O workflow, a partir do perfil validado.
 *
 * Determinístico por construção: mesma entrada e mesma `VERSAO_DO_GERADOR`, mesmos bytes. É o que
 * faz o critério 4 valer sem depender de sorte na serialização — nada aqui itera um `Set`, lê hora
 * ou usa `Object.keys` de objeto montado dinamicamente.
 *
 * **Chamar só com perfil sem problemas.** `validarPerfilDeCi` é o gate; este gerador presume o
 * perfil já aceito. Um perfil cíclico chegando aqui produziria `needs` circular, e o GitHub
 * recusaria o arquivo depois de ele já estar escrito e commitado — tarde demais, contra o
 * critério 3, que exige falhar *antes* da escrita.
 */
export function gerarWorkflowDoPerfil(perfil: PerfilDeCi): string {
  const grupos = gruposDoPerfil(perfil)
  const grupoPorId = new Map(perfil.validacoes.map((v) => [v.id, v.grupo]))
  const idDoJob = new Map(grupos.map((g) => [g, comoIdDeJob(g)]))

  const jobs = grupos.map((grupo) => {
    const deps = gruposDeQueDepende(grupo, perfil, grupoPorId).map((g) => idDoJob.get(g) ?? g)
    const validacoes = perfil.validacoes.filter((v) => v.grupo === grupo)

    return (
      `  ${idDoJob.get(grupo) ?? grupo}:\n` +
      `    runs-on: ${RUNNER_POR_SISTEMA[perfil.sistema]}\n` +
      `    timeout-minutes: ${perfil.timeoutEmMinutos}\n` +
      (deps.length === 0 ? '' : `    needs: [${deps.join(', ')}]\n`) +
      '    defaults:\n      run:\n' +
      `        shell: ${perfil.shell}\n` +
      '    steps:\n' +
      passosDeAmbiente(perfil) +
      validacoes.map(passoDeValidacao).join('')
    )
  })

  // O agregado. `always()` para ele rodar mesmo com dependência falha — sem isso, um job vermelho
  // deixaria o context `validacao` **ausente**, e ausência não é falha para a proteção da branch:
  // o gate ficaria esperando um check que nunca chega em vez de ver vermelho. Os obrigatórios são
  // conferidos pela expressão, que exige `success` e recusa `skipped` (critérios 9 e 16).
  const obrigatorios = grupos.filter((g) =>
    perfil.validacoes.some((v) => v.grupo === g && v.obrigatoria !== false)
  )
  const idsObrigatorios = obrigatorios.map((g) => idDoJob.get(g) ?? g)
  // Sem grupo obrigatório, a condição seria vazia e `!()` não compila como expressão. O perfil já
  // é recusado por `sem-validacao-obrigatoria` antes de chegar aqui; `false` mantém o gerador
  // total sem inventar sucesso — o passo falharia, que é o lado seguro.
  const condicao =
    idsObrigatorios.length === 0
      ? 'false'
      : idsObrigatorios.map((id) => `needs.${id}.result == 'success'`).join(' && ')

  const agregado =
    `  ${NOME_DO_JOB_AGREGADO}:\n` +
    `    runs-on: ${RUNNER_POR_SISTEMA[perfil.sistema]}\n` +
    `    needs: [${grupos.map((g) => idDoJob.get(g) ?? g).join(', ')}]\n` +
    '    if: always()\n' +
    '    steps:\n' +
    '      - name: exigir sucesso das validações obrigatórias\n' +
    `        if: ${JSON.stringify(`\${{ !(${condicao}) }}`)}\n` +
    '        run: exit 1\n'

  return (
    `${MARCA_DO_WORKFLOW_GERADO} ${perfil.profileId}.\n` +
    `# Versão do gerador: ${VERSAO_DO_GERADOR}. Não editar à mão: a edição é preservada, mas\n` +
    '# a pipeline deixa de poder comprovar equivalência e bloqueia a adoção.\n' +
    `name: ${NOME_DO_JOB_AGREGADO}\n` +
    '\n' +
    'on:\n' +
    '  pull_request:\n' +
    '\n' +
    // Cancela apenas execução anterior **do mesmo PR** (critério 7). `github.ref` distingue PRs
    // entre si; agrupar por workflow só cancelaria PRs alheios.
    'concurrency:\n' +
    '  group: ${{ github.workflow }}-${{ github.ref }}\n' +
    '  cancel-in-progress: true\n' +
    '\n' +
    'jobs:\n' +
    jobs.join('\n') +
    '\n' +
    agregado
  )
}
