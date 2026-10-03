import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { App } from './App'

/**
 * Helpers de teste do fluxo de sessão (SPEC-CHOICE-01).
 *
 * Depois que a CHOICE virou a porta de entrada, montar `<App />` já não cai no shell: cai na
 * CHOICE. As suítes do shell (`AppShell.test.tsx`, `shell-navegacao.test.tsx`) provam o shell,
 * não a jornada de entrada — então precisam **atravessar** a CHOICE antes de asseverar. Este
 * helper concentra essa travessia num lugar só; as asserções de cada suíte ficam intactas.
 *
 * O espaço de entrada default é `jarvis`, que era o destino do fluxo antigo ("abre sempre no
 * JARVIS") — assim a maioria das asserções não muda de espaço, só de caminho.
 */

/**
 * Os métodos da escuta contínua (SPEC-Escuta-01) para dublês da ponte.
 *
 * O `AppShell` monta o controle da escuta em toda tela e consulta o estado ao montar, então todo
 * teste que monta o shell precisa destes seis — sem eles o primeiro efeito estoura antes de o
 * teste chegar ao que mede. O estado devolvido é "desligada e indisponível": não abre captura
 * nenhuma, que é o que um teste que não é sobre a escuta quer.
 */
export function pontaDaEscuta(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    estadoDaEscuta: vi.fn(async () => ({
      ativa: false,
      disponivel: false,
      frase: true,
      palmas: true,
      sensibilidade: 0.5
    })),
    definirEscutaAtiva: vi.fn(async () => ({ ok: true })),
    enviarPcmDaEscuta: vi.fn(),
    informarTurnoDaEscuta: vi.fn(),
    onEscutaMudou: vi.fn(() => () => undefined),
    onEscutaDisparo: vi.fn(() => () => undefined)
  }
}

/** Nome curto de marca por espaço, como o card da CHOICE o mostra ("JARVIS" / "NOA"). */
const MARCA: Readonly<Record<WorkspaceId, string>> = {
  jarvis: 'JARVIS',
  noa: 'NOA'
}

/**
 * Renderiza o `App` e entra num espaço pela CHOICE, devolvendo quando o shell montou.
 *
 * Clica no botão "Entrar" do card (nome acessível "Entrar em <marca>") e espera o heading do
 * shell — a transição de marca é atravessada pela espera, sem depender de timer de teste.
 */
export async function entrarPelaChoice(espaco: WorkspaceId = 'jarvis'): Promise<void> {
  render(<App />)
  // O botão do card leva o nome acessível "Entrar em JARVIS" / "Entrar em NOA".
  const entrar = await screen.findByRole('button', {
    name: new RegExp(`entrar em ${MARCA[espaco]}`, 'i')
  })
  await userEvent.click(entrar)
  // O shell chegou quando há um heading de nível 1 (a topbar do espaço).
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
}
