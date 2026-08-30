/**
 * As nove capacidades de automação (SPEC-Conectores-04).
 *
 * Cada função faz **uma** coisa: garante um recurso, ou lê um estado. Nenhuma decide quando será
 * usada — a orquestração é do MVP-009, e a spec repete isso de propósito para a fatia não crescer
 * para dentro da entrega autônoma.
 *
 * A forma de todo `ensure*` é a mesma, e é o que satisfaz o critério 1: **procurar antes de
 * criar**. Não é otimização — é a única maneira de "repetir não duplica" valer contra uma API que
 * não tem upsert. O que muda entre elas é o que conta como "o mesmo recurso": nome para
 * repositório, chave externa para issue, branch para ref, head para PR.
 *
 * Cada uma devolve `ExternalRef` (spec § Contratos) mais o dado normalizado que o chamador precisa
 * — nunca o objeto do GitHub, que traz dezenas de URLs e metadados que ninguém pediu.
 */

import type { ExternalRef } from '@shared/domain/connectors'
import {
  corpoComChaveExterna,
  corpoTemChaveExterna,
  type CheckNormalizado,
  type CommitShaInput,
  type EnsureBranchProtectionInput,
  type EnsureBranchRefInput,
  type EnsureIssueDependencyInput,
  type EnsureIssueInput,
  type EnsurePullRequestInput,
  type EnsureRepositoryInput,
  type HeadShaInput,
  type MergeStateNormalizado,
  type PullRequestInput,
  type SetDefaultBranchInput,
  type SquashMergeInput,
  type WorkflowRunNormalizado
} from '@shared/domain/github-automation'
import { log } from '../../logging/logger'
import { lista, numero, texto, type GithubRest, type RespostaRest } from './github-rest'

/**
 * O desfecho de uma operação: o dado, mais se o recurso **já existia**.
 *
 * `criado` não é cosmético: é o que o chamador usa para saber se a execução teve efeito, e é o que
 * torna a idempotência observável de fora. Sem ele, "repetir não duplica" só seria verificável
 * contando recursos no GitHub.
 */
export interface ResultadoDeOperacao<T> {
  readonly data: T
  readonly externalRef: ExternalRef
  readonly criado: boolean
}

/** Falha que o adapter traduz. Carrega a resposta para a tradução conhecer status e headers. */
export class FalhaRest extends Error {
  constructor(readonly resposta: RespostaRest) {
    super(`HTTP ${resposta.status}`)
    this.name = 'FalhaRest'
  }
}

/** Garante sucesso, ou lança para o adapter traduzir num lugar só. */
function exigirOk(resposta: RespostaRest): RespostaRest {
  if (!resposta.ok) throw new FalhaRest(resposta)
  return resposta
}

/**
 * `repo.ensure` — o repositório existe ao final, tendo sido criado ou não.
 *
 * Procura por `GET /repos/{owner}/{repo}` antes de criar. O 404 aqui é **tratado como ausência**,
 * e essa é a única operação onde isso é legítimo: se a App não enxergasse o repositório, a criação
 * seguinte falharia com 422 ("name already exists"), que é um desfecho honesto — o contrário
 * (assumir que existe) deixaria o chamador esperando um repositório que ninguém criou.
 */
export async function ensureRepository(
  rest: GithubRest,
  input: EnsureRepositoryInput
): Promise<ResultadoDeOperacao<{ readonly fullName: string; readonly defaultBranch: string }>> {
  const existente = await rest.request('GET', `/repos/${input.owner}/${input.repo}`)

  if (existente.ok) {
    return normalizarRepo(existente.corpo, false)
  }

  if (existente.status !== 404) throw new FalhaRest(existente)

  // `POST /user/repos` cria na conta do usuário autenticado. Criar em organização é outro
  // endpoint (`/orgs/{org}/repos`) e outra permissão; a fatia não o cobre, e a falta de escopo
  // aparece como erro do GitHub em vez de sucesso no lugar errado.
  const criado = exigirOk(
    await rest.request('POST', '/user/repos', {
      name: input.repo,
      private: input.visibility === 'private',
      ...(input.description === undefined ? {} : { description: input.description })
    })
  )

  return normalizarRepo(criado.corpo, true)
}

