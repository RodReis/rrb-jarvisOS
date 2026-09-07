/**
 * As capacidades de automação do GitHub — contratos e decisões puras (SPEC-Conectores-04).
 *
 * A fatia entrega **capacidade, não orquestração**: cada operação sabe garantir um recurso e
 * devolver a referência dele. *Quando* usá-las é do MVP-009, e a spec repete isso de propósito —
 * é o que impede esta fatia de crescer para dentro da entrega autônoma.
 *
 * O que mora aqui: a forma de cada entrada, a validação delas, e as regras que decidem sem tocar
 * a rede — se um check satisfaz o gate, se um 404 é ausência ou falta de permissão, qual chave
 * externa determinística uma mutação carrega. O que **não** mora: a chamada HTTP, que é do
 * adapter, e a decisão de retentar, que é da governança da F02.
 *
 * A separação é a mesma de `github-auth.ts` sobre `github-auth-service.ts`, e pela mesma razão:
 * afirmar que "um check de outro SHA não satisfaz o gate" não precisa de rede, e um teste que
 * precisasse de rede para dizer isso estaria medindo a rede.
 */

import type { ConnectorCapability, ConnectorError, ConnectorErrorCode } from './connectors'

/**
 * A versão da REST API, fixada (spec § Regras: "fixar versão da REST API").
 *
 * Constante e não configuração: o formato das respostas que este código lê pertence a **esta**
 * versão, e deixá-la variável faria o app pedir um contrato que os parsers não conhecem. Subir a
 * versão é mudar o código junto, não trocar um valor.
 */
export const GITHUB_API_VERSION = '2022-11-28'

/** A origem da API REST. Distinta da origem do OAuth — são dois hosts no GitHub. */
export const GITHUB_API_ORIGIN = 'https://api.github.com'

/**
 * A origem efetiva da API REST, com override de **ambiente do main**.
 *
 * Mesmo desenho e mesmas garantias de `origemDoOAuth` (SPEC-Conectores-03): existe para o teste
 * de integração e o E2E apontarem a um servidor local que conta requisições, é lida do processo
 * main (nenhum canal IPC a alcança), e `new URL(…).origin` descarta caminho, query e fragmento —
 * o override troca o **servidor**, nunca a rota.
 */
export function origemDaApi(override?: string): string {
  const limpo = override?.trim()
  if (limpo === undefined || limpo === '') return GITHUB_API_ORIGIN

  try {
    const url = new URL(limpo)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : GITHUB_API_ORIGIN
  } catch {
    return GITHUB_API_ORIGIN
  }
}

/** O par que endereça um repositório. Aparece em toda operação desta fatia. */
export interface RepoAlvo {
  readonly owner: string
  readonly repo: string
}

/**
 * As operações que o adapter passa a declarar.
 *
 * Nomes namespaced por ponto, como o resto do projeto (`auth.identify`, `api.external-call`):
 * agrupáveis por prefixo na auditoria sem parsear payload.
 *
 * `ensure*` para o que é idempotente por construção (procura antes de criar) e verbo simples para
 * o que só lê. A diferença é visível no nome porque é a diferença que importa ao chamador: repetir
 * um `ensure` é seguro, repetir um `get` também, e `merge` é o único que muda o mundo de forma
 * irreversível — e por isso é o único que exige `expectedHeadSha`.
 */
export const GITHUB_OPERATIONS = {
  ensureRepository: 'repo.ensure',
  ensureIssue: 'issue.ensure',
  ensureIssueDependency: 'issue.ensure-dependency',
  ensureBranchRef: 'ref.ensure',
  ensurePullRequest: 'pr.ensure',
  getChecksForHead: 'checks.for-head',
  getWorkflowRunsForHead: 'actions.runs-for-head',
  squashMerge: 'pr.squash-merge',
  getMergeState: 'pr.merge-state',
  setDefaultBranch: 'repo.set-default-branch',
  ensureBranchProtection: 'branch.ensure-protection',
  getCommitSha: 'commit.sha-for-ref',
  ensureLabel: 'label.ensure',
  getRequiredChecks: 'checks.required-for-branch'
} as const

