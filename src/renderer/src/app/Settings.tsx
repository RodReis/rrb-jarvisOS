import { useTranslation } from 'react-i18next'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import {
  LOCALES,
  THEME_PREFERENCES,
  type Locale,
  type ThemePreference,
  type UserPreferences
} from '@shared/domain/entities'

/**
 * Tela de configurações (SPEC-Fundacao-05): idioma e tema.
 *
 * Acessível nos dois workspaces — é capacidade compartilhada, e as preferências são do
 * usuário, não do espaço (a spec adia preferências por workspace).
 */

interface SettingsProps {
  readonly preferencias: PreferencesSnapshot
  readonly erro: string | null
  readonly onSalvar: (mudanca: UserPreferences) => void
}

const ROTULO_IDIOMA: Readonly<Record<Locale, string>> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)'
}

export function Settings({ preferencias, erro, onSalvar }: SettingsProps): React.JSX.Element {
  const { t } = useTranslation()

  const rotuloTema: Readonly<Record<ThemePreference, string>> = {
    claro: t('settings.temaClaro'),
    escuro: t('settings.temaEscuro'),
    sistema: t('settings.temaSistema')
  }

  return (
    <section aria-label={t('settings.titulo')} className="flex max-w-xl flex-col gap-8">
      {erro && (
        <p role="alert" className="text-sm text-rose-400">
          {t(erro)}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {/* Label ligada ao select por id: sem isso o leitor de tela anuncia "combobox"
            sem dizer do quê. */}
        <label htmlFor="settings-idioma" className="text-sm font-medium">
          {t('settings.idioma')}
        </label>
        <p className="text-xs opacity-70">{t('settings.idiomaDescricao')}</p>
        <select
          id="settings-idioma"
          value={preferencias.locale}
          onChange={(e) => onSalvar({ locale: e.target.value as Locale })}
          className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm"
        >
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {ROTULO_IDIOMA[locale]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id="settings-tema-titulo">
          {t('settings.tema')}
        </p>
        <p className="text-xs opacity-70">{t('settings.temaDescricao')}</p>
        {/* Radiogroup: as três opções são mutuamente exclusivas. */}
        <div
          role="radiogroup"
          aria-labelledby="settings-tema-titulo"
          className="flex flex-wrap gap-2"
        >
          {THEME_PREFERENCES.map((tema) => {
            const ativo = tema === preferencias.theme
            return (
              <button
                key={tema}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => onSalvar({ theme: tema })}
                className={`rounded-md border px-4 py-2 text-sm transition ${
                  ativo
                    ? 'border-current bg-current/10 font-medium'
                    : 'border-current/20 opacity-70'
                }`}
              >
                {rotuloTema[tema]}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
