import { X } from 'lucide-react'
import { cx } from '../base'
import {
  CLASSE_FUNDO_SEMANTICO,
  CLASSE_TEXTO_SEMANTICO,
  ICONE_SEMANTICO,
  NOME_DO_TOM
} from '../semantica'
import { useToast, type Toast } from './useToast'

/**
 * Container e card do Toast (SPEC-DesignSystem-03b, README §5; critérios 2 e 4).
 *
 * Fiel ao protótipo: container fixo `top:64px right:22px width:360px`, card glass com
 * `backdrop-filter`, barra lateral na cor do tom, ícone, cabeçalho `KIND`/`stamp`, e barra de
 * progresso que encolhe até fechar.
 *
 * **Toasts permanecem escuros** mesmo com `uiTheme='light'` (README §2.6): a superfície é de
 * marca, como Login e Choice. Aqui isso é conseguido por cores próprias (o card não lê as
 * variáveis de tema — usa gradiente escuro fixo), o caminho mais simples já que o viewport vive
 * fora da árvore temada, no fim do provider.
 *
 * A tensão registrada: o `impeccable` bane glassmorphism como default. Aqui o glass é
 * **especificação do protótipo com função** — o toast flutua sobre o conteúdo e o blur o separa
 * do fundo. Segui o protótipo (decisão do PI); o sheen respeita `prefers-reduced-motion`.
 */

/**
 * A região do viewport é `aria-live`. `polite` porque a maioria é info/sucesso: anuncia quando
 * o leitor terminar a frase atual, sem cortar. O componente `role`/`live` por toast é escolhido
 * abaixo conforme o tom — warn/error são mais assertivos.
 */
export function ToastViewport(): React.JSX.Element {
  const { toasts } = useToast()

  return (
    <div
      // Marcador do container. `role="status"` é papel comum — o `Spinner` da página também o
      // usa —, então buscar toast por papel encontra o primeiro `status` do DOM, que pode não
      // ser um toast. A prova visual da F03b tropeçou exatamente nisso.
      data-jos-toasts=""
      // `pointer-events-none` no container, `auto` em cada card: cliques passam pelo espaço
      // vazio entre toasts para o conteúdo atrás (README §5.2).
      className="pointer-events-none fixed right-[var(--jos-toast-direita)] top-[var(--jos-toast-topo)] z-[var(--jos-camada-toast)] flex w-[var(--jos-toast-largura)] max-w-[calc(100vw-44px)] flex-col gap-3"
    >
      {toasts.map((toast) => (
        <CartaoToast key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

/** Gradiente escuro fixo — o toast é superfície de marca e não inverte no modo claro. */
const GLASS = 'bg-[var(--jos-toast-fundo)] [backdrop-filter:blur(14px)]'

function CartaoToast({ toast }: { readonly toast: Toast }): React.JSX.Element {
  const { descartar, pausar, retomar } = useToast()
  const Icone = ICONE_SEMANTICO[toast.tom]

  // warn/error são assertivos (`alert`/`assertive`): interrompem para avisar de um problema.
  // info/success são `status`/`polite`: informam sem cortar. Nenhum move o foco — anunciar não
  // deve arrancar o usuário do que ele faz (README §5 a11y).
  const urgente = toast.tom === 'warn' || toast.tom === 'err'

  return (
    <div
      role={urgente ? 'alert' : 'status'}
      aria-live={urgente ? 'assertive' : 'polite'}
      onMouseEnter={() => pausar(toast.id)}
      onMouseLeave={() => retomar(toast.id)}
      onFocus={() => pausar(toast.id)}
      onBlur={() => retomar(toast.id)}
      className={cx(
        'pointer-events-auto relative flex gap-3 overflow-hidden rounded-[var(--jos-raio-toast)] p-3',
        GLASS,
        'border border-[color-mix(in_srgb,var(--jos-cor-marca-tom)_30%,transparent)]',
        'shadow-[0_0_30px_-14px_var(--jos-cor-marca-tom),var(--jos-toast-sombra)]',
        'data-[novo]:animate-[toast-in_var(--jos-duracao-media)_ease-out]'
      )}
      // A cor do tom vira uma variável local, para borda/sombra/barra lerem a mesma sem repetir
      // a expressão. Toast é sempre escuro, então usa a cor de marca crua (não a `-leitura`).
      style={{ '--jos-cor-marca-tom': `var(--jos-cor-${toast.tom})` } as React.CSSProperties}
      data-novo=""
    >
      {/* Barra lateral 3px na cor + glow (README §5.2). */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-y-0 left-0 w-[var(--jos-toast-barra-lateral)]',
          CLASSE_FUNDO_SEMANTICO[toast.tom]
        )}
      />

      {/* Ícone 34px, fundo translúcido na cor. */}
      <span
        aria-hidden="true"
        className={cx(
          'flex size-[var(--jos-toast-icone)] shrink-0 items-center justify-center rounded-[var(--jos-raio-chip-largo)]',
          'bg-[color-mix(in_srgb,var(--jos-cor-marca-tom)_12%,transparent)]',
          CLASSE_TEXTO_SEMANTICO[toast.tom]
        )}
      >
        <Icone className="size-[var(--jos-tamanho-icone)]" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cx(
              'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]',
              'uppercase tracking-[var(--jos-tracking-label)]',
              CLASSE_TEXTO_SEMANTICO[toast.tom]
            )}
          >
            {/* O leitor de tela recebe o nome do tom em pt-BR; a sigla visual é decorativa. */}
            <span className="sr-only">{NOME_DO_TOM[toast.tom]}: </span>
            <span aria-hidden="true">{toast.tom.toUpperCase()}</span>
          </span>
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-toast-texto-suave)] [font-variant-numeric:tabular-nums]">
            {toast.stamp}
          </span>
        </div>
        <p className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)] text-[var(--jos-toast-texto)]">
          {toast.titulo}
        </p>
        {toast.mensagem !== undefined && (
          <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-toast-texto-suave)]">
            {toast.mensagem}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => descartar(toast.id)}
        aria-label="Fechar notificação"
        className={cx(
          'flex size-6 shrink-0 items-center justify-center rounded-[var(--jos-raio-chip)]',
          'text-[var(--jos-toast-texto-suave)] hover:text-[var(--jos-toast-texto)]',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--jos-cor-marca-tom)]'
        )}
      >
        <X aria-hidden="true" className="size-4" />
      </button>

      {/* Barra de progresso inferior que encolhe até fechar (README §5.2). A animação dura o
          tempo do toast; pausa junto com o timer via `animation-play-state` no hover do card. */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-x-0 bottom-0 h-[var(--jos-toast-barra-progresso)] origin-left',
          CLASSE_FUNDO_SEMANTICO[toast.tom],
          'motion-safe:animate-[toast-barra_linear]',
          'group-hover:[animation-play-state:paused]'
        )}
        style={{ animationDuration: `${toast.duracao}ms` }}
      />
    </div>
  )
}
