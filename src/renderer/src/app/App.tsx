import { useTranslation } from 'react-i18next'
import { TelaLogin } from '../auth/TelaLogin'
import { useAuth } from '../auth/useAuth'
import { AppShell } from './AppShell'

/**
 * Raiz do renderer e **porta de entrada** da aplicação (SPEC-Fundacao-03).
 *
 * O gate mora aqui, e não dentro do AppShell, para que o shell continue tratando de uma
 * coisa só (espaços e navegação). Quem não está `ativo` não monta o shell — não é questão
 * de esconder a UI, e sim de não instanciar o que pressupõe um usuário.
 */
export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const { auth, carregando, entrar, sair } = useAuth()

  // Enquanto o main não respondeu, nada de piscar a tela de login para quem já tem sessão.
  if (carregando) {
    return (
      <main className="flex h-full items-center justify-center opacity-70">
        <p>{t('carregando')}</p>
      </main>
    )
  }

  if (auth.state !== 'ativo') {
    return <TelaLogin auth={auth} onEntrar={() => void entrar()} />
  }

  return <AppShell perfil={auth.profile} onSair={() => void sair()} />
}
