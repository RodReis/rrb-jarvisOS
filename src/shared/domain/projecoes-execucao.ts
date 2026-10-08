import type { Gate, RevisaoAprovada } from './aprovacoes'
export interface NoDoDAG {
  readonly id: string
  readonly tipo: 'mvp' | 'fatia'
  readonly numero: number
  readonly titulo: string
  readonly dependeDe: readonly string[]
  readonly estadoTecnico: 'pendente' | 'em-andamento' | 'mergeado' | 'bloqueado' | 'desconhecido'
  readonly gateAprovado: boolean
  readonly issue?: { readonly numero: number; readonly aberta: boolean; readonly url?: string }
  readonly pullRequests?: readonly {
    readonly numero: number
    readonly estado: 'open' | 'closed'
    readonly merged: boolean
    readonly headBranch?: string
    readonly headSha: string
    readonly mergeSha?: string
    readonly checks: 'pending' | 'success' | 'failure' | 'unknown'
  }[]
}

export interface ExecucaoLocalDoNo {
  readonly id: string
  readonly estado:
    | 'PLANNED'
    | 'AWAITING_PI'
    | 'READY'
    | 'RUNNING'
    | 'VALIDATING'
    | 'REVIEWING'
    | 'PR_CI'
    | 'MERGED'
    | 'AWAITING_MERGE'
    | 'BLOCKED'
    | 'CANCELLED'
}

export interface PrDoRunProjetado {
  readonly pullRequest: number
  readonly owner: string
  readonly repo: string
  readonly branch: string
}

export interface EstadoDaFatiaProjetada {
  readonly id: string
  readonly estadoTecnico: NoDoDAG['estadoTecnico']
  readonly issue?: NoDoDAG['issue']
  readonly run?: ExecucaoLocalDoNo
  readonly branch?: {
    readonly nome: string
    readonly estadoRemoto: 'confirmada' | 'divergente' | 'nao-observada'
    readonly headSha?: string
  }
  readonly pullRequest?: {
    readonly numero: number
    readonly url: string
    readonly estado?: 'open' | 'closed'
    readonly merged?: boolean
    readonly headSha?: string
    readonly mergeSha?: string
    readonly checks?: 'pending' | 'success' | 'failure' | 'unknown'
  }
  readonly divergencias: readonly string[]
}

/** Junta o run persistido e a referência remota do mesmo PR, sem inferir branch por nome de fatia. */
export function projetarEstadoDaFatia(
  no: NoDoDAG,
  run?: ExecucaoLocalDoNo,
  prDoRun?: PrDoRunProjetado
): EstadoDaFatiaProjetada {
  const divergencias: string[] = []
  const remoto =
    prDoRun === undefined
      ? undefined
      : no.pullRequests?.find((pull) => pull.numero === prDoRun.pullRequest)

  const branch =
    prDoRun === undefined
      ? undefined
      : {
          nome: prDoRun.branch,
          estadoRemoto:
            remoto === undefined
              ? ('nao-observada' as const)
              : remoto.headBranch !== undefined && remoto.headBranch !== prDoRun.branch
                ? ('divergente' as const)
                : ('confirmada' as const),
          ...(remoto === undefined ? {} : { headSha: remoto.headSha })
        }

  if (branch?.estadoRemoto === 'divergente') {
    divergencias.push('O branch registrado para o run diverge do branch do PR observado no GitHub.')
  }
  if (run?.estado === 'MERGED' && (remoto === undefined || !remoto.merged || !remoto.mergeSha)) {
    divergencias.push('O run local indica merge, mas o inventário não confirma o merge do PR.')
  }
  if (run?.estado === 'CANCELLED' && remoto?.merged) {
    divergencias.push('O run está cancelado, mas o PR aparece mergeado; reconciliação necessária.')
  }

  return {
    id: no.id,
    estadoTecnico: divergencias.length > 0 ? 'desconhecido' : no.estadoTecnico,
    ...(no.issue === undefined ? {} : { issue: no.issue }),
    ...(run === undefined ? {} : { run }),
    ...(branch === undefined ? {} : { branch }),
    ...(prDoRun === undefined
      ? {}
      : {
          pullRequest: {
            numero: prDoRun.pullRequest,
            url: `https://github.com/${prDoRun.owner}/${prDoRun.repo}/pull/${prDoRun.pullRequest}`,
            ...(remoto === undefined
              ? {}
              : {
                  estado: remoto.estado,
                  merged: remoto.merged,
                  headSha: remoto.headSha,
                  ...(remoto.mergeSha === undefined ? {} : { mergeSha: remoto.mergeSha }),
                  checks: remoto.checks
                })
          }
        }),
    divergencias
  }
}

export interface DiagnosticoDaProjecao {
  readonly codigo: string
  readonly envolvidos: readonly string[]
  readonly mensagem: string
}

export interface InventarioParaProjecao {
  readonly nos: readonly NoDoDAG[]
  readonly ordem: readonly string[]
  readonly diagnosticos: readonly DiagnosticoDaProjecao[]
  readonly fingerprint: string
  readonly noLocalPorId?: ReadonlyMap<string, NoDoDAG>
}

export interface QuestaoDoGate {
  readonly id: string
  readonly texto: string
  readonly respondida: boolean
}

export interface CandidatoAoGate {
  readonly noId: string
  readonly gate: Extract<Gate, 'MVP_ENTRY' | 'SLICE_ENTRY'>
  readonly revisoesAtuais: readonly RevisaoAprovada[]
  readonly revisoesAprovadas: readonly RevisaoAprovada[]
  readonly questoes: readonly QuestaoDoGate[]
}

