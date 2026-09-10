/**
 * Mascote das identidades (SPEC-DesignSystem-05, critérios 6 e 7; README §7, `JARVISOS.md §3.2`).
 *
 * **Um componente, duas identidades** — troca imagem e acento por prop, não por variante. É a
 * prova mais direta da tese "base única, 2 identidades": o mascote é o elemento *mais* marcante
 * de cada espaço e ainda assim não justifica um segundo componente.
 *
 * **Sem motor de voz.** O protótipo fala (`speechSynthesis`) e ouve (`SpeechRecognition`); aqui
 * o mascote só **reflete** `falando`/`ouvindo` que chegam por prop. Voz real é Corte 4 (spec
 * § Fora). A diferença não é de completude, é de contrato: um componente de design system que
 * chamasse a API de voz do navegador teria efeito colateral fora da tela — e não haveria como
 * montá-lo num teste ou numa galeria sem o navegador começar a falar.
 */

import { useEffect, useMemo, useRef } from 'react'
import { identidade, MASCARA_MASCOTE, TILE_MASCOTE } from '../tokens/identidade'
import type { Modulo } from '../tokens/semantic'
import { cx } from './base'
import type { Viseme, VisemeEvent } from '@shared/domain/visemes'
import type { CSSProperties } from 'react'

/**
 * Imagens do bundle. `import` e não caminho em string: o bundler resolve e versiona o arquivo,
 * e um asset que não existe vira erro de build em vez de imagem quebrada em runtime.
 *
 * **512×512 e JPEG nos dois** (F06, hardening): os originais eram 2048²/1024² e somavam 2 MB —
 * três vezes o bundle de JS — para renderizar num círculo de no máximo 160px. O PNG do NOA não
 * tinha canal alfa (o recorte é feito por `mask-image` no CSS), então o formato sem perdas não
 * comprava nada: 304 KB viraram 32 KB. Total: 2043 KB → 77 KB.
 *
 * Moram em `src/design/assets/` — **dentro** do DS. As fontes da F02 vivem em
 * `src/renderer/assets/` e são alcançadas por `url()` no CSS, que o ESLint não inspeciona; o
 * mesmo caminho aqui seria um `import` barrado pela regra de fronteira da F01, e com razão: o
 * mascote **é** parte do design system, não algo que ele vai buscar no renderer. Copiar o
 * arquivo custa 2 MB no repo e mantém a camada fechada.
 */
import jarvisCabeca from '../assets/jarvis-cabeca.jpg'
import noaCabeca from '../assets/noa-cabeca.jpg'

const IMAGEM: Readonly<Record<Modulo, string>> = {
  jarvis: jarvisCabeca,
  noa: noaCabeca
}

const POR_TAMANHO = {
  rail: 'size-10',
  medio: 'size-24',
  grande: 'size-40'
} as const

export type EstadoDoMascote = 'idle' | 'ouvindo' | 'pensando' | 'falando'

export interface PoseDaBoca {
  readonly abertura: number
  readonly largura: number
  readonly intensidade: number
}

const BOCA_FECHADA: PoseDaBoca = { abertura: 0.18, largura: 0.58, intensidade: 0.35 }

export const POSE_DA_BOCA_POR_VISEME: Readonly<Record<Viseme, PoseDaBoca>> = {
  silencio: BOCA_FECHADA,
  pbm: { abertura: 0.08, largura: 0.52, intensidade: 0.25 },
  fv: { abertura: 0.22, largura: 0.7, intensidade: 0.56 },
  th: { abertura: 0.28, largura: 0.74, intensidade: 0.62 },
  dnt: { abertura: 0.24, largura: 0.64, intensidade: 0.52 },
  kg: { abertura: 0.36, largura: 0.6, intensidade: 0.58 },
  ch: { abertura: 0.38, largura: 0.5, intensidade: 0.7 },
  sz: { abertura: 0.16, largura: 0.76, intensidade: 0.48 },
  rr: { abertura: 0.34, largura: 0.68, intensidade: 0.66 },
  aa: { abertura: 1, largura: 0.82, intensidade: 1 },
  ee: { abertura: 0.42, largura: 1, intensidade: 0.82 },
  ih: { abertura: 0.32, largura: 0.92, intensidade: 0.72 },
  oh: { abertura: 0.72, largura: 0.62, intensidade: 0.88 },
  ou: { abertura: 0.58, largura: 0.44, intensidade: 0.8 },
  nasal: { abertura: 0.22, largura: 0.56, intensidade: 0.45 }
}

