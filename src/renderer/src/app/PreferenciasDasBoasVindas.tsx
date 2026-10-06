import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alternador, Button, Field, Input, Select } from '@design/ui'
import type { ConfiguracaoDasBoasVindas } from '@shared/domain/boas-vindas'

function horario(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
}

function minutos(texto: string): number | undefined {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(texto)) return undefined
  const [hora, minuto] = texto.split(':').map(Number)
  return hora * 60 + minuto
}

export function PreferenciasDasBoasVindas(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [rascunho, setRascunho] = useState<ConfiguracaoDasBoasVindas>()
  const [inicio, setInicio] = useState('06:00')
  const [fim, setFim] = useState('23:00')
  const [erro, setErro] = useState<string>()
  const [salvo, setSalvo] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!window.jarvis?.lerBoasVindas) return
    let vivo = true
    void window.jarvis
      .lerBoasVindas()
      .then((config) => {
        if (!vivo) return
        setRascunho(config)
        setInicio(horario(config.janelaInicio))
        setFim(horario(config.janelaFim))
      })
      .catch(() => {
        if (vivo) setErro(t('settings.boasVindas.erroLeitura'))
      })
    return () => {
      vivo = false
    }
  }, [t])

  if (!rascunho) {
    return erro ? <p role="alert">{erro}</p> : null
  }

  function alterar(mudanca: Partial<ConfiguracaoDasBoasVindas>): void {
    setRascunho((atual) => (atual ? { ...atual, ...mudanca } : atual))
    setSalvo(false)
    setErro(undefined)
  }

  async function salvar(): Promise<void> {
    const de = minutos(inicio)
    const ate = minutos(fim)
    if (
      de === undefined ||
      ate === undefined ||
      de === ate ||
      !rascunho ||
      Object.values(rascunho.frases).some((frase) => frase.trim() === '')
    ) {
      setErro(t('settings.boasVindas.erroValidacao'))
      return
    }
    setOcupado(true)
    try {
      const salvo = await window.jarvis.salvarBoasVindas({
        ...rascunho,
        janelaInicio: de,
        janelaFim: ate
      })
      setRascunho(salvo)
      setSalvo(true)
      setErro(undefined)
    } catch {
      setErro(t('settings.boasVindas.erroSalvar'))
    } finally {
      setOcupado(false)
    }
  }

  async function escolher(tipo: 'arquivo' | 'pasta' | null): Promise<void> {
    setOcupado(true)
    try {
      const salvo = await window.jarvis.selecionarMidiaDasBoasVindas(tipo)
      alterar({ midia: salvo.midia, midiaAtiva: salvo.midiaAtiva })
    } catch {
      setErro(t('settings.boasVindas.erroMidia'))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section
      className="flex flex-col gap-5 border-t border-[var(--jos-cor-borda)] pt-6"
      aria-labelledby="boas-vindas-titulo"
    >
      <div>
        <h3 id="boas-vindas-titulo" className="text-sm font-semibold">
          {t('settings.boasVindas.titulo')}
        </h3>
        <p className="mt-1 text-xs opacity-70">{t('settings.boasVindas.descricao')}</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">{t('settings.boasVindas.ativar')}</span>
        <Alternador
          rotulo={t('settings.boasVindas.ativar')}
          ligado={rascunho.ativa}
          onMudar={(ativa) => alterar({ ativa })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field rotulo={t('settings.boasVindas.inicio')}>
          {(atributos) => (
            <Input
              {...atributos}
              valor={inicio}
              onMudar={(valor) => {
                setInicio(valor)
                setSalvo(false)
              }}
              placeholder="06:00"
            />
          )}
        </Field>
        <Field rotulo={t('settings.boasVindas.fim')}>
          {(atributos) => (
            <Input
              {...atributos}
              valor={fim}
              onMudar={(valor) => {
                setFim(valor)
                setSalvo(false)
              }}
              placeholder="23:00"
            />
          )}
        </Field>
      </div>

      <Field
        rotulo={t('settings.boasVindas.teto')}
        descricao={t('settings.boasVindas.tetoDescricao')}
      >
        {(atributos) => (
          <Select
            {...atributos}
            valor={String(rascunho.tetoDaPersonaMs)}
            onMudar={(valor) => alterar({ tetoDaPersonaMs: Number(valor) })}
            opcoes={[2000, 4000, 8000, 15000].map((ms) => ({
              valor: String(ms),
              rotulo: `${ms / 1000} s`
            }))}
          />
        )}
      </Field>

      {(['manha', 'tarde', 'noite'] as const).map((periodo) => (
        <Field
          key={periodo}
          rotulo={t(`settings.boasVindas.${periodo}`)}
          descricao={t('settings.boasVindas.fraseDescricao')}
        >
          {(atributos) => (
            <Input
              {...atributos}
              valor={rascunho.frases[periodo]}
              onMudar={(frase) => alterar({ frases: { ...rascunho.frases, [periodo]: frase } })}
            />
          )}
        </Field>
      ))}

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">{t('settings.boasVindas.midia')}</span>
        <Alternador
          rotulo={t('settings.boasVindas.midia')}
          ligado={rascunho.midiaAtiva}
          desabilitado={!rascunho.midia}
          onMudar={(midiaAtiva) => alterar({ midiaAtiva })}
        />
      </div>
      <p className="text-xs opacity-70">
        {rascunho.midia?.caminho.split(/[\\/]/).pop() ?? t('settings.boasVindas.semMidia')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variante="secundaria"
          desabilitado={ocupado}
          onClick={() => void escolher('arquivo')}
        >
          {t('settings.boasVindas.arquivo')}
        </Button>
        <Button variante="secundaria" desabilitado={ocupado} onClick={() => void escolher('pasta')}>
          {t('settings.boasVindas.pasta')}
        </Button>
        {rascunho.midia && (
          <Button variante="secundaria" desabilitado={ocupado} onClick={() => void escolher(null)}>
            {t('settings.boasVindas.remover')}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button desabilitado={ocupado} onClick={() => void salvar()}>
          {t('settings.boasVindas.salvar')}
        </Button>
        {salvo && (
          <span role="status" className="text-xs opacity-70">
            {t('settings.boasVindas.salvo')}
          </span>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-xs text-[var(--jos-cor-err-leitura)]">
          {erro}
        </p>
      )}
    </section>
  )
}
