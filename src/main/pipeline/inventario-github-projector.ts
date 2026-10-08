import type { RepositoryInventoryNormalizado } from '@shared/domain/github-automation'
import type { EstadoRemotoDoNo, NoInventario, EstadoTecnico } from './inventario-global'

/** Liga issues do índice local a referências `refs #N` dos PRs sem interpretar o texto do corpo. */
export function projetarEstadoGithub(
  locais: readonly NoInventario[],
  remoto: RepositoryInventoryNormalizado
): readonly EstadoRemotoDoNo[] {
  const issuePorNumero = new Map(remoto.issues.map((issue) => [issue.numero, issue]))
  const prsPorIssue = new Map<number, NonNullable<EstadoRemotoDoNo['pullRequests']>[number][]>()

  for (const pull of remoto.pullRequests) {
    const pullProjetado = {
      numero: pull.numero,
      estado: pull.estado,
      merged: pull.merged,
      headBranch: pull.headBranch,
      headSha: pull.headSha,
      ...(pull.mergeSha === undefined ? {} : { mergeSha: pull.mergeSha }),
      checks: pull.checks
    }
    for (const issueNumero of pull.issuesReferenciadas) {
      const prs = prsPorIssue.get(issueNumero) ?? []
      prs.push(pullProjetado)
      prsPorIssue.set(issueNumero, prs)
    }
  }

  const usados = new Set<number>()
  const estados: EstadoRemotoDoNo[] = []
  for (const local of locais) {
    const numeroIssue = local.issue?.numero
    if (numeroIssue === undefined) continue
    const issue = issuePorNumero.get(numeroIssue)
    if (issue === undefined) continue
    usados.add(numeroIssue)
    const pullRequests = prsPorIssue.get(numeroIssue) ?? []
    estados.push({
      id: local.id,
      estadoTecnico: estadoTecnico(issue.estado, issue.labels, pullRequests),
      issue: {
        numero: issue.numero,
        aberta: issue.estado === 'open',
        labels: issue.labels
      },
      pullRequests
    })
  }

  // Issue de fatia/MVP com título estruturado que não aparece no índice é órfã e precisa ser
  // reconciliada. Issues de manutenção sem tokens de roadmap ficam fora do DAG.
  for (const issue of remoto.issues) {
    if (usados.has(issue.numero)) continue
    const id = idDoTitulo(issue.titulo)
    if (id === undefined) continue
    const pullRequests = prsPorIssue.get(issue.numero) ?? []
    estados.push({
      id,
      estadoTecnico: estadoTecnico(issue.estado, issue.labels, pullRequests),
      issue: { numero: issue.numero, aberta: issue.estado === 'open', labels: issue.labels },
      pullRequests
    })
  }

  const remotoPorId = new Map(estados.map((estado) => [estado.id, estado]))
  for (const mvp of locais.filter((no) => no.tipo === 'mvp')) {
    const filhas = locais.filter((no) => no.tipo === 'fatia' && no.mvpId === mvp.id)
    if (
      mvp.quantidadeDeFatias === undefined ||
      filhas.length === 0 ||
      filhas.length !== mvp.quantidadeDeFatias ||
      !filhas.every((filha) => remotoPorId.get(filha.id)?.estadoTecnico === 'mergeado')
    ) {
      continue
    }
    const indice = estados.findIndex((estado) => estado.id === mvp.id)
    if (indice >= 0) estados[indice] = { ...estados[indice]!, estadoTecnico: 'mergeado' }
  }

  return estados
}

function estadoTecnico(
  estadoIssue: 'open' | 'closed',
  labels: readonly string[],
  pullRequests: readonly NonNullable<EstadoRemotoDoNo['pullRequests']>[number][]
): EstadoTecnico {
  if (pullRequests.some((pull) => pull.estado === 'open' && pull.checks === 'failure'))
    return 'bloqueado'
  if (pullRequests.some((pull) => pull.estado === 'open')) return 'em-andamento'
  if (
    pullRequests.length > 0 &&
    pullRequests.every((pull) => pull.merged && pull.mergeSha !== undefined)
  ) {
    return 'mergeado'
  }
  if (labels.includes('proplan:doing')) return 'em-andamento'
  if (labels.includes('proplan:backlog') || labels.includes('proplan:todo')) return 'pendente'
  // Issue fechada sem evidência de merge não satisfaz dependência técnica por si só.
  if (
    estadoIssue === 'closed' ||
    labels.includes('proplan:done') ||
    labels.includes('proplan:finalizado')
  ) {
    return 'desconhecido'
  }
  return 'desconhecido'
}

function idDoTitulo(titulo: string): string | undefined {
  const tokens = /^\[(MVP\d+)\](?:\[SPEC-[^\]]+\])?(?:\[(F\d+|FIX)\])?/i.exec(titulo)
  if (tokens === null) return undefined
  const mvp = tokens[1]?.toUpperCase()
  const fatia = tokens[2]?.toUpperCase()
  if (mvp === undefined) return undefined
  if (fatia === undefined) return mvp
  return `${mvp}-${fatia.startsWith('F') && fatia !== 'FIX' ? `F${fatia.slice(1).padStart(2, '0')}` : fatia}`
}
