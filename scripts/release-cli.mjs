import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'

const COMMANDS = new Set(['queue', 'release', 'steps', 'gates', 'timeline'])

function parse(argv) {
  const [command, ...args] = argv
  if (!command || !COMMANDS.has(command)) {
    throw new TypeError('Comando esperado: queue | release | steps | gates | timeline.')
  }
  const values = new Map()
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i]?.replace(/^--/, '')
    if (!name || !['db', 'user', 'workspace', 'project', 'id'].includes(name) || values.has(name)) {
      throw new TypeError(`Argumento inválido: ${args[i] ?? ''}`)
    }
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new TypeError(`Informe um valor para --${name}.`)
    values.set(name, value)
  }
  for (const name of ['db', 'user', 'workspace', 'project']) {
    if (!values.get(name)?.trim()) throw new TypeError(`Informe --${name} <valor>.`)
  }
  if (!['noa', 'jarvis'].includes(values.get('workspace'))) {
    throw new TypeError('Workspace deve ser noa ou jarvis.')
  }
  if (command !== 'queue' && !values.get('id')?.trim())
    throw new TypeError('Informe --id <release-id>.')
  return { command, values }
}

function escopo(values) {
  return [values.get('user'), values.get('workspace'), values.get('project')]
}

function release(row) {
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        sha: row.sha,
        status: row.status,
        stageStartedAt: row.stage_started_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null
}

function step(row) {
  return {
    releaseId: row.release_id,
    environment: row.environment,
    step: row.step,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    state: row.state,
    attempt: row.attempt,
    updatedAt: row.updated_at
  }
}

export function executarReleaseCli(db, argv) {
  const { command, values } = parse(argv)
  const scope = escopo(values)
  if (command === 'queue') {
    const candidate = db
      .prepare(
        `SELECT r.* FROM release_candidate c JOIN release_run r ON r.id=c.release_id
        WHERE c.user_id=? AND c.workspace_id=? AND c.project_id=?`
      )
      .get(...scope)
    const lanes = db
      .prepare(
        `SELECT environment,active_release_id FROM release_environment_lane
        WHERE user_id=? AND workspace_id=? AND project_id=?`
      )
      .all(...scope)
    const pending = db
      .prepare(
        `SELECT release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at FROM release_step
        WHERE user_id=? AND workspace_id=? AND project_id=? AND state IN ('intended','ambiguous') ORDER BY updated_at`
      )
      .all(...scope)
    const candidateView = release(candidate)
    const minimalAction = pending.length
      ? 'reconcile'
      : candidateView && ['queued', 'preparing'].includes(candidateView.status)
        ? 'resume'
        : candidateView && ['failed', 'degraded'].includes(candidateView.status)
          ? 'resolve-blocker'
          : 'none'
    return {
      candidate: candidateView,
      activeEnvironments: {
        staging: lanes.find((lane) => lane.environment === 'staging')?.active_release_id ?? null,
        production:
          lanes.find((lane) => lane.environment === 'production')?.active_release_id ?? null
      },
      pendingReconciliation: pending.map(step),
      minimalAction
    }
  }

  const id = values.get('id')
  const row = db
    .prepare(
      `SELECT * FROM release_run WHERE id=? AND user_id=? AND workspace_id=? AND project_id=?`
    )
    .get(id, ...scope)
  if (!row) throw new TypeError('Release não encontrada no escopo informado.')
  const releaseView = release(row)
  const steps = db
    .prepare(
      `SELECT release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at FROM release_step
      WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? ORDER BY updated_at`
    )
    .all(...scope, id)
  const gates = db
    .prepare(
      `SELECT id,user_id,workspace_id,project_id,release_id,environment,gate,result,reason,created_at AS createdAt
       FROM release_gate_result WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? ORDER BY created_at`
    )
    .all(...scope, id)
    .map((gate) => ({
      id: gate.id,
      userId: gate.user_id,
      workspaceId: gate.workspace_id,
      projectId: gate.project_id,
      releaseId: gate.release_id,
      environment: gate.environment,
      gate: gate.gate,
      result: gate.result,
      reason: gate.reason,
      createdAt: gate.createdAt
    }))
  const timeline = db
    .prepare(
      `SELECT id,release_id,environment,kind,from_status,to_status,reason,created_at FROM release_event
      WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? ORDER BY created_at,id`
    )
    .all(...scope, id)
    .map((event) => ({
      id: event.id,
      releaseId: event.release_id,
      environment: event.environment,
      kind: event.kind,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      reason: event.reason,
      createdAt: event.created_at
    }))
  const stepViews = steps.map(step)
  const hasPending = steps.some((item) => ['intended', 'ambiguous'].includes(item.state))
  const minimalAction = hasPending
    ? 'reconcile'
    : ['queued', 'preparing'].includes(releaseView.status)
      ? 'resume'
      : ['failed', 'degraded'].includes(releaseView.status)
        ? 'resolve-blocker'
        : 'none'

  if (command === 'release') return { release: releaseView, minimalAction }
  if (command === 'steps') return stepViews
  if (command === 'gates') return gates
  if (command === 'timeline') return timeline
  return { release: releaseView, steps: stepViews, gates, timeline, minimalAction }
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parse(argv)
  const db = new Database(resolve(values.get('db')), { readonly: true, fileMustExist: true })
  try {
    process.stdout.write(`${JSON.stringify(executarReleaseCli(db, argv), null, 2)}\n`)
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar fila de release.'
    process.stderr.write(`${message}\n`)
    process.exitCode = 2
  }
}
