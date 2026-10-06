import { useEffect, useState } from 'react'
import type { ResultadoDoCronograma } from '@shared/domain/cronograma'

export function HistoricoDoCronograma(): React.JSX.Element | null {
  const [resultados, setResultados] = useState<readonly ResultadoDoCronograma[]>([])
  useEffect(() => {
    let vivo = true
    const atualizar = (): void => {
      if (!window.jarvis?.historicoDoCronograma) return
      void window.jarvis
        .historicoDoCronograma()
        .then((lista) => {
          if (vivo)
            setResultados((atual) => {
              const unidos = new Map([...atual, ...lista].map((item) => [item.id, item]))
              return [...unidos.values()]
                .sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm))
                .slice(0, 100)
            })
        })
        .catch(() => undefined)
    }
    atualizar()
    const remover = window.jarvis?.onResultadoDoCronograma?.((resultado) => {
      if (vivo)
        setResultados((atual) =>
          [resultado, ...atual.filter((item) => item.id !== resultado.id)].slice(0, 100)
        )
    })
    window.addEventListener('focus', atualizar)
    return () => {
      vivo = false
      remover?.()
      window.removeEventListener('focus', atualizar)
    }
  }, [])
  if (!resultados.length) return null
  return (
    <section
      aria-label="Histórico do cronograma"
      className="mt-5 border-t border-[var(--jos-cor-borda)] pt-4"
    >
      <h3 className="text-sm font-semibold">Atividades do cronograma</h3>
      <ol className="mt-3 flex flex-col gap-3">
        {resultados.slice(0, 10).map((resultado) => (
          <li
            key={resultado.id}
            className="rounded-lg border border-[var(--jos-cor-borda)] p-3 text-sm"
          >
            <strong>{resultado.nome}</strong>
            <span className="ml-2 text-xs opacity-70">
              {new Date(resultado.iniciadoEm).toLocaleString('pt-BR')}
            </span>
            <ul className="mt-2 flex flex-col gap-1">
              {resultado.atividades.map((atividade) => (
                <li key={atividade.id}>
                  {atividade.estado === 'executada' ? '✓' : '–'}{' '}
                  {atividade.tipo === 'falar' ? 'Falar' : 'Tocar mídia local'}
                  {atividade.motivo ? ` · ${atividade.motivo}` : ''}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