function normalizarRepo(
  corpo: unknown,
  criado: boolean
): ResultadoDeOperacao<{ readonly fullName: string; readonly defaultBranch: string }> {
  const fullName = texto(corpo, 'full_name') ?? ''
  return {
    data: { fullName, defaultBranch: texto(corpo, 'default_branch') ?? 'main' },
    externalRef: {
      id: fullName,
      ...(texto(corpo, 'html_url') === undefined ? {} : { url: texto(corpo, 'html_url') as string })
    },
    criado
  }
}

/**
 * `issue.ensure` — uma issue por chave externa (critérios 1 e 2).
 *
 * A busca é por **chave externa no corpo**, não por título: título muda (alguém reescreve, o
 * processo renomeia a fatia) e a issue passaria a ser criada de novo a cada mudança. A chave é
 * determinística e derivada do par MVP/Fatia/SPEC pelo chamador — o vínculo que o critério 2 pede.
 *
 * **A listagem do GitHub é eventualmente consistente, e o smoke real mediu isso**: uma issue
 * recém-criada leva cerca de 1,5 s para aparecer em `GET /issues`. Dois `ensure` em sequência
 * dentro dessa janela criariam duas issues — exatamente o que o critério 1 proíbe, e exatamente o
 * que nenhum servidor falso mostraria, porque ele responde instantâneo e consistente.
 *
 * A defesa é **reconferir depois de criar**: se a releitura revelar mais de uma issue com a chave,
 * a operação converge para a **mais antiga** (menor `number`) e reporta a duplicata. Duas execuções
 * concorrentes acabam apontando para a mesma issue, que é o que "idempotente" precisa significar
 * quando o serviço do outro lado não oferece criação condicional.
 *
 * O que isto **não** faz: apagar a issue extra. Fechar ou deletar issue por conta própria é ato de
 * curadoria do board, e o processo deste repo é explícito em que issue não se deleta — a extra fica
 * visível para quem decide o que fazer com ela.
 */
export async function ensureIssue(
  rest: GithubRest,
  input: EnsureIssueInput
): Promise<
  ResultadoDeOperacao<{ readonly numero: number; readonly id: number; readonly titulo: string }>
> {
  const existente = await procurarIssuePorChave(rest, input)
  if (existente !== undefined) return normalizarIssue(existente, false)

  const criada = exigirOk(
    await rest.request('POST', `/repos/${input.owner}/${input.repo}/issues`, {
      title: input.title,
      body: corpoComChaveExterna(input.body, input.externalKey),
      ...(input.labels === undefined || input.labels.length === 0 ? {} : { labels: input.labels })
    })
  )

  // Convergência: relê e fica com a mais antiga se a janela de inconsistência tiver produzido
  // duas. A releitura pode não enxergar nem a que acabamos de criar — nesse caso a criada é a
  // resposta, que é o desfecho correto de qualquer forma.
  const todas = await todasComChave(rest, input)
  const maisAntiga = todas.reduce<{ item: unknown; numero: number } | undefined>((menor, item) => {
    const n = numero(item, 'number') ?? Number.MAX_SAFE_INTEGER
    return menor === undefined || n < menor.numero ? { item, numero: n } : menor
  }, undefined)

  const numeroCriado = numero(criada.corpo, 'number') ?? 0
  if (maisAntiga !== undefined && maisAntiga.numero < numeroCriado) {
    log.integracao.warn('Duas issues com a mesma chave externa; usando a mais antiga', {
      connector: 'github'
    })
    return normalizarIssue(maisAntiga.item, false)
  }

  return normalizarIssue(criada.corpo, true)
}

/**
 * Varre as issues do repositório procurando a chave.
 *
 * `state=all` porque uma issue **fechada** com a mesma chave ainda é a mesma issue: recriá-la
 * duplicaria o registro e faria o board mostrar a fatia duas vezes — uma aceita e uma nova.
 *
 * Paginação com teto: sem ele, um repositório com milhares de issues faria o `ensure` varrer tudo
 * a cada chamada. O teto é uma simplificação deliberada e tem consequência conhecida — em repo com
 * mais issues que isso, a chave antiga não é encontrada e uma segunda issue nasce.
 */
async function procurarIssuePorChave(
  rest: GithubRest,
  input: EnsureIssueInput
): Promise<unknown | undefined> {
  return (await todasComChave(rest, input))[0]
}

