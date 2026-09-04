import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import type { Project } from '@shared/domain/projects'
import type { Etapa } from '@shared/domain/jornada'
import { CTA_DA_ETAPA } from '@shared/domain/jornada'
import type { ResumoDoProjeto } from '@shared/domain/fase'
import { ROTULO_DA_FASE, faseDaEtapa, progressoNaFase } from '@shared/domain/fase'
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

/**
 * O resumo de um card (SPEC-Fases-01). Os campos derivados saem das **funções do domínio**, e
 * não de literais: uma galeria que inventasse a fase provaria a própria invenção, e o gate
 * visual passaria com um card que o produto nunca desenha.
 */
function resumo(
  projectId: string,
  etapa: Etapa,
  over: Partial<ResumoDoProjeto> = {}
): ResumoDoProjeto {
  const fase = faseDaEtapa(etapa)

  return {
    projectId,
    etapa,
    fase,
    rotuloDaFase: ROTULO_DA_FASE[fase],
    progresso: progressoNaFase(etapa),
    cta: CTA_DA_ETAPA[etapa],
    gates: { aceitos: 0, total: 5 },
    dataDoUltimoEvento: '2026-09-04T10:00:00.000Z',
    rota: { decisao: 'assinatura' },
    modelo: 'claude-sonnet-5',
    bloqueio: null,
    ...over
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
      /*
        Os três projetos ficam **um por fase** (SPEC-Fases-01, § Testes): é o que prova que o
        bloco de fase acompanha a etapa, e não um rótulo fixo. O terceiro carrega o bloqueio,
        porque a ausência dele nos outros dois é justamente o que o critério 5 exige ver.
      */
      resumoDeVarios: async (): Promise<readonly ResumoDoProjeto[]> => [
        resumo('p-1', 'prd', { gates: { aceitos: 1, total: 5 } }),
        resumo('p-2', 'mvp-aceito', { gates: { aceitos: 3, total: 5 } }),
        resumo('p-3', 'construcao', {
          gates: { aceitos: 5, total: 5 },
          rota: { decisao: 'bloqueado', motivo: 'sem-rota-alguma' },
          modelo: null,
          bloqueio: {
            motivo: 'sem-rota-alguma',
            acao: 'Nenhuma rota de geração está configurada. Conecte a assinatura do Claude ou uma credencial de provider em Providers.'
          }
        })
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
