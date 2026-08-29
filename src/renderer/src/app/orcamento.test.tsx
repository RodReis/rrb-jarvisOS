import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetSnapshot } from '@shared/domain/budget'
import { OrcamentoDoWorkspace } from './OrcamentoDoWorkspace'

/**
 * O painel de orçamento do Settings (SPEC-Providers-03, critérios 7 e 8), categoria Tela.
 *
 * O que estes testes afirmam é o que jsdom consegue afirmar: papéis, texto, o caminho que os
 * limites percorrem até a ponte, e a operação por teclado. O que eles **não** afirmam é
 * aparência — jsdom não aplica folha de estilo, e uma asserção de cor mediria a string que o
 * próprio componente escreveu. A cor da barra ao cruzar o limiar é prova de navegador.
 *
 * O teste central do critério 8 é que a tela **não calcula**: o acumulado exibido é o que veio
 * do main, e editar o limite não muda o número gasto na tela sem uma nova resposta da ponte.
 */

const getBudget = vi.fn()
const setBudgetLimits = vi.fn()
const sendLog = vi.fn()

function snapshotDe(parcial: {
  dailyLimit?: number
  monthlyLimit?: number
  alertThreshold?: number
  diaUsd?: number
  mesUsd?: number
}): BudgetSnapshot {
  return {
    policy: {
      user_id: 'user-teste',
      workspace_id: 'jarvis',
      dailyLimit: parcial.dailyLimit ?? 1,
      monthlyLimit: parcial.monthlyLimit ?? 1,
      alertThreshold: parcial.alertThreshold ?? 0.8,
      currency: 'USD'
    },
    gasto: { diaUsd: parcial.diaUsd ?? 0, mesUsd: parcial.mesUsd ?? 0 }
  }
}

const PADRAO = snapshotDe({})

beforeEach(() => {
  vi.clearAllMocks()
  getBudget.mockResolvedValue(PADRAO)
  setBudgetLimits.mockResolvedValue(PADRAO)

  Object.defineProperty(window, 'jarvis', {
    // `sendLog` entra porque os caminhos de erro logam (ADR-005): sem ele o `catch` do
    // componente estoura ao registrar a falha, e o teste do erro passaria com uma rejeição
    // não tratada em segundo plano.
    value: { getBudget, setBudgetLimits, sendLog },
    configurable: true,
    writable: true
  })
})

async function montar(workspace: 'noa' | 'jarvis' = 'jarvis'): Promise<void> {
  render(
    <OrcamentoDoWorkspace
      workspace={workspace}
      nomeDoEspaco={workspace === 'jarvis' ? 'JARVIS OS' : 'NOA'}
    />
  )
  await waitFor(() => expect(getBudget).toHaveBeenCalled())
}

