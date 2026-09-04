import { useTranslation } from 'react-i18next'
import type { ResumoDoProjeto } from '@shared/domain/fase'
import { CTA_DA_ETAPA } from '@shared/domain/jornada'
import { InlineAlert } from '@design/ui'

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

interface ResumoDoCardProps {
  readonly resumo: ResumoDoProjeto | undefined
}

/** A linha de metadado do card: fase, etapa e progresso dentro da fase (critério 2). */
export function ResumoDoCard({ resumo }: ResumoDoCardProps): React.JSX.Element | null {
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
          {t('projetos.faseEtapa', {
            fase: resumo.rotuloDaFase,
            etapa: CTA_DA_ETAPA[resumo.etapa]
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
            className={`${mono} text-[var(--jos-cor-texto-suave)]`}
          >
            {resumo.rota.decisao === 'paga' ? t('rota.viaPaga') : t('rota.viaAssinatura')} ·{' '}
            {resumo.modelo}
          </span>
        )}
      </div>

      {/* O bloco só existe quando há o que dizer (critério 5). */}
      {resumo.bloqueio && (
        <InlineAlert tom="warn" titulo={t('projetos.bloqueioTitulo')}>
          {resumo.bloqueio.acao}
        </InlineAlert>
      )}
    </div>
  )
}
