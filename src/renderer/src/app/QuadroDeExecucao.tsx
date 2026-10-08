import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AlvoDeCancelamentoEmCascata } from '@shared/domain/roadmap'
import type { QuadroDeExecucao, ResultadoDoPlay } from '@shared/domain/quadro-execucao'
import type { PreviaDeCancelamentoEmCascata } from '@shared/domain/quadro-execucao'
import { Button, ErrorState, LoadingState } from '@design/ui'
import { PainelDaTarefa } from './PainelDaTarefa'
import {
  CONTROLES_OPERACIONAIS,
  type ControleOperacional,
  type SnapshotDeControles
} from '@shared/domain/continuous-controls'

const NOMES_DOS_CONTROLES: Record<ControleOperacional, string> = {
  execucao: 'Novas execuções',
  gasto: 'Gasto monetário',
  push: 'Push de branch',
  'criacao-pr': 'Criação de PR',
  merge: 'Merge automático'
}

function estadoDaTarefa(estado: string): string {
  const rotulos: Record<string, string> = {
    concluida: 'concluída',
    pendente: 'pendente',
    'em-execucao': 'em execução',
    falhou: 'falhou',
    cancelada: 'cancelada',
    recusada: 'recusada',
    incompleta: 'incompleta',
    'escopo-violado': 'fora do escopo'
  }
  return rotulos[estado] ?? 'estado registrado'
}

const INTERVALO_DA_CONSULTA_MS = 60_000

