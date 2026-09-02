/**
 * O workflow de CI que a pipeline gera no projeto-alvo (SPEC-Entrega-05, critério 9).
 *
 * A razão de existir: o projeto criado pelo MVP-008 **não nasce com CI**, e `checksAprovam` recusa
 * lista vazia de checks. Sem esta geração, nenhum run chegaria a `MERGED` — não por defeito, mas
 * porque não haveria verde nenhum na origem para o gate conferir.
 *
 * O PI decidiu por **gerar o workflow** (2026-08-30). As alternativas postas eram aceitar a
 * validação local como equivalente — que quebraria a invariante do critério 3, verde sem
 * corresponder ao `head SHA` na origem — ou nunca mergear sem CI configurado à mão.
 *
 * O arquivo é criado **uma vez, no primeiro run**, dentro do mesmo PR da fatia, e só reescrito
 * quando os comandos declarados mudam. Nunca por cosmética.
 */

/** Onde o GitHub Actions lê o workflow. */
export const CAMINHO_DO_WORKFLOW = '.github/workflows/ci.yml'

/**
 * O nome do job, fixo.
 *
 * É ele que vira o *context* obrigatório na proteção da branch-base. Um nome gerado a cada run
 * produziria um check novo que a proteção não exige, e o gate procuraria por um nome que a origem
 * nunca exigiu — verde que não conta.
 */
export const NOME_DO_JOB_DE_CI = 'validacao'

/**
 * Os comandos de validação declarados no pacote do projeto.
 *
 * Mora aqui, e não junto do `ConstrutorService`, porque o gerador (`src/shared`) precisa deles e
 * `src/shared` não pode importar de `src/main` — é compilado também para o renderer.
 */
export interface ComandosDeValidacao {
  readonly test: readonly string[]
  readonly lint: readonly string[]
  readonly typecheck: readonly string[]
  readonly build: readonly string[]
}

/**
 * Um argumento de argv virando token de linha de comando.
 *
 * Sem isto, `['npm', 'run', 'test', '--grep', 'dois casos'].join(' ')` produziria um `run:` em que
 * o runner vê dois argumentos onde o comando declarado tem um — o container e a origem passariam a
 * rodar coisas diferentes, que é justamente o que o critério 9 existe para impedir.
 *
 * Aspas simples porque o shell não interpreta nada dentro delas; a aspa simples em si fecha,
 * escapa e reabre (`'o'\''brien'`), que é a forma POSIX. Quebra de linha entra escapada pelo mesmo
 * mecanismo — um `\n` cru viraria uma linha solta no YAML.
 */
function comoArgumento(token: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(token)) return token
  return `'${token.replace(/'/g, "'\\''")}'`
}

/** Um comando de argv virando a linha `run:` do passo. */
function comoLinhaDeRun(comando: readonly string[]): string {
  return comando.map(comoArgumento).join(' ')
}

/**
 * O workflow, a partir dos comandos declarados no pacote.
 *
 * Determinístico por construção: mesma entrada, mesmo texto. É o que faz "o run seguinte não o
 * reescreve" (critério 9) valer sem depender de sorte na serialização.
 */
export function gerarWorkflowDeCi(comandos: ComandosDeValidacao): string {
  const passo = (nome: string, comando: readonly string[]): string =>
    `      - name: ${nome}\n        run: ${comoLinhaDeRun(comando)}\n`

  return (
    `name: ${NOME_DO_JOB_DE_CI}\n` +
    '\n' +
    'on:\n' +
    '  pull_request:\n' +
    '  push:\n' +
    '\n' +
    'jobs:\n' +
    `  ${NOME_DO_JOB_DE_CI}:\n` +
    '    runs-on: ubuntu-latest\n' +
    '    steps:\n' +
    '      - uses: actions/checkout@v4\n' +
    '      - uses: actions/setup-node@v4\n' +
    "        with:\n          node-version: '22'\n" +
    '      - name: install\n        run: npm ci\n' +
    passo('lint', comandos.lint) +
    passo('typecheck', comandos.typecheck) +
    passo('test', comandos.test) +
    passo('build', comandos.build)
  )
}

/**
 * O arquivo precisa ser (re)escrito?
 *
 * Compara **os comandos**, não o texto. Um arquivo que alguém comentou, reindentou ou reescreveu à
 * mão continua declarando os mesmos comandos, e sobrescrevê-lo apagaria a edição de um humano por
 * cosmética — o que a spec proíbe em letra. O que justifica reescrever é o pacote declarar um
 * comando que o arquivo não roda: aí a origem deixou de verificar o que o container verifica.
 */
export function precisaReescreverWorkflow(
  atual: string | undefined,
  comandos: ComandosDeValidacao
): boolean {
  if (atual === undefined) return true

  return [comandos.lint, comandos.typecheck, comandos.test, comandos.build].some(
    (comando) => !atual.includes(`run: ${comoLinhaDeRun(comando)}`)
  )
}
