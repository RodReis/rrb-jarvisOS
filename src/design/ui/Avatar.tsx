import * as RadixAvatar from '@radix-ui/react-avatar'
import { cx } from './base'

/**
 * Avatar (SPEC-DesignSystem-03b, PRD §11.4).
 *
 * Sobre Radix: mostra a imagem quando ela carrega e cai para as **iniciais** quando falha ou
 * demora — sem o quadrado quebrado que uma `<img>` crua deixa. As iniciais não são decorativas:
 * são o fallback legível quando não há foto.
 *
 * `nome` é obrigatório e vira o `alt`/`aria-label`: um avatar sem nome é um enfeite que o leitor
 * de tela anuncia como "imagem", sem dizer de quem.
 */

interface AvatarProps {
  readonly nome: string
  readonly imagem?: string
  readonly tamanho?: 'pequeno' | 'medio' | 'grande'
}

const POR_TAMANHO = {
  pequeno: 'size-6 text-[length:var(--jos-texto-micro)]',
  medio: 'size-9 text-[length:var(--jos-texto-mini)]',
  grande: 'size-12 text-[length:var(--jos-texto-corpo)]'
} as const

/** Iniciais do nome — no máximo duas, a primeira de cada uma das duas primeiras palavras. */
function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('')
}

export function Avatar({ nome, imagem, tamanho = 'medio' }: AvatarProps): React.JSX.Element {
  return (
    <RadixAvatar.Root
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
        'border border-[rgba(var(--jos-borda-rgb),0.24)] bg-[var(--jos-cor-superficie-elevada)]',
        POR_TAMANHO[tamanho]
      )}
    >
      {imagem !== undefined && (
        <RadixAvatar.Image src={imagem} alt={nome} className="size-full object-cover" />
      )}
      <RadixAvatar.Fallback
        // `delayMs`: só mostra as iniciais depois de dar chance de a imagem carregar, evitando
        // o flash de iniciais → foto numa conexão rápida.
        delayMs={imagem !== undefined ? 300 : 0}
        aria-label={nome}
        className="flex size-full items-center justify-center font-[family-name:var(--jos-fonte-mono)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto-secundario)]"
      >
        {iniciais(nome)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
