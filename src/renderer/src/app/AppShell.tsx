import { useEffect, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../lib/log'
import {
  NAVEGACAO_INICIAL,
  ROTAS_POR_WORKSPACE,
  navegar,
  rotaDoWorkspace,
  type RotasPorWorkspace
} from '../workspace/navegacao'

/**
 * AppShell (SPEC-Fundacao-02): sidebar, header e área de conteúdo.
 *
 * Estética command center escura, sem design system formal — ele é o MVP-003. O que esta
 * fatia precisa provar é o **isolamento**: navegação e rota separadas por espaço.
 */

/** Identidade visual de cada espaço. Acento distinto para o ativo ser óbvio (critério 2). */
const IDENTIDADE: Readonly<
  Record<WorkspaceId, { nome: string; acento: string; borda: string; descricao: string }>
> = {
  noa: {
    nome: 'NOA',
    acento: 'text-emerald-300',
    borda: 'border-emerald-400/70 bg-emerald-400/10',
    descricao: 'Espaço pessoal'
  },
  jarvis: {
    nome: 'JARVIS OS',
    acento: 'text-sky-300',
    borda: 'border-sky-400/70 bg-sky-400/10',
    descricao: 'Espaço profissional'
  }
}

const ROTULO_ROTA: Readonly<Record<string, string>> = {
  inicio: 'Início',
  notas: 'Notas',
  agenda: 'Agenda',
  operacoes: 'Operações',
  agentes: 'Agentes'
}

export function AppShell(): React.JSX.Element {
  // Espaço ativo mora no main (ele audita a troca); o renderer espelha.
  const [workspace, setWorkspace] = useState<WorkspaceId | null>(null)
  const [navegacao, setNavegacao] = useState<RotasPorWorkspace>(NAVEGACAO_INICIAL)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    window.jarvis
      .getWorkspace()
      .then(setWorkspace)
      .catch((error: unknown) => {
        setErro('Não foi possível carregar o espaço de trabalho.')
        log.ui.error('Falha ao consultar o espaço ativo', { error })
      })
  }, [])

  async function trocarWorkspace(destino: WorkspaceId): Promise<void> {
    if (destino === workspace) return

    try {
      // O main audita a troca antes de confirmá-la; a UI só reflete o que ele devolveu.
      const resultado = await window.jarvis.switchWorkspace(destino)
      setWorkspace(resultado.workspace)
      log.ui.info('Espaço de trabalho alternado pela UI', {
        para: resultado.workspace,
        auditSeq: resultado.auditSeq
      })
    } catch (error) {
      setErro('Não foi possível alternar o espaço de trabalho.')
      log.ui.error('Falha ao alternar espaço de trabalho', { destino, error })
    }
  }

  if (!workspace) {
    return (
      <main className="flex h-full items-center justify-center text-slate-400">
        {erro ? <p role="alert">{erro}</p> : <p>Carregando…</p>}
      </main>
    )
  }

  const identidade = IDENTIDADE[workspace]
  const rotaAtiva = rotaDoWorkspace(navegacao, workspace)

  return (
    <div className="flex h-full text-slate-100">
      <aside
        aria-label="Navegação principal"
        className="flex w-60 shrink-0 flex-col gap-6 border-r border-white/10 bg-black/30 p-4"
      >
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Espaço</p>
          {/* Radiogroup: são opções mutuamente exclusivas, e o leitor de tela precisa
              anunciar qual está ativa — não é uma barra de botões independentes. */}
          <div
            role="radiogroup"
            aria-label="Espaço de trabalho"
            className="mt-2 flex flex-col gap-1"
          >
            {(Object.keys(IDENTIDADE) as WorkspaceId[]).map((id) => {
              const ativo = id === workspace
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => void trocarWorkspace(id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    ativo
                      ? `${IDENTIDADE[id].borda} ${IDENTIDADE[id].acento}`
                      : 'border-transparent text-slate-400 hover:bg-white/5'
                  }`}
                >
                  <span className="block font-medium">{IDENTIDADE[id].nome}</span>
                  <span className="block text-xs text-slate-500">{IDENTIDADE[id].descricao}</span>
                </button>
              )
            })}
          </div>
        </div>

        <nav aria-label={`Navegação de ${identidade.nome}`} className="flex flex-col gap-1">
          {ROTAS_POR_WORKSPACE[workspace].map((rota) => (
            <button
              key={rota}
              type="button"
              aria-current={rota === rotaAtiva ? 'page' : undefined}
              onClick={() => setNavegacao((atual) => navegar(atual, workspace, rota))}
              className={`rounded-md px-3 py-1.5 text-left text-sm transition ${
                rota === rotaAtiva
                  ? 'bg-white/10 text-slate-100'
                  : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {ROTULO_ROTA[rota] ?? rota}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            {/* O espaço ativo é identificável em qualquer tela (critério 2). */}
            <h1 className={`text-lg font-semibold ${identidade.acento}`}>{identidade.nome}</h1>
            <p className="text-xs text-slate-500">{ROTULO_ROTA[rotaAtiva] ?? rotaAtiva}</p>
          </div>
          <button
            type="button"
            onClick={() => window.jarvis.minimizeToTray()}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5"
          >
            Minimizar para a bandeja
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {erro && (
            <p role="alert" className="mb-4 text-sm text-rose-300">
              {erro}
            </p>
          )}
          <section
            aria-label={`Conteúdo de ${ROTULO_ROTA[rotaAtiva] ?? rotaAtiva}`}
            className="rounded-xl border border-white/10 bg-[var(--color-surface-raised)] p-6"
          >
            <p className="text-sm text-slate-400">
              {identidade.nome} · {ROTULO_ROTA[rotaAtiva] ?? rotaAtiva}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Conteúdo placeholder — os módulos entram em fatias futuras.
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
