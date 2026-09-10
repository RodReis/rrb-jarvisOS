import { ProvedorDeTema, FundoDaIdentidade } from '@design/tokens/provider'
import type { ModoUi } from '@design/tokens/semantic'
import type { JarvisBridge } from '@shared/contracts/ipc'
import { Microfone } from '../app/Microfone'

const ponteDaProva = {
  prontidaoDaVoz: async () => ({ pronta: true, faltando: [], compute: 'cuda' as const }),
  baixarArtefatoDeVoz: async () => ({ estado: 'ok' as const }),
  transcreverAudio: async () => ({ estado: 'sem-audio' as const }),
  perguntarAoJarvis: async () => ({ estado: 'ok' as const, resposta: 'Sistemas operacionais.' }),
  historicoDaConversa: async () => [
    { pergunta: 'Qual o estado do sistema?', resposta: 'Todos os serviços locais respondendo.' }
  ],
  falar: async () => ({ estado: 'indisponivel' as const }),
  onVozHotkey: () => () => {},
  sendLog: () => {}
} as unknown as JarvisBridge

window.jarvis = ponteDaProva

const capturaDaProva = async (): Promise<() => Promise<Int16Array>> => async () =>
  new Int16Array(16_000)

const reprodutorDaProva = () => ({
  cancelar: () => {},
  tocar: () => ({
    cancelar: () => {},
    posicaoMs: () => 0,
    terminou: Promise.resolve(),
    saidaAplicada: Promise.resolve(true),
    nivelRms: () => 2_000
  })
})

export function GaleriaDoCommandCenter({ modo }: { readonly modo: ModoUi }): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo="jarvis"
      superficie="jarvis"
      accentJarvis="#C4C4C4"
      accentNoa="#C4C4C4"
    >
      <FundoDaIdentidade className="min-h-screen p-6 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]">
        <main data-testid="galeria-command-center">
          <Microfone
            workspace="jarvis"
            vozDaFala="pt_BR-faber-medium"
            entradaId="headset-prova"
            saidaId="saida-prova"
            capturar={capturaDaProva}
            criarFala={reprodutorDaProva}
          />
        </main>
      </FundoDaIdentidade>
    </ProvedorDeTema>
  )
}