describe('limites e acumulado (critério 7)', () => {
  it('mostra os limites do espaço nos campos editáveis', async () => {
    getBudget.mockResolvedValue(snapshotDe({ dailyLimit: 5, monthlyLimit: 50 }))
    await montar()

    expect(await screen.findByLabelText(/limite diário/i)).toHaveValue('5')
    expect(screen.getByLabelText(/limite mensal/i)).toHaveValue('50')
  })

  it('mostra o acumulado do dia e do mês como texto, não só como barra', async () => {
    // "Estado nunca só por cor" vale para grandeza: quem não distingue o preenchimento da
    // barra precisa poder **ler** quanto gastou.
    getBudget.mockResolvedValue(
      snapshotDe({ dailyLimit: 1, monthlyLimit: 10, diaUsd: 0.25, mesUsd: 3.5 })
    )
    await montar()

    // O texto visível é montado de expressões JSX irmãs, então nenhum nó carrega a string
    // inteira. A asserção é por `aria-valuetext`, que carrega — e que é o mesmo valor lido por
    // quem usa leitor de tela: cobre a régua "estado nunca só por cor" nas duas leituras.
    const hoje = await screen.findByRole('meter', { name: 'Hoje' })
    expect(hoje).toHaveAttribute('aria-valuetext', 'US$ 0.25')
    expect(screen.getByRole('meter', { name: 'Este mês' })).toHaveAttribute(
      'aria-valuetext',
      'US$ 3.50'
    )

    // E o mesmo par também está **visível** como texto, ao lado do rótulo do período — não só
    // no atributo. O matcher olha o `textContent` do nó porque a linha é montada de expressões
    // JSX irmãs, e nenhuma delas isolada carrega a frase inteira.
    const linhaCom =
      (esperado: string) =>
      (_texto: string, no: Element | null): boolean =>
        no?.tagName === 'SPAN' && no.textContent === esperado

    expect(screen.getByText(linhaCom('US$ 0.25 de US$ 1.00'))).toBeInTheDocument()
    expect(screen.getByText(linhaCom('US$ 3.50 de US$ 10.00'))).toBeInTheDocument()
  })

  it('a barra de cada período é um meter com o valor acessível', async () => {
    getBudget.mockResolvedValue(snapshotDe({ dailyLimit: 2, diaUsd: 0.5 }))
    await montar()

    const hoje = await screen.findByRole('meter', { name: 'Hoje' })
    expect(hoje).toHaveAttribute('aria-valuenow', '0.5')
    expect(hoje).toHaveAttribute('aria-valuemax', '2')
    expect(screen.getByRole('meter', { name: 'Este mês' })).toBeInTheDocument()
  })

  it('nomeia o espaço: o orçamento do JARVIS não é o do NOA', async () => {
    await montar('noa')

    expect(await screen.findByText(/Orçamento de IA · NOA/)).toBeInTheDocument()
  })

  it('diz que o controle é por estimativa — melhor esforço, não garantia', async () => {
    // A honestidade do modelo (ARCHITECTURE § Resiliência) precisa chegar ao usuário: ele não
    // pode ler "orçamento" como cerca perfeita, porque com BYOK ela não é.
    await montar()

    expect(await screen.findByText(/por estimativa/i)).toBeInTheDocument()
  })
})

describe('alerta ao cruzar o limiar (critério 7)', () => {
  it('não alerta enquanto o gasto está abaixo do limiar', async () => {
    getBudget.mockResolvedValue(snapshotDe({ dailyLimit: 1, monthlyLimit: 10, diaUsd: 0.1 }))
    await montar()

    await screen.findByRole('meter', { name: 'Hoje' })
    expect(screen.queryByText(/perto do limite/i)).not.toBeInTheDocument()
  })

  it('alerta quando o gasto do dia cruza o limiar, nomeando o período e os números', async () => {
    getBudget.mockResolvedValue(snapshotDe({ dailyLimit: 1, monthlyLimit: 10, diaUsd: 0.85 }))
    await montar()

    expect(await screen.findByText(/perto do limite/i)).toBeInTheDocument()
    expect(screen.getByText(/limite diário de US\$ 1\.00/i)).toBeInTheDocument()
  })

  it('alerta pelo mensal quando só ele cruzou o limiar', async () => {
    getBudget.mockResolvedValue(
      snapshotDe({ dailyLimit: 100, monthlyLimit: 10, diaUsd: 1, mesUsd: 9 })
    )
    await montar()

    expect(await screen.findByText(/limite mensal de US\$ 10\.00/i)).toBeInTheDocument()
  })
})

