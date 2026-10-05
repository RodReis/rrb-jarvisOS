import { ProvedorDeTema, FundoDaIdentidade } from '@design/tokens/provider'
import type { ModoUi } from '@design/tokens/semantic'
import { TopBar } from '@design/patterns'
import type { JarvisBridge } from '@shared/contracts/ipc'
import type { EstadoDaEscuta } from '@shared/domain/voz'
import { EscutaDaVoz } from '../app/EscutaDaVoz'
import { PreferenciasDaEscuta } from '../app/PreferenciasDaEscuta'

/**
 * Galeria de prova da escuta contínua (SPEC-Escuta-01, critérios 8 e 9).
 *
 * Cada cena é um **estado que muda o que o PI lê de relance** na barra superior: ligada,
 * desligada, indisponível (sem modelo) e sem microfone (a escuta quer ouvir e o stream não abriu).
 * Mais a seção de Settings, onde moram gatilhos, limiar, atalho e teste ao vivo.
 *
 * Sem ponte real: um dublê por cena e uma captura que abre ou recusa por script. O que só existe
 * aqui é o layout — o texto do indicador cabendo ao lado do botão, o contraste do estado, o anel
 * de foco —, que jsdom não mede.
 */

export type CenaDaEscuta = 'ligada' | 'desligada' | 'indisponivel' | 'sem-microfone' | 'settings'

const BASE: EstadoDaEscuta = {
  ativa: true,
  disponivel: true,
  frase: true,
  palmas: true,
  sensibilidade: 0.5,
  hotkey: 'Control+Alt+M',
  hotkeyRegistrada: true
}

const ESTADO_POR_CENA: Readonly<Record<CenaDaEscuta, EstadoDaEscuta>> = {
  ligada: BASE,
  desligada: { ...BASE, ativa: false },
  indisponivel: { ...BASE, ativa: false, disponivel: false },
  'sem-microfone': BASE,
  settings: { ...BASE, palmas: false, hotkeyRegistrada: false }
}

function ponteDaProva(cena: CenaDaEscuta): JarvisBridge {
  const estado = ESTADO_POR_CENA[cena]
  return {
    estadoDaEscuta: async () => estado,
    definirEscutaAtiva: async () => ({ ok: true as const }),
    definirGatilhosDaEscuta: async () => estado,
    definirSensibilidadeDaEscuta: async () => estado,
    definirModoDeTesteDaEscuta: async () => estado,
    definirHotkeyDaEscuta: async () => estado,
    enviarPcmDaEscuta: () => {},
    informarTurnoDaEscuta: () => {},
    onEscutaMudou: () => () => {},
    onEscutaDisparo: () => () => {},
    onEscutaTeste: () => () => {},
    sendLog: () => {}
  } as unknown as JarvisBridge
}

/**
 * Instala a ponte da cena. Fora do componente, como na galeria do Command Center: atribuir a
 * `window` durante o render é efeito colateral, e a fábrica do entrypoint é o lugar dele.
 */
export function prepararPonteDaEscuta(cena: CenaDaEscuta): void {
  window.jarvis = ponteDaProva(cena)
}

export function GaleriaDaEscuta({
  modo,
  cena
}: {
  readonly modo: ModoUi
  readonly cena: CenaDaEscuta
}): React.JSX.Element {
  // A captura da prova abre sempre, exceto na cena em que o microfone é recusado.
  const abrirCaptura = async (): Promise<{
    parar: () => Promise<void>
    nivelRms: () => number
    iniciarTurno: () => {
      capturar: () => Promise<() => Promise<Int16Array>>
      cancelar: () => void
    }
  }> => {
    if (cena === 'sem-microfone') throw new DOMException('negado', 'NotAllowedError')
    return {
      parar: async () => undefined,
      nivelRms: () => 0,
      iniciarTurno: () => ({
        capturar: async () => async () => new Int16Array(),
        cancelar: () => undefined
      })
    }
  }

  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo="jarvis"
      superficie="jarvis"
      accentJarvis="#C4C4C4"
      accentNoa="#C4C4C4"
    >
      <FundoDaIdentidade className="min-h-screen font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]">
        <main data-testid="galeria-escuta" data-cena={cena}>
          {cena === 'settings' ? (
            <div className="mx-auto max-w-md p-6">
              <PreferenciasDaEscuta />
            </div>
          ) : (
            <TopBar
              titulo="JARVIS OS"
              uiTheme={modo}
              onAlternarTema={() => {}}
              rotuloTema="Alternar tema"
            >
              <EscutaDaVoz aoDisparar={() => {}} abrirCaptura={abrirCaptura} />
            </TopBar>
          )}
        </main>
      </FundoDaIdentidade>
    </ProvedorDeTema>
  )
}
