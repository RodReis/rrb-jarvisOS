import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import type { EstadoDoMarco, LinhaDeMarco, VistaDeMarcos } from '@shared/domain/marcos'
import { linhasDeMarcos } from '@shared/domain/marcos'
import { MarcosDoProjeto } from '../app/MarcosDoProjeto'

/**
 * Galeria de prova do painel de marcos (SPEC-Fases-04, § Testes).
 *
 * O que só aparece aqui: o painel tem **quatro estados por linha**, e três deles são de aviso.
 * Numa tela real, com layout e cor computada, é possível ver se eles se distinguem de relance —
 * jsdom afirma que o texto "commit desatualizado" existe, e nunca que ele é legível ao lado de
 * "sem commit" num badge da mesma cor.
 *
 * As cenas são os estados que **mudam o que o PI vê**: o projeto em dia (o caso desejado), o
 * projeto com as três pendências ao mesmo tempo (o que bloqueia a Construção) e o Git
 * indisponível (a tela que não pode virar lista vazia).
 */

export type CenaDeMarcos = 'em-dia' | 'pendente' | 'sem-git'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  readonly cena?: CenaDeMarcos
}

const HASH_ACEITO = 'a'.repeat(64)

/**
 * Uma linha, montada pela **função do domínio**.
 *
 * O `estado` não é literal aqui de propósito: `linhasDeMarcos` é quem o deriva no produto, e uma
 * galeria que o escrevesse à mão provaria a própria invenção — poderia pintar `commitado` numa
 * linha que o produto marcaria como divergente, e o gate visual passaria com uma tela que nunca
 * existe.
 */
function linha(caminho: string, commit: string | undefined, hashDoBlob: string): LinhaDeMarco {
  const [derivada] = linhasDeMarcos([
    {
      caminho,
      hashDaRevisao: HASH_ACEITO,
      ...(commit === undefined ? {} : { commit, data: '2026-09-04T10:00:00.000Z' }),
      ...(commit === undefined ? {} : { hashDoBlob })
    }
  ])

  return derivada as LinhaDeMarco
}

/** Os quatro estados juntos: é a única composição que prova que eles se distinguem. */
const PENDENTE: readonly LinhaDeMarco[] = [
  linha('docs/PRD.md', 'c0ffee1234567890abcdef1234567890abcdef12', HASH_ACEITO),
  linha('docs/ARCHITECTURE.md', 'deadbee1234567890abcdef1234567890abcdef1', 'b'.repeat(64)),
  linha('docs/DESIGN-SYSTEM.md', undefined, ''),
  {
    caminho: 'docs/TESTING.md',
    estado: 'sem-revisao' as EstadoDoMarco
  }
]

const EM_DIA: readonly LinhaDeMarco[] = [
  linha('docs/PRD.md', 'c0ffee1234567890abcdef1234567890abcdef12', HASH_ACEITO),
  linha('docs/ARCHITECTURE.md', 'deadbee1234567890abcdef1234567890abcdef1', HASH_ACEITO)
]

const VISTA: Readonly<Record<CenaDeMarcos, VistaDeMarcos>> = {
  'em-dia': {
    disponivel: true,
    linhas: EM_DIA,
    repositorio: {
      sujos: [],
      headInterrompido: false,
      head: 'abc1234567890abcdef1234567890abcdef12345',
      publicadoEm: 'abc1234567890abcdef1234567890abcdef12345'
    }
  },
  pendente: {
    disponivel: true,
    linhas: PENDENTE,
    repositorio: {
      sujos: ['docs/PRD.md', 'src/app.ts'],
      headInterrompido: true,
      head: 'abc1234567890abcdef1234567890abcdef12345'
    }
  },
  'sem-git': {
    disponivel: false,
    linhas: [],
    repositorio: { sujos: [], headInterrompido: false, head: '' },
    mensagem:
      'O comando `git` não está permitido neste espaço. Permita-o em Terminal Controlado → comandos permitidos para que o projeto possa versionar sua documentação.'
  }
}

/**
 * A ponte dublada no módulo, e não num efeito: o `useEffect` do painel roda **antes** de um
 * efeito da galeria, e a captura pegaria o estado de carregamento em vez das linhas.
 */
function instalarPonte(cena: CenaDeMarcos): void {
  Object.defineProperty(window, 'jarvis', {
    value: {
      marcosDoProjeto: async (): Promise<VistaDeMarcos> => VISTA[cena],
      completeMilestone: async (): Promise<null> => null,
      sendLog: (): void => {}
    },
    configurable: true,
    writable: true
  })
}

export function GaleriaDeMarcos({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'pendente'
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
      <div data-jos-marcos={cena} className="min-h-screen bg-[var(--jos-cor-superficie)] p-8">
        {/* A largura do painel no produto: ele vive na coluna de conteúdo da etapa, não numa
            caixa cheia — medir mais largo daria um ritmo de varredura que a tela real não tem. */}
        <div className="max-w-[48rem]">
          <MarcosDoProjeto projectId="p-1" workspace="jarvis" />
        </div>
      </div>
    </ProvedorDeTema>
  )
}