/** Todas as issues com aquela chave — normalmente zero ou uma; mais de uma é a duplicata. */
async function todasComChave(
  rest: GithubRest,
  input: EnsureIssueInput
): Promise<readonly unknown[]> {
  const achadas: unknown[] = []

  // ponytail: 5 páginas de 100 (500 issues). Paginar até o fim se um repo real passar disso.
  for (let pagina = 1; pagina <= 5; pagina += 1) {
    const resposta = exigirOk(
      await rest.request(
        'GET',
        `/repos/${input.owner}/${input.repo}/issues?state=all&per_page=100&page=${pagina}`
      )
    )

    const itens = lista(resposta.corpo)
    achadas.push(
      ...itens.filter(
        (i) =>
          i.pull_request === undefined && corpoTemChaveExterna(texto(i, 'body'), input.externalKey)
      )
    )

    // Página incompleta = última página. Continuar pediria uma página vazia por nada.
    if (itens.length < 100) break
  }

  return achadas
}

function normalizarIssue(
  corpo: unknown,
  criado: boolean
): ResultadoDeOperacao<{ readonly numero: number; readonly id: number; readonly titulo: string }> {
  const numeroDaIssue = numero(corpo, 'number') ?? 0
  return {
    data: {
      numero: numeroDaIssue,
      // `id` e `number` são diferentes, e a distinção importa: a API de sub-issues recebe o **id**
      // global, enquanto tudo mais endereça pelo `number` do repositório. Confundi-los faz o
      // vínculo apontar para outra issue qualquer.
      id: numero(corpo, 'id') ?? 0,
      titulo: texto(corpo, 'title') ?? ''
    },
    externalRef: {
      id: String(numeroDaIssue),
      ...(texto(corpo, 'html_url') === undefined ? {} : { url: texto(corpo, 'html_url') as string })
    },
    criado
  }
}

/**
 * `issue.ensure-dependency` — o vínculo pai/filho pela **API de sub-issues** (spec § decisões).
 *
 * Relação real e não checklist em markdown: é a mesma hierarquia MVP→fatia que o processo deste
 * repo já usa, e um item de lista no corpo não é consultável nem sobrevive a alguém editando o
 * texto.
 *
 * Idempotente por verificação prévia: lista as sub-issues do pai antes de acrescentar. A API
 * responde 422 ao repetir, e tratar 422 como sucesso confundiria "já era filho" com outras
 * validações que também dão 422.
 */
export async function ensureIssueDependency(
  rest: GithubRest,
  input: EnsureIssueDependencyInput
): Promise<ResultadoDeOperacao<{ readonly parentIssue: number; readonly childIssue: number }>> {
  const filha = exigirOk(
    await rest.request('GET', `/repos/${input.owner}/${input.repo}/issues/${input.childIssue}`)
  )
  const idDaFilha = numero(filha.corpo, 'id')
  if (idDaFilha === undefined) throw new FalhaRest(filha)

  const existentes = exigirOk(
    await rest.request(
      'GET',
      `/repos/${input.owner}/${input.repo}/issues/${input.parentIssue}/sub_issues`
    )
  )

  const jaEhFilha = lista(existentes.corpo).some((i) => numero(i, 'number') === input.childIssue)
  const resultado = {
    data: { parentIssue: input.parentIssue, childIssue: input.childIssue },
    externalRef: { id: `${input.parentIssue}->${input.childIssue}` }
  }

  if (jaEhFilha) return { ...resultado, criado: false }

  exigirOk(
    await rest.request(
      'POST',
      `/repos/${input.owner}/${input.repo}/issues/${input.parentIssue}/sub_issues`,
      // `sub_issue_id` é o **id** global da issue, não o número dela no repositório.
      { sub_issue_id: idDaFilha }
    )
  )

  return { ...resultado, criado: true }
}

/**
 * `ref.ensure` — o branch aponta para o commit informado.
 *
 * Cria com `POST /git/refs` quando não existe; atualiza com `PATCH` quando existe e aponta para
 * outro commit. **Sem `force`**: a atualização só é aceita se for fast-forward, e um branch que
 * divergiu vira erro em vez de perder commits em silêncio. Reescrever histórico de branch remoto
 * não é capacidade que esta fatia deva oferecer.
 */
