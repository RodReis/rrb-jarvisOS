import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Select } from '@design/ui'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import type { ProntidaoDoTts } from '@shared/domain/visemes'
import { criarReprodutor } from './reproducao-de-fala'
import {
  HOTKEYS_DE_VOZ,
  IDIOMAS_DE_VOZ,
  MODELOS_DE_VOZ,
  type HotkeyDeVoz,
  type IdiomaDeVoz,
  type ModeloDeVoz,
  type UserPreferences,
  type VozDaFalaPreferida
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

      <VozDaFala preferencias={preferencias} onSalvar={onSalvar} />
    </div>
  )
}

/** A frase do preview. Fixa e curta: o que se avalia é o timbre, não o conteúdo. */
const FRASE_DO_PREVIEW = 'Bom dia. Sou o JARVIS, e esta é a minha voz.'

/**
 * A voz da fala e o preview (SPEC-Voz-02, critério 5).
 *
 * O default é **escolhido ouvindo** — decisão do PI. Por isso o preview vive ao lado do seletor e
 * não numa tela à parte: comparar duas vozes exige alternar entre elas, e mandar o usuário a
 * outro lugar para ouvir tornaria a comparação uma sequência de idas e voltas.
 *
 * Sem voz baixada, o bloco mostra o estado com a ação — o mesmo padrão do runtime na F01. Oferecer
 * um seletor vazio seria pedir uma escolha que não existe.
 */
function VozDaFala({
  preferencias,
  onSalvar
}: {
  readonly preferencias: PreferencesSnapshot
  readonly onSalvar: (mudanca: UserPreferences) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [prontidao, setProntidao] = useState<ProntidaoDoTts | undefined>()
  const [falando, setFalando] = useState(false)
  const [erro, setErro] = useState<string | undefined>()

  /*
   * O reprodutor vive num ref, e não em estado.
   *
   * Ele não é lido durante a renderização — só em manipulador de evento —, e pô-lo em `useState`
   * faria cada fala recriar o componente. É também o que garante que o cancelamento fale com a
   * **mesma** instância que começou a tocar.
   */
  const reprodutor = useRef<ReturnType<typeof criarReprodutor> | undefined>(undefined)
  reprodutor.current ??= criarReprodutor()

  useEffect(() => {
    let vivo = true
    void window.jarvis.prontidaoDoTts().then((p) => {
      if (vivo) setProntidao(p)
    })

    return () => {
      vivo = false
      // Sair da aba com a fala tocando a deixaria soando sobre o resto do app. O critério 7 fala
      // de nova fala cancelar a anterior; desmontar é o mesmo caso visto de outro ângulo.
      reprodutor.current?.cancelar()
    }
  }, [])

  const vozes = prontidao?.vozes ?? []

  async function ouvir(): Promise<void> {
    setErro(undefined)
    setFalando(true)

    try {
      const desfecho = await window.jarvis.falar(FRASE_DO_PREVIEW, preferencias.vozDaFala)
      if (desfecho.estado !== 'ok') {
        setErro(t(`settings.vozFala.${desfecho.estado}`))
        return
      }

      await reprodutor.current?.tocar(desfecho.fala).terminou
    } finally {
      setFalando(false)
    }
  }

  if (vozes.length === 0) {
    return (
      <Field rotulo={t('settings.vozDaFala')} descricao={t('settings.vozDaFalaSemVoz')}>
        {() => <p className="text-xs opacity-70">{t('settings.vozDaFalaBaixar')}</p>}
      </Field>
    )
  }

  return (
    <Field rotulo={t('settings.vozDaFala')} descricao={t('settings.vozDaFalaDescricao')}>
      {(atributos) => (
        <div className="flex flex-col gap-2">
          <Select
            {...atributos}
            valor={preferencias.vozDaFala}
            onMudar={(valor) => {
              // Trocar de voz para a fala em curso: continuar tocando a anterior enquanto o
              // seletor já mostra outra faria o preview mentir sobre o que está soando.
              reprodutor.current?.cancelar()
              onSalvar({ vozDaFala: valor as VozDaFalaPreferida })
            }}
            opcoes={vozes.map((v) => ({ valor: v.id, rotulo: v.rotulo }))}
          />

          <div className="flex items-center gap-2">
            <Button variante="secundaria" onClick={() => void ouvir()} carregando={falando}>
              {falando ? t('settings.vozDaFalaFalando') : t('settings.vozDaFalaOuvir')}
            </Button>

            {falando && (
              <Button variante="secundaria" onClick={() => reprodutor.current?.cancelar()}>
                {t('settings.vozDaFalaParar')}
              </Button>
            )}
          </div>

          {erro !== undefined && <p className="text-xs text-[var(--cor-erro)]">{erro}</p>}
        </div>
      )}
    </Field>
  )
}
