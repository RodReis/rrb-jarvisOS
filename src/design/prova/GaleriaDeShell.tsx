import { useState } from 'react'
import { Grid3x3, LogOut, Target } from 'lucide-react'
import type { CorAcento } from '../tokens/acento'
import type { ModoUi, Modulo } from '../tokens/semantic'
import {
  AppShell,
  NavigationGroup,
  Rail,
  ShellFooter,
  Sidebar,
  TopBar,
  WorkspaceSwitcher,
  GRID
} from '../patterns'
import { VoiceMascot } from '../ui'

/**
 * Galeria de prova do shell (SPEC-DesignSystem-04a).
 *
 * O que só existe aqui é **o grid montado**: em jsdom, `width: 60px` é a string que o componente
 * escreveu, e um rail que colapsasse a zero por um `flex` mal resolvido passaria em todos os
 * testes de componente. O critério 1 fala em "compõe rail + sidebar + topbar + conteúdo" — e
 * composição é exatamente o que precisa de layout real para ser verificada.
 *
 * Monta o shell **sem ponte, sem i18n e sem estado de produto**: só os blocos do DS com dados
 * literais. Se a galeria precisasse do renderer para montar, a fronteira da F01 estaria furada.
 */

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
}

const ROTAS: Readonly<Record<Modulo, readonly string[]>> = {
  jarvis: ['Início', 'Operações'],
  noa: ['Hoje', 'Agenda', 'Rotina']
}

export function GaleriaDeShell({
  modo,
  modulo = 'jarvis',
  acento
}: GaleriaProps): React.JSX.Element {
  const [uiTheme, setUiTheme] = useState<ModoUi>(modo)
  const [rota, setRota] = useState<string>(ROTAS[modulo][0] ?? 'Início')
  const [subModulo, setSubModulo] = useState<'command' | 'agents'>('command')

  const rotas = modulo === 'jarvis' && subModulo === 'agents' ? ['Agentes'] : ROTAS[modulo]

  return (
    <div className="h-screen" data-testid="galeria">
      <AppShell
        modulo={modulo}
        uiTheme={uiTheme}
        accentJarvis={acento ?? '#FF5C00'}
        accentNoa={acento ?? '#C4C4C4'}
        rail={
          <Rail
            topo={<VoiceMascot modulo={modulo} tamanho="rail" />}
            itens={
              modulo === 'jarvis'
                ? [
                    {
                      id: 'command',
                      rotulo: 'Command Center',
                      icone: <Target size={18} aria-hidden />,
                      ativo: subModulo === 'command'
                    },
                    {
                      id: 'agents',
                      rotulo: 'Agents OS',
                      icone: <Grid3x3 size={18} aria-hidden />,
                      ativo: subModulo === 'agents'
                    }
                  ]
                : []
            }
            rodape={[{ id: 'sair', rotulo: 'Sair', icone: <LogOut size={18} aria-hidden /> }]}
            onSelecionar={(id) => {
              if (id === 'command' || id === 'agents') {
                setSubModulo(id)
                setRota(id === 'agents' ? 'Agentes' : (ROTAS[modulo][0] ?? 'Início'))
              }
            }}
          />
        }
        sidebar={
          <Sidebar
            titulo={modulo === 'jarvis' ? 'JARVIS OS' : 'NOA'}
            subtitulo={modulo === 'jarvis' ? 'Professional Ops' : 'Pessoal'}
          >
            <WorkspaceSwitcher
              espacos={[
                { id: 'noa', rotulo: 'NOA' },
                { id: 'jarvis', rotulo: 'JARVIS OS' }
              ]}
              ativo={modulo}
              onTrocar={() => undefined}
              rotulo="Espaço de trabalho"
            />
            <NavigationGroup
              grupo={{
                titulo: 'Navegação',
                itens: rotas.map((r) => ({ id: r, rotulo: r, ativo: r === rota }))
              }}
              onNavegar={setRota}
            />
          </Sidebar>
        }
        topbar={
          <TopBar
            titulo={rota}
            uiTheme={uiTheme}
            rotuloTema="Alternar entre tema claro e escuro"
            onAlternarTema={() => setUiTheme(uiTheme === 'dark' ? 'light' : 'dark')}
          />
        }
        rodape={
          <ShellFooter>
            <span>© RRB Trading</span>
            <span data-prova-grid={`${GRID.rail}/${GRID.sidebar}`}>{rota}</span>
          </ShellFooter>
        }
      >
        <section className="rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-6">
          <p className="text-[length:var(--jos-texto-corpo)]">Conteúdo de {rota}</p>
        </section>
      </AppShell>
    </div>
  )
}
