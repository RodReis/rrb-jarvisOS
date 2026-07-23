import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { AtributosDoControle } from './Field'
import type { OpcaoSelect } from './Select'
import { ALTURA_CONTROLE, BORDA, cx, DESABILITADO, FOCO, SUPERFICIE, TRANSICAO } from './base'

/**
 * Seleção com busca (SPEC-DesignSystem-03a, PRD §11.2).
 *
 * Construído sobre o padrão ARIA `combobox` diretamente, e não sobre um primitivo Radix: o
 * Radix não publica um Combobox, e trazer uma segunda biblioteca (Downshift, cmdk) para um
 * único componente pagaria dependência nova e um segundo vocabulário de composição. O padrão
 * está implementado por inteiro aqui — `role="combobox"`, `aria-expanded`, `aria-controls`,
 * `aria-activedescendant`, teclado completo — e o consumidor vê a mesma API do `Select`.
 *
 * Teclado (WAI-ARIA APG): ↓/↑ navegam, Enter confirma, Escape fecha sem alterar, Tab sai
 * confirmando o foco atual. Sem isso o componente é um input com uma lista bonita ao lado.
 */

interface ComboboxProps extends Partial<AtributosDoControle> {
  readonly valor: string
  readonly onMudar: (valor: string) => void
  readonly opcoes: readonly OpcaoSelect[]
  readonly placeholder?: string
  readonly desabilitado?: boolean
  /** Texto quando a busca não encontra nada — ensina em vez de dizer "vazio". */
  readonly semResultado?: string
}

export function Combobox({
  valor,
  onMudar,
  opcoes,
  placeholder = 'Buscar',
  desabilitado = false,
  semResultado = 'Nenhuma opção corresponde à busca',
  ...campo
}: ComboboxProps): React.JSX.Element {
  const base = useId()
  const idLista = `${base}-lista`
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [indiceAtivo, setIndiceAtivo] = useState(0)
  const refEntrada = useRef<HTMLInputElement>(null)

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (termo === '') return opcoes
    return opcoes.filter((o) => o.rotulo.toLowerCase().includes(termo))
  }, [opcoes, busca])

  const selecionada = opcoes.find((o) => o.valor === valor)
  // Fechado mostra o rótulo escolhido; aberto mostra o que está sendo digitado. Misturar os
  // dois é o que faz combobox parecer "apagar o valor sozinho".
  const textoVisivel = aberto ? busca : (selecionada?.rotulo ?? '')

  function abrir(): void {
    if (desabilitado) return
    setAberto(true)
    setBusca('')
    setIndiceAtivo(
      Math.max(
        0,
        filtradas.findIndex((o) => o.valor === valor)
      )
    )
  }

  function escolher(opcao: OpcaoSelect): void {
    if (opcao.desabilitada === true) return
    onMudar(opcao.valor)
    setAberto(false)
    setBusca('')
    refEntrada.current?.focus()
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!aberto) return abrir()
      setIndiceAtivo((i) => Math.min(i + 1, filtradas.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceAtivo((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!aberto) return
      e.preventDefault()
      const alvo = filtradas[indiceAtivo]
      if (alvo !== undefined) escolher(alvo)
    } else if (e.key === 'Escape') {
      // Escape fecha **sem** alterar o valor — cancelar tem de ser sempre reversível.
      setAberto(false)
      setBusca('')
    }
  }

  const idOpcaoAtiva = aberto && filtradas.length > 0 ? `${base}-opcao-${indiceAtivo}` : undefined

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 size-4 text-[var(--jos-cor-texto-suave)]"
        />
        <input
          {...campo}
          ref={refEntrada}
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={idOpcaoAtiva}
          value={textoVisivel}
          onChange={(e) => {
            setBusca(e.target.value)
            setAberto(true)
            setIndiceAtivo(0)
          }}
          onFocus={abrir}
          onBlur={() => window.setTimeout(() => setAberto(false), 120)}
          onKeyDown={aoTeclar}
          placeholder={placeholder}
          disabled={desabilitado}
          style={{ height: ALTURA_CONTROLE }}
          className={cx(
            'w-full rounded-[var(--jos-raio-card)] pl-10 pr-10 text-[length:var(--jos-texto-corpo)]',
            'font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]',
            BORDA,
            SUPERFICIE,
            'placeholder:text-[var(--jos-cor-texto-suave)]',
            'aria-[invalid=true]:border-[var(--jos-cor-err)]',
            FOCO,
            TRANSICAO,
            DESABILITADO
          )}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 size-4 text-[var(--jos-cor-texto-suave)]"
        />
      </div>

      {aberto && (
        <ul
          id={idLista}
          role="listbox"
          className={cx(
            'absolute left-0 right-0 top-[calc(100%+6px)] z-[var(--jos-camada-overlay)]',
            'max-h-56 overflow-auto rounded-[var(--jos-raio-card)] p-1',
            'shadow-[var(--jos-sombra-card)]',
            BORDA,
            'bg-[var(--jos-cor-superficie-elevada)]'
          )}
        >
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-[length:var(--jos-texto-acao)] text-[var(--jos-cor-texto-suave)]">
              {semResultado}
            </li>
          ) : (
            filtradas.map((o, i) => {
              const escolhida = o.valor === valor
              return (
                <li
                  key={o.valor}
                  id={`${base}-opcao-${i}`}
                  role="option"
                  aria-selected={escolhida}
                  aria-disabled={o.desabilitada}
                  onMouseDown={(e) => {
                    // `mousedown` e não `click`: o `blur` do input dispararia antes do click e
                    // fecharia a lista, engolindo a escolha.
                    e.preventDefault()
                    escolher(o)
                  }}
                  onMouseEnter={() => setIndiceAtivo(i)}
                  className={cx(
                    'flex cursor-default items-center gap-2 rounded-[var(--jos-raio-chip)]',
                    'py-2 pl-8 pr-3 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]',
                    'relative',
                    i === indiceAtivo &&
                      'bg-[color-mix(in_srgb,var(--jos-cor-acento)_14%,transparent)]',
                    o.desabilitada === true && 'opacity-45'
                  )}
                >
                  {escolhida && <Check aria-hidden="true" className="absolute left-2 size-4" />}
                  {o.rotulo}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
