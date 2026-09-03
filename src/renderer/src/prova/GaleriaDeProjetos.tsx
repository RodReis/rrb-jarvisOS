import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import type { Project } from '@shared/domain/projects'
import type { EstadoDaJornada } from '@shared/domain/jornada'
import { montarTrilha } from '@shared/domain/jornada'
import { ProjetosLocais } from '../app/ProjetosLocais'

/**
 * Galeria de prova do índice de projetos (SPEC-Jornada-01, § Testes).
 *
 * **Esta tela não tinha gate visual**, e é por isso que ela acumulou o defeito que o PI
 * reportou: as três ações do card renderizavam com o mesmo peso, porque nenhuma nomeava a
 * variante e o default do `Button` é `secundaria`. Os testes de tela passavam verdes — papel
 * ARIA não mede rank visual, e a M25-F01 já tinha aprendido isso com marcadores de 20px
 * renderizando a 2px.
 *
 * As cenas são os estados que **mudam o que o PI vê**, não variações cosméticas: a lista com
 * projetos em etapas diferentes (o caso normal), o índice vazio (primeira vez) e a confirmação
 * de remoção (a única faixa destrutiva da tela).
 */

export type CenaDeProjetos = 'lista' | 'vazio'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  readonly cena?: CenaDeProjetos
}

function projeto(over: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    nome: 'Leituras',
    slug: 'leituras',
    diretorio: 'C:/Desenv/Projetos/leituras',
    origem: 'criado',
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  } as Project
}

/**
 * Três projetos em etapas diferentes: é o que prova que o CTA do card vem da jornada e não é
 * um "Abrir" genérico. Um só projeto esconderia justamente isso.
 */
const PROJETOS: readonly Project[] = [
  projeto(),
  projeto({
    id: 'p-2',
    nome: 'Painel de custos',
    slug: 'painel-de-custos',
    diretorio: 'C:/Desenv/Projetos/painel-de-custos',
    origem: 'importado'
  }),
  projeto({
    id: 'p-3',
    nome: 'Agenda da equipe',
    slug: 'agenda-da-equipe',
    diretorio: 'C:/Desenv/Projetos/agenda-da-equipe'
  })
]

function jornada(projectId: string, etapa: Parameters<typeof montarTrilha>[0]): EstadoDaJornada {
  const trilha = montarTrilha(etapa)
  return {
    projectId,
    etapa,
    cta: trilha.find((e) => e.posicao === 'atual')?.cta ?? 'Abrir',
    trilha,
    motivoDaRegressao: null,
    recalculada: false
  }
}

/**
 * A ponte dublada no módulo, e não num efeito: o `useEffect` da tela roda **antes** de um
 * efeito da galeria, e a captura pegaria o estado de carregamento em vez da lista.
 */
function instalarPonte(cena: CenaDeProjetos): void {
  Object.defineProperty(window, 'jarvis', {
    value: {
      listProjects: async (): Promise<readonly Project[]> =>
        cena === 'vazio' ? [] : [...PROJETOS],
      jornadaDeVarios: async (): Promise<readonly EstadoDaJornada[]> => [
        jornada('p-1', 'prompt'),
        jornada('p-2', 'brief-aceito'),
        jornada('p-3', 'construcao')
      ],
      sendLog: (): void => {}
    },
    configurable: true,
    writable: true
  })
}

export function GaleriaDeProjetos({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'lista'
}: GaleriaProps): React.JSX.Element {
  instalarPonte(cena)

  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#C4C4C4'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <div data-jos-projetos={cena} className="min-h-screen bg-[var(--jos-cor-superficie)] p-8">
        {/* A largura do conteúdo no produto: medir numa caixa mais larga daria um ritmo de
            varredura que a tela real não tem. */}
        <div className="max-w-[64rem]">
          <ProjetosLocais workspace="jarvis" />
        </div>
      </div>
    </ProvedorDeTema>
  )
}