export type GithubOperation = (typeof GITHUB_OPERATIONS)[keyof typeof GITHUB_OPERATIONS]

/**
 * As capacidades declaradas ao núcleo (critério 1 da F01: declaradas, não descobertas).
 *
 * `effect` separa leitura de mutação, e é o que a governança da F02 usa para exigir chave de
 * idempotência: mutação sem ela nunca é repetida automaticamente. As quatro leituras não a
 * exigem porque repetir uma consulta é seguro por natureza.
 */
export const GITHUB_CAPABILITIES: readonly ConnectorCapability[] = [
  {
    connector: 'github',
    operation: 'auth.identify',
    effect: 'leitura',
    descricao: 'Confirma quem está autenticado e se a GitHub App tem acesso à conta.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensureRepository,
    effect: 'mutacao',
    descricao: 'Garante que o repositório existe, criando-o apenas se ainda não existir.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensureIssue,
    effect: 'mutacao',
    descricao: 'Garante uma issue com a chave externa informada, reusando a que já existir.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensureIssueDependency,
    effect: 'mutacao',
    descricao: 'Garante o vínculo pai/filho entre duas issues pela API de sub-issues.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensureBranchRef,
    effect: 'mutacao',
    descricao: 'Garante que um branch aponta para o commit informado.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensurePullRequest,
    effect: 'mutacao',
    descricao: 'Garante um pull request para o head informado, reusando o que já estiver aberto.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.getChecksForHead,
    effect: 'leitura',
    descricao: 'Lista os checks de um commit específico, com SHA e conclusão normalizados.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.getWorkflowRunsForHead,
    effect: 'leitura',
    descricao: 'Lista as execuções de workflow de um commit específico.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.squashMerge,
    effect: 'mutacao',
    descricao: 'Faz squash merge de um pull request, exigindo que o head ainda seja o esperado.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.getMergeState,
    effect: 'leitura',
    descricao: 'Consulta na origem se o pull request está mesmo mergeado, e com qual commit.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.setDefaultBranch,
    effect: 'mutacao',
    descricao: 'Define a branch base do repositório, quando ela ainda não é a informada.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensureBranchProtection,
    effect: 'mutacao',
    descricao: 'Garante a proteção da branch base com a revisão exigida antes do merge.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.getCommitSha,
    effect: 'leitura',
    descricao: 'Lê o commit para onde uma ref aponta na origem, para conferir o que foi publicado.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.ensureLabel,
    effect: 'mutacao',
    descricao: 'Garante que o rótulo existe no repositório, criando-o apenas se ainda não existir.'
  },
  {
    connector: 'github',
    operation: GITHUB_OPERATIONS.getRequiredChecks,
    effect: 'leitura',
    descricao: 'Lê da origem quais checks a proteção da branch exige antes de permitir o merge.'
  }
]

/** Entrada de `repo.ensure`. */
export interface EnsureRepositoryInput extends RepoAlvo {
  readonly visibility: 'private' | 'public'
  readonly description?: string
}

/**
 * Entrada de `issue.ensure`.
 *
 * `externalKey` é a **chave externa determinística** que a spec exige de toda mutação: derivada do
 * par MVP/Fatia/SPEC pelo chamador, ela é o que torna `ensure` idempotente sem depender do título,
 * que muda. Vai no corpo da issue como marcador, e é por ela que a busca acontece.
 */
export interface EnsureIssueInput extends RepoAlvo {
  readonly externalKey: string
  readonly title: string
  readonly body: string
  readonly labels?: readonly string[]
}

/** Entrada de `issue.ensure-dependency`: o número da issue pai e o da filha. */
export interface EnsureIssueDependencyInput extends RepoAlvo {
  readonly parentIssue: number
  readonly childIssue: number
}

/** Entrada de `ref.ensure`: o branch e o commit para onde ele aponta. */
export interface EnsureBranchRefInput extends RepoAlvo {
  readonly branch: string
  readonly sha: string
}

/** Entrada de `pr.ensure`. `head` e `base` são nomes de branch, não SHAs. */
export interface EnsurePullRequestInput extends RepoAlvo {
  readonly head: string
  readonly base: string
  readonly title: string
  readonly body: string
}

