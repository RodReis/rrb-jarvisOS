/**
 * Estado de autenticação no renderer (SPEC-Fundacao-03).
 *
 * O hook **espelha** o main; não decide nada. Quem sabe se há sessão, se ela venceu e
 * quem é o usuário é o `AuthService` — aqui só se reflete o `AuthSnapshot` que chega.
 * É o que mantém o critério 4: não existe token neste lado da ponte para vazar.
 *
 * A assinatura do push (`onAuthChanged`) é essencial e não decorativa: o login acontece
 * fora do app, no navegador, e pode terminar minutos depois. Sem push, a UI ficaria presa
 * em `autenticando` até alguém consultar de novo.
 */

import { useCallback, useEffect, useState } from 'react'
import { DESLOGADO, type AuthSnapshot } from '@shared/contracts/auth'
import { log } from '../lib/log'

export interface UseAuth {
  readonly auth: AuthSnapshot
  readonly carregando: boolean
  readonly entrar: () => Promise<void>
  readonly sair: () => Promise<void>
}

export function useAuth(): UseAuth {
  const [auth, setAuth] = useState<AuthSnapshot>(DESLOGADO)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    // Assina **antes** de consultar: entre a consulta e a assinatura o main pode concluir
    // a restauração da sessão, e essa transição não pode se perder.
    const cancelar = window.jarvis.onAuthChanged((snapshot) => {
      setAuth(snapshot)
      setCarregando(false)
    })

    window.jarvis
      .getAuth()
      .then((snapshot) => {
        setAuth(snapshot)
        setCarregando(false)
      })
      .catch((error: unknown) => {
        log.ui.error('Falha ao consultar o estado de autenticação', { error })
        setCarregando(false)
      })

    return cancelar
  }, [])

  const entrar = useCallback(async (): Promise<void> => {
    // O estado `autenticando` chega pelo push do main; não se antecipa aqui para a UI não
    // divergir do que o serviço de fato fez.
    try {
      const snapshot = await window.jarvis.login()
      setAuth(snapshot)
      log.ui.info('Fluxo de login concluído pela UI', { estado: snapshot.state })
    } catch (error) {
      log.ui.error('Falha ao iniciar o login', { error })
    }
  }, [])

  const sair = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await window.jarvis.logout()
      setAuth(snapshot)
      log.ui.info('Logout concluído pela UI')
    } catch (error) {
      log.ui.error('Falha ao encerrar a sessão', { error })
    }
  }, [])

  return { auth, carregando, entrar, sair }
}
