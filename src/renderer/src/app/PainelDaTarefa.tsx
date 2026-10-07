import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  EventoDeTarefaDoSquad,
  PainelDaTarefa as PainelDaTarefaModel
} from '@shared/domain/painel-tarefa'
import type {
  SnapshotDeArquivoDaTarefa,
  SnapshotDoDiffDaTarefa
} from '@shared/domain/painel-tarefa'
import type { TarefaDoPainel } from '@shared/domain/painel-tarefa'

type Aba = 'plano' | string | 'diff' | 'arquivos' | 'checks' | 'testes'

function hora(iso: string | undefined): string {
  if (iso === undefined) return 'sem registro'
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? 'horário desconhecido' : data.toLocaleTimeString()
}

export function PainelDaTarefa({
  runId,
  workspace,
  onFechar
}: {
  readonly runId: string
  readonly workspace: WorkspaceId
  readonly onFechar: () => void
}): React.JSX.Element {
  const [painel, setPainel] = useState<PainelDaTarefaModel | undefined>()
  const [aba, setAba] = useState<Aba>('plano')
  const [falhou, setFalhou] = useState(false)
  const [eventosAoVivo, setEventosAoVivo] = useState<readonly EventoDeTarefaDoSquad[]>([])
  const [conteudoSelecionado, setConteudoSelecionado] = useState<string | undefined>()
  const [conteudoId, setConteudoId] = useState<string | undefined>()
  const [termoBusca, setTermoBusca] = useState('')

  useEffect(() => {
    let ativo = true
    const carregar = async (): Promise<void> => {
      try {
        const resposta = await window.jarvis.painelDaTarefa(runId, workspace)
        if (ativo) {
          setPainel(resposta)
          setFalhou(false)
        }
      } catch {
        if (ativo) setFalhou(true)
      }
    }
    void carregar()
    const cancelar = window.jarvis.onSquadTaskEvent(runId, (evento) => {
      setEventosAoVivo((atuais) => [...atuais, evento])
      void carregar()
    })
    const timer = window.setInterval(() => void carregar(), 5_000)
    return () => {
      ativo = false
      window.clearInterval(timer)
      cancelar()
    }
  }, [runId, workspace])

  const tarefas = useMemo(() => {
    const ids = new Set([
      ...(painel?.tarefas.map((item) => item.tarefaId) ?? []),
      ...eventosAoVivo.map((evento) => evento.tarefaId)
    ])
    return [...ids].map<TarefaDoPainel>(
      (id) =>
        painel?.tarefas.find((item) => item.tarefaId === id) ?? {
          tarefaId: id,
          papel: 'Agente',
          estado: 'em-execucao',
          dependencias: [],
          paths: [],
          traces: [],
          snapshots: [],
          diffs: []
        }
    )
  }, [eventosAoVivo, painel])

  const eventosDaAba =
    aba === 'plano' || ['diff', 'arquivos', 'checks', 'testes'].includes(aba)
      ? []
      : [
          ...(painel?.tracesPorTarefa[aba]?.flatMap(
            (trace) => painel.eventosDeTarefa[trace.id] ?? []
          ) ?? []),
          ...eventosAoVivo
            .filter((evento) => evento.tarefaId === aba)
            .map((evento) => evento.evento)
        ]
  const selecionado = ((): (SnapshotDeArquivoDaTarefa | SnapshotDoDiffDaTarefa) | undefined => {
    if (aba === 'arquivos' || aba === 'diff') {
      return (
        tarefas
          .flatMap((item) => (aba === 'arquivos' ? item.snapshots : item.diffs))
          .find((item) => item.id === conteudoId) ??
        (aba === 'arquivos' ? painel?.arquivosDeTeste : undefined)?.find(
          (item) => item.id === conteudoId
        )
      )
    }
    if (aba.startsWith('tarefa:')) {
      const [, tarefaId, snapshotId] = aba.split(':')
      const tarefa = painel?.tarefas.find((item) => item.tarefaId === tarefaId)
      return [...(tarefa?.snapshots ?? []), ...(tarefa?.diffs ?? [])].find(
        (item) => item.id === snapshotId
      )
    }
    if (aba === 'testes') return painel?.arquivosDeTeste.find((item) => item.id === conteudoId)
    if (painel?.tarefas.some((item) => item.tarefaId === aba)) {
      const tarefa = painel.tarefas.find((item) => item.tarefaId === aba)
      return [...(tarefa?.snapshots ?? []), ...(tarefa?.diffs ?? [])].find(
        (item) => item.id === conteudoId
      )
    }
    return undefined
  })()
  const ehVisualizadorDeArquivo = aba === 'arquivos' && selecionado?.id === conteudoId
  const partesDestacadas = useMemo(() => {
    if (conteudoSelecionado === undefined || !ehVisualizadorDeArquivo) return undefined
    const linhas = conteudoSelecionado.split('\n')
    const busca = termoBusca.trim()
    return linhas.map((linha, indice) => {
      const classes =
        /^(\s*)(?:const|let|var|function|class|import|export|return|if|else|async|await|type|interface)\b/.exec(
          linha
        )
      const tokens = linha.split(
        /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:true|false|null|undefined)\b)/g
      )
      return (
        <div key={indice} className="min-h-4">
          <span className="mr-3 inline-block w-8 select-none text-right text-[var(--jos-cor-texto-suave)]">
            {indice + 1}
          </span>
          {tokens.map((token, tokenIndex) => {
            const palavraChave =
              /^(?:const|let|var|function|class|import|export|return|if|else|async|await|type|interface)\b/.test(
                token
              )
            const literal =
              /^(?:"|'|`)/.test(token) || /^(?:true|false|null|undefined)$/.test(token)
            const numero = /^\d/.test(token)
            const classe = palavraChave
              ? 'text-violet-400'
              : literal
                ? 'text-emerald-400'
                : numero
                  ? 'text-amber-400'
                  : ''
            if (classes && tokenIndex === 0 && !busca) return <span key={tokenIndex}>{token}</span>
            const partes = token.split(
              new RegExp(`(${busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')
            )
            return (
              <span key={tokenIndex} className={classe}>
                {partes.map((parte, parteIndex) =>
                  parte.toLocaleLowerCase() === busca.toLocaleLowerCase() ? (
                    <mark key={parteIndex}>{parte}</mark>
                  ) : (
                    parte
                  )
                )}
              </span>
            )
          })}
        </div>
      )
    })
  }, [conteudoSelecionado, ehVisualizadorDeArquivo, termoBusca])
  useEffect(() => {
    const id = selecionado?.id
    if (!id || conteudoId !== id) return
    let ativo = true
    void window.jarvis
      .painelDaTarefaConteudo(runId, id, workspace)
      .then((texto) => {
        if (ativo) setConteudoSelecionado(texto)
      })
      .catch(() => {
        if (ativo) setConteudoSelecionado(undefined)
      })
    return () => {
      ativo = false
    }
  }, [runId, workspace, selecionado?.id, conteudoId])

  return (
    <aside
      aria-label="Painel da tarefa"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-3xl flex-col border-l border-[rgba(var(--jos-borda-rgb),0.18)] bg-[var(--jos-cor-fundo)] shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-[rgba(var(--jos-borda-rgb),0.14)] p-4">
        <div>
          <h2 className="text-base font-semibold">Painel da tarefa</h2>
          <p className="text-xs text-[var(--jos-cor-texto-suave)]">Run {runId}</p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar painel da tarefa"
          className="rounded px-3 py-2 hover:bg-[rgba(var(--jos-borda-rgb),0.08)]"
        >
          Fechar
        </button>
      </header>

      {falhou ? (
        <p role="alert" className="p-4">
          Não foi possível carregar os dados desta tarefa.
        </p>
      ) : painel === undefined ? (
        <p role="status" className="p-4">
          Carregando o run…
        </p>
      ) : (
        <>
          {!painel.snapshotsCompletos && (
            <p role="status" className="border-b border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              Snapshots incompletos: parte do conteúdo excedeu a cota e não foi persistida. A
              execução e publicação não foram afetadas.
            </p>
          )}
          <nav
            aria-label="Abas do painel"
            className="flex gap-1 overflow-x-auto border-b border-[rgba(var(--jos-borda-rgb),0.14)] p-2"
          >
            {(
              [
                'plano',
                ...tarefas.map((item) => item.tarefaId),
                'diff',
                'arquivos',
                'checks',
                'testes'
              ] as const
            ).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={aba === id}
                onClick={() => setAba(id)}
                className="shrink-0 rounded px-3 py-2 text-xs aria-pressed:bg-[rgba(var(--jos-borda-rgb),0.12)]"
              >
                {id === 'plano'
                  ? 'Plano'
                  : id === 'diff'
                    ? 'Diff'
                    : id === 'arquivos'
                      ? 'Arquivos'
                      : id === 'checks'
                        ? 'Checks'
                        : id === 'testes'
                          ? 'Testes'
                          : (tarefas.find((item) => item.tarefaId === id)?.papel ?? id)}
              </button>
            ))}
          </nav>
          <section className="min-h-0 flex-1 overflow-auto p-4" aria-live="polite">
            {aba.startsWith('tarefa:') ? (
              <p role="status" className="text-sm">
                {conteudoSelecionado ?? 'Carregando conteúdo…'}
              </p>
            ) : aba === 'plano' ? (
              <div>
                <h3 className="mb-3 font-medium">Plano do Squad</h3>
                {painel.plano.length === 0 ? (
                  <p className="text-sm text-[var(--jos-cor-texto-suave)]">
                    Sem tarefas registradas neste run.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tarefas.map((item) => (
                      <li
                        key={item.tarefaId}
                        className="rounded border border-[rgba(var(--jos-borda-rgb),0.14)] p-3 text-sm"
                      >
                        <strong>{item.papel}</strong>
                        <span className="ml-2 text-xs text-[var(--jos-cor-texto-suave)]">
                          {item.tarefaId} · {item.estado}
                        </span>
                        <p className="mt-1 text-xs">
                          Camada {item.camada ?? 'não informada'}
                          {item.escritor ? ` · escritor ${item.escritor}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-[var(--jos-cor-texto-suave)]">
                          Depende de: {item.dependencias.join(', ') || 'nenhuma'} · Paths:{' '}
                          {item.paths.join(', ') || 'somente leitura'}
                        </p>
                        {item.regraDeConclusao && (
                          <p className="mt-1 text-xs">Conclusão: {item.regraDeConclusao}</p>
                        )}
                        {item.motivo && <p className="mt-1 text-xs">{item.motivo}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : aba === 'arquivos' || aba === 'diff' ? (
              <div>
                <h3 className="font-medium">
                  {aba === 'diff' ? 'Diffs das tarefas' : 'Arquivos alterados'}
                </h3>
                <ul className="mt-3 space-y-1">
                  {tarefas
                    .flatMap((item) =>
                      (aba === 'diff' ? item.diffs : item.snapshots).map((arquivo) => ({
                        ...arquivo,
                        tarefaId: item.tarefaId
                      }))
                    )
                    .map((arquivo) => (
                      <li key={arquivo.id}>
                        <button
                          className="text-left text-sm underline"
                          onClick={() => {
                            setConteudoId(arquivo.id)
                            setAba('arquivos')
                          }}
                        >
                          {arquivo.tarefaId} · {arquivo.caminho} · {arquivo.estado}
                        </button>
                      </li>
                    ))}
                  {aba === 'arquivos' &&
                    painel.arquivosDeTeste.map((arquivo) => (
                      <li key={arquivo.id}>
                        <button
                          className="text-left text-sm underline"
                          onClick={() => {
                            setConteudoId(arquivo.id)
                            setAba('testes')
                          }}
                        >
                          {arquivo.caminho} · {arquivo.estado}
                        </button>
                      </li>
                    ))}
                </ul>
                {conteudoId && conteudoSelecionado !== undefined && (
                  <>
                    {ehVisualizadorDeArquivo && (
                      <label className="mt-4 block text-xs">
                        Buscar no arquivo
                        <input
                          aria-label="Buscar no arquivo"
                          value={termoBusca}
                          onChange={(evento) => setTermoBusca(evento.target.value)}
                          className="ml-2 rounded border bg-transparent px-2 py-1"
                        />
                      </label>
                    )}
                    <pre
                      className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-[rgba(var(--jos-borda-rgb),0.06)] p-3 text-xs"
                      aria-label="Conteúdo do arquivo"
                    >
                      {partesDestacadas ?? conteudoSelecionado}
                    </pre>
                  </>
                )}
                {aba === 'arquivos' &&
                  conteudoId &&
                  conteudoSelecionado === undefined &&
                  painel.arquivosDeTeste.some((arquivo) => arquivo.id === conteudoId) && (
                    <p className="mt-3 text-xs">
                      {painel.arquivosDeTeste.find((arquivo) => arquivo.id === conteudoId)?.resumo}
                    </p>
                  )}
              </div>
            ) : aba === 'checks' ? (
              <div>
                <h3 className="font-medium">Checks</h3>
                <p
                  className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                  role="status"
                >
                  {painel.checks === undefined
                    ? 'Checks não consultados para este estado do run.'
                    : `${painel.checks.estado}: ${painel.checks.checks.map((check) => `${check.nome} (${check.status}${check.conclusao ? `, ${check.conclusao}` : ''})`).join(' · ') || 'nenhum check retornado'}`}
                </p>
              </div>
            ) : aba === 'testes' ? (
              <div>
                <h3 className="font-medium">Testes</h3>
                {painel.arquivosDeTeste.length === 0 ? (
                  <p role="status" className="mt-3 text-sm">
                    Sem evidência de suíte registrada; isso não significa que os testes passaram.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {painel.conteudosDeTeste.map((arquivo) => (
                      <li key={arquivo.id} className="rounded border p-3 text-sm">
                        <div>
                          {arquivo.caminho} · {arquivo.estado}
                        </div>
                        <p className="mt-1 text-xs">{arquivo.resumo}</p>
                        {conteudoId === arquivo.id && conteudoSelecionado !== undefined && (
                          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">
                            {conteudoSelecionado}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div>
                <h3 className="mb-2 font-medium">
                  {tarefas.find((item) => item.tarefaId === aba)?.papel ?? 'Agente'}
                </h3>
                <p className="mb-3 text-xs text-[var(--jos-cor-texto-suave)]">
                  {tarefas.find((item) => item.tarefaId === aba)?.estado === 'pendente'
                    ? `Sem sinal desde ${hora(tarefas.find((item) => item.tarefaId === aba)?.atualizadoEm ?? painel.atualizadoEm)}`
                    : `Última atualização ${hora(tarefas.find((item) => item.tarefaId === aba)?.atualizadoEm)}`}
                </p>
                {conteudoId && selecionado && conteudoSelecionado !== undefined ? (
                  <pre className="mb-3 whitespace-pre-wrap break-words rounded bg-[rgba(var(--jos-borda-rgb),0.06)] p-3 text-xs">
                    {conteudoSelecionado}
                  </pre>
                ) : null}
                {eventosDaAba.length === 0 ? (
                  <p className="text-sm text-[var(--jos-cor-texto-suave)]">
                    Sem novos eventos desde{' '}
                    {hora(
                      tarefas.find((item) => item.tarefaId === aba)?.atualizadoEm ??
                        painel.atualizadoEm
                    )}
                    .
                  </p>
                ) : (
                  <ol className="space-y-2 font-mono text-xs">
                    {eventosDaAba.map((evento, indice) => (
                      <li
                        key={`${aba}-${indice}`}
                        className="whitespace-pre-wrap break-words rounded bg-[rgba(var(--jos-borda-rgb),0.06)] p-2"
                      >
                        {evento.tipo === 'texto'
                          ? evento.delta
                          : evento.tipo === 'ferramenta-inicio'
                            ? `${evento.nome}: ${evento.resumoDoArgumento}`
                            : evento.tipo === 'ferramenta-fim'
                              ? `${evento.status}: ${evento.resumoDoResultado}`
                              : evento.tipo === 'uso'
                                ? `${evento.tokensEntrada} tokens de entrada · ${evento.tokensSaida} tokens de saída`
                                : evento.tipo === 'erro'
                                  ? evento.mensagem
                                  : `${evento.etapa}: ${evento.estado}`}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </aside>
  )
}
