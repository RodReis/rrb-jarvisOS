/**
 * Seletor de acento (SPEC-DesignSystem-06; README §2.4).
 *
 * A **paleta fixa de 8 swatches** por módulo, que vive na tela CHOICE — não no shell interno. A
 * F04a foi explícita nisso: o AppShell só *consome* o acento ativo, e não há color picker livre
 * lá dentro.
 *
 * Paleta fechada e não picker é decisão de arquitetura, não de estética: é o que permitiu à F02
 * **pré-calcular** o ajuste de contraste das 8 cores × 2 modos, em vez de validar cor arbitrária
 * em runtime. Um picker livre reabriria o problema que a `tabelaLeitura` fechou.
 */

import { PALETA_ACENTO, type CorAcento } from '../tokens/acento'
import { cx, FOCO } from '../ui/base'

export function AccentSwatchSelector({
  valor,
  onEscolher,
  rotulo
}: {
  readonly valor: CorAcento
  readonly onEscolher: (cor: CorAcento) => void
  /** Nome acessível do grupo — quem usa leitor de tela precisa saber de qual módulo é a paleta. */
  readonly rotulo: string
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      data-jos-swatches
      className="flex flex-wrap items-center gap-2"
    >
      {PALETA_ACENTO.map((cor) => {
        const selecionada = cor === valor
        return (
          <button
            key={cor}
            type="button"
            role="radio"
            aria-checked={selecionada}
            // O **nome da cor é o hex**, e é o que o leitor de tela anuncia. Não há rótulo melhor:
            // "azul" seria interpretação nossa, e as oito não têm nomes canônicos no protótipo.
            aria-label={cor}
            onClick={() => onEscolher(cor)}
            style={{ backgroundColor: cor }}
            className={cx(
              'size-7 rounded-[var(--jos-raio-pill)] border transition-[transform,border-color]',
              'duration-[var(--jos-duracao-rapida)]',
              // `FOCO` do DS, e não um anel próprio: a F06 varre estilos paralelos, e um foco
              // com forma diferente do resto do sistema é justamente isso.
              FOCO,
              // A seleção é marcada por **borda clara e escala**, não por uma cor de destaque:
              // o swatch *é* uma cor, e destacá-lo com outra cor competiria com o próprio valor
              // que ele mostra. Escala sobrevive ao daltonismo; `aria-checked` sobrevive à
              // ausência de visão.
              selecionada
                ? 'scale-110 border-[var(--jos-cor-texto)] border-2'
                : 'border-[rgba(var(--jos-borda-rgb),0.24)] hover:scale-105'
            )}
          />
        )
      })}
    </div>
  )
}