export async function ensureBranchRef(
  rest: GithubRest,
  input: EnsureBranchRefInput
): Promise<ResultadoDeOperacao<{ readonly branch: string; readonly sha: string }>> {
  const ref = `heads/${input.branch}`
  const atual = await rest.request('GET', `/repos/${input.owner}/${input.repo}/git/ref/${ref}`)

  const resultado = (
    sha: string,
    criado: boolean
  ): ResultadoDeOperacao<{ branch: string; sha: string }> => ({
    data: { branch: input.branch, sha },
    externalRef: {
      id: `refs/${ref}`,
      url: `https://github.com/${input.owner}/${input.repo}/tree/${input.branch}`
    },
    criado
  })

  if (atual.ok) {
    const shaAtual = texto((atual.corpo as { object?: unknown } | undefined)?.object, 'sha')
    if (shaAtual === input.sha) return resultado(input.sha, false)

    exigirOk(
      await rest.request('PATCH', `/repos/${input.owner}/${input.repo}/git/refs/${ref}`, {
        sha: input.sha
      })
    )
    return resultado(input.sha, false)
  }

  if (atual.status !== 404) throw new FalhaRest(atual)

  exigirOk(
    await rest.request('POST', `/repos/${input.owner}/${input.repo}/git/refs`, {
      ref: `refs/${ref}`,
      sha: input.sha
    })
  )

  return resultado(input.sha, true)
}

/**
 * `pr.ensure` — um PR por head (critério 3).
 *
 * Procura por `GET /pulls?head=owner:branch&state=open` antes de criar. O PR **aberto** é o que
 * conta: um PR fechado do mesmo branch é histórico, e reusá-lo não é possível (o GitHub recusa
 * reabrir automaticamente) nem desejável — a nova entrega merece o próprio PR.
 */
export async function ensurePullRequest(
  rest: GithubRest,
  input: EnsurePullRequestInput
): Promise<
  ResultadoDeOperacao<{
    readonly numero: number
    readonly headSha: string
    readonly estado: string
  }>
> {
  const abertos = exigirOk(
    await rest.request(
      'GET',
      `/repos/${input.owner}/${input.repo}/pulls?state=open&head=${input.owner}:${input.head}&base=${input.base}`
    )
  )

  const existente = lista(abertos.corpo)[0]
  if (existente !== undefined) return normalizarPr(existente, false)

  const criado = exigirOk(
    await rest.request('POST', `/repos/${input.owner}/${input.repo}/pulls`, {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base
    })
  )

  return normalizarPr(criado.corpo, true)
}

function normalizarPr(
  corpo: unknown,
  criado: boolean
): ResultadoDeOperacao<{
  readonly numero: number
  readonly headSha: string
  readonly estado: string
}> {
  const numeroDoPr = numero(corpo, 'number') ?? 0
  return {
    data: {
      numero: numeroDoPr,
      headSha: texto((corpo as { head?: unknown } | undefined)?.head, 'sha') ?? '',
      estado: texto(corpo, 'state') ?? 'open'
    },
    externalRef: {
      id: String(numeroDoPr),
      ...(texto(corpo, 'html_url') === undefined ? {} : { url: texto(corpo, 'html_url') as string })
    },
    criado
  }
}

/**
 * `checks.for-head` — os checks **daquele commit**, normalizados (critério 4).
 *
 * O endpoint já é por ref, então o SHA da consulta e o dos checks deveriam coincidir. Mesmo assim
 * o `headSha` de cada check vem do **dado**, não da entrada: é o que permite ao gate comparar de
 * verdade em vez de confiar que a API respondeu sobre o que foi perguntado.
 */
export async function getChecksForHead(
  rest: GithubRest,
  input: HeadShaInput
): Promise<ResultadoDeOperacao<readonly CheckNormalizado[]>> {
  const resposta = exigirOk(
    await rest.request(
      'GET',
      `/repos/${input.owner}/${input.repo}/commits/${input.sha}/check-runs?per_page=100`
    )
  )

  const checks: CheckNormalizado[] = lista(resposta.corpo, 'check_runs').map((c) => ({
    nome: texto(c, 'name') ?? '',
    headSha: texto(c, 'head_sha') ?? '',
    status: (texto(c, 'status') ?? 'queued') as CheckNormalizado['status'],
    ...(texto(c, 'conclusion') === undefined
      ? {}
      : { conclusao: texto(c, 'conclusion') as NonNullable<CheckNormalizado['conclusao']> }),
    ...(texto(c, 'html_url') === undefined ? {} : { url: texto(c, 'html_url') as string })
  }))

  return {
    data: checks,
    externalRef: { id: input.sha },
    // Leitura não cria nada. `false` aqui é fato, não default.
    criado: false
  }
}