export function poseDaTimeline(
  visemes: readonly VisemeEvent[],
  posicaoMs: number,
  cursorInicial = 0
): { pose: PoseDaBoca; cursor: number } {
  if (visemes.length === 0) return { pose: BOCA_FECHADA, cursor: 0 }

  let cursor = Math.min(cursorInicial, visemes.length - 1)
  while (cursor > 0 && posicaoMs < visemes[cursor].startMs) cursor--
  while (cursor < visemes.length - 1 && posicaoMs >= visemes[cursor].endMs) cursor++

  const evento = visemes[cursor]
  if (posicaoMs < evento.startMs || posicaoMs >= evento.endMs) {
    return { pose: BOCA_FECHADA, cursor }
  }

  return { pose: POSE_DA_BOCA_POR_VISEME[evento.viseme], cursor }
}

function aplicarPose(el: HTMLElement | null, pose: PoseDaBoca): void {
  if (el === null) return
  el.style.setProperty('--jos-boca-abertura', String(pose.abertura))
  el.style.setProperty('--jos-boca-largura', String(pose.largura))
  el.style.setProperty('--jos-boca-intensidade', String(pose.intensidade))
}

export interface VoiceMascotProps {
  readonly modulo: Modulo
  /**
   * Estado de fala — **reflexo**, nunca comando: o componente não faz falar, ele mostra que
   * está falando. Quem controla o estado é a tela (Corte 4, quando houver TTS).
   */
  readonly falando?: boolean
  readonly ouvindo?: boolean
  readonly estado?: EstadoDoMascote
  readonly visemes?: readonly VisemeEvent[]
  readonly relogioDaFala?: () => number
  readonly tamanho?: keyof typeof POR_TAMANHO
  /**
   * Habilita os estados de fala.
   *
   * Default vem da identidade — `false` no NOA (decisão do PI: o espaço pessoal não fala sem ser
   * chamado). Com `voz={false}`, `falando`/`ouvindo` são **ignorados**: não é um componente que
   * confia em quem chama para não passar a prop errada, é um que recusa o estado.
   */
  readonly voz?: boolean
}