describe('editar limites pela ponte tipada (critério 8)', () => {
  it('envia os novos limites ao main e reflete a resposta dele', async () => {
    const usuario = userEvent.setup()
    setBudgetLimits.mockResolvedValue(snapshotDe({ dailyLimit: 9, monthlyLimit: 90 }))
    await montar()

    const diario = await screen.findByLabelText(/limite diário/i)
    await usuario.clear(diario)
    await usuario.type(diario, '9')
    await usuario.click(screen.getByRole('button', { name: /salvar limites/i }))

    await waitFor(() =>
      expect(setBudgetLimits).toHaveBeenCalledWith(
        expect.objectContaining({ dailyLimit: 9 }),
        'jarvis'
      )
    )
    // O campo passa a mostrar o que o **main** devolveu, não o que foi digitado: se o main
    // recusasse e devolvesse o valor anterior, a tela mostraria o que de fato vale.
    expect(await screen.findByLabelText(/limite mensal/i)).toHaveValue('90')
  })

  it('preserva o limiar corrente em vez de reduzi-lo ao padrão a cada salvamento', async () => {
    const usuario = userEvent.setup()
    getBudget.mockResolvedValue(snapshotDe({ alertThreshold: 0.5 }))
    await montar()

    await screen.findByLabelText(/limite diário/i)
    await usuario.click(screen.getByRole('button', { name: /salvar limites/i }))

    await waitFor(() =>
      expect(setBudgetLimits).toHaveBeenCalledWith(
        expect.objectContaining({ alertThreshold: 0.5 }),
        'jarvis'
      )
    )
  })

  it('recusa limite negativo com mensagem, sem chamar a ponte', async () => {
    const usuario = userEvent.setup()
    await montar()

    const diario = await screen.findByLabelText(/limite diário/i)
    await usuario.clear(diario)
    await usuario.type(diario, '-5')
    await usuario.click(screen.getByRole('button', { name: /salvar limites/i }))

    expect(await screen.findByText(/maior ou igual a zero/i)).toBeInTheDocument()
    expect(setBudgetLimits).not.toHaveBeenCalled()
  })

  it('recusa texto que não é número, sem chamar a ponte', async () => {
    const usuario = userEvent.setup()
    await montar()

    const diario = await screen.findByLabelText(/limite diário/i)
    await usuario.clear(diario)
    await usuario.type(diario, 'abc')
    await usuario.click(screen.getByRole('button', { name: /salvar limites/i }))

    expect(await screen.findByText(/maior ou igual a zero/i)).toBeInTheDocument()
    expect(setBudgetLimits).not.toHaveBeenCalled()
  })

  it('avisa quando o main falha ao salvar', async () => {
    const usuario = userEvent.setup()
    setBudgetLimits.mockRejectedValue(new Error('ipc caiu'))
    await montar()

    await screen.findByLabelText(/limite diário/i)
    await usuario.click(screen.getByRole('button', { name: /salvar limites/i }))

    expect(await screen.findByText(/não foi possível salvar/i)).toBeInTheDocument()
  })
})

describe('falha ao carregar', () => {
  it('mostra o erro NO LUGAR do conteúdo, não ao lado dele', async () => {
    // A régua herdada da M4-F03: com a carga falhando, exibir o aviso junto de limites zerados
    // diria "seu orçamento é zero" quando o certo é "não sabemos qual é". Por isso o teste
    // afirma sobre o que está **ausente**, e não só sobre o texto do alerta.
    getBudget.mockRejectedValue(new Error('banco fora'))
    render(<OrcamentoDoWorkspace workspace="jarvis" nomeDoEspaco="JARVIS OS" />)

    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/limite diário/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /salvar limites/i })).not.toBeInTheDocument()
  })
})

describe('operável por teclado (critério 7)', () => {
  it('alcança os dois campos e o botão pela tabulação, e salva com Enter', async () => {
    const usuario = userEvent.setup()
    await montar()

    const diario = await screen.findByLabelText(/limite diário/i)
    const mensal = screen.getByLabelText(/limite mensal/i)
    const salvar = screen.getByRole('button', { name: /salvar limites/i })

    diario.focus()
    expect(diario).toHaveFocus()
    await usuario.tab()
    expect(mensal).toHaveFocus()
    await usuario.tab()
    expect(salvar).toHaveFocus()

    // Enter no botão submete o formulário — sem mouse, o caminho inteiro fecha.
    await usuario.keyboard('{Enter}')
    await waitFor(() => expect(setBudgetLimits).toHaveBeenCalled())
  })
})
