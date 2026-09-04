import { useTranslation } from 'react-i18next'
import type { ResumoDoProjeto } from '@shared/domain/fase'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Etapa } from '@shared/domain/jornada'
import { InlineAlert } from '@design/ui'
import { TrocaDeModeloDoProjeto } from './TrocaDeModeloDoProjeto'

/**
 * Os quatro blocos do card de projeto (SPEC-Fases-01, critérios 2 a 5).
 *
 * A pergunta que este componente responde: **onde este projeto está, quanto falta, por onde a
 * próxima geração sai e o que o impede** — tudo sem abrir o projeto. Antes, a lista dizia só o
 * nome e o próximo passo, e o PI abria projeto por projeto para descobrir o resto.
 *
 * Duas decisões de forma governam o arquivo:
 *
 *  - **O bloco de bloqueio só existe quando há bloqueio.** Um card que sempre reserva espaço
 *    para "status" ensina o olho a pular aquela região, e aí o aviso que importa chega
 *    invisível. É a mesma régua do `AvisoDaRotaPaga`: alerta que aparece sempre para de ser lido.
 *  - **Metadado em mono maiúsculo.** Fase, rota e modelo são fatos de máquina, e o DS já usa
 *    essa forma para o mesmo papel na origem do projeto e no `SeloDaRota`. Repetir a convenção é
 *    o que faz o bloco novo parecer parte do app em vez de um enxerto.
 *
 * Não recompõe nada: cada campo vem pronto do main (critério 7). Derivar aqui o rótulo da etapa
 * a partir da etapa seria a exceção — e é exatamente o tipo de recomposição que faria o card
 * discordar da tela do projeto aberto no dia em que um dos dois mudasse.
 */

/**
 * O **nome** da etapa, não o rótulo do CTA.
 *
 * A primeira versão usava `CTA_DA_ETAPA` aqui, e a captura do gate visual mostrou o defeito: a
 * linha dizia "PLANEJAMENTO · GERAR O PRD" a poucos centímetros de um botão "Gerar o PRD". O
 * card repetia a ação e não dizia *onde o projeto está* — que é a pergunta do bloco. As chaves
 * são as mesmas que a trilha usa, então os dois lugares nomeiam a etapa igual.
 */
function nomeDaEtapa(etapa: Etapa, t: (chave: string) => string): string {
  return t(`jornada.etapas.${etapa}`)
}

interface ResumoDoCardProps {
  readonly resumo: ResumoDoProjeto | undefined
  /**
   * A troca de modelo deste projeto (SPEC-Fases-02, criterio 3). Opcional: o card e usado em
   * contexto sem workspace nos testes de unidade, e o selo sem troca continua sendo o da F01.
   */
  readonly workspace?: WorkspaceId
  /** Recarrega o resumo depois da troca — o modelo exibido e o que o **main** confirma. */
  readonly aoTrocarModelo?: () => void
}

/** A linha de metadado do card: fase, etapa e progresso dentro da fase (critério 2). */
export function ResumoDoCard({
  resumo,
  workspace,
  aoTrocarModelo
}: ResumoDoCardProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()

  // Sem resumo o card fica com nome, caminho e CTA — degradação legítima, e não uma tela quebrada.
  if (!resumo) return null

  const mono =
    'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px]'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          data-jos-fase={resumo.fase}
          className={`${mono} text-[var(--jos-cor-acento-leitura)]`}
        >
          {/*
            Fase e etapa juntas, **exceto quando dizem a mesma coisa**: a fase Construção tem
            uma etapa só, e ela se chama Construção — "CONSTRUÇÃO · CONSTRUÇÃO" foi o que a
            captura do gate visual mostrou. Repetir a palavra gasta a linha sem informar.
          */}
          {nomeDaEtapa(resumo.etapa, t) === resumo.rotuloDaFase
            ? resumo.rotuloDaFase
            : t('projetos.faseEtapa', {
                fase: resumo.rotuloDaFase,
                etapa: nomeDaEtapa(resumo.etapa, t)
              })}
        </span>

        {/*
          O progresso é da **fase**, não da trilha inteira: "5 / 8 no Planejamento" responde
          quanto falta para virar de fase, que é a pergunta do índice. "5 / 12" responderia a
          pergunta da trilha, que a tela do projeto aberto já responde melhor.
        */}
        <span className={`${mono} text-[var(--jos-cor-texto-suave)]`}>
          {t('projetos.progressoNaFase', {
            posicao: resumo.progresso.posicao,
            total: resumo.progresso.total
          })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-label={t('projetos.gatesRotulo')}
          className={`${mono} text-[var(--jos-cor-texto-suave)]`}
        >
          {t('projetos.gatesAceitos', {
            aceitos: resumo.gates.aceitos,
            total: resumo.gates.total
          })}
        </span>

        <span className={`${mono} text-[var(--jos-cor-texto-suave)]`}>
          {resumo.dataDoUltimoEvento
            ? t('projetos.ultimoEvento', {
                data: new Date(resumo.dataDoUltimoEvento).toLocaleDateString(i18n.language)
              })
            : t('projetos.semEvento')}
        </span>

        {/*
          Rota e modelo juntos, e só quando a geração vai acontecer. Na rota bloqueada o main já
          devolve `modelo: null` — anunciar um modelo ali descreveria uma chamada que não sai, e
          é a mesma razão pela qual o `SeloDaRota` não renderiza nada quando a rota bloqueia.
        */}
        {resumo.rota && resumo.rota.decisao !== 'bloqueado' && resumo.modelo && (
          <span
            data-jos-rota={resumo.rota.decisao}
            className={`${mono} flex items-center gap-1 text-[var(--jos-cor-texto-suave)]`}
          >
            {resumo.rota.decisao === 'paga' ? t('rota.viaPaga') : t('rota.viaAssinatura')} ·{' '}
            {/*
             * O modelo vira gatilho quando o card sabe o espaco (SPEC-Fases-02, criterio 3).
             * Sem `workspace` continua sendo texto — a F01 nao deixa de funcionar por causa da
             * F02, e o card em contexto sem espaco nao ganha um botao que nao teria o que gravar.
             */}
            {workspace === undefined || aoTrocarModelo === undefined ? (
              resumo.modelo
            ) : (
              <TrocaDeModeloDoProjeto
                projectId={resumo.projectId}
                fase={resumo.fase}
                decisao={resumo.rota.decisao}
                modelo={resumo.modelo}
                workspace={workspace}
                aoTrocar={aoTrocarModelo}
              />
            )}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * O bloqueio do projeto (critério 5), **fora da coluna do nome**.
 *
 * Componente separado do `ResumoDoCard` por causa do layout: os metadados vivem numa coluna que
 * divide a linha com os botões de ação, e a captura do gate visual mostrou o aviso mais
 * importante do card nascendo como o elemento mais estreito dele. Uma margem negativa não
 * resolveria — a largura vem do `flex-1`, não do padding. O bloqueio precisa ser irmão da linha,
 * e é o card quem o posiciona.
 *
 * Continua só existindo quando há bloqueio: um card que sempre reserva a faixa ensina o olho a
 * pular aquela região.
 */
export function BloqueioDoCard({ resumo }: ResumoDoCardProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!resumo?.bloqueio) return null

  return (
    <InlineAlert tom="warn" titulo={t('projetos.bloqueioTitulo')}>
      {resumo.bloqueio.acao}
    </InlineAlert>
  )
}
