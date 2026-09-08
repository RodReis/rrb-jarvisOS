import { useTranslation } from 'react-i18next'
import { Field, Select } from '@design/ui'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import {
  HOTKEYS_DE_VOZ,
  IDIOMAS_DE_VOZ,
  MODELOS_DE_VOZ,
  type HotkeyDeVoz,
  type IdiomaDeVoz,
  type ModeloDeVoz,
  type UserPreferences
} from '@shared/domain/entities'

/**
 * As preferências de voz (SPEC-Voz-01, critério 6).
 *
 * Quatro campos, todos `Select` de lista fechada — nenhum é texto livre, e isso é decisão de
 * segurança tanto quanto de UX: cada modelo precisa de artefato com hash pinado no catálogo, e a
 * **hotkey registra um atalho global**, que intercepta a tecla no sistema inteiro. Campo livre
 * ali deixaria o renderer sequestrar qualquer combinação para a máquina toda.
 *
 * Cada mudança grava sozinha, como o resto do Settings: não há botão "salvar" nesta tela, e
 * introduzir um só aqui faria o usuário perder o ajuste ao trocar de aba.
 *
 * A frase sobre o áudio não sair da máquina fica no topo, e não em nota de rodapé: é o que
 * distingue este recurso de um assistente em nuvem, e quem chega para configurar voz é
 * exatamente quem tem essa dúvida.
 */

/** Os tetos oferecidos, em milissegundos. */
const TETOS_DE_GRAVACAO = [15_000, 30_000, 60_000, 120_000, 300_000] as const

const ROTULO_DO_MODELO: Readonly<Record<ModeloDeVoz, string>> = {
  tiny: 'Tiny — o mais rápido',
  base: 'Base',
  small: 'Small — equilíbrio',
  medium: 'Medium — o mais preciso'
}

const ROTULO_DO_IDIOMA: Readonly<Record<IdiomaDeVoz, string>> = {
  pt: 'Português',
  en: 'English'
}

/**
 * O acelerador do Electron para o que o teclado mostra.
 *
 * `Control+Shift+Space` é o que a API entende; `Ctrl + Shift + Espaço` é o que está escrito na
 * tecla. Mostrar o primeiro faria o usuário procurar uma tecla "Control+Shift+Space".
 */
const ROTULO_DA_HOTKEY: Readonly<Record<HotkeyDeVoz, string>> = {
  'Control+Shift+Space': 'Ctrl + Shift + Espaço',
  'Control+Shift+J': 'Ctrl + Shift + J',
  'Control+Alt+Space': 'Ctrl + Alt + Espaço',
  'Control+Alt+J': 'Ctrl + Alt + J'
}

export function PreferenciasDeVoz({
  preferencias,
  onSalvar
}: {
  readonly preferencias: PreferencesSnapshot
  readonly onSalvar: (mudanca: UserPreferences) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const rotuloDoTeto = (ms: number): string =>
    ms < 60_000
      ? t('settings.vozSegundos', { valor: ms / 1000 })
      : t('settings.vozMinutos', { valor: ms / 60_000 })

  return (
    <div className="flex max-w-md flex-col gap-8">
      <p className="text-xs opacity-70">{t('settings.vozDescricao')}</p>

      <Field rotulo={t('settings.vozModelo')} descricao={t('settings.vozModeloDescricao')}>
        {(atributos) => (
          <Select
            {...atributos}
            valor={preferencias.vozModelo}
            onMudar={(valor) => onSalvar({ vozModelo: valor as ModeloDeVoz })}
            opcoes={MODELOS_DE_VOZ.map((modelo) => ({
              valor: modelo,
              rotulo: ROTULO_DO_MODELO[modelo]
            }))}
          />
        )}
      </Field>

      <Field rotulo={t('settings.vozIdioma')} descricao={t('settings.vozIdiomaDescricao')}>
        {(atributos) => (
          <Select
            {...atributos}
            valor={preferencias.vozIdioma}
            onMudar={(valor) => onSalvar({ vozIdioma: valor as IdiomaDeVoz })}
            opcoes={IDIOMAS_DE_VOZ.map((idioma) => ({
              valor: idioma,
              rotulo: ROTULO_DO_IDIOMA[idioma]
            }))}
          />
        )}
      </Field>

      <Field rotulo={t('settings.vozHotkey')} descricao={t('settings.vozHotkeyDescricao')}>
        {(atributos) => (
          <Select
            {...atributos}
            valor={preferencias.vozHotkey}
            onMudar={(valor) => onSalvar({ vozHotkey: valor as HotkeyDeVoz })}
            opcoes={HOTKEYS_DE_VOZ.map((hotkey) => ({
              valor: hotkey,
              rotulo: ROTULO_DA_HOTKEY[hotkey]
            }))}
          />
        )}
      </Field>

      <Field rotulo={t('settings.vozTimeout')} descricao={t('settings.vozTimeoutDescricao')}>
        {(atributos) => (
          <Select
            {...atributos}
            valor={String(preferencias.vozTimeoutMs)}
            onMudar={(valor) => onSalvar({ vozTimeoutMs: Number(valor) })}
            opcoes={TETOS_DE_GRAVACAO.map((ms) => ({
              valor: String(ms),
              rotulo: rotuloDoTeto(ms)
            }))}
          />
        )}
      </Field>
    </div>
  )
}
