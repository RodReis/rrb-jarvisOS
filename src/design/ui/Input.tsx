import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { AtributosDoControle } from './Field'
import { ALTURA_CONTROLE, BORDA, cx, DESABILITADO, FOCO, SUPERFICIE, TRANSICAO } from './base'

/**
 * Campos de texto (SPEC-DesignSystem-03a, PRD §11.2).
 *
 * A forma vem da tela de login do protótipo: 44px de altura, raio de card, borda neutra de
 * baixo alfa, ícone opcional à esquerda, placeholder discreto.
 *
 * Os atributos ARIA chegam prontos do `Field` (`...campo`) em vez de cada uso montar o
 * `aria-describedby` à mão — é o que garante que o erro seja anunciado junto com o campo.
 */

const CLASSES_CAMPO = cx(
  'w-full rounded-[var(--jos-raio-card)] px-3.5 text-[length:var(--jos-texto-corpo)]',
  'font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]',
  BORDA,
  SUPERFICIE,
  // O placeholder usa a cor de texto suave, que o tema garante com contraste — o cinza-claro
  // "elegante" é a causa nº 1 de campo ilegível.
  'placeholder:text-[var(--jos-cor-texto-suave)]',
  // Borda vermelha **acompanha** o ícone e o texto do FormMessage: cor nunca sozinha.
  'aria-[invalid=true]:border-[var(--jos-cor-err)]',
  FOCO,
  TRANSICAO,
  DESABILITADO
)

interface InputProps extends Partial<AtributosDoControle> {
  readonly valor: string
  readonly onMudar: (valor: string) => void
  readonly placeholder?: string
  readonly desabilitado?: boolean
  readonly tipo?: 'text' | 'email' | 'search' | 'url' | 'tel'
  /** Ícone à esquerda — decorativo; quem nomeia o campo é o rótulo do `Field`. */
  readonly icone?: React.ReactNode
  readonly autoComplete?: string
}

export function Input({
  valor,
  onMudar,
  placeholder,
  desabilitado = false,
  tipo = 'text',
  icone,
  autoComplete,
  ...campo
}: InputProps): React.JSX.Element {
  return (
    <div className="relative flex items-center">
      {icone !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 flex text-[var(--jos-cor-texto-suave)]"
        >
          {icone}
        </span>
      )}
      <input
        {...campo}
        type={tipo}
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        placeholder={placeholder}
        disabled={desabilitado}
        autoComplete={autoComplete}
        style={{ height: ALTURA_CONTROLE }}
        className={cx(CLASSES_CAMPO, icone !== undefined && 'pl-10')}
      />
    </div>
  )
}

interface PasswordInputProps extends Partial<AtributosDoControle> {
  readonly valor: string
  readonly onMudar: (valor: string) => void
  readonly placeholder?: string
  readonly desabilitado?: boolean
  readonly icone?: React.ReactNode
  readonly autoComplete?: string
}

/**
 * Campo de senha com alternância de visibilidade (PRD §11.2 e §15).
 *
 * O botão de revelar é um `button` de verdade, com `aria-pressed` e rótulo que muda — não um
 * ícone clicável. Assim ele entra na ordem de tabulação e o leitor de tela informa se a senha
 * está visível.
 *
 * **`autoComplete` default `current-password`** e nada de `value` em superfície de resumo: a
 * spec cita PRD §15 (sem cópia acidental). O campo não expõe API para renderizar o valor em
 * outro lugar — quem quiser fazê-lo terá de escrever, e não herdar por descuido.
 */
export function PasswordInput({
  valor,
  onMudar,
  placeholder,
  desabilitado = false,
  icone,
  autoComplete = 'current-password',
  ...campo
}: PasswordInputProps): React.JSX.Element {
  const [visivel, setVisivel] = useState(false)

  return (
    <div className="relative flex items-center">
      {icone !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 flex text-[var(--jos-cor-texto-suave)]"
        >
          {icone}
        </span>
      )}
      <input
        {...campo}
        type={visivel ? 'text' : 'password'}
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        placeholder={placeholder}
        disabled={desabilitado}
        autoComplete={autoComplete}
        style={{ height: ALTURA_CONTROLE }}
        className={cx(CLASSES_CAMPO, icone !== undefined && 'pl-10', 'pr-11')}
      />
      <button
        type="button"
        onClick={() => setVisivel(!visivel)}
        disabled={desabilitado}
        aria-pressed={visivel}
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        className={cx(
          'absolute right-2 flex size-8 items-center justify-center rounded-[var(--jos-raio-chip)]',
          'text-[var(--jos-cor-texto-suave)] hover:text-[var(--jos-cor-texto)]',
          FOCO,
          TRANSICAO,
          DESABILITADO
        )}
      >
        {visivel ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  )
}

interface TextareaProps extends Partial<AtributosDoControle> {
  readonly valor: string
  readonly onMudar: (valor: string) => void
  readonly placeholder?: string
  readonly desabilitado?: boolean
  readonly linhas?: number
}

export function Textarea({
  valor,
  onMudar,
  placeholder,
  desabilitado = false,
  linhas = 4,
  ...campo
}: TextareaProps): React.JSX.Element {
  return (
    <textarea
      {...campo}
      value={valor}
      onChange={(e) => onMudar(e.target.value)}
      placeholder={placeholder}
      disabled={desabilitado}
      rows={linhas}
      // `resize-y` e não `resize`: redimensionar na horizontal quebra o layout do formulário,
      // e a medida de leitura é decisão do design, não do arrasto.
      className={cx(CLASSES_CAMPO, 'resize-y py-3 leading-relaxed')}
    />
  )
}
