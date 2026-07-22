/**
 * Configuração do i18next (SPEC-Fundacao-05; `i18next` decidido pelo PI).
 *
 * O idioma inicial vem do perfil persistido, que o main entrega no boot — não de um
 * detector de idioma do navegador. Num app local-first com preferência por usuário, a
 * fonte de verdade é o `UserProfile`, não o `navigator`.
 */

import i18next, { type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Locale } from '@shared/domain/entities'
import { RECURSOS } from './recursos'

export function initI18n(idioma: Locale): Promise<unknown> {
  return i18next.use(initReactI18next).init({
    resources: RECURSOS,
    lng: idioma,
    // Idioma faltante cai no padrão do produto em vez de mostrar a chave crua.
    fallbackLng: 'pt-BR',
    supportedLngs: [...Object.keys(RECURSOS)],
    interpolation: {
      // React já escapa o que renderiza; escapar de novo produziria `&amp;` na tela.
      escapeValue: false
    }
  })
}

export function trocarIdioma(idioma: Locale): Promise<unknown> {
  return i18next.changeLanguage(idioma)
}

export const i18n: I18n = i18next