/** Entrada das leituras por commit. */
export interface HeadShaInput extends RepoAlvo {
  readonly sha: string
}

/** Entrada de `pr.squash-merge`. */
export interface SquashMergeInput extends RepoAlvo {
  readonly pullRequest: number
  /**
   * O SHA que o head do PR **precisa** ter para o merge acontecer (critério 5).
   *
   * Obrigatório, e não opcional com default: sem ele o GitHub mergeia o que estiver lá, e um push
   * que chegou entre a leitura dos checks e o merge entraria sem ter sido verificado. É o mesmo
   * cuidado do `expectedHeadSha` que a M9-F05 já previa.
   */
  readonly expectedHeadSha: string
}

/**
 * Entrada de `label.ensure`.
 *
 * O rótulo é identificado **pelo nome**, que é como o GitHub o endereça — não há id estável a
 * guardar. `cor` sem `#`, como a API espera; `descricao` é opcional porque rótulo sem descrição é
 * legítimo, e mandar string vazia sobrescreveria uma descrição existente por nada.
 */
export interface EnsureLabelInput extends RepoAlvo {
  readonly nome: string
  readonly cor: string
  readonly descricao?: string
}

/**
 * Entrada de `repo.set-default-branch`.
 *
 * A branch precisa **existir** na origem antes: o GitHub recusa apontar a default para uma ref que
 * não está lá, e é por isso que a publicação define a base depois do primeiro push, não antes.
 */
export interface SetDefaultBranchInput extends RepoAlvo {
  readonly branch: string
}

/**
 * Entrada de `branch.ensure-protection`.
 *
 * `revisoesExigidas: 0` é legítimo e diferente de "sem proteção": mantém o gate de checks e a
 * proibição de force-push, sem exigir um revisor humano — que é a configuração de um repositório
 * cujo merge é autônomo (decisão 2 do MVP-009). Quem quer revisor pede 1 ou mais.
 */
export interface EnsureBranchProtectionInput extends RepoAlvo {
  readonly branch: string
  readonly revisoesExigidas: number
  /**
   * Os checks que precisam passar. Vazio significa "nenhum check exigido" — e não é o mesmo que
   * omitir: omitido, o GitHub mantém o que já estava configurado; vazio, ele limpa a lista.
   */
  readonly checksExigidos?: readonly string[]
}

/**
 * Entrada de `commit.sha-for-ref`: a ref cujo commit se quer ler na origem.
 *
 * Aceita nome de branch (`main`), tag ou SHA — é o que `GET /commits/{ref}` aceita. Serve ao
 * critério 2 (*"commits locais aprovados correspondem à branch remota"*): sem ler o que está lá, a
 * correspondência seria afirmada a partir do que mandamos, e um push parcial passaria por completo.
 */
export interface CommitShaInput extends RepoAlvo {
  readonly ref: string
}

/** Entrada de `pr.merge-state`. */
export interface PullRequestInput extends RepoAlvo {
  readonly pullRequest: number
}

/** Um check normalizado — SHA e conclusão, sem o objeto do GitHub (critério 4). */
export interface CheckNormalizado {
  readonly nome: string
  /** O commit que este check avaliou. É por ele que o gate decide, nunca pelo nome. */
  readonly headSha: string
  readonly status: 'queued' | 'in_progress' | 'completed'
  /** `undefined` enquanto não terminou. Ausência é "ainda não se sabe", não "falhou". */
  readonly conclusao?:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'timed_out'
    | 'action_required'
    | 'skipped'
    | 'stale'
  readonly url?: string
  /**
   * Quem emitiu o check (o `slug` do app no GitHub), quando a origem informa.
   *
   * O critério 11 da SPEC-Pipeline-01 exige validar o emissor quando a regra da origem o
   * especifica: **nome de check não é identidade**. Qualquer app com permissão de escrita pode
   * publicar um check chamado `validacao` e verde, e o gate que só olha o nome aceitaria a
   * afirmação de um terceiro como se fosse do CI do repositório.
   *
   * Opcional porque nem toda origem informa, e ausência não pode virar bloqueio de projeto que
   * nunca declarou emissor esperado — ver `checkTemEmissorEsperado`.
   */
  readonly emissor?: string
  /**
   * A tentativa da execução que produziu este check, quando a origem informa.
   *
   * Também do critério 11: uma tentativa **antiga** do mesmo workflow, no mesmo head, tem o mesmo
   * nome e pode estar verde enquanto a corrente falhou. Sem este campo, "o check verde existe" e
   * "o CI aprovou agora" são indistinguíveis.
   */
  readonly tentativa?: number
}

