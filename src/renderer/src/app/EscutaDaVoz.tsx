import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff } from 'lucide-react'
import type { DisparoDaEscuta, EstadoDaEscuta } from '@shared/domain/voz'
import { abrirCapturaContinua, type CapturaContinua, type CapturaDoTurno } from './captura-continua'
import { log } from '../lib/log'

/**
 * O indicador permanente e o kill switch da escuta contínua (SPEC-Escuta-01, critérios 8 e 9).
 *
 * ## Dono da captura
 *
 * O main decide **se** a escuta está ligada; o microfone, porém, é do renderer (`getUserMedia` é
 * Web API). Este componente é a ponte entre os dois: quando o estado diz `ativa`, abre o stream
 * e manda o PCM; quando deixa de dizer — por clique aqui, pela hotkey de mute ou por qualquer
 * outro caminho —, **encerra as trilhas**. Vive na barra superior e não numa rota, porque a escuta
 * é global aos dois espaços e o controle tem de estar sempre à mão (não enterrado em Settings).
 *
 * ## O indicador não mente
 *
 * "Escuta ligada" só aparece com o stream **de fato aberto**. Estado `ativa` sem microfone (negado,
 * ausente) vira "Microfone não abriu", com a próxima ação: microfone aberto em silêncio visual é
 * defeito, mas indicador de ouvindo sobre microfone fechado também é.
 *
 * O estado sai por texto, ícone e forma — nunca só pela cor do ponto (princípio 2 do produto).
 */

/** Um disparo entregue ao shell, com identidade própria para ser tratado uma única vez. */
export type DisparoRecebido = DisparoDaEscuta & {
  readonly id: number
  readonly capturaDoTurno: CapturaDoTurno
}

type Visao = 'ligada' | 'ligando' | 'desligada' | 'indisponivel' | 'sem-microfone'

