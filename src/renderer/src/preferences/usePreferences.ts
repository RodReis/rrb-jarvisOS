/**
 * Preferências no renderer: lê do main, aplica e persiste (SPEC-Fundacao-05).
 *
 * A troca é **a quente**: idioma muda a UI sem reiniciar (critério 1) e o tema pinta na
 * hora (critério 2). O estado vive aqui, mas a verdade é o main — que persiste no
 * `UserProfile` por usuário, fechando o critério 3.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import type { ResolvedTheme, UserPreferences } from '@shared/domain/entities'
import { trocarIdioma } from '../i18n'
import { log } from '../lib/log'

/**
 * Escreve o tema no `<html>` como atributo.
 *
 * Atributo e não classe porque o Tailwind v4 casa variantes por seletor (`data-tema`), e
 * porque o valor é um estado de três opções resolvido para dois — um atributo expressa
 * isso melhor que classes que precisariam ser adicionadas e removidas em par.
 */
function aplicarTema(tema: ResolvedTheme): void {
  document.documentElement.dataset['tema'] = tema
}

export interface UsePreferences {
  readonly preferencias: PreferencesSnapshot | null
  readonly erro: string | null
  readonly salvar: (mudanca: UserPreferences) => Promise<void>
}

export function usePreferences(): UsePreferences {
  const [preferencias, setPreferencias] = useState<PreferencesSnapshot | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  /** Aplica idioma e tema juntos — os dois vêm do mesmo snapshot do main. */
  const aplicar = useCallback(async (snapshot: PreferencesSnapshot): Promise<void> => {
    aplicarTema(snapshot.resolvedTheme)
    await trocarIdioma(snapshot.locale)
    setPreferencias(snapshot)
  }, [])

  useEffect(() => {
    window.jarvis
      .getPreferences()
      .then(aplicar)
      .catch((error: unknown) => {
        log.ui.error('Falha ao carregar preferências', { error })
      })
  }, [aplicar])

  const salvar = useCallback(
    async (mudanca: UserPreferences): Promise<void> => {
      try {
        // O main devolve o estado resultante já resolvido; a UI reflete o que ele gravou,
        // em vez de assumir que a gravação deu certo.
        const snapshot = await window.jarvis.savePreferences(mudanca)
        await aplicar(snapshot)
        setErro(null)
        log.ui.info('Preferências atualizadas pela UI', {
          idioma: snapshot.locale,
          tema: snapshot.theme
        })
      } catch (error) {
        setErro('erro.preferencias')
        log.ui.error('Falha ao salvar preferências', { error })
      }
    },
    [aplicar]
  )

  return { preferencias, erro, salvar }
}
