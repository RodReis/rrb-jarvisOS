import { useEffect, useRef, useState } from 'react'
import { ProvedorDeTema } from '@design/tokens/provider'
import { identidade } from '@design/tokens/identidade'
import { ACENTO_PADRAO, type CorAcento } from '@design/tokens/acento'
import type { Modulo } from '@design/tokens/semantic'
import { VoiceMascot } from '@design/ui'

/**
 * Overlay de transição CHOICE → espaço (SPEC-CHOICE-01, critérios 9 e 10).
 *
 * O overlay de marca que roda entre escolher um card e o espaço abrir. `superficie='transicao'`
 * já está em `SUPERFICIES_DE_MARCA`, então **não inverte** no tema claro.
 *
 * **Não é gate da navegação** (critério 10). Este é o ponto delicado, e a lição da F06 —
 * *"reveal animations must enhance an already-visible default"*: quem pediu `prefers-reduced-motion`
 * entra no espaço **sem esperar**, e a navegação acontece de todo jeito. Como se garante isso sem
 * ler `matchMedia` (que não funciona em teste headless): o `setTimeout` que confirma a entrada é
 * armado **independente** da animação. Se a folha de estilo zera a duração (o bloco
 * `prefers-reduced-motion` do DS faz isso), o overlay some no mesmo frame, mas o timer que chama
 * `onConcluir` já estava correndo — a chegada ao destino nunca dependeu do CSS ter animado.
 *
 * O timer é **curto** (a duração da animação), não o tempo de uma animação "bonita": transição de
 * produto conduz ao destino, não faz o usuário assisti-la.
 */

/** Duração do overlay antes de confirmar a entrada. Curta — é condução, não espetáculo. */
const DURACAO_MS = 620

export function TransicaoDeMarca({
  modulo,
  acento,
  onConcluir
}: {
  readonly modulo: Modulo
  readonly acento: CorAcento
  readonly onConcluir: () => void
}): React.JSX.Element {
  const { nome } = identidade(modulo)
  // `onConcluir` num ref para o efeito abaixo rodar **uma vez** (deps vazias) sem rearmar o timer
  // quando o pai recria a função entre renders. O ref é sincronizado num efeito próprio, não
  // durante o render — escrever `ref.current` no corpo é o anti-padrão que a regra do DS barra.
  const concluir = useRef(onConcluir)
  useEffect(() => {
    concluir.current = onConcluir
  }, [onConcluir])

  const [saindo, setSaindo] = useState(false)

  useEffect(() => {
    // O timer é a fonte da verdade da navegação — independente de a animação ter rodado. Com
    // reduced-motion o overlay já sumiu, mas a entrada acontece aqui de todo jeito.
    const t = window.setTimeout(() => {
      setSaindo(true)
      concluir.current()
    }, DURACAO_MS)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <ProvedorDeTema
      superficie="transicao"
      modulo={modulo}
      uiTheme="dark"
      accentJarvis={modulo === 'jarvis' ? acento : ACENTO_PADRAO.jarvis}
      accentNoa={modulo === 'noa' ? acento : ACENTO_PADRAO.noa}
    >
      <div
        // `aria-hidden`: é uma cortina visual entre duas telas reais. O leitor de tela anuncia o
        // destino (a tela que chega), não a transição.
        aria-hidden
        data-jos-tela="transicao"
        className={`pointer-events-none fixed inset-0 z-[var(--jos-camada-overlay)] grid place-items-center bg-[#060708] transition-opacity duration-[var(--jos-duracao-media)] ${saindo ? 'opacity-0' : 'opacity-100'}`}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--jos-cor-acento) 12%, transparent) 0%, transparent 60%)'
          }}
        />
        <div className="relative flex flex-col items-center gap-6 motion-safe:animate-[riseIn_var(--jos-duracao-media)_ease_both]">
          <div className="relative grid size-[112px] place-items-center">
            <span className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-[color-mix(in_srgb,var(--jos-cor-acento)_35%,transparent)] motion-safe:animate-[spin_20s_linear_infinite]" />
            <VoiceMascot modulo={modulo} tamanho="medio" voz={false} />
          </div>
          <span className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] tracking-[6px] text-[var(--jos-cor-texto)]">
            {nome}
          </span>
        </div>
      </div>
    </ProvedorDeTema>
  )
}
