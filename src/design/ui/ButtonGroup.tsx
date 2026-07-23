import { cx } from './base'

/**
 * Agrupamento de ações relacionadas (SPEC-DesignSystem-03a, PRD §11.1).
 *
 * Dois papéis distintos, e é por isso que `papel` existe em vez de o grupo ser só um `div` com
 * `gap`:
 *
 * - `acoes` — botões independentes lado a lado (Cancelar / Salvar). Semanticamente é só um
 *   agrupamento visual, então recebe `role="group"`.
 * - `segmentado` — opções **mutuamente exclusivas** (uma vista de cada vez). Isso é um
 *   `radiogroup`, não uma fileira de botões: sem esse papel, o leitor de tela anuncia três
 *   botões soltos e não diz qual está ativo. É a mesma lição registrada na F02 do MVP-001
 *   (os botões de espaço viraram `radiogroup` pelo mesmo motivo).
 */

interface ButtonGroupProps {
  readonly children: React.ReactNode
  /** Nome acessível do grupo — obrigatório em `segmentado`, recomendado em `acoes`. */
  readonly rotulo?: string
  readonly papel?: 'acoes' | 'segmentado'
}

export function ButtonGroup({
  children,
  rotulo,
  papel = 'acoes'
}: ButtonGroupProps): React.JSX.Element {
  return (
    <div
      role={papel === 'segmentado' ? 'radiogroup' : 'group'}
      aria-label={rotulo}
      className={cx('inline-flex items-center', papel === 'segmentado' ? 'gap-1' : 'gap-3')}
    >
      {children}
    </div>
  )
}
