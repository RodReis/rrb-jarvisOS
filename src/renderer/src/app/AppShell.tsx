import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Grid3x3, LogOut, Minimize2, Target } from 'lucide-react'
import type { UserProfile, WorkspaceId } from '@shared/domain/entities'
import {
  AppShell as ShellDoDesign,
  NavigationGroup,
  Rail,
  ShellFooter,
  Sidebar,
  TopBar,
  WorkspaceSwitcher,
  type ItemDoRail
} from '@design/patterns'
import { VoiceMascot } from '@design/ui'
import { ACENTO_PADRAO } from '@design/tokens'
import { log } from '../lib/log'
import { usePreferences } from '../preferences/usePreferences'
import {
  NAVEGACAO_INICIAL,
  ROTAS_POR_SUB_MODULO,
  ROTAS_POR_WORKSPACE,
  navegar,
  rotaDoWorkspace,
  rotaInicialDoSubModulo,
  subModuloDaRota,
  type RotasPorWorkspace,
  type SubModuloJarvis
} from '../workspace/navegacao'
import { Settings } from './Settings'

/**
 * AppShell do renderer (SPEC-DesignSystem-04a).
 *
 * **Re-plataforma** o shell da SPEC-Fundacao-02: a estrutura visual agora vem do design system
 * (`@design/patterns`), e o que era Tailwind cru com cores `emerald`/`sky` passa a ler tokens.
 * O que **não** muda são as garantias da fundação — isolamento de rota por espaço,
 * `Desenvolvimento` oculto, troca auditada pelo main. Os 15 testes daquela fatia continuam
 * valendo **sem uma linha alterada**, e é assim que se sabe que a troca foi de aparência, não de
 * contrato: se algum deles tivesse precisado de ajuste, o que mudou não teria sido só a pele.
 *
 * A divisão de responsabilidade: o DS desenha e não sabe o que é workspace; este arquivo sabe o
 * que é workspace e não desenha. Toda decisão de produto — quais espaços existem, qual rota
 * pertence a quem, o que o rail mostra — mora aqui.
 */

