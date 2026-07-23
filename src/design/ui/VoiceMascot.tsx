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

import { identidade, MASCARA_MASCOTE, TILE_MASCOTE } from '../tokens/identidade'
import type { Modulo } from '../tokens/semantic'
import { cx } from './base'

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

export interface VoiceMascotProps {
  readonly modulo: Modulo
  /**
   * Estado de fala — **reflexo**, nunca comando: o componente não faz falar, ele mostra que
   * está falando. Quem controla o estado é a tela (Corte 4, quando houver TTS).
   */
  readonly falando?: boolean
  readonly ouvindo?: boolean
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
  tamanho = 'medio',
  voz
}: VoiceMascotProps): React.JSX.Element {
  const id = identidade(modulo)
  const vozAtiva = voz ?? id.vozPadrao

  // Sem voz, os estados não existem — e é aqui que a decisão do PI vira comportamento, em vez de
  // recomendação na spec. Ver o teste do critério 6.
  const fala = vozAtiva && falando
  const escuta = vozAtiva && ouvindo

  const estado = fala ? 'falando' : escuta ? 'ouvindo' : 'parado'

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
            style={{ animationPlayState: fala ? 'running' : 'paused' }}
            className="pointer-events-none absolute bottom-[22%] h-[6%] w-[18%] rounded-full bg-[var(--jos-cor-acento)] opacity-70 motion-safe:animate-[talk_420ms_ease-in-out_infinite]"
          />
          <span
            aria-hidden
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
            : `${id.nome} em repouso`}
      </span>
    </div>
  )
}
