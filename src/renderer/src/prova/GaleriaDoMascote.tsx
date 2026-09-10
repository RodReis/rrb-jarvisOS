import { ProvedorDeTema, FundoDaIdentidade } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi } from '@design/tokens/semantic'
import { VoiceMascot } from '@design/ui'
import { POSE_DA_BOCA_POR_VISEME } from '@design/ui'
import { VISEMES } from '@shared/domain/visemes'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly acento?: CorAcento
}

export function GaleriaDoMascote({ modo, acento }: GaleriaProps): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo="jarvis"
      superficie="jarvis"
      accentJarvis={acento ?? '#C4C4C4'}
      accentNoa="#C4C4C4"
    >
      <FundoDaIdentidade className="min-h-screen p-6 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-8" data-testid="galeria-mascote">
          <section className="grid grid-cols-4 gap-4" data-prova="estados">
            {(['idle', 'ouvindo', 'pensando', 'falando'] as const).map((estado) => (
              <div
                key={estado}
                className="flex items-center gap-3 border border-[rgba(var(--jos-borda-rgb),0.18)] p-4"
                data-estado-card={estado}
              >
                <VoiceMascot
                  modulo="jarvis"
                  tamanho="medio"
                  estado={estado}
                  visemes={[{ viseme: 'aa', startMs: 0, endMs: 100 }]}
                  relogioDaFala={() => 50}
                />
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
                  {estado}
                </span>
              </div>
            ))}
          </section>

          <section className="grid grid-cols-5 gap-4" data-prova="visemes">
            {VISEMES.map((viseme) => (
              <div
                key={viseme}
                className="flex flex-col items-center gap-2 border border-[rgba(var(--jos-borda-rgb),0.18)] p-3"
                data-viseme={viseme}
                data-pose={JSON.stringify(POSE_DA_BOCA_POR_VISEME[viseme])}
              >
                <VoiceMascot
                  modulo="jarvis"
                  tamanho="medio"
                  estado="falando"
                  visemes={[{ viseme, startMs: 0, endMs: 100 }]}
                  relogioDaFala={() => 50}
                />
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                  {viseme}
                </span>
              </div>
            ))}
          </section>
        </div>
      </FundoDaIdentidade>
    </ProvedorDeTema>
  )
}
