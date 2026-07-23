import { useState } from 'react'
import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi } from '@design/tokens/semantic'
import { Card, Checkbox, Meter, Panel } from '@design/ui'

/**
 * Tela **NOA · Hoje** (`NOA.md §3.1`) — segunda da jornada de prova da F06.
 *
 * Prova a identidade NOA **em claro e escuro** (critério 2), com o tom calmo do espaço pessoal:
 * saudação, agenda, hábitos com toggle e saúde resumida. Diferente da CHOICE, esta é tela
 * interna — responde ao `uiTheme`.
 *
 * Composta **só** com componentes públicos (critério 1). Onde faltou peça, a resposta foi usar a
 * que existe em vez de escrever CSS local: os cards de saúde são `Panel`, o progresso de passos
 * é `Meter`, os hábitos são `Checkbox`. Nenhum `<div>` com cor ou espaçamento fora dos tokens.
 *
 * Os dados são mock por props — a spec é explícita: *"prova de composição, não a entrega das
 * telas de produto finais"*.
 */

export interface AgendaItem {
  readonly hora: string
  readonly titulo: string
}

export interface Habito {
  readonly id: string
  readonly nome: string
  readonly feito: boolean
}

const AGENDA: readonly AgendaItem[] = [
  { hora: '09:00', titulo: 'Revisão médica anual' },
  { hora: '15:00', titulo: 'Foco profundo — sem notificações' },
  { hora: '19:30', titulo: 'Treino — inferiores' }
]

const HABITOS_INICIAIS: readonly Habito[] = [
  { id: 'treino', nome: 'Treino de força', feito: true },
  { id: 'leitura', nome: 'Leitura 30 min', feito: false },
  { id: 'meditacao', nome: 'Meditação', feito: false },
  { id: 'agua', nome: 'Água 3L', feito: true }
]

export function NoaHoje({
  uiTheme,
  acento
}: {
  readonly uiTheme: ModoUi
  readonly acento?: CorAcento
}): React.JSX.Element {
  const [habitos, setHabitos] = useState<readonly Habito[]>(HABITOS_INICIAIS)

  function alternar(id: string): void {
    setHabitos((atual) => atual.map((h) => (h.id === id ? { ...h, feito: !h.feito } : h)))
  }

  return (
    <ProvedorDeTema
      uiTheme={uiTheme}
      modulo="noa"
      superficie="noa"
      accentNoa={acento ?? '#C4C4C4'}
      accentJarvis="#FF5C00"
    >
      <div
        data-jornada="noa-hoje"
        className="min-h-screen bg-[var(--jos-cor-superficie)] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-1">
            {/* Saudação estática: `new Date()` deixaria a captura da prova visual diferente a
                cada execução, e a tela é prova de composição — não de relógio. */}
            <h1 className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-tela)]">
              Bom dia, Operador.
            </h1>
            <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
              Quinta, 23 de julho
            </span>
          </header>

          <Card titulo="Agenda de hoje">
            <ul className="flex flex-col gap-3">
              {AGENDA.map((item) => (
                <li key={item.hora} className="flex items-baseline gap-3">
                  <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-acento-leitura)]">
                    {item.hora}
                  </span>
                  <span className="text-[length:var(--jos-texto-corpo)]">{item.titulo}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card titulo="Hábitos">
            <div className="flex flex-col gap-2" data-jornada-habitos>
              {habitos.map((habito) => (
                <Checkbox
                  key={habito.id}
                  rotulo={habito.nome}
                  marcado={habito.feito}
                  onMudar={() => alternar(habito.id)}
                />
              ))}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            <Panel titulo="Sono ontem">
              <p className="text-[length:var(--jos-texto-realce)] tabular-nums">7h20</p>
            </Panel>
            <Panel titulo="Passos hoje">
              {/* `Meter` e não uma barra local: o valor **e** a meta ficam legíveis, e o número
                  ao lado é o sinal não-cromático que o critério 5 pede. */}
              <Meter valor={6400} maximo={8000} rotulo="Passos hoje" />
            </Panel>
            <Panel titulo="Sequência">
              <p className="text-[length:var(--jos-texto-realce)] tabular-nums">5 dias</p>
            </Panel>
          </div>
        </div>
      </div>
    </ProvedorDeTema>
  )
}
