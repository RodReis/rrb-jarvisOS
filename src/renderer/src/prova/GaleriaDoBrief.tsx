import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import type { Afirmacao, BriefRegistrado, PromptDoProjeto } from '@shared/domain/brief'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { PromptDoProjeto as TelaDoPrompt } from '../app/PromptDoProjeto'
import { BriefDoProjeto } from '../app/BriefDoProjeto'
import { RefinamentoDoProjeto } from '../app/RefinamentoDoProjeto'

/**
 * Galeria de prova do prompt e do gate do brief (SPEC-Jornada-02, § Testes).
 *
 * **Existe por causa do gate visual da spec:** *"gate visual do pop-up e do gate antes de
 * fechar"*. Os testes de tela provam comportamento com JSDOM, que não tem layout — e a M25-F01
 * já mostrou o que isso deixa passar: marcadores de 20px renderizando a 2px, com todos os
 * testes verdes.
 *
 * As cenas são os estados que **mudam a decisão do PI**, não variações cosméticas: o prompt
 * vazio (primeira vez), o prompt bloqueado (sem rota — critério 6), o brief com propostos
 * (critério 4) e o brief com pendência material (aceite travado).
 *
 * **A ponte é dublada aqui**, e não no componente: as telas chamam `window.jarvis` como no
 * produto, e injetar dado por prop faria a captura provar um componente diferente do que roda.
 */

export type CenaDoBrief =
  | 'prompt-vazio'
  | 'prompt-bloqueado'
  /**
   * A recusa que o PI encontrou: o modelo respondeu em português explicando um impedimento em
   * vez de devolver o brief. A cena existe porque a tela antiga mostrava "a saída não passou no
   * validador" enquanto o console, abaixo, trazia a observação inteira — e nenhum teste de papel
   * acusa uma mensagem verdadeira que esconde a informação útil.
   */
  | 'prompt-recusado'
  | 'brief-propostos'
  | 'brief-travado'
  // O refinamento: sem perguntas (o convite a gerar) e com pergunta na fila (o próximo passo
  // é respondê-la, não gerar mais).
  | 'refinamento-vazio'
  | 'refinamento-pendente'
  // A rota paga: o clique passa a custar dinheiro, e a tela precisa dizer isso antes.
  | 'refinamento-rota-paga'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  readonly cena?: CenaDoBrief
}

function afirmacao(over: Partial<Afirmacao> = {}): Afirmacao {
  return {
    id: 'a-1',
    bloco: 'problema-usuarios-resultado',
    texto: 'O leitor perde o fio das leituras longas e não sabe onde parou.',
    origem: 'prompt',
    ...over
  }
}

const BRIEF: BriefRegistrado = {
  id: 'b-1',
  user_id: 'u-1',
  workspace_id: 'jarvis',
  projectId: 'p-1',
  promptId: 'pr-1',
  afirmacoes: [
    afirmacao(),
    afirmacao({
      id: 'a-2',
      bloco: 'problema-usuarios-resultado',
      origem: 'decisao',
      referencia: 'd-7',
      texto: 'O sucesso é retomar uma leitura sem reler o que já foi lido.'
    }),
    afirmacao({
      id: 'a-3',
      bloco: 'escopo-e-metricas',
      origem: 'proposto',
      texto: 'A primeira versão cobre livros e artigos, não vídeos.'
    }),
    afirmacao({
      id: 'a-4',
      bloco: 'stack-e-restricoes',
      origem: 'proposto',
      texto: 'Funciona offline, sincronizando quando a rede volta.'
    })
  ],
  pendencias: [],
  hash: 'h'.repeat(64),
  commitHash: null,
  contextPackId: 'pack-1',
  created_at: '2026-09-03T10:00:00.000Z'
}

const PROMPT: PromptDoProjeto = {
  id: 'pr-1',
  user_id: 'u-1',
  workspace_id: 'jarvis',
  projectId: 'p-1',
  texto: 'Quero um app que organize minhas leituras e me lembre do que parei no meio.',
  hash: 'h'.repeat(64),
  commitHash: null,
  created_at: '2026-09-03T10:00:00.000Z'
}

const ROTA_OK: ResultadoDaRota = { decisao: 'assinatura' }
const ROTA_PAGA: ResultadoDaRota = { decisao: 'paga' }

const ROTA_BLOQUEADA: ResultadoDaRota = {
  decisao: 'bloqueado',
  motivo: 'sem-rota-alguma',
  acao: 'Conecte a assinatura do Claude (Claude Code CLI) em Providers, ou habilite a rota paga para este projeto.'
}

/**
 * Instala o dublê da ponte antes de a tela montar.
 *
 * No módulo, e não num efeito: o `useEffect` do componente roda **antes** de um efeito da
 * galeria, e a captura pegaria o estado de carregamento em vez da tela.
 */
