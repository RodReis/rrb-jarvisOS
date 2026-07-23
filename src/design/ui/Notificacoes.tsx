import { cx } from './base'
import { EmptyState } from './Dados'
import type { TomSemantico } from './semantica'
import { CLASSE_FUNDO_SEMANTICO, ICONE_SEMANTICO, NOME_DO_TOM } from './semantica'

/**
 * Central de notificações (SPEC-DesignSystem-03b, PRD §12.6).
 *
 * NotificationCenter, NotificationItem e UnreadIndicator — o histórico **persistente** das
 * mensagens, contra o Toast que é efêmero. A mesma mensagem pode aparecer como toast (agora) e
 * ficar na central (depois).
 *
 * A lista vem **por props** (critério: persistência é dos dados, SPEC-Fundacao-04). O DS não
 * guarda notificação, não marca como lida no storage — recebe a lista pronta e emite os eventos
 * de leitura para quem os persiste. É a fronteira do PRD §8.1: componente não conhece storage.
 */

export interface Notificacao {
  readonly id: string
  readonly tom: TomSemantico
  readonly titulo: string
  readonly mensagem?: string
  /** Carimbo já formatado pelo dono dos dados — o DS não formata data (não conhece locale aqui). */
  readonly quando: string
  readonly lida: boolean
}

interface NotificationCenterProps {
  readonly notificacoes: readonly Notificacao[]
  readonly onLer: (id: string) => void
  readonly onLerTodas?: () => void
}

export function NotificationCenter({
  notificacoes,
  onLer,
  onLerTodas
}: NotificationCenterProps): React.JSX.Element {
  const naoLidas = notificacoes.filter((n) => !n.lida).length

  if (notificacoes.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma notificação"
        descricao="Avisos do sistema e resultados de execução aparecem aqui."
      />
    )
  }

  return (
    <section aria-label="Central de notificações" className="flex flex-col">
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
          Notificações {naoLidas > 0 && `· ${naoLidas} não lidas`}
        </h2>
        {onLerTodas !== undefined && naoLidas > 0 && (
          <button
            type="button"
            onClick={onLerTodas}
            className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-acento-leitura)] underline underline-offset-2 hover:no-underline"
          >
            Marcar todas como lidas
          </button>
        )}
      </header>
      <ul className="flex flex-col">
        {notificacoes.map((n) => (
          <NotificationItem key={n.id} notificacao={n} onLer={onLer} />
        ))}
      </ul>
    </section>
  )
}

interface NotificationItemProps {
  readonly notificacao: Notificacao
  readonly onLer: (id: string) => void
}

export function NotificationItem({ notificacao, onLer }: NotificationItemProps): React.JSX.Element {
  const Icone = ICONE_SEMANTICO[notificacao.tom]

  return (
    <li>
      <button
        type="button"
        onClick={() => onLer(notificacao.id)}
        className={cx(
          'flex w-full items-start gap-2.5 border-b border-[rgba(var(--jos-borda-rgb),0.08)] p-3 text-left',
          'hover:bg-[rgba(var(--jos-borda-rgb),0.06)]',
          'focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--jos-cor-acento)_10%,transparent)]',
          !notificacao.lida && 'bg-[rgba(var(--jos-borda-rgb),0.03)]'
        )}
      >
        {/* Ponto de não-lida à esquerda; a coluna reserva o espaço mesmo quando lida, para o
            texto não deslocar. O estado "não lida" também está no negrito do título — não é só
            o ponto colorido (critério 4). */}
        <span className="flex w-2 shrink-0 justify-center pt-2">
          {!notificacao.lida && (
            <UnreadIndicator tom={notificacao.tom} rotulo={NOME_DO_TOM[notificacao.tom]} />
          )}
        </span>
        <Icone
          aria-hidden="true"
          className="mt-0.5 size-[var(--jos-tamanho-icone-mini)] shrink-0 text-[var(--jos-cor-texto-suave)]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cx(
                'truncate text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]',
                notificacao.lida ? 'font-[var(--jos-peso-medio)]' : 'font-[var(--jos-peso-forte)]'
              )}
            >
              {!notificacao.lida && <span className="sr-only">Não lida: </span>}
              {notificacao.titulo}
            </p>
            <span className="shrink-0 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
              {notificacao.quando}
            </span>
          </div>
          {notificacao.mensagem !== undefined && (
            <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
              {notificacao.mensagem}
            </p>
          )}
        </div>
      </button>
    </li>
  )
}

interface UnreadIndicatorProps {
  readonly tom?: TomSemantico
  /** Rótulo para tecnologia assistiva — o ponto sozinho não diz nada por voz. */
  readonly rotulo?: string
}

/**
 * Marca de não-lida — o ponto colorido.
 *
 * Puramente visual, então `aria-hidden` quando acompanha texto que já diz "não lida" (é o caso
 * no `NotificationItem`). O `rotulo` existe para o uso avulso — um sino com um ponto —, onde ele
 * é a **única** indicação e precisa ser anunciado.
 */
export function UnreadIndicator({ tom, rotulo }: UnreadIndicatorProps): React.JSX.Element {
  const fundo = tom !== undefined ? CLASSE_FUNDO_SEMANTICO[tom] : 'bg-[var(--jos-cor-acento)]'
  return (
    <span
      role={rotulo !== undefined ? 'status' : undefined}
      aria-label={rotulo}
      className={cx('block size-2 rounded-full', fundo)}
    />
  )
}