export function VoiceMascot({
  modulo,
  falando = false,
  ouvindo = false,
  estado: estadoControlado,
  visemes = [],
  relogioDaFala,
  tamanho = 'medio',
  voz
}: VoiceMascotProps): React.JSX.Element {
  const id = identidade(modulo)
  const vozAtiva = voz ?? id.vozPadrao

  // Sem voz, os estados não existem — e é aqui que a decisão do PI vira comportamento, em vez de
  // recomendação na spec. Ver o teste do critério 6.
  const fala = vozAtiva && falando
  const escuta = vozAtiva && ouvindo

  const estadoDerivado: EstadoDoMascote = fala ? 'falando' : escuta ? 'ouvindo' : 'idle'
  const estado = vozAtiva ? (estadoControlado ?? estadoDerivado) : 'idle'
  const boca = useRef<HTMLSpanElement | null>(null)
  const cursor = useRef(0)
  const sincronizarBoca = vozAtiva && estado === 'falando' && tamanho !== 'rail'
  const relogio = useMemo(() => relogioDaFala ?? (() => 0), [relogioDaFala])

  useEffect(() => {
    cursor.current = 0
    if (!sincronizarBoca || visemes.length === 0) {
      aplicarPose(boca.current, BOCA_FECHADA)
      return
    }

    let quadro = 0
    const animar = (): void => {
      const atual = poseDaTimeline(visemes, relogio(), cursor.current)
      cursor.current = atual.cursor
      aplicarPose(boca.current, atual.pose)
      quadro = requestAnimationFrame(animar)
    }

    animar()
    return () => {
      cancelAnimationFrame(quadro)
      aplicarPose(boca.current, BOCA_FECHADA)
    }
  }, [relogio, sincronizarBoca, visemes])

  const estiloDaBoca = {
    '--jos-boca-abertura': String(BOCA_FECHADA.abertura),
    '--jos-boca-largura': String(BOCA_FECHADA.largura),
    '--jos-boca-intensidade': String(BOCA_FECHADA.intensidade)
  } as CSSProperties

  return (
    <div
      // O tile **não inverte** no modo claro (critério 7): a imagem é composta com
      // `mix-blend-mode: screen`, que sobre fundo claro a apagaria. Cor literal do token de
      // identidade, não `var(--jos-cor-superficie)`, exatamente porque aquela inverte.
      style={{ backgroundColor: TILE_MASCOTE[modulo] }}
      data-mascote={modulo}
      data-estado={estado}
      className={cx(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full',
        'border border-[rgba(var(--jos-borda-rgb),0.24)]',
        POR_TAMANHO[tamanho],
        'motion-safe:animate-[bob_6s_ease-in-out_infinite]'
      )}
    >
      {/* Anéis: dois sentidos opostos, puramente decorativos — `aria-hidden`. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-[var(--jos-cor-acento)] opacity-40 motion-safe:animate-[spin_18s_linear_infinite]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0.5 rounded-full border border-dotted border-[var(--jos-cor-acento)] opacity-25 motion-safe:animate-[spinr_26s_linear_infinite]"
      />
      {/* Glow do núcleo — respira mais rápido quando fala (protótipo: hue 2.4s vs 9s). */}
      <span
        aria-hidden
        style={{
          boxShadow: '0 0 34px -8px var(--jos-cor-acento)',
          animationDuration: fala ? '2.4s' : '9s'
        }}
        className="pointer-events-none absolute inset-2 rounded-full motion-safe:animate-[corepulse_9s_ease-in-out_infinite]"
      />

      <img
        src={IMAGEM[modulo]}
        // O nome da identidade, não "mascote": quem usa leitor de tela precisa saber **de quem**
        // é o rosto, e "mascote" não diz se estamos no espaço pessoal ou no profissional.
        alt={id.nome}
        className="size-full rounded-full object-cover mix-blend-screen"
        style={{ maskImage: MASCARA_MASCOTE }}
      />

      {vozAtiva && (
        <>
          {/*
           * Boca: existe sempre e **pausa** quando calado (`animation-play-state`), em vez de
           * ser montada/desmontada. Remontar reiniciaria o ciclo a cada palavra, produzindo um
           * salto para o quadro zero.
           */}
          <span
            aria-hidden
            ref={boca}
            style={{ ...estiloDaBoca, transitionDuration: '50ms' }}
            data-boca
            className={cx(
              'pointer-events-none absolute bottom-[21%] grid h-[13%] w-[24%] place-items-end',
              'transition-[width,opacity] ease-linear'
            )}
          >
            <span
              style={{ transitionDuration: '50ms' }}
              className={cx(
                'block h-[calc(var(--jos-boca-abertura)*100%)] w-[calc(var(--jos-boca-largura)*100%)]',
                'rounded-b-full rounded-t-[var(--jos-raio-sm)] bg-[var(--jos-cor-acento)]',
                'opacity-[var(--jos-boca-intensidade)] shadow-[0_0_12px_-3px_var(--jos-cor-acento)]',
                'transition-[height,width,opacity] ease-linear'
              )}
            />
            <span className="absolute inset-x-[18%] bottom-[22%] h-px bg-[rgba(var(--jos-borda-rgb),0.72)] opacity-[var(--jos-boca-intensidade)]" />
            <span className="absolute inset-x-[24%] bottom-[45%] h-px bg-[rgba(var(--jos-borda-rgb),0.5)] opacity-[var(--jos-boca-intensidade)]" />
          </span>
          <span
            aria-hidden
            data-olhos
            style={{
              animationDuration:
                estado === 'falando' ? '1.9s' : estado === 'pensando' ? '4.2s' : '7s',
              opacity: estado === 'falando' ? 1 : estado === 'pensando' ? 0.55 : 0.75
            }}
            className="pointer-events-none absolute top-[38%] h-[4%] w-[34%] motion-safe:animate-[eyeblink_7s_ease-in-out_infinite]"
          />
        </>
      )}

      {/*
       * O estado em texto, para leitor de tela. `aria-live="polite"`: mudança de estado do
       * mascote é informação de contexto, não interrupção — quem está lendo outra coisa termina
       * a frase antes de ouvir "ouvindo".
       *
       * Sem isto o mascote seria pura decoração: alguém que não vê o anel pulsando não teria
       * como saber que o sistema está escutando — e "está me ouvindo agora?" é exatamente a
       * pergunta que o estado precisa responder.
       */}
      <span aria-live="polite" className="sr-only">
        {estado === 'falando'
          ? `${id.nome} está falando`
          : estado === 'ouvindo'
            ? `${id.nome} está ouvindo`
            : estado === 'pensando'
              ? `${id.nome} está pensando`
              : `${id.nome} em repouso`}
      </span>
    </div>
  )
}