/** Uma execução de workflow normalizada. */
export interface WorkflowRunNormalizado {
  readonly nome: string
  readonly headSha: string
  readonly status: string
  readonly conclusao?: string
  readonly url?: string
}

/** Entrada de `checks.required-for-branch`. */
export interface RequiredChecksInput extends RepoAlvo {
  readonly branch: string
}

/**
 * O conjunto obrigatório de checks **lido da origem** (critério 11 da SPEC-Entrega-05).
 *
 * Existe porque o gate de merge não pode comparar com a regra que *nós* escrevemos num run
 * anterior: entre o início do run e o merge, alguém pode acrescentar um check obrigatório, e um
 * snapshot tirado da nossa própria escrita nunca veria essa mudança.
 *
 * **`protegida: false` não é "sem exigência"** — é ausência de regra, e quem decide o que fazer com
 * ela é o gate, que a trata como bloqueio explicável. Verde por omissão é exatamente o que o
 * critério 10 existe para impedir.
 */
export interface RequiredChecksNormalizado {
  readonly branch: string
  /** Os *contexts* que a proteção exige. Vazio quando a branch não tem proteção. */
  readonly contexts: readonly string[]
  /** A origem exige que o branch esteja atualizado com a base antes do merge? */
  readonly strict: boolean
  readonly protegida: boolean
  /** A origem exige merge queue? Nesse caso a pipeline não tenta contorná-la (critério 12). */
  readonly mergeQueueExigida: boolean
}

/** O que `pr.merge-state` devolve — **consultado na origem**, nunca deduzido. */
export interface MergeStateNormalizado {
  readonly numero: number
  readonly estado: 'open' | 'closed'
  readonly merged: boolean
  /**
   * O commit do merge, quando ele **de fato** aconteceu.
   *
   * Só presente com `merged: true`, e a razão é uma armadilha real da API: em PR **aberto**, o
   * `merge_commit_sha` é o SHA de um *test merge commit* — um commit que o GitHub calcula para
   * saber se dá conflito, e que não está em branch nenhum. Repassá-lo como se fosse o merge faria
   * o chamador declarar entregue algo que não foi mergeado (spec § Regras: "nunca declarar merge
   * sem consultar a origem").
   */
  readonly mergeSha?: string
  readonly headSha: string
}

/**
 * O marcador da chave externa dentro do corpo da issue.
 *
 * Um comentário HTML, invisível no render do GitHub: a chave é infraestrutura de idempotência, não
 * conteúdo que alguém deva ler. Colocá-la como texto visível poluiria toda issue criada pelo app
 * com um identificador que só o app entende.
 */
export function marcadorDeChaveExterna(externalKey: string): string {
  return `<!-- jarvis-key: ${externalKey} -->`
}

/** O corpo da issue já com o marcador. Idempotente: não duplica o marcador se já houver um. */
export function corpoComChaveExterna(body: string, externalKey: string): string {
  const marcador = marcadorDeChaveExterna(externalKey)
  return body.includes(marcador) ? body : `${body}\n\n${marcador}`
}

/** O corpo contém aquela chave externa? É como `ensureIssue` reconhece o que já criou. */
export function corpoTemChaveExterna(body: string | undefined, externalKey: string): boolean {
  return typeof body === 'string' && body.includes(marcadorDeChaveExterna(externalKey))
}

/**
 * Um check satisfaz o gate para aquele commit? (critério: "check de outro SHA não satisfaz").
 *
 * Duas condições, e a primeira é a que a spec cobra: o check precisa ter avaliado **este** commit.
 * Um check verde de um push anterior diz que o código de ontem passava — e é exatamente o engano
 * que faz um merge entrar sem verificação depois de um push de última hora.
 *
 * Função pura sobre dado já normalizado: é o que permite provar a regra sem rede.
 */
