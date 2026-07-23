import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi } from '@design/tokens/semantic'
import { Card, Meter, Separator, Table } from '@design/ui'
import { StatusOperacional } from '@design/patterns'

/**
 * Tela **JARVIS · HUD** (`JARVISOS.md §4`) — terceira da jornada de prova da F06.
 *
 * Prova a identidade JARVIS **densa** em claro e escuro (critério 2). É o contraponto da NOA
 * Hoje: onde aquela é espaçada e calma, esta é apertada e numérica — e o teste da base única é
 * as duas saírem dos **mesmos** componentes e tokens.
 *
 * Telemetria com `Meter` (barras CPU/RAM/GPU/DISK) e as linhas de sistema com `Table`. Os
 * números usam `tabular-nums`, que a F03b introduziu: dígitos de largura fixa não "dançam" quando
 * o valor muda, e num HUD que atualiza isso é a diferença entre ler e perseguir.
 */

interface Telemetria {
  readonly nome: string
  readonly valor: number
}

const TELEMETRIA: readonly Telemetria[] = [
  { nome: 'CPU', valor: 34 },
  { nome: 'RAM', valor: 61 },
  { nome: 'GPU', valor: 18 },
  { nome: 'DISK', valor: 82 }
]

const SISTEMA: readonly (readonly [string, string])[] = [
  ['Uptime', '4d 12h 08m'],
  ['Agentes ativos', '6'],
  ['Triggers', '14'],
  ['Memória indexada', '2.4 GB'],
  ['Modo', 'Autônomo']
]

/**
 * Faixas do `Meter` — o que cada nível significa **nesta** medida.
 *
 * Em telemetria de recurso, alto é ruim: 82% de disco é o alerta, não a conquista. É por isso
 * que as faixas são dado e não `if` embutido no componente — 80% de meta de passos (tela do NOA)
 * é exatamente o contrário.
 */
const FAIXAS_DE_RECURSO = [
  { ate: 60, tom: 'ok' as const },
  { ate: 80, tom: 'warn' as const },
  { ate: 100, tom: 'err' as const }
]

export function JarvisHud({
  uiTheme,
  acento
}: {
  readonly uiTheme: ModoUi
  readonly acento?: CorAcento
}): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={uiTheme}
      modulo="jarvis"
      superficie="jarvis"
      accentJarvis={acento ?? '#FF5C00'}
      accentNoa="#C4C4C4"
    >
      <div
        data-jornada="jarvis-hud"
        className="min-h-screen bg-[var(--jos-cor-superficie)] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <header className="flex items-center justify-between gap-4">
            <h1 className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-tela)]">
              HUD
            </h1>
            <StatusOperacional estado="ativo" rotulo="Runtime" descricao="heartbeat 1.2s" />
          </header>

          <Card titulo="Telemetria">
            <div className="flex flex-col gap-4" data-jornada-telemetria>
              {TELEMETRIA.map((item) => (
                <Meter
                  key={item.nome}
                  valor={item.valor}
                  maximo={100}
                  rotulo={item.nome}
                  faixas={FAIXAS_DE_RECURSO}
                />
              ))}
            </div>
          </Card>

          <Separator />

          <Card titulo="Sistema">
            <Table
              legenda="Estado do sistema"
              chaveDaLinha={(linha) => linha.indicador}
              colunas={[
                {
                  chave: 'indicador',
                  cabecalho: 'Indicador',
                  celula: (linha) => linha.indicador
                },
                {
                  chave: 'valor',
                  cabecalho: 'Valor',
                  // `numerica` alinha à direita: valores leem melhor alinhados pela unidade.
                  numerica: true,
                  celula: (linha) => linha.valor
                }
              ]}
              linhas={SISTEMA.map(([indicador, valor]) => ({ indicador, valor }))}
            />
          </Card>
        </div>
      </div>
    </ProvedorDeTema>
  )
}
