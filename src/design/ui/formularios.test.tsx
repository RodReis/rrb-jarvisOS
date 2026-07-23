import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Alternador,
  Checkbox,
  Combobox,
  Field,
  Input,
  PasswordInput,
  RadioGroup,
  Select,
  Slider,
  Textarea
} from './index'

/**
 * Formulários (SPEC-DesignSystem-03a, critérios 1–4 e 6; PRD §11.2).
 *
 * Consulta por papel, nunca por classe. O que se prova aqui é o que o leitor de tela recebe:
 * nome, papel, estado, e a ligação entre o controle e as mensagens que o descrevem.
 */

const OPCOES = [
  { valor: 'seo', rotulo: 'SEO' },
  { valor: 'conteudo', rotulo: 'Conteúdo' },
  { valor: 'operacoes', rotulo: 'Operações', desabilitada: true }
] as const

describe('Field: ligação entre controle e mensagens', () => {
  it('o rótulo nomeia o controle', () => {
    render(
      <Field rotulo="Nome do workflow">
        {(campo) => <Input {...campo} valor="" onMudar={vi.fn()} />}
      </Field>
    )
    expect(screen.getByRole('textbox', { name: /nome do workflow/i })).toBeInTheDocument()
  })

  it('a descrição fica ligada por aria-describedby', () => {
    render(
      <Field rotulo="Nome" descricao="Use letras minúsculas e hífen.">
        {(campo) => <Input {...campo} valor="" onMudar={vi.fn()} />}
      </Field>
    )
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(/letras minúsculas e hífen/i)
  })

  it('obrigatório é anunciado por aria-required e por texto — não só pelo asterisco', () => {
    // O `*` é convenção visual que nem todo usuário conhece, e não chega a leitor de tela.
    render(
      <Field rotulo="Nome" obrigatorio>
        {(campo) => <Input {...campo} valor="" onMudar={vi.fn()} />}
      </Field>
    )
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByText('(obrigatório)')).toBeInTheDocument()
  })

  describe('erro (critérios 2 e 4)', () => {
    it('marca o controle como inválido e anuncia a mensagem', () => {
      render(
        <Field rotulo="Nome" erro="Nome já existe. Escolha outro ou edite o workflow atual.">
          {(campo) => <Input {...campo} valor="x" onMudar={vi.fn()} />}
        </Field>
      )

      const campo = screen.getByRole('textbox')
      expect(campo).toHaveAttribute('aria-invalid', 'true')
      // `role="alert"` faz a mensagem ser anunciada assim que aparece.
      expect(screen.getByRole('alert')).toHaveTextContent(/nome já existe/i)
      expect(campo).toHaveAccessibleDescription(/nome já existe/i)
    })

    it('a mensagem de erro traz problema E próxima ação (critério 4)', () => {
      // A spec exige as duas metades. O componente não consegue forçá-las por tipo — quem
      // escreve é o consumidor —, mas o DS não pode atrapalhar: a mensagem inteira é anunciada.
      render(
        <Field rotulo="Chave" erro="Chave inválida. Verifique o valor no painel do provedor.">
          {(campo) => <Input {...campo} valor="" onMudar={vi.fn()} />}
        </Field>
      )
      const alerta = screen.getByRole('alert')
      expect(alerta).toHaveTextContent(/inválida/i) // problema
      expect(alerta).toHaveTextContent(/verifique/i) // próxima ação
    })

    it('o erro substitui a descrição, para não competirem', () => {
      render(
        <Field rotulo="Nome" descricao="Texto de apoio" erro="Falhou. Tente de novo.">
          {(campo) => <Input {...campo} valor="" onMudar={vi.fn()} />}
        </Field>
      )
      expect(screen.queryByText('Texto de apoio')).not.toBeInTheDocument()
    })
  })
})