export function QuadroDeExecucao({
  projectId,
  workspace
}: {
  readonly projectId: string
  readonly workspace: WorkspaceId
}): React.JSX.Element {
  const [quadro, setQuadro] = useState<QuadroDeExecucao | null>(null)
  const [selecionadas, setSelecionadas] = useState<readonly string[]>([])
  const [resultados, setResultados] = useState<readonly ResultadoDoPlay[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [falhou, setFalhou] = useState(false)
  const [runAberto, setRunAberto] = useState<string | undefined>()
  const [cancelando, setCancelando] = useState<string | undefined>()
  const [mensagemDoCancelamento, setMensagemDoCancelamento] = useState<string | undefined>()
  const [cascataAberta, setCascataAberta] = useState(false)
  const [alvoDaCascata, setAlvoDaCascata] = useState<AlvoDeCancelamentoEmCascata | undefined>()
  const [previaDaCascata, setPreviaDaCascata] = useState<
    PreviaDeCancelamentoEmCascata | undefined
  >()
  const [erroDaCascata, setErroDaCascata] = useState<string | undefined>()
  const [cancelandoCascata, setCancelandoCascata] = useState(false)
  const [decidindo, setDecidindo] = useState<string | undefined>()
  const [escopoWorkspace, setEscopoWorkspace] = useState(false)
  const [controles, setControles] = useState<SnapshotDeControles | undefined>()
  const [salvandoControle, setSalvandoControle] = useState(false)

  const atualizarControles = useCallback(async () => {
    const snapshot = await window.jarvis.lerControlesContinuos({
      workspaceId: workspace,
      ...(escopoWorkspace ? {} : { projectId })
    })
    setControles(snapshot)
  }, [projectId, workspace, escopoWorkspace])

  const atualizar = useCallback(async () => {
    try {
      setQuadro(await window.jarvis.quadroDeExecucao(projectId, workspace))
      setFalhou(false)
    } catch {
      setFalhou(true)
    } finally {
      setCarregando(false)
    }
  }, [projectId, workspace])

  useEffect(() => {
    let ativo = true
    const carregar = async () => {
      try {
        const vista = await window.jarvis.quadroDeExecucao(projectId, workspace)
        if (ativo) {
          setQuadro(vista)
          setFalhou(false)
        }
      } catch {
        if (ativo) setFalhou(true)
      } finally {
        if (ativo) setCarregando(false)
      }
    }
    void carregar()
    const timer = window.setInterval(() => {
      void carregar()
      void window.jarvis
        .lerControlesContinuos({
          workspaceId: workspace,
          ...(escopoWorkspace ? {} : { projectId })
        })
        .then((snapshot) => {
          if (ativo) setControles(snapshot)
        })
        .catch(() => {
          if (ativo) setControles(undefined)
        })
    }, INTERVALO_DA_CONSULTA_MS)
    return () => {
      ativo = false
      window.clearInterval(timer)
    }
  }, [projectId, workspace, escopoWorkspace])

  useEffect(() => {
    let ativo = true
    void window.jarvis
      .lerControlesContinuos({ workspaceId: workspace, ...(escopoWorkspace ? {} : { projectId }) })
      .then((snapshot) => {
        if (ativo) setControles(snapshot)
      })
      .catch(() => {
        if (ativo) setControles(undefined)
      })
    return () => {
      ativo = false
    }
  }, [projectId, workspace, escopoWorkspace])

  const aplicarControle = async (
    acao:
      | { tipo: 'pausa'; pausada: boolean | null }
      | { tipo: 'switch'; controle: ControleOperacional; habilitado: boolean | null }
  ) => {
    if (salvandoControle) return
    setSalvandoControle(true)
    try {
      const resultado = await window.jarvis.definirControleContinuo({
        escopo: { workspaceId: workspace, ...(escopoWorkspace ? {} : { projectId }) },
        acao,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      })
      if (resultado.status === 'invalid' || resultado.status === 'idempotency-conflict')
        throw new Error(resultado.message)
      await atualizarControles()
      await atualizar()
      setMensagemDoCancelamento(
        acao.tipo === 'pausa'
          ? acao.pausada
            ? 'Pausa solicitada; os runs ativos vão terminar antes de suspender novos dispatches.'
            : 'Retomada solicitada; o dispatcher verificará novamente no próximo ciclo.'
          : 'Controle operacional atualizado.'
      )
    } catch {
      setMensagemDoCancelamento('Não foi possível atualizar o controle operacional.')
    } finally {
      setSalvandoControle(false)
    }
  }

  const cartoes = quadro?.colunas.flatMap((coluna) => coluna.cartoes) ?? []
  const elegiveis = cartoes.filter(
    (cartao) =>
      cartao.coluna === 'a-fazer' &&
      cartao.issue !== undefined &&
      cartao.specExecutavel &&
      (cartao.run === undefined ||
        cartao.run.estado === 'BLOCKED' ||
        cartao.run.estado === 'CANCELLED')
  )
  const mvpSelecionado = new Set(
    cartoes.filter((cartao) => selecionadas.includes(cartao.sliceId)).map((cartao) => cartao.mvpId)
  )
  const podeSelecionar = (sliceId: string, mvpId: string) =>
    mvpSelecionado.size === 0 || selecionadas.includes(sliceId) || mvpSelecionado.has(mvpId)

  const alternar = (sliceId: string) => {
    const cartao = elegiveis.find((item) => item.sliceId === sliceId)
    if (!cartao) return
    setSelecionadas((atual) =>
      atual.includes(sliceId) ? atual.filter((id) => id !== sliceId) : [...atual, sliceId]
    )
  }

  const preverCascata = async () => {
    if (alvoDaCascata === undefined || cancelandoCascata) return
    setErroDaCascata(undefined)
    setPreviaDaCascata(undefined)
    try {
      const resposta = await window.jarvis.preverCancelamentoEmCascataNoQuadro(
        projectId,
        alvoDaCascata,
        workspace
      )
      if (!resposta.ok) {
        setErroDaCascata(resposta.mensagem)
        return
      }
      setPreviaDaCascata(resposta)
    } catch {
      setErroDaCascata('Não foi possível calcular a prévia do cancelamento.')
    }
  }

  const confirmarCascata = async () => {
    if (
      alvoDaCascata === undefined ||
      previaDaCascata === undefined ||
      previaDaCascata.runs.length === 0 ||
      cancelandoCascata
    )
      return
    setCancelandoCascata(true)
    setErroDaCascata(undefined)
    try {
      const resultado = await window.jarvis.cancelarEmCascataNoQuadro(
        projectId,
        alvoDaCascata,
        previaDaCascata.fingerprint,
        workspace
      )
      if (resultado.status === 'stale') {
        setPreviaDaCascata(resultado.previa)
        setErroDaCascata('Roadmap ou runs mudaram. Revise a prévia atualizada antes de confirmar.')
        return
      }
      if (resultado.status === 'invalid') {
        setErroDaCascata(resultado.mensagem)
        return
      }
      const cancelados = resultado.resultados.filter((item) => item.resultado.cancelado).length
      const recusados = resultado.resultados.length - cancelados
      setMensagemDoCancelamento(
        `Cascata concluída: ${cancelados} run(s) cancelado(s), ${recusados} sem cancelamento.`
      )
      setPreviaDaCascata(undefined)
      await atualizar()
    } catch {
      setErroDaCascata(
        'Não foi possível concluir a cascata. Atualize a prévia para tentar de novo.'
      )
    } finally {
      setCancelandoCascata(false)
    }
  }

  const escolherAlvoDaCascata = (value: string) => {
    setErroDaCascata(undefined)
    setPreviaDaCascata(undefined)
    if (value === 'dag') {
      setAlvoDaCascata({ tipo: 'dag' })
    } else if (value.startsWith('mvp:')) {
      setAlvoDaCascata({ tipo: 'mvp', mvpId: value.slice('mvp:'.length) })
    } else if (value.startsWith('fatia:')) {
      setAlvoDaCascata({ tipo: 'fatia', sliceId: value.slice('fatia:'.length) })
    } else {
      setAlvoDaCascata(undefined)
    }
  }

  const play = async () => {
    if (selecionadas.length === 0 || ocupado) return
    setOcupado(true)
    try {
      const resposta = await window.jarvis.playNoQuadro(
        { projectId, sliceIds: selecionadas },
        workspace
      )
      setResultados(resposta)
      setSelecionadas([])
      await atualizar()
    } catch {
      setResultados([
        { sliceId: '', estado: 'recusado', mensagem: 'Não foi possível iniciar o play.' }
      ])
    } finally {
      setOcupado(false)
    }
  }

  const cancelar = async (runId: string) => {
    if (cancelando !== undefined || !window.confirm('Cancelar este run e suas tarefas?')) return
    setCancelando(runId)
    try {
      const resposta = await window.jarvis.cancelarNoQuadro(projectId, runId, workspace)
      setMensagemDoCancelamento(
        resposta.cancelado
          ? 'Run cancelado. Recursos e evidências serão reconciliados.'
          : resposta.mensagem
      )
      await atualizar()
    } catch {
      setMensagemDoCancelamento('Não foi possível cancelar o run.')
    } finally {
      setCancelando(undefined)
    }
  }

  const decidirAprovacao = async (id: string, decisao: 'aprovado' | 'negado') => {
    if (decidindo !== undefined) return
    setDecidindo(id)
    try {
      const resolvida = await window.jarvis.resolverAprovacaoDoSquad(
        projectId,
        id,
        decisao,
        workspace
      )
      setMensagemDoCancelamento(
        resolvida ? 'Decisão do PI registrada.' : 'O pedido já não está disponível para decisão.'
      )
      await atualizar()
    } catch {
      setMensagemDoCancelamento('Não foi possível registrar a decisão do PI.')
    } finally {
      setDecidindo(undefined)
    }
  }

  if (carregando) return <LoadingState rotulo="Carregando quadro de execução" />
  if (falhou || quadro === null) {
    return (
      <ErrorState
        titulo="Quadro de execução"
        descricao="Não foi possível atualizar o quadro."
        onTentarNovamente={() => {
          setCarregando(true)
          void atualizar()
        }}
      />
    )
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="quadro-execucao-titulo">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            id="quadro-execucao-titulo"
            className="text-lg font-semibold text-[var(--jos-cor-texto)]"
          >
            Quadro de execução
          </h3>
          <p className="text-sm text-[var(--jos-cor-texto-suave)]">
            Atualizado {new Date(quadro.geradoEm).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variante="secundaria"
            desabilitado={cancelandoCascata}
            onClick={() => {
              setCascataAberta((aberta) => !aberta)
              setAlvoDaCascata(undefined)
              setPreviaDaCascata(undefined)
              setErroDaCascata(undefined)
            }}
          >
            Cancelamento em cascata
          </Button>
          <Button
            variante="primaria"
            desabilitado={selecionadas.length === 0}
            carregando={ocupado}
            onClick={() => void play()}
          >
            {ocupado
              ? 'Iniciando…'
              : `Play${selecionadas.length ? ` (${selecionadas.length})` : ''}`}
          </Button>
        </div>
      </header>

      {cascataAberta && (
        <section
          className="rounded-xl border border-red-400/30 bg-[rgba(var(--jos-borda-rgb),0.035)] p-4"
          aria-labelledby="cancelamento-cascata-titulo"
        >
          <h4 id="cancelamento-cascata-titulo" className="font-semibold">
            Cancelar alvo e descendentes vinculados
          </h4>
          <p className="mt-1 text-sm text-[var(--jos-cor-texto-suave)]">
            A prévia mostra as fatias alcançadas e os runs ativos. Ramos independentes ficam fora.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-col gap-1 text-sm">
              Alvo
              <select
                aria-label="Alvo do cancelamento em cascata"
                value={
                  alvoDaCascata?.tipo === 'dag'
                    ? 'dag'
                    : alvoDaCascata?.tipo === 'mvp'
                      ? `mvp:${alvoDaCascata.mvpId}`
                      : alvoDaCascata?.tipo === 'fatia'
                        ? `fatia:${alvoDaCascata.sliceId}`
                        : ''
                }
                disabled={cancelandoCascata}
                onChange={(event) => escolherAlvoDaCascata(event.target.value)}
              >
                <option value="">Selecione DAG, MVP ou fatia</option>
                <option value="dag">DAG inteiro</option>
                {[...new Map(cartoes.map((cartao) => [cartao.mvpId, cartao])).values()]
                  .sort((a, b) => a.numeroDoMvp - b.numeroDoMvp)
                  .map((cartao) => (
                    <option key={`mvp:${cartao.mvpId}`} value={`mvp:${cartao.mvpId}`}>
                      MVP-{cartao.numeroDoMvp}
                    </option>
                  ))}
                {[...cartoes]
                  .sort(
                    (a, b) => a.numeroDoMvp - b.numeroDoMvp || a.numeroDaFatia - b.numeroDaFatia
                  )
                  .map((cartao) => (
                    <option key={`fatia:${cartao.sliceId}`} value={`fatia:${cartao.sliceId}`}>
                      MVP-{cartao.numeroDoMvp} F{cartao.numeroDaFatia} · {cartao.titulo}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              variante="secundaria"
              desabilitado={alvoDaCascata === undefined || cancelandoCascata}
              onClick={() => void preverCascata()}
            >
              Atualizar prévia
            </Button>
          </div>
          {previaDaCascata && (
            <div className="mt-3 rounded-lg border border-[rgba(var(--jos-borda-rgb),0.12)] p-3">
              <p className="text-sm font-medium">
                {previaDaCascata.fatias.length} fatia(s) vinculada(s) ·{' '}
                {previaDaCascata.runs.length} run(s) ativo(s)
              </p>
              <ul
                className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--jos-cor-texto-suave)]"
                aria-label="Descendentes alcançados pela prévia"
              >
                {previaDaCascata.fatias.map((fatia) => {
                  const runs = previaDaCascata.runs.filter((run) => run.sliceId === fatia.sliceId)
                  return (
                    <li key={fatia.sliceId}>
                      MVP-{fatia.numeroDoMvp} F{fatia.numeroDaFatia} · {fatia.titulo}
                      {runs.length > 0
                        ? ` · ${runs.map((run) => `${run.runId} (${run.estado})`).join(', ')}`
                        : ' · sem run ativo'}
                    </li>
                  )
                })}
                {previaDaCascata.fatias.length === 0 && <li>O alvo não contém fatias.</li>}
              </ul>
              <div className="mt-3">
                <Button
                  variante="perigo"
                  desabilitado={previaDaCascata.runs.length === 0 || cancelandoCascata}
                  carregando={cancelandoCascata}
                  onClick={() => void confirmarCascata()}
                >
                  {cancelandoCascata
                    ? 'Cancelando…'
                    : `Confirmar cancelamento de ${previaDaCascata.runs.length} run(s)`}
                </Button>
              </div>
            </div>
          )}
          {erroDaCascata && (
            <p role="alert" className="mt-2 text-sm text-red-400">
              {erroDaCascata}
            </p>
          )}
        </section>
      )}

      <section
        className="rounded-xl border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[rgba(var(--jos-borda-rgb),0.035)] p-4"
        aria-labelledby="controles-continuos-titulo"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 id="controles-continuos-titulo" className="font-semibold">
              Controles operacionais
            </h4>
            <p className="text-xs text-[var(--jos-cor-texto-suave)]">
              Escopo: {escopoWorkspace ? 'workspace' : 'projeto'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={escopoWorkspace}
              onChange={(event) => setEscopoWorkspace(event.target.checked)}
            />
            Aplicar ao workspace
          </label>
        </div>
        {controles === undefined ? (
          <p className="mt-3 text-sm text-amber-400">Estado dos controles indisponível.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variante={controles.pausa.noEscopoAtual ? 'secundaria' : 'primaria'}
                desabilitado={salvandoControle || (!escopoWorkspace && controles.pausa.noWorkspace)}
                onClick={() =>
                  void aplicarControle({ tipo: 'pausa', pausada: !controles.pausa.noEscopoAtual })
                }
              >
                {controles.pausa.noEscopoAtual
                  ? 'Retomar dispatches'
                  : 'Pausar após os runs ativos'}
              </Button>
              {!escopoWorkspace && (
                <button
                  type="button"
                  className="text-xs underline"
                  disabled={salvandoControle || !controles.pausa.noEscopoAtual}
                  onClick={() => void aplicarControle({ tipo: 'pausa', pausada: null })}
                >
                  Herdar pausa do workspace
                </button>
              )}
              <span role="status" className="text-sm text-[var(--jos-cor-texto-suave)]">
                {controles.pausa.pausada
                  ? controles.pausa.drenando
                    ? 'Pausa solicitada · aguardando run(s) terminar(em)'
                    : 'Dispatch pausado'
                  : 'Dispatch ativo'}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CONTROLES_OPERACIONAIS.map((controle) => {
                const estado = controles.controles[controle]
                return (
                  <label
                    key={controle}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(var(--jos-borda-rgb),0.12)] p-3 text-sm"
                  >
                    <span>
                      {NOMES_DOS_CONTROLES[controle]}
                      {estado.herdado ? (
                        <small className="block text-xs text-[var(--jos-cor-texto-suave)]">
                          Herdado do workspace
                        </small>
                      ) : null}
                    </span>
                    <div className="flex items-center gap-2">
                      {!escopoWorkspace && (
                        <button
                          type="button"
                          className="text-xs underline"
                          disabled={salvandoControle}
                          aria-label={`Herdar ${NOMES_DOS_CONTROLES[controle]} do workspace`}
                          onClick={() =>
                            void aplicarControle({ tipo: 'switch', controle, habilitado: null })
                          }
                        >
                          Herdar
                        </button>
                      )}
                      <input
                        type="checkbox"
                        checked={estado.enabled}
                        disabled={salvandoControle}
                        aria-label={NOMES_DOS_CONTROLES[controle]}
                        onChange={(event) =>
                          void aplicarControle({
                            tipo: 'switch',
                            controle,
                            habilitado: event.target.checked
                          })
                        }
                      />
                    </div>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </section>

      {resultados.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-[rgba(var(--jos-borda-rgb),0.16)] p-3 text-sm"
        >
          {resultados.map((resultado, indice) => (
            <p key={`${resultado.sliceId}-${indice}`}>{resultado.mensagem}</p>
          ))}
        </div>
      )}
      {mensagemDoCancelamento && (
        <p role="status" className="text-sm">
          {mensagemDoCancelamento}
        </p>
      )}

      <div
        className="grid gap-3 overflow-x-auto xl:grid-cols-7"
        aria-label="Colunas do quadro de execução"
      >
        {quadro.colunas.map((coluna) => (
          <section
            key={coluna.id}
            aria-label={coluna.titulo}
            className="min-w-44 rounded-xl border border-[rgba(var(--jos-borda-rgb),0.14)] bg-[rgba(var(--jos-borda-rgb),0.035)] p-3"
          >
            <h4 className="mb-3 flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--jos-cor-texto-suave)]">
              {coluna.titulo}
              <span>{coluna.cartoes.length}</span>
            </h4>
            <div className="flex flex-col gap-2">
              {coluna.cartoes.map((cartao) => {
                const selecionavel = coluna.id === 'a-fazer' && cartao.issue !== undefined
                return (
                  <article
                    key={cartao.sliceId}
                    className="rounded-lg border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-fundo)] p-3 text-sm"
                  >
                    {selecionavel && elegiveis.some((item) => item.sliceId === cartao.sliceId) && (
                      <label className="mb-2 flex items-center gap-2 text-xs text-[var(--jos-cor-texto-suave)]">
                        <input
                          type="checkbox"
                          checked={selecionadas.includes(cartao.sliceId)}
                          disabled={!podeSelecionar(cartao.sliceId, cartao.mvpId)}
                          onChange={() => alternar(cartao.sliceId)}
                        />
                        Selecionar para Play
                      </label>
                    )}
                    <p className="font-medium text-[var(--jos-cor-texto)]">{cartao.titulo}</p>
                    <p className="mt-1 text-xs text-[var(--jos-cor-texto-suave)]">
                      MVP-{cartao.numeroDoMvp} · F{cartao.numeroDaFatia}
                      {cartao.issue ? ` · #${cartao.issue}` : ''}
                    </p>
                    {cartao.aprovacaoPendente && (
                      <section
                        className="mt-2 rounded border border-amber-400/40 bg-amber-400/10 p-2 text-xs"
                        aria-label="Aguardando decisão do PI"
                      >
                        <p className="font-semibold text-amber-300">Aguardando PI</p>
                        <p className="mt-1 text-[var(--jos-cor-texto)]">
                          {cartao.aprovacaoPendente.motivo}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={decidindo !== undefined}
                            onClick={() =>
                              void decidirAprovacao(cartao.aprovacaoPendente!.id, 'aprovado')
                            }
                          >
                            Aprovar ação
                          </button>
                          <button
                            type="button"
                            disabled={decidindo !== undefined}
                            onClick={() =>
                              void decidirAprovacao(cartao.aprovacaoPendente!.id, 'negado')
                            }
                          >
                            Recusar ação
                          </button>
                        </div>
                      </section>
                    )}
                    {cartao.run !== undefined && (
                      <button
                        type="button"
                        className="mt-2 rounded border border-[rgba(var(--jos-borda-rgb),0.18)] px-2 py-1 text-xs"
                        onClick={() => setRunAberto(cartao.run?.id)}
                      >
                        Ver atividade dos agentes
                      </button>
                    )}
                    {cartao.run !== undefined &&
                      !['BLOCKED', 'CANCELLED', 'MERGED'].includes(cartao.run.estado) && (
                        <button
                          type="button"
                          className="mt-2 ml-2 rounded border border-red-400/40 px-2 py-1 text-xs text-red-400"
                          disabled={cancelando !== undefined}
                          onClick={() => void cancelar(cartao.run!.id)}
                        >
                          {cancelando === cartao.run.id ? 'Cancelando…' : 'Cancelar run'}
                        </button>
                      )}
                    {cartao.equipe && (
                      <section
                        className="mt-3 rounded-md border border-[rgba(var(--jos-borda-rgb),0.12)] p-2 text-xs"
                        aria-label={`Equipe e execução de ${cartao.titulo}`}
                      >
                        <p className="font-medium text-[var(--jos-cor-texto)]">
                          Equipe · {cartao.equipe.escritores} escritor(es)
                        </p>
                        <ul className="mt-1 space-y-0.5 text-[var(--jos-cor-texto-suave)]">
                          {cartao.equipe.membros.map((membro) => (
                            <li key={`${membro.papel}-${membro.modelo}`}>
                              {membro.papel}: {membro.modelo} ({membro.provider})
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-[var(--jos-cor-texto-suave)]">
                          Teto de custo:{' '}
                          {cartao.equipe.limiteCusto.medido
                            ? `até US$ ${cartao.equipe.limiteCusto.usd.toFixed(2)}`
                            : 'sem custo variável medido para a rota escolhida'}
                        </p>
                        <p className="mt-1 text-[var(--jos-cor-texto-suave)]">
                          Fluxo: {cartao.equipe.workflow.join(' → ')}
                        </p>
                        {cartao.equipe.consumo && (
                          <p
                            className="mt-1 text-[var(--jos-cor-texto-suave)]"
                            aria-label="Consumo do Squad"
                          >
                            Uso observado: {cartao.equipe.consumo.chamadas} chamada(s),{' '}
                            {cartao.equipe.consumo.tokensEntrada +
                              cartao.equipe.consumo.tokensSaida}{' '}
                            tokens, {Math.ceil(cartao.equipe.consumo.duracaoMs / 1000)} s
                            {cartao.equipe.limiteCusto.medido &&
                              `, US$ ${cartao.equipe.consumo.usd.toFixed(4)}`}
                            {cartao.equipe.consumo.pendentes > 0 &&
                              ` · ${cartao.equipe.consumo.pendentes} pendente(s)`}
                            {cartao.equipe.consumo.falhasDeTeto > 0 &&
                              ` · ${cartao.equipe.consumo.falhasDeTeto} estouro(s)`}
                          </p>
                        )}
                        {cartao.equipe.progresso.length > 0 && (
                          <ul
                            className="mt-1 space-y-0.5"
                            aria-label="Progresso das tarefas do Squad"
                          >
                            {cartao.equipe.progresso.map((tarefa) => (
                              <li key={tarefa.tarefaId}>
                                {tarefa.papel}: {estadoDaTarefa(tarefa.estado)}
                                {tarefa.estado === 'falhou' && tarefa.motivo && (
                                  <span className="ml-1 text-red-400">· {tarefa.motivo}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )}
                    {coluna.id === 'a-fazer' &&
                      cartao.issue !== undefined &&
                      !cartao.specExecutavel && (
                        <p className="mt-2 text-xs text-amber-400">
                          Aguardando SPEC executável aprovada.
                        </p>
                      )}
                    {coluna.id === 'a-fazer' &&
                      cartao.run &&
                      cartao.run.estado !== 'BLOCKED' &&
                      cartao.run.estado !== 'CANCELLED' && (
                        <p className="mt-2 text-xs text-[var(--jos-cor-texto-suave)]">
                          Já existe um run ativo ({cartao.run.estado}).
                        </p>
                      )}
                    {cartao.dependenciasAbertas.map((dependencia) => (
                      <p key={dependencia.id} className="mt-2 text-xs text-amber-400">
                        {dependencia.mensagem}
                      </p>
                    ))}
                    {cartao.run?.bloqueio && (
                      <p className="mt-2 text-xs text-amber-400">{cartao.run.bloqueio.evidencia}</p>
                    )}
                    {coluna.id === 'pr-merge' && (
                      <div className="mt-2 text-xs" aria-live="polite">
                        <p>
                          {cartao.consulta.estado === 'desconhecido'
                            ? `Estado desconhecido desde ${cartao.consulta.desconhecidoDesde ?? 'horário indisponível'}: ${cartao.consulta.erro ?? ''}`
                            : `Última consulta: ${cartao.consulta.consultadoEm ?? 'ainda não consultado'}`}
                        </p>
                        {cartao.run && (
                          <p>
                            Na etapa há{' '}
                            {Math.max(
                              0,
                              Math.floor(
                                (Date.now() - new Date(cartao.run.updated_at).getTime()) / 1000
                              )
                            )}{' '}
                            s.
                          </p>
                        )}
                        {cartao.consulta.checks.map((check) => (
                          <p
                            key={`${check.nome}-${check.status}`}
                            className={
                              check.status === 'completed' && check.conclusao !== 'success'
                                ? 'text-red-400'
                                : undefined
                            }
                          >
                            {check.nome}:{' '}
                            {check.status === 'completed'
                              ? (check.conclusao ?? 'concluído')
                              : check.status === 'queued'
                                ? 'na fila'
                                : 'em andamento'}
                          </p>
                        ))}
                        {cartao.consulta.estado === 'atualizado' &&
                          cartao.consulta.checks.length === 0 && (
                            <p>A origem não devolveu checks para esta revisão.</p>
                          )}
                      </div>
                    )}
                  </article>
                )
              })}
              {coluna.cartoes.length === 0 && (
                <p className="rounded-lg border border-dashed border-[rgba(var(--jos-borda-rgb),0.12)] p-3 text-xs text-[var(--jos-cor-texto-suave)]">
                  Sem issues nesta etapa.
                </p>
              )}
            </div>
            {runAberto !== undefined && (
              <PainelDaTarefa
                runId={runAberto}
                workspace={workspace}
                onFechar={() => setRunAberto(undefined)}
              />
            )}
          </section>
        ))}
      </div>
      <p className="text-xs text-[var(--jos-cor-texto-suave)]">
        Checks e merge são consultados novamente a cada 60 segundos. A coluna DONE exige confirmação
        do merge pela origem.
      </p>
    </section>
  )
}
