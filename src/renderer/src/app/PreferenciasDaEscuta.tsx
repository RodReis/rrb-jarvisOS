import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alternador, Button, Field, Slider } from '@design/ui'
import type { DisparoDeTesteDaEscuta, EstadoDaEscuta } from '@shared/domain/voz'
import {
  SENSIBILIDADE_MAXIMA_WAKE_WORD,
  SENSIBILIDADE_MINIMA_WAKE_WORD,
  WAKE_WORD_OFICIAL
} from '@shared/domain/voz'

/**
 * A escuta contínua em Settings (SPEC-Escuta-01, critério 12 e a revisão de escopo de 2026-10-03).
 *
 * Três coisas, todas aplicadas na hora e sem botão de salvar — como o resto do Settings:
 *
 *  - **Gatilhos**: a frase e as duas palmas ligam e desligam separadamente. O último ligado não
 *    desliga aqui: escuta ligada sem gatilho nenhum é microfone aberto sem função, com o
 *    indicador dizendo que está ouvindo. Para parar de ouvir existe o interruptor da barra.
 *  - **Limiar de disparo**: vale na detecção seguinte, sem restart. É um *limiar* — maior exige
 *    mais certeza —, e por isso o rótulo não diz "sensibilidade": a escala seria o inverso do que
 *    a palavra sugere.
 *  - **Teste ao vivo**: cada disparo aparece com a confiança medida, e **não abre conversa**. O
 *    modo é encerrado ao sair da seção; o main ainda o expira, mas deixá-lo ligado sem querer
 *    faria a escuta parar de abrir turnos sem ninguém ver.
 */

/** Quantos disparos do teste a lista guarda. */
const MAXIMO_DE_DISPAROS = 8

export function PreferenciasDaEscuta(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [estado, setEstado] = useState<EstadoDaEscuta | undefined>(undefined)
  const [testando, setTestando] = useState(false)
  const [disparos, setDisparos] = useState<readonly DisparoDeTesteDaEscuta[]>([])
  const testandoAgora = useRef(false)

  useEffect(() => {
    let vivo = true
    void window.jarvis.estadoDaEscuta().then((e) => {
      if (vivo) setEstado(e)
    })
    const cancelarEstado = window.jarvis.onEscutaMudou((e) => {
      setEstado(e)
      // O main encerra o teste ao desligar a escuta (mute, kill switch); a tela acompanha.
      if (!e.ativa) {
        testandoAgora.current = false
        setTestando(false)
      }
    })
    const cancelarTeste = window.jarvis.onEscutaTeste((d) =>
      setDisparos((atuais) => [d, ...atuais].slice(0, MAXIMO_DE_DISPAROS))
    )
    return () => {
      vivo = false
      cancelarEstado()
      cancelarTeste()
      if (testandoAgora.current) void window.jarvis.definirModoDeTesteDaEscuta(false)
    }
  }, [])

  if (estado === undefined) return null

  const numero = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

  async function definirGatilhos(frase: boolean, palmas: boolean): Promise<void> {
    setEstado(await window.jarvis.definirGatilhosDaEscuta({ frase, palmas }))
  }

  async function alternarTeste(): Promise<void> {
    const proximo = !testando
    testandoAgora.current = proximo
    setTestando(proximo)
    if (proximo) setDisparos([])
    await window.jarvis.definirModoDeTesteDaEscuta(proximo)
  }

  // O último gatilho ligado fica fixo: ver o comentário do componente.
  const soUmLigado = estado.frase !== estado.palmas

  return (
    <section aria-label={t('settings.escuta.titulo')} className="flex flex-col gap-6">
      <div>
        <h3 className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-medio)]">
          {t('settings.escuta.titulo')}
        </h3>
        <p className="mt-1 text-xs opacity-70">{t('settings.escuta.descricao')}</p>
      </div>

      <GatilhoLigavel
        rotulo={t('settings.escuta.frase', { frase: WAKE_WORD_OFICIAL })}
        descricao={t('settings.escuta.fraseDescricao')}
        ligado={estado.frase}
        desabilitado={soUmLigado && estado.frase}
        onMudar={(ligado) => void definirGatilhos(ligado, estado.palmas)}
      />
      <GatilhoLigavel
        rotulo={t('settings.escuta.palmas')}
        descricao={t('settings.escuta.palmasDescricao')}
        ligado={estado.palmas}
        desabilitado={soUmLigado && estado.palmas}
        onMudar={(ligado) => void definirGatilhos(estado.frase, ligado)}
      />
      {soUmLigado && <p className="text-xs opacity-70">{t('settings.escuta.ultimoGatilho')}</p>}

      <Field rotulo={t('settings.escuta.limiar')} descricao={t('settings.escuta.limiarDescricao')}>
        {(atributos) => (
          <Slider
            {...atributos}
            rotulo={t('settings.escuta.limiar')}
            valor={estado.sensibilidade}
            minimo={SENSIBILIDADE_MINIMA_WAKE_WORD}
            maximo={SENSIBILIDADE_MAXIMA_WAKE_WORD}
            passo={0.05}
            formatar={(v) => numero.format(v)}
            onMudar={(valor) =>
              void window.jarvis.definirSensibilidadeDaEscuta(valor).then(setEstado)
            }
          />
        )}
      </Field>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variante="secundaria"
            desabilitado={!estado.ativa}
            onClick={() => void alternarTeste()}
          >
            {testando ? t('settings.escuta.pararTeste') : t('settings.escuta.testar')}
          </Button>
          {!estado.ativa && (
            <p className="text-xs opacity-70">{t('settings.escuta.testeExigeEscuta')}</p>
          )}
        </div>

        {testando && (
          <>
            <p className="text-xs opacity-70">{t('settings.escuta.testeSemConversa')}</p>
            <ol aria-label={t('settings.escuta.disparosDoTeste')} className="flex flex-col gap-1">
              {disparos.map((d, i) => (
                <li
                  key={`${disparos.length - i}`}
                  className="text-[length:var(--jos-texto-mini)] tabular-nums"
                >
                  {d.gatilho === 'frase'
                    ? t('settings.escuta.disparoFrase', {
                        frase: WAKE_WORD_OFICIAL,
                        confianca: numero.format(d.confianca ?? 0),
                        limiar: numero.format(d.limiar)
                      })
                    : t('settings.escuta.disparoPalmas', { limiar: numero.format(d.limiar) })}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  )
}

function GatilhoLigavel({
  rotulo,
  descricao,
  ligado,
  desabilitado,
  onMudar
}: {
  readonly rotulo: string
  readonly descricao: string
  readonly ligado: boolean
  readonly desabilitado: boolean
  readonly onMudar: (ligado: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[length:var(--jos-texto-corpo)]">{rotulo}</p>
        <p className="text-xs opacity-70">{descricao}</p>
      </div>
      <Alternador rotulo={rotulo} ligado={ligado} desabilitado={desabilitado} onMudar={onMudar} />
    </div>
  )
}
