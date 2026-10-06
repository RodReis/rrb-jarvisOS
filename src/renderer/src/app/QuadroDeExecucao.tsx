import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { QuadroDeExecucao, ResultadoDoPlay } from '@shared/domain/quadro-execucao'
import { Button, ErrorState, LoadingState } from '@design/ui'

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
    const timer = window.setInterval(() => void carregar(), INTERVALO_DA_CONSULTA_MS)
    return () => {
      ativo = false
      window.clearInterval(timer)
    }
  }, [projectId, workspace])

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
        <Button
          variante="primaria"
          desabilitado={selecionadas.length === 0}
          carregando={ocupado}
          onClick={() => void play()}
        >
          {ocupado ? 'Iniciando…' : `Play${selecionadas.length ? ` (${selecionadas.length})` : ''}`}
        </Button>
      </header>

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