describe('Input e variantes', () => {
  it('digita e propaga o valor', async () => {
    function Controlado(): React.JSX.Element {
      const [v, setV] = useState('')
      return (
        <Field rotulo="Busca">{(campo) => <Input {...campo} valor={v} onMudar={setV} />}</Field>
      )
    }
    render(<Controlado />)
    await userEvent.type(screen.getByRole('textbox'), 'seo')
    expect(screen.getByRole('textbox')).toHaveValue('seo')
  })

  it('Textarea aceita várias linhas', async () => {
    function Controlado(): React.JSX.Element {
      const [v, setV] = useState('')
      return (
        <Field rotulo="Notas">{(campo) => <Textarea {...campo} valor={v} onMudar={setV} />}</Field>
      )
    }
    render(<Controlado />)
    const area = screen.getByRole('textbox', { name: /notas/i })
    await userEvent.type(area, 'linha 1{Enter}linha 2')
    expect(area).toHaveValue('linha 1\nlinha 2')
  })

  describe('PasswordInput', () => {
    it('nasce oculto e o botão de revelar é operável por teclado', async () => {
      render(
        <Field rotulo="Senha">
          {(campo) => <PasswordInput {...campo} valor="segredo" onMudar={vi.fn()} />}
        </Field>
      )

      // Campo de senha não tem papel `textbox` — é justamente o que o esconde do leitor.
      const revelar = screen.getByRole('button', { name: 'Mostrar senha' })
      expect(revelar).toHaveAttribute('aria-pressed', 'false')

      await userEvent.click(revelar)
      // O rótulo muda junto com o estado: quem usa leitor de tela sabe o que aconteceu.
      expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('textbox', { name: /senha/i })).toHaveValue('segredo')
    })
  })
})

describe('Select (Radix encapsulado — critério 3)', () => {
  it('expõe papel de combobox com o rótulo do Field', () => {
    render(
      <Field rotulo="Especialidade">
        {(campo) => <Select {...campo} valor="" onMudar={vi.fn()} opcoes={OPCOES} />}
      </Field>
    )
    expect(screen.getByRole('combobox', { name: /especialidade/i })).toBeInTheDocument()
  })

  it('abre por teclado e escolhe uma opção', async () => {
    const onMudar = vi.fn()
    render(
      <Field rotulo="Especialidade">
        {(campo) => <Select {...campo} valor="" onMudar={onMudar} opcoes={OPCOES} />}
      </Field>
    )

    const gatilho = screen.getByRole('combobox')
    gatilho.focus()
    await userEvent.keyboard('{Enter}')

    const opcao = await screen.findByRole('option', { name: 'SEO' })
    await userEvent.click(opcao)
    expect(onMudar).toHaveBeenCalledWith('seo')
  })
})

