import { Button } from './Button'
import { cx } from './base'
import { Spinner } from './Indicadores'
import type { TomSemantico } from './semantica'
import {
  CLASSE_BORDA_SEMANTICA,
  CLASSE_TEXTO_SEMANTICO,
  ICONE_SEMANTICO,
  NOME_DO_TOM
} from './semantica'

/**
 * Feedback in-loco (SPEC-DesignSystem-03b, PRD §11.5).
 *
 * InlineAlert, ErrorState e LoadingState — o feedback que fica **na tela**, ao contrário do
 * Toast, que é efêmero e flutuante.
 *
 * A distinção decide qual usar: toast é para o que aconteceu (uma ação concluiu); estes são para
 * o estado atual de uma região (este painel está carregando, esta busca falhou). Um erro
 * permanente num toast some antes de o usuário agir; um carregamento num toast não pertence a
 * lugar nenhum da tela.
 */

interface InlineAlertProps {
  readonly tom: TomSemantico
  readonly titulo: string
  readonly children?: React.ReactNode
  /** Ação de dispensar — o alerta permanece até o usuário fechar, se dispensável. */
  readonly onDispensar?: () => void
}

/**
 * Alerta embutido — a faixa de aviso dentro de um formulário ou painel.
 *
 * Ícone + texto + tom, nunca só a cor de fundo (critério 4). `role` conforme o tom: `alert`
 * (assertivo) para warn/err, região comum para info/ok — anunciar um informativo com a mesma
 * urgência de um erro cansa e reduz a confiança no sinal.
 */
export function InlineAlert({
  tom,
  titulo,
  children,
  onDispensar
}: InlineAlertProps): React.JSX.Element {
  const Icone = ICONE_SEMANTICO[tom]
  const urgente = tom === 'warn' || tom === 'err'

  return (
    <div
      role={urgente ? 'alert' : undefined}
      className={cx(
        'flex items-start gap-2.5 rounded-[var(--jos-raio-card)] border p-3',
        CLASSE_BORDA_SEMANTICA[tom],
        'bg-[var(--jos-cor-superficie-elevada)]'
      )}
    >
      <Icone
        aria-hidden="true"
        className={cx(
          'mt-0.5 size-[var(--jos-tamanho-icone)] shrink-0',
          CLASSE_TEXTO_SEMANTICO[tom]
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-[var(--jos-peso-semi)] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
          <span className="sr-only">{NOME_DO_TOM[tom]}: </span>
          {titulo}
        </p>
        {children !== undefined && (
          <div className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
            {children}
          </div>
        )}
      </div>
      {onDispensar !== undefined && (
        <button
          type="button"
          onClick={onDispensar}
          aria-label="Dispensar alerta"
          className={cx(
            'flex size-6 shrink-0 items-center justify-center rounded-[var(--jos-raio-chip)]',
            'text-[var(--jos-cor-texto-suave)] hover:text-[var(--jos-cor-texto)]',
            'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--jos-cor-acento)]'
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  )
}

interface ErrorStateProps {
  readonly titulo: string
  /** Diz **o que fazer**, não só que falhou (PRD §14 — erro identifica próxima ação). */
  readonly descricao?: string
  readonly onTentarNovamente?: () => void
  readonly icone?: React.ReactNode
}

/**
 * Estado de erro de uma região inteira — a busca falhou, o painel não carregou.
 *
 * Diferente do `InlineAlert` (uma faixa dentro de conteúdo que existe): aqui o conteúdo **não
 * existe** porque a operação falhou, e o componente ocupa o lugar dele. Sempre oferece o caminho
 * de volta (`onTentarNovamente`) quando há um — erro sem saída é beco.
 */
export function ErrorState({
  titulo,
  descricao,
  onTentarNovamente,
  icone
}: ErrorStateProps): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-[var(--jos-raio-card)] px-6 py-10 text-center"
    >
      <span aria-hidden="true" className="text-[var(--jos-cor-err-leitura)]">
        {icone ?? <span className="text-2xl">⚠</span>}
      </span>
      <p className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-realce)] text-[var(--jos-cor-texto)]">
        {titulo}
      </p>
      {descricao !== undefined && (
        <p className="max-w-sm text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {descricao}
        </p>
      )}
      {onTentarNovamente !== undefined && (
        <div className="pt-1">
          <Button variante="secundaria" onClick={onTentarNovamente}>
            Tentar novamente
          </Button>
        </div>
      )}
    </div>
  )
}

interface LoadingStateProps {
  readonly rotulo: string
  readonly children?: React.ReactNode
}

/**
 * Estado de carregamento de uma região.
 *
 * `role="status"` com o rótulo — o carregamento é anunciado sem interromper. Recebe `children`
 * para mostrar **skeletons** no lugar do spinner quando o layout do que vai chegar é conhecido:
 * o register product prefere skeleton, que preserva o layout e não faz a página pular.
 */
export function LoadingState({ rotulo, children }: LoadingStateProps): React.JSX.Element {
  if (children !== undefined) {
    return (
      <div role="status" aria-label={rotulo} className="flex flex-col gap-3">
        {children}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center px-6 py-10">
      <Spinner rotulo={rotulo} />
    </div>
  )
}
