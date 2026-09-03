import { useTranslation } from 'react-i18next'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { InlineAlert } from '@design/ui'

/**
 * Por onde a geração vai sair — dito **antes** do clique (decisão do PI, 2026-09-03).
 *
 * Gerar gasta uma chamada de IA, e na rota paga gasta dinheiro. As telas mostravam o bloqueio
 * quando **não havia** rota, mas ficavam mudas quando havia: o PI clicava sem saber se aquilo
 * consumia a assinatura dele ou o provedor pago do workspace. Descobrir depois é tarde — é a
 * mesma fricção que o critério 6 evita no custo, repetida na atenção.
 *
 * Duas superfícies para dois pesos, porque **não são o mesmo fato**:
 *
 *  - **Assinatura** é a rota esperada, e vira uma linha em mono ao lado do botão. Um alerta aqui
 *    gritaria sobre o caso normal, e alerta que aparece sempre para de ser lido.
 *  - **Paga** vira `InlineAlert`, porque o clique passa a custar dinheiro. É o único caso em que
 *    a consequência do botão muda de natureza, e a forma acompanha.
 *
 * O bloqueio continua com quem chama: ele já era mostrado por cada tela junto da ação que o
 * destrava, e trazê-lo para cá afastaria o erro da correção.
 */

interface RotaDaGeracaoProps {
  readonly rota: ResultadoDaRota | null
}

/** O aviso da rota paga. Só existe quando a geração passa a custar dinheiro. */
export function AvisoDaRotaPaga({ rota }: RotaDaGeracaoProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (rota?.decisao !== 'paga') return null

  return (
    <InlineAlert tom="warn" titulo={t('rota.pagaTitulo')}>
      {t('rota.pagaDescricao')}
    </InlineAlert>
  )
}

/**
 * O selo da rota, ao lado do botão que gera.
 *
 * Em mono maiúsculo: é metadado de máquina, a mesma convenção que o índice de projetos usa para
 * a origem e o brief usa para o bloco. Repetir a convenção é o que faz a informação nova parecer
 * parte do app em vez de um enxerto.
 *
 * Nada é renderizado quando a rota está bloqueada: aí o botão não gera, e anunciar por onde a
 * geração sairia descreveria algo que não vai acontecer.
 */
export function SeloDaRota({ rota }: RotaDaGeracaoProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (rota === null || rota.decisao === 'bloqueado') return null

  return (
    <span
      data-jos-rota={rota.decisao}
      className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]"
    >
      {rota.decisao === 'paga' ? t('rota.viaPaga') : t('rota.viaAssinatura')}
    </span>
  )
}