/** `actions.runs-for-head` — as execuções de workflow daquele commit. */
export async function getWorkflowRunsForHead(
  rest: GithubRest,
  input: HeadShaInput
): Promise<ResultadoDeOperacao<readonly WorkflowRunNormalizado[]>> {
  const resposta = exigirOk(
    await rest.request(
      'GET',
      `/repos/${input.owner}/${input.repo}/actions/runs?head_sha=${input.sha}&per_page=100`
    )
  )

  const runs: WorkflowRunNormalizado[] = lista(resposta.corpo, 'workflow_runs').map((r) => ({
    nome: texto(r, 'name') ?? '',
    headSha: texto(r, 'head_sha') ?? '',
    status: texto(r, 'status') ?? 'queued',
    ...(texto(r, 'conclusion') === undefined
      ? {}
      : { conclusao: texto(r, 'conclusion') as string }),
    ...(texto(r, 'html_url') === undefined ? {} : { url: texto(r, 'html_url') as string })
  }))

  return { data: runs, externalRef: { id: input.sha }, criado: false }
}

/**
 * `pr.squash-merge` — mergeia **se** o head ainda for o esperado (critério 5).
 *
 * O `sha` no corpo é a garantia inteira: o GitHub responde **409** quando o head do PR não casa,
 * e é assim que um push que chegou entre a verificação e o merge é barrado pelo próprio serviço
 * em vez de por uma comparação nossa que poderia estar velha.
 *
 * O `mergeSha` devolvido é o do corpo da resposta do merge — que, aí sim, é o commit real na base.
 */
export async function squashMerge(
  rest: GithubRest,
  input: SquashMergeInput
): Promise<ResultadoDeOperacao<{ readonly mergeSha: string; readonly merged: boolean }>> {
  const resposta = exigirOk(
    await rest.request(
      'PUT',
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequest}/merge`,
      { merge_method: 'squash', sha: input.expectedHeadSha }
    )
  )

  const mergeSha = texto(resposta.corpo, 'sha') ?? ''
  const merged = (resposta.corpo as { merged?: unknown } | undefined)?.merged === true

  // Merge que responde 200 sem SHA é resposta que não confirma nada; o adapter a trata como
  // inválida em vez de reportar sucesso vazio.
  return {
    data: { mergeSha, merged },
    externalRef: { id: mergeSha },
    criado: merged
  }
}

/**
 * `pr.merge-state` — o estado **consultado na origem** (spec § Regras).
 *
 * A armadilha que esta função existe para evitar: em PR aberto, `merge_commit_sha` é o SHA de um
 * *test merge commit* — um commit que o GitHub calcula para saber se dá conflito, e que não está
 * em branch nenhum. Repassá-lo faria o chamador declarar entregue algo que não foi mergeado. Por
 * isso o `mergeSha` só sai quando `merged` é `true`.
 */
export async function getMergeState(
  rest: GithubRest,
  input: PullRequestInput
): Promise<ResultadoDeOperacao<MergeStateNormalizado>> {
  const resposta = exigirOk(
    await rest.request('GET', `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequest}`)
  )

  const merged = (resposta.corpo as { merged?: unknown } | undefined)?.merged === true
  const mergeSha = texto(resposta.corpo, 'merge_commit_sha')

  const estado: MergeStateNormalizado = {
    numero: numero(resposta.corpo, 'number') ?? input.pullRequest,
    estado: texto(resposta.corpo, 'state') === 'closed' ? 'closed' : 'open',
    merged,
    ...(merged && mergeSha !== undefined ? { mergeSha } : {}),
    headSha: texto((resposta.corpo as { head?: unknown } | undefined)?.head, 'sha') ?? ''
  }

  return { data: estado, externalRef: { id: String(estado.numero) }, criado: false }
}

/**
 * `repo.set-default-branch` — a branch base do repositório é a informada ao final.
 *
 * Lê antes de escrever, como todo `ensure` desta família: um `PATCH` incondicional funcionaria, mas
 * gravaria uma mutação auditada a cada publicação repetida, e o critério 1 se mede pelo que **não**
 * sai. Quando a default já é a branch pedida, nenhuma requisição de escrita acontece.
 *
 * A branch precisa existir na origem. Se não existir, o GitHub responde 422 — e é o desfecho
 * honesto: apontar a default para uma ref ausente deixaria o repositório num estado que a interface
 * do GitHub mostra como vazio.
 */
export async function setDefaultBranch(
  rest: GithubRest,
  input: SetDefaultBranchInput
): Promise<ResultadoDeOperacao<{ readonly defaultBranch: string; readonly alterado: boolean }>> {
  const atual = exigirOk(await rest.request('GET', `/repos/${input.owner}/${input.repo}`))
  const jaEra = texto(atual.corpo, 'default_branch') === input.branch

  if (!jaEra) {
    exigirOk(
      await rest.request('PATCH', `/repos/${input.owner}/${input.repo}`, {
        default_branch: input.branch
      })
    )
  }

  return {
    data: { defaultBranch: input.branch, alterado: !jaEra },
    externalRef: {
      id: `${input.owner}/${input.repo}`,
      url: `https://github.com/${input.owner}/${input.repo}/tree/${input.branch}`
    },
    criado: false
  }
}

