import { createHash } from 'node:crypto'

export type EstadoTecnico = 'pendente' | 'em-andamento' | 'mergeado' | 'bloqueado' | 'desconhecido'
export type EstadoDaSpec = 'aprovada' | 'em-revisao' | 'ausente' | 'desconhecida'
export interface RevisoesDasFontes {
  /** Hash do conteúdo semântico de STATUS/specs/gates locais, sem timestamps cosméticos. */
  readonly local: string
  /** Revisión de coleta externa; não participa do fingerprint material do DAG. */
  readonly github: string
}

export interface NoInventario {
  readonly id: string
  readonly tipo: 'mvp' | 'fatia'
  readonly mvpId?: string
  /** Contagem do índice local; necessária para provar que nenhum filho ficou fora do snapshot. */
  readonly quantidadeDeFatias?: number
  readonly numero: number
  readonly titulo: string
  readonly dependeDe: readonly string[]
  readonly estadoTecnico: EstadoTecnico
  readonly spec: {
    readonly estado: EstadoDaSpec
    /** Fingerprints SHA-256 do manifesto material atual e aprovado; ruído cosmético fica fora. */
    readonly revisaoAtual?: string
    readonly revisaoAprovada?: string
  }
  readonly gateAprovado: boolean
  readonly bloqueado: boolean
  readonly issue?: {
    readonly numero: number
    readonly aberta: boolean
    readonly labels?: readonly string[]
  }
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

export interface DiagnosticoInventario {
  readonly codigo:
    | 'duplicidade'
    | 'dependencia-ausente'
    | 'ciclo'
    | 'referencia-quebrada'
    | 'item-orfao'
    | 'conflito-projecao'
  readonly envolvidos: readonly string[]
  readonly mensagem: string
}

export interface InventarioGlobal {
  readonly nos: readonly NoInventario[]
  readonly ordem: readonly string[]
  readonly diagnosticos: readonly DiagnosticoInventario[]
  readonly fingerprint: string
  readonly revisoesDasFontes?: RevisoesDasFontes
}

const compararTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Fingerprint material completo: nós e diagnósticos que também bloqueiam a elegibilidade. */
export function fingerprintInventario(
  nos: readonly NoInventario[],
  diagnosticos: readonly DiagnosticoInventario[]
): string {
  const canonicalNos = [...nos]
    .sort((a, b) => compararTexto(a.id, b.id))
    .map((no) => ({
      id: no.id,
      tipo: no.tipo,
      mvpId: no.mvpId ?? null,
      quantidadeDeFatias: no.quantidadeDeFatias ?? null,
      numero: no.numero,
      titulo: no.titulo,
      dependeDe: [...no.dependeDe].sort(),
      estadoTecnico: no.estadoTecnico,
      spec: {
        estado: no.spec.estado,
        revisaoAtual: no.spec.revisaoAtual ?? null,
        revisaoAprovada: no.spec.revisaoAprovada ?? null
      },
      gateAprovado: no.gateAprovado,
      bloqueado: no.bloqueado,
      issue:
        no.issue === undefined
          ? null
          : {
              numero: no.issue.numero,
              aberta: no.issue.aberta,
              labels: [...(no.issue.labels ?? [])].sort()
            },
      pullRequests:
        no.pullRequests === undefined
          ? null
          : [...no.pullRequests]
              .sort((a, b) => a.numero - b.numero)
              .map((pull) => ({
                numero: pull.numero,
                estado: pull.estado,
                merged: pull.merged,
                headBranch: pull.headBranch ?? null,
                headSha: pull.headSha,
                mergeSha: pull.mergeSha ?? null,
                checks: pull.checks
              }))
    }))
  const canonicalDiagnosticos = diagnosticos
    .map((diagnostico) => ({
      codigo: diagnostico.codigo,
      envolvidos: [...diagnostico.envolvidos].sort(),
      mensagem: diagnostico.mensagem
    }))
    .sort((a, b) => compararTexto(JSON.stringify(a), JSON.stringify(b)))
  return createHash('sha256')
    .update(JSON.stringify({ nos: canonicalNos, diagnosticos: canonicalDiagnosticos }))
    .digest('hex')
}

/** Constrói uma visão determinística. Qualquer inconsistência bloqueia a ordem executável. */
export function comporInventario(nos: readonly NoInventario[]): InventarioGlobal {
  const diagnosticos: DiagnosticoInventario[] = []
  const porId = new Map<string, NoInventario>()
  for (const no of nos) {
    if (porId.has(no.id)) {
      diagnosticos.push({
        codigo: 'duplicidade',
        envolvidos: [no.id],
        mensagem: `Identificador duplicado: ${no.id}.`
      })
    } else porId.set(no.id, no)
  }

  for (const no of porId.values()) {
    if (no.tipo === 'fatia' && (no.mvpId === undefined || porId.get(no.mvpId)?.tipo !== 'mvp')) {
      diagnosticos.push({
        codigo: 'referencia-quebrada',
        envolvidos: [no.id, ...(no.mvpId === undefined ? [] : [no.mvpId])],
        mensagem: `A fatia ${no.id} não referencia um MVP conhecido.`
      })
    }
    const dependenciasUnicas = new Set<string>()
    for (const dependencia of no.dependeDe) {
      if (dependenciasUnicas.has(dependencia))
        diagnosticos.push({
          codigo: 'duplicidade',
          envolvidos: [no.id, dependencia],
          mensagem: `${no.id} declara a dependência ${dependencia} mais de uma vez.`
        })
      dependenciasUnicas.add(dependencia)
      if (!porId.has(dependencia))
        diagnosticos.push({
          codigo: 'dependencia-ausente',
          envolvidos: [no.id, dependencia],
          mensagem: `${no.id} depende de ${dependencia}, que não existe no inventário.`
        })
    }
  }

  const cor = new Map<string, 'cinza' | 'preto'>()
  const caminho: string[] = []
  const ciclos = new Set<string>()
  const visitar = (id: string): void => {
    const estado = cor.get(id)
    if (estado === 'preto') return
    if (estado === 'cinza') {
      const ciclo = [...caminho.slice(caminho.indexOf(id)), id]
      const chave = [...ciclo.slice(0, -1)].sort().join('|')
      if (!ciclos.has(chave)) {
        ciclos.add(chave)
        diagnosticos.push({
          codigo: 'ciclo',
          envolvidos: ciclo,
          mensagem: `Ciclo de dependência: ${ciclo.join(' → ')}.`
        })
      }
      return
    }
    cor.set(id, 'cinza')
    caminho.push(id)
    for (const dep of [...(porId.get(id)?.dependeDe ?? [])].sort()) {
      if (porId.has(dep)) visitar(dep)
    }
    caminho.pop()
    cor.set(id, 'preto')
  }
  for (const id of [...porId.keys()].sort(compararTexto)) visitar(id)

  const validos = diagnosticos.length === 0
  const pendencias = new Map([...porId.values()].map((no) => [no.id, no.dependeDe.length]))
  const ordem: string[] = []
  while (validos && ordem.length < porId.size) {
    const prontos = [...porId.values()]
      .filter((no) => pendencias.get(no.id) === 0 && !ordem.includes(no.id))
      .sort((a, b) => a.numero - b.numero || compararTexto(a.id, b.id))
    if (prontos.length === 0) break
    for (const pronto of prontos) {
      ordem.push(pronto.id)
      for (const no of porId.values())
        if (no.dependeDe.includes(pronto.id))
          pendencias.set(no.id, (pendencias.get(no.id) ?? 1) - 1)
    }
  }

  return {
    nos: [...porId.values()].sort((a, b) => a.numero - b.numero || compararTexto(a.id, b.id)),
    ordem: validos && ordem.length === porId.size ? ordem : [],
    diagnosticos,
    fingerprint: fingerprintInventario(nos, diagnosticos)
  }
}

export interface EstadoRemotoDoNo {
  readonly id: string
  readonly estadoTecnico: EstadoTecnico
  readonly issue?: {
    readonly numero: number
    readonly aberta: boolean
    readonly labels?: readonly string[]
  }
  readonly pullRequests?: NoInventario['pullRequests']
}

/** Concilia a projeção documental com a observação GitHub sem escolher conflito silenciosamente. */
export function reconciliarInventario(
  locais: readonly NoInventario[],
  remotos: readonly EstadoRemotoDoNo[],
  revisoesDasFontes: RevisoesDasFontes
): InventarioGlobal {
  const remotoPorId = new Map<string, EstadoRemotoDoNo>()
  const diagnosticos: DiagnosticoInventario[] = []
  for (const remoto of remotos) {
    if (remotoPorId.has(remoto.id)) {
      diagnosticos.push({
        codigo: 'duplicidade',
        envolvidos: [remoto.id],
        mensagem: `GitHub retornou mais de um item para ${remoto.id}.`
      })
    } else remotoPorId.set(remoto.id, remoto)
  }

  const idsLocais = new Set(locais.map((no) => no.id))
  for (const remoto of remotos) {
    if (!idsLocais.has(remoto.id)) {
      diagnosticos.push({
        codigo: 'item-orfao',
        envolvidos: [remoto.id],
        mensagem: `O item GitHub ${remoto.id} não tem correspondência em STATUS.md.`
      })
    }
  }

  const conciliados = locais.map((local) => {
    const remoto = remotoPorId.get(local.id)
    if (remoto === undefined) {
      diagnosticos.push({
        codigo: 'item-orfao',
        envolvidos: [local.id],
        mensagem: `${local.id} não apareceu na coleta GitHub completa.`
      })
      return { ...local, estadoTecnico: 'desconhecido' as const }
    }
    const estadoDivergente =
      local.estadoTecnico !== 'desconhecido' &&
      remoto.estadoTecnico !== 'desconhecido' &&
      local.estadoTecnico !== remoto.estadoTecnico
    const issueDivergente =
      local.issue !== undefined &&
      remoto.issue !== undefined &&
      (local.issue.numero !== remoto.issue.numero || local.issue.aberta !== remoto.issue.aberta)
    if (estadoDivergente || issueDivergente) {
      diagnosticos.push({
        codigo: 'conflito-projecao',
        envolvidos: [local.id],
        mensagem: `STATUS.md e GitHub divergem em ${local.id}; reconciliação explícita necessária.`
      })
    }
    return {
      ...local,
      estadoTecnico: estadoDivergente ? ('desconhecido' as const) : remoto.estadoTecnico,
      issue: remoto.issue,
      pullRequests: remoto.pullRequests
    }
  })

  const base = comporInventario(conciliados)
  const todosDiagnosticos = [...base.diagnosticos, ...diagnosticos]
  return {
    ...base,
    diagnosticos: todosDiagnosticos,
    ordem: todosDiagnosticos.length > 0 ? [] : base.ordem,
    fingerprint: fingerprintInventario(conciliados, todosDiagnosticos),
    revisoesDasFontes
  }
}

/** Merge confirmado satisfaz dependência técnica mesmo com issue administrativa ainda aberta. */
export function dependenciasTecnicasSatisfeitas(
  no: NoInventario,
  inventario: InventarioGlobal
): boolean {
  const porId = new Map(inventario.nos.map((item) => [item.id, item]))
  return no.dependeDe.every((id) => porId.get(id)?.estadoTecnico === 'mergeado')
}

/** Revisão não aprovada, gate ausente, bloqueio ou checks não verdes jamais executam. */
export function elegivelParaExecucao(no: NoInventario, inventario: InventarioGlobal): boolean {
  if (
    inventario.diagnosticos.length > 0 ||
    no.spec.estado !== 'aprovada' ||
    !no.spec.revisaoAtual?.trim() ||
    no.spec.revisaoAtual !== no.spec.revisaoAprovada ||
    !no.gateAprovado ||
    no.bloqueado
  )
    return false
  if (no.pullRequests?.some((pull) => pull.estado === 'open')) return false
  return no.estadoTecnico === 'pendente' && dependenciasTecnicasSatisfeitas(no, inventario)
}