export function checkSatisfazGate(check: CheckNormalizado, headSha: string): boolean {
  return check.headSha === headSha && check.status === 'completed' && check.conclusao === 'success'
}

/**
 * A exigência de identidade que a origem declara para um check obrigatório.
 *
 * Opcional por projeto: a §6 da SPEC-Pipeline-01 proíbe *"mudança de nome do check obrigatório"* e
 * a §2 proíbe endurecer proteção por iniciativa própria. Exigir emissor em projeto que nunca o
 * declarou seria endurecer, e o resultado seria bloquear entrega por uma regra que ninguém pediu.
 */
export interface ExigenciaDeIdentidade {
  /** O emissor esperado (o `slug` do app). Quando ausente, o emissor não é verificado. */
  readonly emissorEsperado?: string
  /** A tentativa corrente do CI. Quando presente, check de tentativa anterior não satisfaz. */
  readonly tentativaCorrente?: number
}

/** Por que um check não serve como evidência (critério 11). */
export type RecusaDeEvidencia =
  'head-diferente' | 'nao-concluido' | 'sem-sucesso' | 'emissor-nao-confiavel' | 'tentativa-antiga'

/**
 * O check serve como evidência do gate — e por que não, quando não serve (critério 11).
 *
 * `checkSatisfazGate` responde "está verde neste SHA?". Esta função responde a pergunta que a
 * SPEC-Pipeline-01 acrescenta: **"e é de quem eu espero, da execução que está correndo?"**
 *
 * As duas checagens novas fecham buracos que o nome do check não cobre:
 *
 *  - *Emissor.* Qualquer app com permissão de escrita publica um check chamado `validacao` e
 *    verde. Sem verificar quem o emitiu, a pipeline aceita a afirmação de um terceiro como se
 *    fosse do CI do repositório.
 *  - *Tentativa.* Uma tentativa antiga do mesmo workflow, no mesmo head, tem o mesmo nome e pode
 *    estar verde enquanto a corrente falhou. "Existe check verde" e "o CI aprovou agora" só são a
 *    mesma coisa quando a tentativa bate.
 *
 * **Ausência de dado não bloqueia.** Quando a origem não informa emissor ou tentativa, ou quando o
 * projeto não declara exigência, essas duas checagens não se aplicam — a §2 proíbe endurecer a
 * proteção por conta própria, e transformar "a API não me contou" em bloqueio seria isso. O que a
 * ausência **não** faz é virar aprovação: as três checagens de sempre continuam valendo.
 */
export function recusaDaEvidencia(
  check: CheckNormalizado,
  headSha: string,
  exigencia: ExigenciaDeIdentidade = {}
): RecusaDeEvidencia | undefined {
  if (check.headSha !== headSha) return 'head-diferente'
  if (check.status !== 'completed') return 'nao-concluido'
  if (check.conclusao !== 'success') return 'sem-sucesso'

  if (
    exigencia.emissorEsperado !== undefined &&
    check.emissor !== undefined &&
    check.emissor !== exigencia.emissorEsperado
  ) {
    return 'emissor-nao-confiavel'
  }

  if (
    exigencia.tentativaCorrente !== undefined &&
    check.tentativa !== undefined &&
    check.tentativa !== exigencia.tentativaCorrente
  ) {
    return 'tentativa-antiga'
  }

  return undefined
}

/**
 * O conjunto de checks aprova aquele commit?
 *
 * **Lista vazia não aprova.** É a decisão que separa "todos passaram" de "não havia nenhum": um
 * `every` sobre lista vazia devolve `true`, e o gate diria verde para um commit que ninguém
 * verificou. Quem quiser mergear sem checks precisa dizer isso explicitamente, não herdá-lo de
 * uma propriedade da linguagem.
 */