/** Os espaços oferecidos. `Desenvolvimento` **nunca** entra (SPEC-Fundacao-02, critério 5). */
const ESPACOS: readonly WorkspaceId[] = ['noa', 'jarvis']

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

  /**
   * Alterna o `uiTheme` (critério 1).
   *
   * Persiste pelo mesmo caminho do Settings (SPEC-Fundacao-05) em vez de guardar estado local:
   * o toggle da topbar e o seletor de Settings são **dois controles da mesma preferência**, e
   * um estado local aqui faria os dois discordarem assim que o usuário usasse os dois.
   */
  function alternarTema(): void {
    const claroAgora = preferencias?.resolvedTheme === 'claro'
    void salvar({ theme: claroAgora ? 'escuro' : 'claro' })
  }

  // Espera as duas fontes: sem preferências não há idioma nem tema para pintar.
  if (!workspace || !preferencias) {
    return (
      <main className="flex h-full items-center justify-center opacity-70">
        {erro ? <p role="alert">{t(erro)}</p> : <p>{t('carregando')}</p>}
      </main>
    )
  }

  const nomeEspaco = t(`espaco.${workspace}`)
  const rotaAtiva = rotaDoWorkspace(navegacao, workspace)
  const uiTheme = preferencias.resolvedTheme === 'claro' ? 'light' : 'dark'
  const outroEspaco: WorkspaceId = workspace === 'jarvis' ? 'noa' : 'jarvis'

  // Sub-módulo ativo do JARVIS: derivado da rota, não guardado em estado próprio. Duas fontes
  // para a mesma verdade divergiriam — o rail acenderia um sub-módulo e a sidebar mostraria a
  // navegação do outro.
  const subModulo: SubModuloJarvis = subModuloDaRota(rotaAtiva) ?? 'command'

  function irPara(rota: string): void {
    if (workspace === null) return
    setNavegacao((atual) => navegar(atual, workspace, rota))
  }

  /** Rail dual do JARVIS (critério 3) — protótipo JARVISOS §2. */
  const itensDoRail: readonly ItemDoRail[] =
    workspace === 'jarvis'
      ? [
          {
            id: 'command',
            rotulo: t('shell.commandCenter'),
            icone: <Target size={18} aria-hidden />,
            ativo: subModulo === 'command'
          },
          {
            id: 'agents',
            rotulo: t('shell.agentsOs'),
            icone: <Grid3x3 size={18} aria-hidden />,
            ativo: subModulo === 'agents'
          }
        ]
      : []

  const rodapeDoRail: readonly ItemDoRail[] = [
    {
      id: `ir-${outroEspaco}`,
      rotulo: t('shell.irPara', { espaco: t(`espaco.${outroEspaco}`) }),
      icone: <span aria-hidden>{outroEspaco === 'noa' ? 'N' : 'J'}</span>
    },
    ...(onSair !== undefined
      ? [{ id: 'sair', rotulo: t('auth.sair'), icone: <LogOut size={18} aria-hidden /> }]
      : [])
  ]

  function acionarRail(id: string): void {
    if (id === 'sair') {
      onSair?.()
      return
    }
    if (id === `ir-${outroEspaco}`) {
      void trocarWorkspace(outroEspaco)
      return
    }
    // Sub-módulo: navega para a primeira rota dele. É o que mantém rail e sidebar em acordo —
    // trocar de rail sem mover a rota deixaria a navegação do outro sub-módulo na tela.
    irPara(rotaInicialDoSubModulo(id as SubModuloJarvis))
  }

  // Rotas visíveis na sidebar: no JARVIS, só as do sub-módulo ativo (protótipo JARVISOS §2);
  // no NOA, todas as do espaço.
  const rotasVisiveis =
    workspace === 'jarvis' ? ROTAS_POR_SUB_MODULO[subModulo] : ROTAS_POR_WORKSPACE[workspace]

  const subtituloDaSidebar =
    workspace === 'jarvis'
      ? subModulo === 'agents'
        ? t('shell.jarvisAgents')
        : t('shell.jarvisOps')
      : t('shell.noaPessoal')

  return (
    <ShellDoDesign
      modulo={workspace}
      uiTheme={uiTheme}
      accentJarvis={ACENTO_PADRAO.jarvis}
      accentNoa={ACENTO_PADRAO.noa}
      rail={
        <Rail
          itens={itensDoRail}
          rodape={rodapeDoRail}
          onSelecionar={acionarRail}
          topo={<VoiceMascot modulo={workspace} tamanho="rail" />}
        />
      }
      sidebar={
        <Sidebar titulo={nomeEspaco} subtitulo={subtituloDaSidebar}>
          <WorkspaceSwitcher
            espacos={ESPACOS.map((id) => ({ id, rotulo: t(`espaco.${id}`) }))}
            ativo={workspace}
            onTrocar={(id) => void trocarWorkspace(id as WorkspaceId)}
            rotulo={t('espaco.seletor')}
          />
          <NavigationGroup
            grupo={{
              titulo: t('navegacao.de', { espaco: nomeEspaco }),
              itens: rotasVisiveis.map((rota) => ({
                id: rota,
                rotulo: t(`navegacao.${rota}`),
                ativo: rota === rotaAtiva
              }))
            }}
            onNavegar={irPara}
          />
        </Sidebar>
      }
      topbar={
        <TopBar
          titulo={nomeEspaco}
          uiTheme={uiTheme}
          onAlternarTema={alternarTema}
          rotuloTema={t('shell.alternarTema')}
        >
          {/* Nome e e-mail visíveis fecham o critério 1 da SPEC-03: a prova de que o login
              completou é o app mostrar de quem é a sessão. */}
          {perfil && (
            <div aria-label={t('auth.conta')} className="text-right">
              <p className="text-[length:var(--jos-texto-mini)] font-[var(--jos-peso-medio)]">
                {perfil.name}
              </p>
              <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                {perfil.email}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => window.jarvis.minimizeToTray()}
            aria-label={t('janela.minimizar')}
            title={t('janela.minimizar')}
            className="grid size-9 place-items-center rounded-[var(--jos-raio-chip-largo)] border border-[rgba(var(--jos-borda-rgb),0.18)] text-[var(--jos-cor-texto-secundario)] outline-none hover:bg-[rgba(var(--jos-borda-rgb),0.08)] focus-visible:ring-1 focus-visible:ring-[var(--jos-cor-acento)]"
          >
            <Minimize2 size={16} aria-hidden />
          </button>
        </TopBar>
      }
      rodape={
        <ShellFooter>
          <span>{t('shell.rodape')}</span>
          <span>{t(`navegacao.${rotaAtiva}`)}</span>
        </ShellFooter>
      }
    >
      {erro && (
        <p
          role="alert"
          className="mb-4 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-err-leitura)]"
        >
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
          className="rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-6"
        >
          <p className="text-[length:var(--jos-texto-corpo)]">
            {nomeEspaco} · {t(`navegacao.${rotaAtiva}`)}
          </p>
          <p className="mt-2 text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
            {t('conteudo.placeholder')}
          </p>
        </section>
      )}
    </ShellDoDesign>
  )
}
