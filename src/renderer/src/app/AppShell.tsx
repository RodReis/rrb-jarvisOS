import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserProfile, WorkspaceId } from '@shared/domain/entities'
import { log } from '../lib/log'
import { usePreferences } from '../preferences/usePreferences'
import {
  NAVEGACAO_INICIAL,
  ROTAS_POR_WORKSPACE,
  navegar,
  rotaDoWorkspace,
  type RotasPorWorkspace
} from '../workspace/navegacao'
import { Settings } from './Settings'

/**
 * AppShell (SPEC-02): sidebar, header e área de conteúdo, agora traduzido e tematizado
 * (SPEC-05). Estética command center, sem design system formal — ele é o MVP-003.
 */

/** Acento por espaço, para o ativo ser óbvio (SPEC-02, critério 2). */
const ACENTO: Readonly<Record<WorkspaceId, { texto: string; borda: string }>> = {
  noa: {
    texto: 'text-emerald-500 dark:text-emerald-300',
    borda: 'border-emerald-500/70 bg-emerald-500/10'
  },
  jarvis: { texto: 'text-sky-600 dark:text-sky-300', borda: 'border-sky-500/70 bg-sky-500/10' }
}

interface AppShellProps {
  /** Usuário da sessão. Opcional só para o app seguir montável sem login configurado. */
  readonly perfil?: UserProfile
  readonly onSair?: () => void
}

export function AppShell({ perfil, onSair }: AppShellProps = {}): React.JSX.Element {
  const { t } = useTranslation()
  const { preferencias, erro: erroPreferencias, salvar } = usePreferences()

  // Espaço ativo mora no main (ele audita a troca); o renderer espelha.
  const [workspace, setWorkspace] = useState<WorkspaceId | null>(null)
  const [navegacao, setNavegacao] = useState<RotasPorWorkspace>(NAVEGACAO_INICIAL)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    window.jarvis
      .getWorkspace()
      .then(setWorkspace)
      .catch((error: unknown) => {
        setErro('erro.espaco')
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
      setErro('erro.trocaEspaco')
      log.ui.error('Falha ao alternar espaço de trabalho', { destino, error })
    }
  }

  // Espera as duas fontes: sem preferências não há idioma nem tema para pintar.
  if (!workspace || !preferencias) {
    return (
      <main className="flex h-full items-center justify-center opacity-70">
        {erro ? <p role="alert">{t(erro)}</p> : <p>{t('carregando')}</p>}
      </main>
    )
  }

  const acento = ACENTO[workspace]
  const nomeEspaco = t(`espaco.${workspace}`)
  const rotaAtiva = rotaDoWorkspace(navegacao, workspace)

  return (
    <div className="flex h-full">
      <aside
        aria-label={t('navegacao.principal')}
        className="flex w-60 shrink-0 flex-col gap-6 border-r border-current/10 bg-black/5 p-4 dark:bg-black/30"
      >
        <div>
          <p className="text-xs uppercase tracking-wider opacity-60">{t('espaco.titulo')}</p>
          {/* Radiogroup: opções mutuamente exclusivas — o leitor de tela precisa
              anunciar qual está ativa. */}
          <div
            role="radiogroup"
            aria-label={t('espaco.seletor')}
            className="mt-2 flex flex-col gap-1"
          >
            {(Object.keys(ACENTO) as WorkspaceId[]).map((id) => {
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
                      ? `${ACENTO[id].borda} ${ACENTO[id].texto}`
                      : 'border-transparent opacity-70 hover:bg-current/5'
                  }`}
                >
                  <span className="block font-medium">{t(`espaco.${id}`)}</span>
                  <span className="block text-xs opacity-70">{t(`espaco.${id}Descricao`)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <nav aria-label={t('navegacao.de', { espaco: nomeEspaco })} className="flex flex-col gap-1">
          {ROTAS_POR_WORKSPACE[workspace].map((rota) => (
            <button
              key={rota}
              type="button"
              aria-current={rota === rotaAtiva ? 'page' : undefined}
              onClick={() => setNavegacao((atual) => navegar(atual, workspace, rota))}
              className={`rounded-md px-3 py-1.5 text-left text-sm transition ${
                rota === rotaAtiva ? 'bg-current/10 font-medium' : 'opacity-70 hover:bg-current/5'
              }`}
            >
              {t(`navegacao.${rota}`)}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-current/10 px-6 py-4">
          <div>
            {/* O espaço ativo é identificável em qualquer tela (SPEC-02, critério 2). */}
            <h1 className={`text-lg font-semibold ${acento.texto}`}>{nomeEspaco}</h1>
            <p className="text-xs opacity-60">{t(`navegacao.${rotaAtiva}`)}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Nome e e-mail visíveis fecham o critério 1 da SPEC-03: a prova de que o
                login completou é o app mostrar de quem é a sessão. */}
            {perfil && (
              <div aria-label={t('auth.conta')} className="text-right">
                <p className="text-xs font-medium">{perfil.name}</p>
                <p className="text-xs opacity-60">{perfil.email}</p>
              </div>
            )}

            {onSair && (
              <button
                type="button"
                onClick={onSair}
                className="rounded-md border border-current/20 px-3 py-1.5 text-xs opacity-70 transition hover:bg-current/5"
              >
                {t('auth.sair')}
              </button>
            )}

            <button
              type="button"
              onClick={() => window.jarvis.minimizeToTray()}
              className="rounded-md border border-current/20 px-3 py-1.5 text-xs opacity-70 transition hover:bg-current/5"
            >
              {t('janela.minimizar')}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {erro && (
            <p role="alert" className="mb-4 text-sm text-rose-500 dark:text-rose-300">
              {t(erro)}
            </p>
          )}

          {rotaAtiva === 'settings' ? (
            <Settings
              preferencias={preferencias}
              erro={erroPreferencias}
              onSalvar={(mudanca) => void salvar(mudanca)}
            />
          ) : (
            <section
              aria-label={t('conteudo.de', { rota: t(`navegacao.${rotaAtiva}`) })}
              className="rounded-xl border border-current/10 bg-current/5 p-6"
            >
              <p className="text-sm opacity-80">
                {nomeEspaco} · {t(`navegacao.${rotaAtiva}`)}
              </p>
              <p className="mt-2 text-xs opacity-60">{t('conteudo.placeholder')}</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
