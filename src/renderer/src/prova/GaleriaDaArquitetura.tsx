import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import type {
  AfirmacaoDaArquitetura,
  AjusteProposto,
  ArquiteturaRegistrada
} from '@shared/domain/arquitetura-gerada'
import { DOCUMENTOS_DA_ARQUITETURA, SECOES_DA_ARQUITETURA } from '@shared/domain/arquitetura'
import { ArquiteturaDoProjeto } from '../app/ArquiteturaDoProjeto'

/**
 * Galeria de prova do pacote de arquitetura (issue #333).
 *
 * **Existe para medir o scroll.** O PI reportou *"scroll muito grande vertical para um projeto
 * pequeno"*, e a suíte de tela não tem como discordar nem concordar: jsdom não tem layout, então
 * `scrollHeight` ali é sempre zero. A altura real da página só existe num navegador.
 *
 * A cena `pacote-cheio` é o que o PI viu: quatro documentos, doze seções, afirmações em cada uma
 * e os oito ajustes de coerência acima de tudo. Não é o pior caso inventado — é o tamanho que um
 * projeto pequeno produz, que é justamente o que torna o número interessante.
 */

export type CenaDaArquitetura = 'pacote-cheio' | 'pacote-magro'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  readonly cena?: CenaDaArquitetura
}

const HASH = 'a'.repeat(64)

/**
 * As afirmações de todas as seções dos quatro documentos.
 *
 * Duas por seção: uma vinda do PRD e uma proposta pela IA. A proposta importa porque ela é a que
 * ganha o botão "Cortar" ao lado, e é o par texto+botão que define a altura de uma linha.
 */
function afirmacoesDoPacote(): readonly AfirmacaoDaArquitetura[] {
  const saida: AfirmacaoDaArquitetura[] = []

  for (const documento of DOCUMENTOS_DA_ARQUITETURA) {
    for (const secao of SECOES_DA_ARQUITETURA[documento]) {
      saida.push({
        id: `${documento}-${secao}-prd`,
        documento,
        secao,
        texto: `O sistema registra ${secao.toLowerCase()} conforme o PRD aceito define, e a leitura passa pelo mesmo canal das demais etapas.`,
        origem: 'prd',
        referencia: 'p-1'
      })
      saida.push({
        id: `${documento}-${secao}-proposto`,
        documento,
        secao,
        texto: `A IA inferiu que ${secao.toLowerCase()} precisa de tratamento próprio quando o volume cresce, e propõe isolar a responsabilidade.`,
        origem: 'proposto'
      })
    }
  }

  return saida
}

/** Os oito ajustes que o PI viu na geração real, distribuídos entre os três tipos. */
const AJUSTES: readonly AjusteProposto[] = [
  {
    id: 'j-1',
    tipo: 'tela-sem-requisito',
    jornada: 'Entrar na conta',
    observacao: 'A tela existe no protótipo e nenhum requisito do PRD a pede.',
    recomendacao: 'Confirmar se o login entra nesta versão ou sai do protótipo.'
  },
  {
    id: 'j-2',
    tipo: 'tela-sem-requisito',
    jornada: 'Recuperar senha',
    observacao: 'O fluxo de recuperação está desenhado e o PRD não o menciona.',
    recomendacao: 'Decidir se recuperar senha é escopo do primeiro corte.'
  },
  {
    id: 'j-3',
    tipo: 'requisito-sem-tela',
    requisito: 'r-4',
    observacao: 'O PRD pede exportação em CSV e nenhuma tela a oferece.',
    recomendacao: 'Desenhar a saída da exportação ou adiar o requisito.'
  },
  {
    id: 'j-4',
    tipo: 'requisito-sem-tela',
    requisito: 'r-7',
    observacao: 'O relatório mensal está no PRD sem tela correspondente.',
    recomendacao: 'Desenhar o relatório ou marcá-lo como fora do MVP.'
  },
  {
    id: 'j-5',
    tipo: 'estado-ausente',
    jornada: 'Painel de cotações',
    observacao: 'A tela não mostra o que acontece enquanto os dados carregam.',
    recomendacao: 'Desenhar o estado de carregamento no protótipo.'
  },
  {
    id: 'j-6',
    tipo: 'estado-ausente',
    jornada: 'Painel de cotações',
    observacao: 'Não há estado para a consulta que falha.',
    recomendacao: 'Desenhar o erro com a ação de tentar de novo.'
  },
  {
    id: 'j-7',
    tipo: 'estado-ausente',
    jornada: 'Lista de materiais',
    observacao: 'A lista vazia não tem desenho — só a lista preenchida existe.',
    recomendacao: 'Desenhar a primeira vez, quando ainda não há material.'
  },
  {
    id: 'j-8',
    tipo: 'estado-ausente',
    jornada: 'Assinatura',
    observacao: 'O bloqueio por assinatura aparece sem dizer o que desbloqueia.',
    recomendacao: 'Nomear o que a assinatura libera dentro do próprio estado.'
  }
]

function pacote(cena: CenaDaArquitetura): ArquiteturaRegistrada {
  const cheio = cena === 'pacote-cheio'

  return {
    id: 'r-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    pacoteEstruturalId: 'pac-1',
    afirmacoes: cheio ? afirmacoesDoPacote() : afirmacoesDoPacote().slice(0, 4),
    ajustes: cheio ? AJUSTES : [],
    anexos: [
      {
        id: 'anx-1',
        user_id: 'u-1',
        workspace_id: 'jarvis',
        projectId: 'p-1',
        tipo: 'design-system',
        caminho: 'docs/design/design.md',
        origem: 'C:/design/design.md',
        hash: HASH,
        bytes: 12_480,
        anexadoEm: '2026-09-07T09:00:00.000Z'
      }
    ],
    hash: 'h',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-07T10:00:00.000Z'
  } as ArquiteturaRegistrada
}

/**
 * Instala o dublê da ponte antes de a tela montar — no módulo, e não num efeito, senão a captura
 * pega o estado de carregamento.
 */
function instalarPonte(cena: CenaDaArquitetura): void {
  Object.defineProperty(window, 'jarvis', {
    value: {
      carregarArquitetura: async (): Promise<ArquiteturaRegistrada> => pacote(cena),
      gerarArquiteturaPorIa: async () => ({ resultado: 'gerada' as const, mensagem: 'ok' }),
      cortarPropostoDaArquitetura: async (): Promise<ArquiteturaRegistrada> => pacote(cena),
      descartarAjusteDaArquitetura: async (): Promise<ArquiteturaRegistrada> => pacote(cena),
      aplicarEventoDaJornada: async () => ({ resultado: 'avancou' as const })
    },
    configurable: true,
    writable: true
  })
}

export function GaleriaDaArquitetura({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'pacote-cheio'
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
      <div data-jos-arquitetura={cena} className="min-h-screen bg-[var(--jos-cor-superficie)] p-8">
        {/* A largura do conteúdo de etapa no produto: a trilha ocupa 19rem à esquerda, e medir
            numa caixa mais larga daria uma altura menor que a tela real. */}
        <div className="max-w-[52rem]">
          <ArquiteturaDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Lastro" />
        </div>
      </div>
    </ProvedorDeTema>
  )
}
