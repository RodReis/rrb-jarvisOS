import { useTranslation } from 'react-i18next'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import {
  LOCALES,
  THEME_PREFERENCES,
  type AccentColor,
  type Locale,
  type ThemePreference,
  type UserPreferences
} from '@shared/domain/entities'
import { AccentSwatchSelector } from '@design/patterns'
import { identidade } from '@design/tokens/identidade'
import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { Modulo } from '@design/tokens/semantic'

/**
 * Tela de configurações (SPEC-Fundacao-05 + SPEC-CHOICE-01 crit. 5): idioma, tema e acento.
 *
 * Acessível nos dois workspaces — é capacidade compartilhada, e as preferências são do
 * usuário, não do espaço (a spec adia preferências por workspace).
 *
 * O acento reusa o **mesmo** `AccentSwatchSelector` da CHOICE (paleta fechada, por módulo), não um
 * picker livre: mudar aqui reflete na CHOICE e vice-versa, porque ambos editam o mesmo valor no
 * `UserProfile`. É o critério 5 — um só valor, dois lugares de edição.
 */

interface SettingsProps {
  readonly preferencias: PreferencesSnapshot
  readonly erro: string | null
  readonly onSalvar: (mudanca: UserPreferences) => void
  /** `uiTheme` do shell — o grupo de acento acompanha o tema da tela, não força escuro. */
  readonly uiTheme: 'light' | 'dark'
}

const ROTULO_IDIOMA: Readonly<Record<Locale, string>> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)'
}

export function Settings({
  preferencias,
  erro,
  onSalvar,
  uiTheme
}: SettingsProps): React.JSX.Element {
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

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id="settings-acento-titulo">
          {t('settings.acento')}
        </p>
        <p className="text-xs opacity-70">{t('settings.acentoDescricao')}</p>
        {/*
         * Um grupo por módulo, cada um reabrindo o provider com o seu acento — o mesmo desenho da
         * CHOICE. Reabrir é o que faz o swatch selecionado (marcado por borda no `--jos-cor-texto`)
         * e o rótulo lerem a identidade certa sem `if` de cor aqui.
         */}
        <div aria-labelledby="settings-acento-titulo" className="flex flex-col gap-4 pt-1">
          {(['noa', 'jarvis'] as const).map((modulo) => (
            <SeletorDeAcentoDoModulo
              key={modulo}
              modulo={modulo}
              uiTheme={uiTheme}
              valor={
                (modulo === 'noa' ? preferencias.accentNoa : preferencias.accentJarvis) as CorAcento
              }
              onEscolher={(cor) =>
                onSalvar(
                  modulo === 'noa'
                    ? { accentNoa: cor as AccentColor }
                    : { accentJarvis: cor as AccentColor }
                )
              }
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * Um seletor de acento por módulo, com o provider reaberto na identidade.
 *
 * Fora do componente principal porque monta o seu próprio `ProvedorDeTema` — o Settings roda no
 * shell (que já tem provider), mas cada grupo precisa do acento **do seu módulo** para o estado
 * selecionado do swatch aparecer na cor certa.
 */
function SeletorDeAcentoDoModulo({
  modulo,
  valor,
  uiTheme,
  onEscolher
}: {
  readonly modulo: Modulo
  readonly valor: CorAcento
  readonly uiTheme: 'light' | 'dark'
  readonly onEscolher: (cor: CorAcento) => void
}): React.JSX.Element {
  const id = identidade(modulo)

  return (
    <ProvedorDeTema
      modulo={modulo}
      uiTheme={uiTheme}
      accentJarvis={modulo === 'jarvis' ? valor : '#C4C4C4'}
      accentNoa={modulo === 'noa' ? valor : '#C4C4C4'}
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium opacity-80">{id.nome}</span>
        <AccentSwatchSelector
          valor={valor}
          onEscolher={onEscolher}
          rotulo={`Acento de ${id.nome}`}
        />
      </div>
    </ProvedorDeTema>
  )
}
