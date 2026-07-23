import { Settings2 } from 'lucide-react'
import { Alternador } from '../ui'

/**
 * Linha de ajuste (rótulo + descrição + alternador) — primeiro padrão da camada
 * `patterns` (SPEC-DesignSystem-01).
 *
 * `patterns` compõe `ui` e recebe **dados, estado e callbacks só por props tipadas**
 * (PRD §8.1). Não busca dado, não conhece IPC, não sabe o que é workspace: é o que
 * mantém o DS reutilizável nos dois espaços sem virar dependente do produto.
 */

interface LinhaDeAjusteProps {
  readonly rotulo: string
  readonly descricao?: string
  readonly ligado: boolean
  readonly onMudar: (ligado: boolean) => void
}

export function LinhaDeAjuste({
  rotulo,
  descricao,
  ligado,
  onMudar
}: LinhaDeAjusteProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-center gap-2">
        {/* Lucide importado individualmente — importar o pacote inteiro traria o catálogo. */}
        <Settings2 aria-hidden="true" className="size-4 opacity-70" />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{rotulo}</span>
          {descricao && <span className="text-xs opacity-70">{descricao}</span>}
        </div>
      </div>
      <Alternador rotulo={rotulo} ligado={ligado} onMudar={onMudar} />
    </div>
  )
}
