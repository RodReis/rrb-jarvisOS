import { useTranslation } from 'react-i18next'
import { TelaLogin } from '../auth/TelaLogin'
import { useAuth } from '../auth/useAuth'
import { SessaoAtiva } from './SessaoAtiva'

/**
 * Raiz do renderer e **porta de entrada** da aplicação (SPEC-Fundacao-03).
 *
 * O gate de auth mora aqui, e não dentro do que ele monta, para que cada camada trate de uma
 * coisa só: o `App` decide **se** há sessão; a `SessaoAtiva` decide **em que espaço** ela começa
 * e monta o shell. Quem não está `ativo` não instancia nada que pressuponha um usuário.
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

  // `state === 'ativo'` não estreita `profile` (são campos independentes do snapshot); a ausência
  // de perfil num estado ativo seria contrato quebrado do main, então cai no login em vez de
  // montar a sessão sem usuário.
  if (auth.state !== 'ativo' || !auth.profile) {
    return <TelaLogin auth={auth} onEntrar={() => void entrar()} />
  }

  // `key` no perfil: um novo login (outro usuário, ou o mesmo depois de sair) **remonta** a
  // sessão do zero, e a CHOICE reaparece — é a spec ("CHOICE em todo login"). Sem a key, o
  // React reusaria o estado da sessão anterior e pularia a CHOICE no segundo login.
  return <SessaoAtiva key={auth.profile.id} perfil={auth.profile} onSair={() => void sair()} />
}
