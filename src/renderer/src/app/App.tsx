import { AppShell } from './AppShell'

/**
 * Raiz do renderer. A tela placeholder da Fatia 01 cumpriu seu papel (provar que o
 * renderer monta e que a ponte responde) e deu lugar ao AppShell da Fatia 02 — que herda
 * essa prova: sem a ponte, ele não carrega o espaço ativo.
 */
export function App(): React.JSX.Element {
  return <AppShell />
}
