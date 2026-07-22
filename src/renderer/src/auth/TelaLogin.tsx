import { useTranslation } from 'react-i18next'
import type { AuthSnapshot } from '@shared/contracts/auth'

/**
 * Tela de entrada (SPEC-Fundacao-03, critérios 1 e 6).
 *
 * Apresenta os quatro estados que antecedem `ativo`. A mensagem de falha vem pronta do
 * main e é exibida **como veio**: o critério 6 proíbe stack trace na UI, e a forma de
 * garantir isso é o renderer não ter acesso ao erro cru para começo de conversa.
 *
 * Estética alinhada ao AppShell — sem design system formal, que é o MVP-003.
 */

interface TelaLoginProps {
  readonly auth: AuthSnapshot
  readonly onEntrar: () => void
}

export function TelaLogin({ auth, onEntrar }: TelaLoginProps): React.JSX.Element {
  const { t } = useTranslation()

  const autenticando = auth.state === 'autenticando'
  const expirada = auth.state === 'sessao-expirada'
  const falhou = auth.state === 'erro'

  return (
    <main className="flex h-full items-center justify-center p-6">
      <section
        aria-labelledby="login-titulo"
        className="w-full max-w-sm rounded-2xl border border-current/10 bg-current/5 p-8 text-center"
      >
        <h1 id="login-titulo" className="text-xl font-semibold text-sky-600 dark:text-sky-300">
          {t('auth.titulo')}
        </h1>

        <p className="mt-2 text-sm opacity-70">
          {autenticando ? t('auth.entrandoDescricao') : t('auth.subtitulo')}
        </p>

        {/* `role="alert"` nos dois casos: a transição para erro ou expiração acontece
            depois de o usuário sair da tela, e precisa ser anunciada quando ele volta. */}
        {(falhou || expirada) && auth.mensagem && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300"
          >
            {auth.mensagem}
          </p>
        )}

        <button
          type="button"
          onClick={onEntrar}
          disabled={autenticando}
          className="mt-6 w-full rounded-lg border border-sky-500/60 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-700 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-200"
        >
          {autenticando
            ? t('auth.entrando')
            : falhou || expirada
              ? t('auth.tentarNovamente')
              : t('auth.entrar')}
        </button>
      </section>
    </main>
  )
}
