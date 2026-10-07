import { ProvedorDeTema, FundoDaIdentidade } from '@design/tokens/provider'
import type { ModoUi } from '@design/tokens/semantic'
import type { JarvisBridge } from '@shared/contracts/ipc'
import type { PainelDaTarefa as Modelo } from '@shared/domain/painel-tarefa'
import { PainelDaTarefa } from '../app/PainelDaTarefa'

const painel: Modelo = {
  projectId: 'prova',
  runId: 'run-2026',
  workspace: 'jarvis',
  estado: 'ativo',
  snapshotsCompletos: false,
  tarefas: [
    {
      tarefaId: 'writer-1',
      papel: 'Escritor',
      estado: 'em-execucao',
      iniciadoEm: '2026-10-07T18:00:00.000Z',
      atualizadoEm: '2026-10-07T18:03:00.000Z',
      dependencias: ['worker-1'],
      camada: 'especialista',
      escritor: 'escritor-1',
      paths: ['src/main/pipeline/painel.ts', 'src/renderer/src/app/Painel.tsx'],
      regraDeConclusao: 'testes passam e o escopo continua válido',
      traces: [],
      snapshots: [
        {
          id: 'arquivo-1',
          caminho: 'src/main/pipeline/painel.ts',
          sha256: 'a'.repeat(64),
          bytes: 82,
          tipo: 'texto',
          estado: 'disponivel'
        },
        {
          id: 'arquivo-2',
          caminho: 'assets/icon.bin',
          sha256: 'b'.repeat(64),
          bytes: 1024,
          tipo: 'binario',
          estado: 'disponivel'
        }
      ],
      diffs: [
        {
          id: 'diff-1',
          caminho: 'src/main/pipeline/painel.ts',
          sha256: 'c'.repeat(64),
          bytes: 54,
          estado: 'disponivel'
        }
      ]
    }
  ],
  plano: [{ tarefaId: 'writer-1', papel: 'Escritor', dependencias: ['worker-1'] }],
  arquivosDeTeste: [],
  conteudosDeTeste: [],
  traces: {
    'trace-1': [{ tipo: 'texto', delta: 'Vou persistir eventos, snapshots e diffs com escopo.' }]
  },
  eventosDeTarefa: {},
  tracesPorTarefa: {},
  atualizadoEm: '2026-10-07T18:03:00.000Z'
}

window.jarvis = {
  painelDaTarefa: async () => painel,
  painelDaTarefaConteudo: async () =>
    'export const maximoPorArquivo = 10 * 1024 * 1024\nexport const maximoPorRun = 50 * 1024 * 1024\n',
  onSquadTaskEvent: () => () => {}
} as unknown as JarvisBridge

export function GaleriaDoPainelDaTarefa({ modo }: { readonly modo: ModoUi }): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo="jarvis"
      superficie="jarvis"
      accentJarvis="#C4C4C4"
      accentNoa="#C4C4C4"
    >
      <FundoDaIdentidade className="min-h-screen font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]">
        <main
          data-testid="galeria-painel-tarefa"
          className="min-h-screen bg-[var(--jos-cor-fundo)] p-6"
        >
          <div className="mx-auto max-w-5xl">
            <h1 className="mb-4 text-lg font-semibold">Quadro de execução · #378</h1>
            <PainelDaTarefa runId="run-2026" workspace="jarvis" onFechar={() => {}} />
          </div>
        </main>
      </FundoDaIdentidade>
    </ProvedorDeTema>
  )
}
