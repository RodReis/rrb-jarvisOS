import { useId } from 'react'
import { AlertCircle, Info } from 'lucide-react'
import { cx, LABEL_MONO } from './base'

/**
 * Campo de formulário: rótulo, controle, descrição e mensagem (SPEC-DesignSystem-03a §11.2).
 *
 * `Field` existe para resolver **uma** coisa que quase todo formulário erra: a ligação entre o
 * controle e os textos que o descrevem. Ele gera os ids e devolve, por render prop, o conjunto
 * de atributos ARIA que o controle precisa vestir. Sem isso, cada componente teria de lembrar
 * de fazer `aria-describedby` apontar para a descrição *e* para o erro — e um dia um esquece.
 *
 * Por que render prop e não contexto: o controle precisa dos atributos **no próprio elemento**,
 * e uma prop explícita torna impossível renderizar o campo sem ligá-los.
 */

/** Atributos que o controle deve receber para ficar corretamente descrito. */
export interface AtributosDoControle {
  readonly id: string
  readonly 'aria-describedby': string | undefined
  readonly 'aria-invalid': boolean | undefined
  readonly 'aria-required': boolean | undefined
}

interface FieldProps {
  readonly rotulo: string
  /** Texto de apoio permanente — some quando há erro, para não competir com ele. */
  readonly descricao?: string
  /** Mensagem de erro. Presente ⇒ o campo está inválido. */
  readonly erro?: string
  readonly obrigatorio?: boolean
  readonly children: (atributos: AtributosDoControle) => React.ReactNode
}

export function Field({
  rotulo,
  descricao,
  erro,
  obrigatorio = false,
  children
}: FieldProps): React.JSX.Element {
  const base = useId()
  const idControle = `${base}-controle`
  const idDescricao = `${base}-descricao`
  const idErro = `${base}-erro`

  const invalido = erro !== undefined && erro !== ''

  // Erro primeiro na ordem de leitura: quem acabou de errar precisa ouvir o problema antes da
  // instrução genérica. Sem erro, resta só a descrição.
  const descritoPor = [invalido ? idErro : null, descricao ? idDescricao : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={idControle} className={cx(LABEL_MONO, 'flex items-center gap-1.5')}>
        {rotulo}
        {obrigatorio && (
          <>
            {/* O asterisco é decorativo — quem informa a obrigatoriedade é `aria-required` no
                controle. Um `*` sozinho é convenção visual que nem todo usuário conhece. */}
            <span aria-hidden="true" className="text-[var(--jos-cor-err)]">
              *
            </span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </label>

      {children({
        id: idControle,
        'aria-describedby': descritoPor === '' ? undefined : descritoPor,
        'aria-invalid': invalido || undefined,
        'aria-required': obrigatorio || undefined
      })}

      {invalido && <FormMessage id={idErro} tom="erro" mensagem={erro} />}
      {!invalido && descricao !== undefined && (
        <FormMessage id={idDescricao} tom="apoio" mensagem={descricao} />
      )}
    </div>
  )
}

interface FormMessageProps {
  readonly mensagem: string
  readonly tom: 'erro' | 'apoio'
  readonly id?: string
}

/**
 * Mensagem de campo (critério 4).
 *
 * Erro carrega **ícone + texto + `role="alert"`**, nunca só cor vermelha: daltonismo, alto
 * contraste e leitor de tela precisam do mesmo sinal por caminhos diferentes.
 *
 * A spec exige que o erro traga *problema **e** próxima ação*. Isso não dá para forçar por
 * tipo — quem escreve a mensagem é o consumidor. O que o componente faz é não atrapalhar:
 * `role="alert"` anuncia a mensagem inteira assim que ela aparece, e há teste cobrando o
 * formato nas mensagens que o DS oferece.
 */
export function FormMessage({ mensagem, tom, id }: FormMessageProps): React.JSX.Element {
  const erro = tom === 'erro'
  const Icone = erro ? AlertCircle : Info

  return (
    <p
      id={id}
      role={erro ? 'alert' : undefined}
      className={cx(
        'flex items-start gap-1.5 text-[length:var(--jos-texto-mini)] leading-snug',
        erro ? 'text-[var(--jos-cor-err)]' : 'text-[var(--jos-cor-texto-suave)]'
      )}
    >
      <Icone aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{mensagem}</span>
    </p>
  )
}
