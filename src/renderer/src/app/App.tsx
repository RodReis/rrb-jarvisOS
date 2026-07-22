import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/contracts/ipc'
import { log } from '../lib/log'

/**
 * Tela placeholder do bootstrap (Fatia 01). Sem backend real: só prova que o
 * renderer monta e que a ponte tipada responde. AppShell e workspaces são a Fatia 02.
 */
export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    window.jarvis
      .getAppInfo()
      .then((info) => {
        setAppInfo(info)
        log.ui.info('Tela inicial carregada', { ambiente: info.environment })
      })
      .catch((error: unknown) => {
        setErro('Não foi possível carregar as informações do app.')
        log.ui.error('Falha ao carregar informações do app pela ponte', { error })
      })
  }, [])

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-8 text-slate-100">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">JARVIS OS</h1>
        <p className="text-sm text-slate-400">Fundação — Fatia 01 · Bootstrap e estrutura</p>
      </div>

      <section
        aria-label="Informações do app"
        className="min-w-72 rounded-xl bg-[var(--color-surface-raised)] p-5 text-sm shadow-lg"
      >
        {erro && <p role="alert">{erro}</p>}
        {!erro && !appInfo && <p className="text-slate-400">Carregando…</p>}
        {appInfo && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-slate-400">Versão</dt>
            <dd>{appInfo.version}</dd>
            <dt className="text-slate-400">Electron</dt>
            <dd>{appInfo.electronVersion}</dd>
            <dt className="text-slate-400">Ambiente</dt>
            <dd>{appInfo.environment}</dd>
          </dl>
        )}
      </section>
    </main>
  )
}