export type EstadoDoPacoteDoGate =
  | 'sem-gate-pendente'
  | 'reconciliacao-necessaria'
  | 'aguardando-dependencias'
  | 'bloqueado'
  | 'pronto-para-revisao'

export interface PacoteDoProximoGate {
  readonly estado: EstadoDoPacoteDoGate
  readonly fingerprint: string
  readonly no?: NoDoDAG
  readonly gate?: CandidatoAoGate['gate']
  readonly revisoes: readonly RevisaoAprovada[]
  readonly mudancas: readonly {
    readonly artefato: string
    readonly hashAnterior?: string
    readonly hashAtual: string
  }[]
  readonly questoes: readonly QuestaoDoGate[]
  readonly diagnosticos: readonly DiagnosticoDaProjecao[]
  readonly recomendacao: string
}

/** Monta um pacote determinístico para o primeiro gate pendente, sem aprová-lo nem persistir prosa derivada. */
export function projetarProximoGate(
  inventario: InventarioParaProjecao,
  candidatos: readonly CandidatoAoGate[]
): PacoteDoProximoGate {
  const diagnosticos = inventario.diagnosticos
  const vazio = {
    fingerprint: inventario.fingerprint,
    revisoes: [],
    mudancas: [],
    questoes: [],
    diagnosticos
  } as const

  if (diagnosticos.length > 0) {
    return {
      ...vazio,
      estado: 'reconciliacao-necessaria',
      recomendacao:
        'Resolver as divergências entre as fontes e reconciliar novamente antes de apresentar um gate.'
    }
  }

  const candidatoPorNo = new Map(candidatos.map((candidato) => [candidato.noId, candidato]))
  const no = inventario.ordem
    .map((id) => inventario.nos.find((item) => item.id === id))
    .find((item) => item !== undefined && !item.gateAprovado && candidatoPorNo.has(item.id))

  if (no === undefined) {
    const pendenteSemPacote = inventario.ordem
      .map((id) => inventario.nos.find((item) => item.id === id))
      .find((item) => item !== undefined && !item.gateAprovado)
    if (pendenteSemPacote !== undefined) {
      return {
        ...vazio,
        estado: 'bloqueado',
        no: inventario.noLocalPorId?.get(pendenteSemPacote.id) ?? pendenteSemPacote,
        recomendacao:
          'A revisão exata deste gate não está disponível; nenhuma decisão pode ser preparada.'
      }
    }
    return {
      ...vazio,
      estado: 'sem-gate-pendente',
      recomendacao: 'Não há gate pendente identificado nesta reconciliação.'
    }
  }

  const candidato = candidatoPorNo.get(no.id)!
  const noLocal = inventario.noLocalPorId?.get(no.id)
  const noParaPacote = noLocal === undefined ? no : { ...no, ...noLocal }
  const revisoes = ordenarRevisoes(candidato.revisoesAtuais)
  const aprovadasPorArtefato = new Map(
    candidato.revisoesAprovadas.map((revisao) => [revisao.artefato, revisao.hash])
  )
  const mudancas = revisoes.flatMap((revisao) => {
    const anterior = aprovadasPorArtefato.get(revisao.artefato)
    return anterior === revisao.hash
      ? []
      : [
          {
            artefato: revisao.artefato,
            ...(anterior === undefined ? {} : { hashAnterior: anterior }),
            hashAtual: revisao.hash
          }
        ]
  })
  const dependenciasProntas = no.dependeDe.every((id) =>
    inventario.nos.some((item) => item.id === id && item.estadoTecnico === 'mergeado')
  )
  const revisaoDisponivel =
    revisoes.length > 0 && revisoes.every((revisao) => /^[a-f0-9]{64}$/i.test(revisao.hash))
  const perguntasAbertas = candidato.questoes.some((questao) => !questao.respondida)
  const estado = !revisaoDisponivel
    ? 'bloqueado'
    : !dependenciasProntas
      ? 'aguardando-dependencias'
      : perguntasAbertas
        ? 'bloqueado'
        : 'pronto-para-revisao'

  return {
    estado,
    fingerprint: inventario.fingerprint,
    no: noParaPacote,
    gate: candidato.gate,
    revisoes,
    mudancas,
    questoes: [...candidato.questoes].sort((a, b) => comparar(a.id, b.id)),
    diagnosticos,
    recomendacao: recomendacaoDoEstado(estado)
  }
}

function ordenarRevisoes(revisoes: readonly RevisaoAprovada[]): readonly RevisaoAprovada[] {
  return [...revisoes]
    .map((revisao) => ({ artefato: revisao.artefato, hash: revisao.hash }))
    .sort((a, b) => comparar(a.artefato, b.artefato) || comparar(a.hash, b.hash))
}

function recomendacaoDoEstado(estado: EstadoDoPacoteDoGate): string {
  switch (estado) {
    case 'pronto-para-revisao':
      return 'Revisar os artefatos e mudanças listados; a aprovação continua sendo uma decisão manual do PI.'
    case 'aguardando-dependencias':
      return 'Aguardar merge confirmado das dependências antes de decidir este gate.'
    case 'bloqueado':
      return 'Completar a revisão ou responder às questões abertas; não há decisão acionável agora.'
    case 'reconciliacao-necessaria':
      return 'Resolver as divergências entre as fontes e reconciliar novamente antes de apresentar um gate.'
    case 'sem-gate-pendente':
      return 'Não há gate pendente identificado nesta reconciliação.'
  }
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