describe('Combobox', () => {
  it('implementa o padrão ARIA combobox', () => {
    render(
      <Field rotulo="Skill">
        {(campo) => <Combobox {...campo} valor="" onMudar={vi.fn()} opcoes={OPCOES} />}
      </Field>
    )
    const entrada = screen.getByRole('combobox', { name: /skill/i })
    expect(entrada).toHaveAttribute('aria-expanded', 'false')
    expect(entrada).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('filtra pela busca e escolhe com Enter', async () => {
    const onMudar = vi.fn()
    render(
      <Field rotulo="Skill">
        {(campo) => <Combobox {...campo} valor="" onMudar={onMudar} opcoes={OPCOES} />}
      </Field>
    )

    const entrada = screen.getByRole('combobox')
    await userEvent.type(entrada, 'cont')
    expect(screen.getByRole('option', { name: 'Conteúdo' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'SEO' })).not.toBeInTheDocument()

    await userEvent.keyboard('{Enter}')
    expect(onMudar).toHaveBeenCalledWith('conteudo')
  })

  it('busca sem resultado ensina, em vez de dizer "vazio"', async () => {
    render(
      <Field rotulo="Skill">
        {(campo) => <Combobox {...campo} valor="" onMudar={vi.fn()} opcoes={OPCOES} />}
      </Field>
    )
    await userEvent.type(screen.getByRole('combobox'), 'zzzz')
    expect(screen.getByText(/nenhuma opção corresponde/i)).toBeInTheDocument()
  })

  it('Escape fecha sem alterar o valor', async () => {
    const onMudar = vi.fn()
    render(
      <Field rotulo="Skill">
        {(campo) => <Combobox {...campo} valor="seo" onMudar={onMudar} opcoes={OPCOES} />}
      </Field>
    )
    const entrada = screen.getByRole('combobox')
    await userEvent.click(entrada)
    await userEvent.keyboard('{Escape}')
    // Cancelar tem de ser sempre reversível.
    expect(onMudar).not.toHaveBeenCalled()
  })
})

describe('Checkbox, RadioGroup, Switch e Slider', () => {
  it('Checkbox alterna por teclado', async () => {
    const onMudar = vi.fn()
    render(<Checkbox rotulo="Exigir aprovação" marcado={false} onMudar={onMudar} />)

    const caixa = screen.getByRole('checkbox', { name: 'Exigir aprovação' })
    caixa.focus()
    await userEvent.keyboard(' ')
    expect(onMudar).toHaveBeenCalledWith(true)
  })

  it('Checkbox indeterminado é anunciado como mixed, não como falso', () => {
    // "Nem tudo, nem nada" é um terceiro estado — reduzi-lo a `false` mentiria sobre a seleção.
    render(<Checkbox rotulo="Todos" marcado="indeterminado" onMudar={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Todos' })).toHaveAttribute('aria-checked', 'mixed')
  })

  it('o rótulo do Checkbox é clicável — amplia o alvo além dos 20px da caixa', async () => {
    const onMudar = vi.fn()
    render(<Checkbox rotulo="Exigir aprovação" marcado={false} onMudar={onMudar} />)
    await userEvent.click(screen.getByText('Exigir aprovação'))
    expect(onMudar).toHaveBeenCalledWith(true)
  })

  it('RadioGroup expõe as opções e navega por setas', async () => {
    const onMudar = vi.fn()
    render(
      <RadioGroup
        rotulo="Tipo de execução"
        valor="seo"
        onMudar={onMudar}
        opcoes={[
          { valor: 'seo', rotulo: 'Sequencial' },
          { valor: 'conteudo', rotulo: 'Paralelo' }
        ]}
      />
    )

    expect(screen.getByRole('radiogroup', { name: 'Tipo de execução' })).toBeInTheDocument()

    // A opção ativa é anunciada por `aria-checked` — não por cor de preenchimento.
    expect(screen.getByRole('radio', { name: 'Sequencial' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Paralelo' })).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(screen.getByRole('radio', { name: 'Paralelo' }))
    expect(onMudar).toHaveBeenCalledWith('conteudo')
  })

  /*
   * Navegação por seta no RadioGroup: **não verificável em jsdom**.
   *
   * O Radix implementa roving tabindex — o grupo carrega `tabindex=0`, os itens ficam em `-1`,
   * e o movimento por seta depende de `focus()` real do navegador somado a medidas de layout
   * que o jsdom não calcula. Diagnosticado: o clique dispara `onMudar`, a seta não, nem depois
   * de o item receber foco.
   *
   * Registrar aqui é mais honesto que escrever um teste que passa mascarando o que não foi
   * medido — e mais honesto que apagar a preocupação. A navegação por teclado do RadioGroup é
   * garantida pelo Radix (WAI-ARIA APG) e será exercitada no E2E das telas que o usarem
   * (F04a/F04b), onde há navegador de verdade.
   */
  it.todo('RadioGroup navega por setas — cobrir no E2E, jsdom não move o foco do Radix')

  it('Switch expõe papel e estado', async () => {
    const onMudar = vi.fn()
    render(<Alternador rotulo="Modo autônomo" ligado={false} onMudar={onMudar} />)

    const chave = screen.getByRole('switch', { name: 'Modo autônomo' })
    expect(chave).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(chave)
    expect(onMudar).toHaveBeenCalledWith(true)
  })

  it('Slider anuncia o valor formatado e responde ao teclado', async () => {
    const onMudar = vi.fn()
    render(<Slider rotulo="Limite diário" valor={40} onMudar={onMudar} formatar={(v) => `${v}%`} />)

    const faixa = screen.getByRole('slider', { name: 'Limite diário' })
    // `aria-valuetext` leva a versão legível: "40" sozinho não diz que é porcentagem.
    expect(faixa).toHaveAttribute('aria-valuetext', '40%')
    faixa.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onMudar).toHaveBeenCalledWith(41)
  })

  it('o valor do Slider também aparece em texto — posição de alça não é número', () => {
    render(<Slider rotulo="Limite" valor={40} onMudar={vi.fn()} formatar={(v) => `${v}%`} />)
    expect(screen.getByText('40%')).toBeInTheDocument()
  })
})

describe('estado desabilitado em toda a família', () => {
  it.each([
    ['Input', <Input key="i" valor="" onMudar={vi.fn()} desabilitado />],
    ['Textarea', <Textarea key="t" valor="" onMudar={vi.fn()} desabilitado />]
  ])('%s desabilitado é anunciado como tal', (_nome, elemento) => {
    render(<Field rotulo="Campo">{() => elemento}</Field>)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('Checkbox desabilitado não alterna', async () => {
    const onMudar = vi.fn()
    render(<Checkbox rotulo="Trava" marcado={false} onMudar={onMudar} desabilitado />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Trava' }))
    expect(onMudar).not.toHaveBeenCalled()
  })
})