/**
 * `branch.ensure-protection` — a branch base está protegida ao final.
 *
 * Diferente dos outros `ensure`, este **não procura antes de criar**: a API de proteção é um `PUT`
 * que substitui a configuração inteira, então é idempotente por construção — repetir com a mesma
 * entrada deixa o mesmo estado. Ler antes só serviria para pular o `PUT`, e a comparação exigiria
 * reproduzir a normalização que o GitHub faz nos campos aninhados; errar essa comparação deixaria a
 * proteção desatualizada em silêncio, que é pior do que um `PUT` a mais.
 *
 * `enforce_admins: false` é deliberado: o merge autônomo do MVP-009 acontece como o usuário dono, e
 * com `true` a própria proteção barraria a entrega que ela existe para proteger. A regra continua
 * valendo para todo o resto — force-push e deleção seguem proibidos.
 */
export async function ensureBranchProtection(
  rest: GithubRest,
  input: EnsureBranchProtectionInput
): Promise<ResultadoDeOperacao<{ readonly branch: string; readonly revisoesExigidas: number }>> {
  exigirOk(
    await rest.request(
      'PUT',
      `/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`,
      {
        required_status_checks:
          input.checksExigidos === undefined
            ? null
            : { strict: true, contexts: [...input.checksExigidos] },
        enforce_admins: false,
        required_pull_request_reviews: {
          required_approving_review_count: input.revisoesExigidas
        },
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false
      }
    )
  )

  return {
    data: { branch: input.branch, revisoesExigidas: input.revisoesExigidas },
    externalRef: {
      id: `${input.owner}/${input.repo}/protection/${input.branch}`,
      url: `https://github.com/${input.owner}/${input.repo}/settings/branches`
    },
    criado: false
  }
}

/**
 * `commit.sha-for-ref` — o commit para onde uma ref aponta **na origem**.
 *
 * É o que torna o critério 2 verificável: sem ler o que está no GitHub, "os commits locais
 * correspondem à branch remota" seria afirmado a partir do que mandamos, e um push parcial ou
 * rejeitado passaria por completo. A leitura acontece depois do push, contra a origem.
 *
 * O 404 **não** é traduzido como ausência aqui — sobe como falha para o adapter, que distingue "não
 * existe" de "existe e você não vê" (`significadoDo404`). Tratá-lo como ausência faria uma branch
 * invisível por permissão parecer uma branch que nunca foi publicada.
 */
export async function getCommitSha(
  rest: GithubRest,
  input: CommitShaInput
): Promise<ResultadoDeOperacao<{ readonly ref: string; readonly sha: string }>> {
  const resposta = exigirOk(
    await rest.request('GET', `/repos/${input.owner}/${input.repo}/commits/${input.ref}`)
  )

  const sha = texto(resposta.corpo, 'sha') ?? ''

  return {
    data: { ref: input.ref, sha },
    externalRef: {
      id: sha,
      url: `https://github.com/${input.owner}/${input.repo}/commit/${sha}`
    },
    criado: false
  }
}
