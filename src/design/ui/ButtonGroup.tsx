/**
 * Agrupamento de ações relacionadas (SPEC-DesignSystem-03a, PRD §11.1).
 *
 * Só um papel: `role="group"` para botões independentes lado a lado (Cancelar / Salvar). É
 * agrupamento visual e semântico, sem estado de seleção.
 *
 * **Havia uma variante `segmentado`** que aplicava `role="radiogroup"` para opções mutuamente
 * exclusivas. Foi removida: `radiogroup` exige filhos com `role="radio"` e `aria-checked`, e os
 * filhos aqui são `<button>` comuns — o leitor de tela anunciaria um grupo de rádio **sem
 * rádios dentro**, que é pior que a fileira de botões que a variante tentava corrigir. A
 * promessa estava na assinatura, não na árvore.
 *
 * Achado pelo `/impeccable critique` da F03a. Um controle segmentado de verdade precisa de
 * componente próprio, com estado e teclado (setas navegam, não Tab) — isso é escopo da F04a
 * (AppShell + navegação), onde há tela que o use. Entregar a casca agora seria oferecer
 * acessibilidade que não existe.
 */

interface ButtonGroupProps {
  readonly children: React.ReactNode
  /** Nome acessível do grupo — o leitor anuncia "grupo, <rótulo>" ao entrar. */
  readonly rotulo?: string
}

export function ButtonGroup({ children, rotulo }: ButtonGroupProps): React.JSX.Element {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex items-center gap-3">
      {children}
    </div>
  )
}