export function EscutaDaVoz({
  entradaId,
  aoDisparar,
  abrirCaptura = abrirCapturaContinua
}: {
  /** O dispositivo escolhido na F05; sem ele, o padrão do sistema. */
  readonly entradaId?: string | null
  /** Quem conduz o turno de conversa quando um gatilho dispara. */
  readonly aoDisparar: (disparo: DisparoDaEscuta, capturaDoTurno: CapturaDoTurno) => void
  /** Injetada para teste: `getUserMedia` não existe em jsdom. */
  readonly abrirCaptura?: typeof abrirCapturaContinua
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [estado, setEstado] = useState<EstadoDaEscuta | undefined>(undefined)
  const [capturando, setCapturando] = useState(false)
  const [falhouAoAbrir, setFalhouAoAbrir] = useState(false)
  const [motivoDaRecusa, setMotivoDaRecusa] = useState<string | undefined>(undefined)
  const capturaAtual = useRef<CapturaContinua | undefined>(undefined)

  // O disparo chega por assinatura estável; quem conduz o turno muda a cada render do shell.
  const aoDispararAtual = useRef(aoDisparar)
  useEffect(() => {
    aoDispararAtual.current = aoDisparar
  })

  useEffect(() => {
    let vivo = true
    void window.jarvis.estadoDaEscuta().then((e) => {
      if (vivo) setEstado(e)
    })
    const cancelarEstado = window.jarvis.onEscutaMudou(setEstado)
    const cancelarDisparo = window.jarvis.onEscutaDisparo((d) => {
      const captura = capturaAtual.current
      if (!captura) {
        window.jarvis.informarTurnoDaEscuta(false)
        return
      }
      const turno = captura.iniciarTurno()
      log.ui.info('Turno da escuta reservado', {
        gatilho: d.gatilho,
        latenciaAteReservaMs: Math.max(0, Date.now() - (d.fimDoGatilhoMs ?? Date.now()))
      })
      aoDispararAtual.current(d, turno)
    })
    return () => {
      vivo = false
      cancelarEstado()
      cancelarDisparo()
    }
  }, [])

  const ativa = estado?.ativa ?? false

  useEffect(() => {
    if (!ativa) return

    let cancelado = false
    let captura: CapturaContinua | undefined

    abrirCaptura(entradaId ?? undefined, (bloco) => window.jarvis.enviarPcmDaEscuta(bloco))
      .then((aberta) => {
        // O stream que chega depois de o estado ter mudado nasce condenado: sem este `parar`, a
        // permissão demorada deixaria o microfone aberto sem ninguém para fechá-lo.
        if (cancelado) {
          void aberta.parar()
          return
        }
        captura = aberta
        capturaAtual.current = aberta
        setFalhouAoAbrir(false)
        setCapturando(true)
      })
      .catch((erro: unknown) => {
        if (cancelado) return
        setFalhouAoAbrir(true)
        log.ui.warn('A escuta não conseguiu abrir o microfone', {
          motivo: erro instanceof Error ? erro.name : 'desconhecido'
        })
      })

    return () => {
      cancelado = true
      if (capturaAtual.current === captura) capturaAtual.current = undefined
      setCapturando(false)
      void captura?.parar()
    }
  }, [ativa, entradaId, abrirCaptura])

  if (estado === undefined) return null

  const visao: Visao = ativa
    ? capturando
      ? 'ligada'
      : falhouAoAbrir
        ? 'sem-microfone'
        : 'ligando'
    : estado.disponivel
      ? 'desligada'
      : 'indisponivel'

  async function alternar(): Promise<void> {
    setMotivoDaRecusa(undefined)
    try {
      const desfecho = await window.jarvis.definirEscutaAtiva(!ativa)
      if (!desfecho.ok) {
        setMotivoDaRecusa(
          desfecho.motivo === 'MODELO_AUSENTE'
            ? t('escuta.recusaModelo')
            : t('escuta.recusaEntrada')
        )
      }
      setEstado(await window.jarvis.estadoDaEscuta())
    } catch (erro) {
      log.ui.error('Falha ao alternar a escuta', { erro })
      setMotivoDaRecusa(t('escuta.recusaEntrada'))
    }
  }

  const TEXTO: Record<Visao, string> = {
    ligada: t('escuta.ligada'),
    ligando: t('escuta.ligando'),
    desligada: t('escuta.desligada'),
    indisponivel: t('escuta.indisponivel'),
    'sem-microfone': t('escuta.semMicrofone')
  }
  const DICA: Partial<Record<Visao, string>> = {
    indisponivel: t('escuta.dicaIndisponivel'),
    'sem-microfone': t('escuta.dicaSemMicrofone')
  }
  const ouvindo = visao === 'ligada'
  const problema = visao === 'sem-microfone'

  return (
    <div role="group" aria-label={t('escuta.grupo')} className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={ativa}
        disabled={visao === 'indisponivel'}
        onClick={() => void alternar()}
        title={DICA[visao] ?? t('escuta.dicaAlternar')}
        className="inline-flex h-9 items-center gap-2 rounded-[var(--jos-raio-chip-largo)] border border-[rgba(var(--jos-borda-rgb),0.18)] px-3 text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)] outline-none hover:bg-[rgba(var(--jos-borda-rgb),0.08)] focus-visible:ring-1 focus-visible:ring-[var(--jos-cor-acento)] disabled:opacity-60"
      >
        {ativa ? <Mic size={16} aria-hidden /> : <MicOff size={16} aria-hidden />}
        {t('escuta.rotulo')}
      </button>
      <span
        role="status"
        title={DICA[visao]}
        className={`inline-flex items-center gap-1.5 text-[length:var(--jos-texto-mini)] ${
          problema ? 'text-[var(--jos-cor-err-leitura)]' : 'text-[var(--jos-cor-texto-suave)]'
        }`}
      >
        <span
          aria-hidden
          className={`size-2 rounded-full ${
            ouvindo
              ? 'bg-[var(--jos-cor-ok)] motion-safe:animate-pulse'
              : problema
                ? 'bg-[var(--jos-cor-err)]'
                : 'border border-[var(--jos-cor-texto-suave)]'
          }`}
        />
        {TEXTO[visao]}
      </span>
      {motivoDaRecusa !== undefined && (
        <p
          role="alert"
          className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-err-leitura)]"
        >
          {motivoDaRecusa}
        </p>
      )}
    </div>
  )
}
