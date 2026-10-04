import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Select } from '@design/ui'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import type { UserPreferences } from '@shared/domain/entities'
import { criarMedidorDeEntrada } from './medidor-de-audio'

/** A escolha de dispositivos é uma preferência da máquina, compartilhada pelos dois espaços. */
export function DispositivosDeVoz({
  preferencias,
  onSalvar
}: {
  readonly preferencias: PreferencesSnapshot
  readonly onSalvar: (mudanca: UserPreferences) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [dispositivos, setDispositivos] = useState<readonly MediaDeviceInfo[]>([])
  const [erro, setErro] = useState(false)
  const barraDoMedidor = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let ativo = true
    const atualizar = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((lista) => {
          if (ativo) setDispositivos(lista)
        })
        .catch(() => {
          if (ativo) setErro(true)
        })
    }
    if (!navigator.mediaDevices) return
    atualizar()
    navigator.mediaDevices.addEventListener?.('devicechange', atualizar)
    return () => {
      ativo = false
      navigator.mediaDevices.removeEventListener?.('devicechange', atualizar)
    }
  }, [])

  useEffect(() => {
    const id = preferencias.vozEntradaId
    if (!id || !dispositivos.some((d) => d.kind === 'audioinput' && d.deviceId === id)) return
    let cancelado = false
    let parar: (() => Promise<void>) | undefined
    let relogio: ReturnType<typeof setInterval> | undefined
    void criarMedidorDeEntrada(id)
      .then((medidor) => {
        if (cancelado) {
          void medidor.parar()
          return
        }
        parar = medidor.parar
        relogio = setInterval(() => {
          const nivel = medidor.nivelRms()
          barraDoMedidor.current?.style.setProperty('width', `${Math.min(100, nivel / 327.67)}%`)
          barraDoMedidor.current?.parentElement?.setAttribute('aria-valuenow', String(nivel))
        }, 100)
      })
      .catch(() => {
        if (!cancelado) setErro(true)
      })
    return () => {
      cancelado = true
      if (relogio) clearInterval(relogio)
      void parar?.()
    }
  }, [preferencias.vozEntradaId, dispositivos])

  async function permitir(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((trilha) => trilha.stop())
      setDispositivos(await navigator.mediaDevices.enumerateDevices())
      setErro(false)
    } catch {
      setErro(true)
    }
  }

  const entradas = dispositivos.filter((d) => d.kind === 'audioinput' && d.deviceId)
  const saidas = dispositivos.filter((d) => d.kind === 'audiooutput' && d.deviceId)
  return (
    <div className="flex flex-col gap-4">
      <Button variante="secundaria" onClick={() => void permitir()}>
        {t('voz.escolherMicrofone')}
      </Button>
      {erro && <p role="alert">{t('voz.microfoneIndisponivel')}</p>}
      <Field rotulo={t('voz.entrada')}>
        {(campo) => (
          <Select
            {...campo}
            valor={preferencias.vozEntradaId ?? ''}
            placeholder={t('voz.selecione')}
            opcoes={entradas.map((d) => ({ valor: d.deviceId, rotulo: d.label || d.deviceId }))}
            onMudar={(valor) =>
              onSalvar({
                vozEntradaId: valor,
                vozEntradaRotulo: entradas.find((d) => d.deviceId === valor)?.label
              })
            }
          />
        )}
      </Field>
      <div
        role="meter"
        aria-label={t('voz.nivelEntrada')}
        aria-valuemin={0}
        aria-valuemax={32767}
        aria-valuenow={0}
        className="h-2 w-full overflow-hidden bg-[rgba(var(--jos-borda-rgb),0.12)]"
      >
        <span
          ref={barraDoMedidor}
          className="block h-full bg-[var(--jos-cor-acento)]"
          style={{ width: '0%' }}
        />
      </div>
      <Field rotulo={t('voz.saida')}>
        {(campo) => (
          <Select
            {...campo}
            valor={preferencias.vozSaidaId ?? ''}
            placeholder={t('voz.selecione')}
            opcoes={saidas.map((d) => ({ valor: d.deviceId, rotulo: d.label || d.deviceId }))}
            onMudar={(valor) =>
              onSalvar({
                vozSaidaId: valor,
                vozSaidaRotulo: saidas.find((d) => d.deviceId === valor)?.label
              })
            }
          />
        )}
      </Field>
    </div>
  )
}