function instalarPonte(cena: CenaDoBrief): void {
  const bloqueado = cena === 'prompt-bloqueado'
  const travado = cena === 'brief-travado'

  Object.defineProperty(window, 'jarvis', {
    value: {
      lerPromptDoProjeto: async (): Promise<PromptDoProjeto | null> =>
        cena === 'prompt-vazio' ? null : PROMPT,
      rotaDaGeracao: async (): Promise<ResultadoDaRota> =>
        bloqueado ? ROTA_BLOQUEADA : cena === 'refinamento-rota-paga' ? ROTA_PAGA : ROTA_OK,
      salvarPromptDoProjeto: async (): Promise<PromptDoProjeto> => PROMPT,
      gerarBrief: async () =>
        cena === 'prompt-recusado'
          ? {
              resultado: 'saida-invalida' as const,
              // Idêntico ao que `BriefService` produz: uma cena que inventa a própria cópia
              // prova a galeria, não o produto.
              mensagem: 'Nada foi gravado — nenhum brief, nenhuma alteração no projeto.',
              acao: 'Responda ao ponto no campo do prompt e gere de novo.',
              textoDoModelo:
                'O diretório `rrb-insights` já contém outro produto (AgroInsights, para produtores rurais). Não vou sobrescrever: crio o projeto de construção ao lado. Antes, confirmo a forma exata de structured outputs e do SQLite embutido.',
              problemas: ['O modelo respondeu em texto corrido, e o brief exige saída estruturada.']
            }
          : { resultado: 'gerado' as const, mensagem: 'ok' },
      carregarBrief: async (): Promise<BriefRegistrado> =>
        travado
          ? {
              ...BRIEF,
              pendencias: [
                {
                  bloco: 'dominio-e-dados',
                  pergunta: 'Onde os dados de leitura ficam guardados?',
                  material: true
                }
              ]
            }
          : BRIEF,
      cortarPropostoDoBrief: async (): Promise<BriefRegistrado> => BRIEF,
      estadoDoRefinamento: async () =>
        cena === 'refinamento-pendente'
          ? {
              tipo: 'pergunta' as const,
              restantes: 4,
              pergunta: {
                id: 'q-1',
                etapa: 'refinamento',
                titulo: 'Alcance da primeira versão',
                enunciado: 'Até onde vai a primeira entrega?',
                opcoes: [
                  { id: 'a', rotulo: 'Fatia vertical', impacto: 'ponta a ponta, estreita' },
                  { id: 'b', rotulo: 'Fundação', impacto: 'base ampla, sem uso ainda' }
                ],
                recomendada: 'a',
                justificativa: 'Valida antes de investir.',
                aceitaTextoLivre: true,
                delegavel: true
              }
            }
          : null,
      gerarPerguntasDeRefinamento: async () => ({ resultado: 'geradas' as const, mensagem: 'ok' }),
      historicoDoRefinamento: async () => [],
      responderRefinamento: async () => ({ resultado: 'registrada' as const }),
      // O gate de aceite chama o canal de evento da jornada — sem ele a captura pegaria a
      // tela em falha em vez do botão em repouso.
      aplicarEventoDaJornada: async () => ({ resultado: 'avancou' as const }),
      sendLog: (): void => {}
    },
    configurable: true,
    writable: true
  })
}

export function GaleriaDoBrief({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'brief-propostos'
}: GaleriaProps): React.JSX.Element {
  instalarPonte(cena)

  const ehPrompt =
    cena === 'prompt-vazio' || cena === 'prompt-bloqueado' || cena === 'prompt-recusado'
  const ehRefinamento =
    cena === 'refinamento-vazio' ||
    cena === 'refinamento-pendente' ||
    cena === 'refinamento-rota-paga'

  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#C4C4C4'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <div data-jos-brief={cena} className="min-h-screen bg-[var(--jos-cor-superficie)] p-8">
        {/* A largura do conteúdo de etapa no produto: medir numa caixa mais larga daria um
            ritmo de leitura que a tela real não tem. */}
        <div className="max-w-[52rem]">
          {ehPrompt ? (
            <TelaDoPrompt
              workspace="jarvis"
              projectId="p-1"
              nomeDoProjeto="Leituras"
              onAvancar={() => {}}
            />
          ) : ehRefinamento ? (
            <RefinamentoDoProjeto
              workspace="jarvis"
              projectId="p-1"
              nomeDoProjeto="Leituras"
              onResponder={() => {}}
              onRecarregar={() => {}}
            />
          ) : (
            <BriefDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" />
          )}
        </div>
      </div>
    </ProvedorDeTema>
  )
}