export function checksAprovam(
  checks: readonly CheckNormalizado[],
  headSha: string
): { readonly aprovado: boolean; readonly pendentes: number; readonly falhos: number } {
  const doHead = checks.filter((c) => c.headSha === headSha)
  const pendentes = doHead.filter((c) => c.status !== 'completed').length
  const falhos = doHead.filter(
    (c) => c.status === 'completed' && c.conclusao !== 'success' && c.conclusao !== 'skipped'
  ).length

  return {
    aprovado: doHead.length > 0 && pendentes === 0 && falhos === 0,
    pendentes,
    falhos
  }
}

/**
 * O que um 404 do GitHub significa **de verdade** (critério 6).
 *
 * A armadilha que a spec nomeia: o GitHub devolve 404 tanto para "não existe" quanto para "existe,
 * mas você não pode ver" — é uma decisão de segurança dele, para não revelar a existência de
 * repositório privado a quem não tem acesso. Tratar todo 404 como ausência faria o `ensure*` criar
 * um recurso que já existe, ou reportar "não encontrado" quando o problema é permissão.
 *
 * A regra é o que se pode afirmar com honestidade: **numa operação autenticada, 404 é ambíguo** e
 * o erro precisa dizer isso. `nao-encontrado` só é afirmável quando a credencial comprovadamente
 * alcança o escopo — e comprovar isso exigiria outra chamada, que é justamente o que a fatia não
 * deve inventar. Então o código é `permissao-negada` com mensagem que nomeia as duas
 * possibilidades, em vez de escolher a errada com confiança.
 */
export function significadoDo404(autenticado: boolean): {
  readonly code: ConnectorErrorCode
  readonly mensagem: string
} {
  return autenticado
    ? {
        code: 'permissao-negada',
        mensagem:
          'O GitHub respondeu 404: o recurso não existe ou a App não tem acesso a ele. ' +
          'Confira a instalação e as permissões antes de criar de novo.'
      }
    : {
        code: 'credencial-ausente',
        mensagem: 'Conecte a conta do GitHub antes de usar este conector.'
      }
}

/**
 * Valida a entrada de uma operação, sem tocar a rede (critério 2 da F01).
 *
 * Devolve a mensagem do problema, ou `undefined`. Mensagem e não `ConnectorError` porque quem
 * monta o erro completo é o adapter, que tem a proveniência — aqui só se decide **o que** está
 * errado.
 *
 * O que se valida é forma, não existência: "o repositório existe?" é pergunta para a rede, e
 * respondê-la aqui exigiria a chamada que a validação existe para evitar.
 */
export function validarEntrada(operation: string, input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return 'A operação exige um objeto de entrada.'
  }

  const v = input as Record<string, unknown>
  const texto = (campo: string): boolean => typeof v[campo] === 'string' && v[campo] !== ''
  const inteiroPositivo = (campo: string): boolean =>
    typeof v[campo] === 'number' && Number.isInteger(v[campo]) && (v[campo] as number) > 0

  // Todas as operações endereçam um repositório. Conferir uma vez evita repetir a mesma linha
  // em nove ramos — e evita que um ramo futuro esqueça.
  if (!texto('owner') || !texto('repo')) {
    return 'Informe `owner` e `repo`.'
  }

  switch (operation) {
    case GITHUB_OPERATIONS.ensureRepository:
      return v.visibility === 'private' || v.visibility === 'public'
        ? undefined
        : '`visibility` precisa ser "private" ou "public".'

    case GITHUB_OPERATIONS.ensureIssue:
      if (!texto('externalKey'))
        return 'Informe `externalKey` — é ela que torna o ensure idempotente.'
      return texto('title') ? undefined : 'Informe `title`.'

    case GITHUB_OPERATIONS.ensureIssueDependency:
      return inteiroPositivo('parentIssue') && inteiroPositivo('childIssue')
        ? v.parentIssue === v.childIssue
          ? 'Uma issue não pode ser sub-issue dela mesma.'
          : undefined
        : 'Informe `parentIssue` e `childIssue` como números de issue.'

    case GITHUB_OPERATIONS.ensureBranchRef:
      if (!texto('branch')) return 'Informe `branch`.'
      return ehSha('sha', v) ? undefined : '`sha` precisa ser um SHA de commit.'

    case GITHUB_OPERATIONS.ensurePullRequest:
      if (!texto('head') || !texto('base')) return 'Informe `head` e `base`.'
      if (v.head === v.base) return '`head` e `base` não podem ser o mesmo branch.'
      return texto('title') ? undefined : 'Informe `title`.'

    case GITHUB_OPERATIONS.getChecksForHead:
    case GITHUB_OPERATIONS.getWorkflowRunsForHead:
      return ehSha('sha', v) ? undefined : '`sha` precisa ser um SHA de commit.'

    case GITHUB_OPERATIONS.squashMerge:
      if (!inteiroPositivo('pullRequest')) return 'Informe `pullRequest` como número.'
      // O `expectedHeadSha` é exigido **aqui**, na validação, e não só documentado: sem ele o
      // GitHub mergeia o que estiver no head, e um push que chegou depois da verificação entraria
      // sem ter sido verificado (critério 5).
      return ehSha('expectedHeadSha', v)
        ? undefined
        : 'Informe `expectedHeadSha` — merge sem SHA esperado mergeia o que estiver no head.'

    case GITHUB_OPERATIONS.getMergeState:
      return inteiroPositivo('pullRequest') ? undefined : 'Informe `pullRequest` como número.'

    case GITHUB_OPERATIONS.setDefaultBranch:
      return texto('branch') ? undefined : 'Informe `branch`.'

    case GITHUB_OPERATIONS.ensureBranchProtection:
      if (!texto('branch')) return 'Informe `branch`.'
      // Zero é válido (merge autônomo sem revisor humano); negativo e fracionário não são, e um
      // deles passaria para a API virar 422 num lugar onde a causa já era conhecível aqui.
      return typeof v.revisoesExigidas === 'number' &&
        Number.isInteger(v.revisoesExigidas) &&
        v.revisoesExigidas >= 0
        ? undefined
        : '`revisoesExigidas` precisa ser um inteiro não negativo.'

    case GITHUB_OPERATIONS.getCommitSha:
      return texto('ref') ? undefined : 'Informe `ref`.'

    case GITHUB_OPERATIONS.getRequiredChecks:
      return texto('branch') ? undefined : 'Informe `branch`.'

    case GITHUB_OPERATIONS.ensureLabel:
      if (!texto('nome')) return 'Informe `nome`.'
      // Seis hexadecimais **sem** `#`: é o formato que a API aceita, e mandar com `#` devolve
      // 422 num lugar onde a causa já era conhecível aqui.
      return typeof v.cor === 'string' && /^[0-9a-f]{6}$/i.test(v.cor)
        ? undefined
        : '`cor` precisa ser um hexadecimal de 6 dígitos, sem `#`.'

    default:
      return `Operação "${operation}" não pertence ao conector GitHub.`
  }
}

/**
 * O valor é um SHA de commit plausível?
 *
 * Hexadecimal de 7 a 64 caracteres: aceita o abreviado que uma pessoa cola e o completo que a API
 * devolve, e recusa nome de branch — que é o engano que faz `squashMerge` receber `"main"` no
 * lugar do SHA e perder exatamente a garantia que ele existe para dar.
 */
function ehSha(campo: string, v: Record<string, unknown>): boolean {
  const valor = v[campo]
  return typeof valor === 'string' && /^[0-9a-f]{7,64}$/i.test(valor)
}

/**
 * O erro de "o head mudou desde a verificação" (o 409 do merge com `sha`).
 *
 * Fábrica própria porque a mensagem precisa dizer o que aconteceu **e** o que fazer: o head andou,
 * então os checks que aprovaram são de outro commit, e repetir o merge com o mesmo SHA erraria de
 * novo. `retryable: false` e `acao: 'corrigir-entrada'` — quem repete precisa reler o head primeiro.
 */
export function erroDeHeadDivergente(
  esperado: string,
  obtidoEm: string,
  operation: string
): ConnectorError {
  return {
    ok: false,
    code: 'validacao-invalida',
    mensagem:
      `O head do pull request não é mais ${esperado.slice(0, 7)}. ` +
      'Alguém publicou depois da verificação: releia os checks do head atual antes de mergear.',
    retryable: false,
    acao: 'corrigir-entrada',
    provenance: { connector: 'github', operation, obtidoEm }
  }
}
