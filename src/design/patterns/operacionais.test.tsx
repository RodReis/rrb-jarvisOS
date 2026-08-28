import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProvedorDeTema } from '@design/tokens/provider'
import {
  ApprovalDialog,
  LogViewer,
  MaskedCredentialSummary,
  MENSAGEM_BYOK,
  ProviderSetup,
  REDIGIDO,
  RemoveCredentialDialog,
  RuntimeUnavailable,
  SensitiveActionSummary,
  StatusOperacional,
  SyncStatus,
  type AcaoSensivel
} from './index'

/**
 * Padrões operacionais (SPEC-DesignSystem-04b, critérios 1–5).
 *
 * A redaction de texto tem suíte própria em `redigir.spec.ts` (Regras, ambiente `node`, função
 * pura). Aqui prova-se que os **componentes** a aplicam — que é outra coisa: uma função de
 * redaction perfeita não protege ninguém se o `LogViewer` esquecer de chamá-la.
 */

function comTema(ui: React.ReactNode): React.JSX.Element {
  return <ProvedorDeTema>{ui}</ProvedorDeTema>
}

const ACAO: AcaoSensivel = {
  acao: 'Executar deploy em produção',
  solicitante: 'agente-devops',
  impacto: 'Substitui a versão ativa em 3 servidores.',
  risco: 'alto',
  custoEstimado: 'US$ 0,42',
  escopo: 'cluster-prod'
}

describe('critério 1 — aprovação mostra tudo antes de confirmar', () => {
  it('o resumo exibe ação, solicitante, impacto, risco, escopo e custo', () => {
    render(comTema(<SensitiveActionSummary acao={ACAO} />))

    // Os cinco campos do critério, na tela **antes** da decisão. Um resumo sem impacto é a
    // confirmação genérica que a spec proíbe.
    expect(screen.getByText('Executar deploy em produção')).toBeInTheDocument()
    expect(screen.getByText('agente-devops')).toBeInTheDocument()
    expect(screen.getByText('Substitui a versão ativa em 3 servidores.')).toBeInTheDocument()
    expect(screen.getByText('Risco alto')).toBeInTheDocument()
    expect(screen.getByText('US$ 0,42')).toBeInTheDocument()
    expect(screen.getByText('cluster-prod')).toBeInTheDocument()
  })

  it('o risco é comunicado por texto, não só por cor (PRD §15)', () => {
    const { rerender } = render(comTema(<SensitiveActionSummary acao={ACAO} />))
    expect(screen.getByText('Risco alto')).toBeInTheDocument()

    rerender(comTema(<SensitiveActionSummary acao={{ ...ACAO, risco: 'baixo' }} />))
    // O texto muda junto — não é o mesmo rótulo pintado de outra cor.
    expect(screen.getByText('Risco baixo')).toBeInTheDocument()
    expect(screen.queryByText('Risco alto')).not.toBeInTheDocument()
  })

  it('o diálogo confirma com verbo específico e leva o resumo dentro', async () => {
    const aprovar = vi.fn()
    render(
      comTema(
        <ApprovalDialog
          aberto
          acao={ACAO}
          verboConfirmar="Executar deploy"
          onAprovar={aprovar}
          onRecusar={vi.fn()}
        />
      )
    )

    // O resumo está no diálogo — não numa tela anterior que o usuário já esqueceu.
    expect(screen.getByText('agente-devops')).toBeInTheDocument()
    // "Executar deploy", não "OK": o botão diz o que vai acontecer.
    const confirmar = screen.getByRole('button', { name: 'Executar deploy' })
    expect(screen.queryByRole('button', { name: /^ok$/i })).not.toBeInTheDocument()

    await userEvent.click(confirmar)
    expect(aprovar).toHaveBeenCalledOnce()
  })

  it('cancelar não aprova', async () => {
    const aprovar = vi.fn()
    const recusar = vi.fn()
    render(
      comTema(
        <ApprovalDialog
          aberto
          acao={ACAO}
          verboConfirmar="Executar deploy"
          onAprovar={aprovar}
          onRecusar={recusar}
        />
      )
    )

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(recusar).toHaveBeenCalledOnce()
    expect(aprovar).not.toHaveBeenCalled()
  })
})

describe('critério 2 — BYOK: a chave crua não fica na UI', () => {
  it('o setup exibe a mensagem obrigatória do PRD §12.5, literal', () => {
    render(comTema(<ProviderSetup provider="Anthropic" onSalvar={vi.fn()} />))

    // Literal, não parafraseada: as três informações dela mudam a decisão do usuário.
    expect(screen.getByText(MENSAGEM_BYOK)).toBeInTheDocument()
    expect(MENSAGEM_BYOK).toContain('não são armazenadas na nuvem')
    expect(MENSAGEM_BYOK).toContain('somente enquanto a Plataforma estiver aberta')
    expect(MENSAGEM_BYOK).toContain('precisará configurar as chaves novamente')
  })

  it('a chave sai por callback e some do campo no mesmo passo', async () => {
    const salvar = vi.fn()
    render(comTema(<ProviderSetup provider="Anthropic" onSalvar={salvar} />))

    const campo = screen.getByLabelText(/chave de api/i)
    await userEvent.type(campo, 'sk-ant-segredo123')
    await userEvent.click(screen.getByRole('button', { name: /salvar chave/i }))

    // Entregue uma vez ao chamador…
    expect(salvar).toHaveBeenCalledExactlyOnceWith('sk-ant-segredo123')
    // …e imediatamente esquecida. Enquanto estivesse no estado, apareceria em devtools e em
    // qualquer captura de estado do renderer.
    expect(campo).toHaveValue('')
  })

  it('o campo não deixa o gerenciador de senhas guardar a chave', () => {
    render(comTema(<ProviderSetup provider="Anthropic" onSalvar={vi.fn()} />))
    // `autoComplete` ligado faria o navegador persistir a chave — o "storage do renderer" que o
    // PRD §15 proíbe.
    expect(screen.getByLabelText(/chave de api/i)).toHaveAttribute('autocomplete', 'off')
  })

  it('o resumo mostra só provider, status, últimos 4 e data — nunca a chave', () => {
    render(
      comTema(
        <MaskedCredentialSummary
          credencial={{
            provider: 'Anthropic',
            ultimos4: '3f9a',
            estado: 'ativo',
            validadaEm: '23/07/2026'
          }}
        />
      )
    )

    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByLabelText('Chave terminada em 3f9a')).toBeInTheDocument()
    expect(screen.getByText(/validada em 23\/07\/2026/i)).toBeInTheDocument()
    // A garantia mais forte não é este teste — é o tipo `CredencialMascarada`, que não tem campo
    // onde a chave caiba. Aqui só se confirma que a superfície renderizada bate com o PRD §15.
    expect(document.body.textContent).not.toMatch(/sk-|segredo/i)
  })

  it('remover credencial informa as execuções afetadas e exige verbo específico', async () => {
    const remover = vi.fn()
    render(
      comTema(
        <RemoveCredentialDialog
          aberto
          provider="Anthropic"
          execucoesAfetadas={2}
          onRemover={remover}
          onCancelar={vi.fn()}
        />
      )
    )

    expect(screen.getByText(/2 execuções em andamento serão interrompidas/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remover chave de Anthropic' }))
    expect(remover).toHaveBeenCalledOnce()
  })

  it('zero execuções afetadas é informação, não omissão', () => {
    render(
      comTema(
        <RemoveCredentialDialog
          aberto
          provider="Anthropic"
          execucoesAfetadas={0}
          onRemover={vi.fn()}
          onCancelar={vi.fn()}
        />
      )
    )
    // Omitir a frase deixaria o usuário supondo se há execução em risco.
    expect(screen.getByText(/nenhuma execução em andamento será afetada/i)).toBeInTheDocument()
  })
})

describe('critério 3 — o LogViewer redige antes de exibir', () => {
  it('nenhum segredo do payload chega ao DOM', () => {
    render(
      comTema(
        <LogViewer
          linhas={[
            '[info] boot ok',
            'GET /v1/messages Authorization: Bearer sk-ant-vazou123456',
            '{"apiKey":"segredo-que-nao-pode-aparecer"}'
          ]}
        />
      )
    )

    const texto = screen.getByLabelText('Registro').textContent ?? ''
    expect(texto).not.toContain('sk-ant-vazou123456')
    expect(texto).not.toContain('segredo-que-nao-pode-aparecer')
    expect(texto).toContain(REDIGIDO)
    // O log continua útil: a linha limpa e os nomes dos campos sobrevivem.
    expect(texto).toContain('[info] boot ok')
    expect(texto).toContain('apiKey')
  })

  it('a redaction não é opcional — não há prop para desligá-la', () => {
    // Uma prop `redigir={false}` seria a que alguém passa "só neste caso" e vira vazamento.
    // Este teste falha por tipo se a prop for acrescentada com valor que a desative.
    render(comTema(<LogViewer linhas={['token=abc12345']} />))
    expect(screen.getByLabelText('Registro').textContent).toContain(REDIGIDO)
  })
})

describe('critério 4 — status por texto+ícone, não só cor', () => {
  it('SyncStatus distingue os cinco estados do PRD §12.4 por rótulo', () => {
    const esperado = [
      ['concluida', 'Sincronizado'],
      ['andamento', 'Sincronizando'],
      ['offline', 'Offline'],
      ['pendente', 'Pendente'],
      ['falha', 'Falha na sincronização']
    ] as const

    for (const [estado, rotulo] of esperado) {
      const { unmount } = render(comTema(<SyncStatus estado={estado} />))
      expect(screen.getByText(rotulo)).toBeInTheDocument()
      unmount()
    }
  })

  it('`offline` e `pendente` compartilham a cor e se separam pelo texto', () => {
    // É o caso que prova o critério: dois estados no mesmo tom `warn`. Se a cor fosse o único
    // sinal, seriam indistinguíveis.
    const { unmount } = render(comTema(<SyncStatus estado="offline" />))
    expect(screen.getByText('Offline')).toBeInTheDocument()
    unmount()

    render(comTema(<SyncStatus estado="pendente" />))
    expect(screen.getByText('Pendente')).toBeInTheDocument()
  })

  it('StatusOperacional anuncia o tom em texto para o leitor de tela', () => {
    const { unmount } = render(comTema(<StatusOperacional estado="ativo" rotulo="Agente" />))
    expect(screen.getByText('sucesso')).toBeInTheDocument()
    unmount()

    render(comTema(<StatusOperacional estado="inativo" rotulo="Agente" />))
    // `inativo` não tem tom semântico — e a ausência é anunciada como tal, em vez de virar um
    // quinto tom inventado.
    expect(screen.getByText('inativo')).toBeInTheDocument()
  })
})

describe('critério 5 — runtime indisponível permite copiar diagnóstico redigido e reiniciar', () => {
  const DIAGNOSTICO = [
    'runtime saiu com código 1',
    'último request Authorization: Bearer sk-x9y8z7w6'
  ]

  it('o texto copiado vai **redigido** — é o que sai do dispositivo', async () => {
    const copiar = vi.fn()
    render(
      comTema(
        <RuntimeUnavailable
          mensagem="O processo não respondeu."
          diagnostico={DIAGNOSTICO}
          onCopiarDiagnostico={copiar}
        />
      )
    )

    await userEvent.click(screen.getByRole('button', { name: /copiar diagnóstico/i }))

    const copiado = copiar.mock.calls[0]?.[0] as string
    // O diagnóstico é justamente o texto que o usuário cola num chat de suporte. Se o segredo
    // sobreviver à cópia, ele deixa o dispositivo.
    expect(copiado).not.toContain('sk-x9y8z7w6')
    expect(copiado).toContain(REDIGIDO)
    expect(copiado).toContain('runtime saiu com código 1')
  })

  it('reiniciar é oferecido quando permitido e ausente quando não', async () => {
    const reiniciar = vi.fn()
    const { unmount } = render(
      comTema(<RuntimeUnavailable mensagem="x" diagnostico={DIAGNOSTICO} onReiniciar={reiniciar} />)
    )
    await userEvent.click(screen.getByRole('button', { name: /reiniciar runtime/i }))
    expect(reiniciar).toHaveBeenCalledOnce()
    unmount()

    // Sem `onReiniciar`, o botão não existe — em vez de existir e não fazer nada.
    render(comTema(<RuntimeUnavailable mensagem="x" diagnostico={DIAGNOSTICO} />))
    expect(screen.queryByRole('button', { name: /reiniciar runtime/i })).not.toBeInTheDocument()
  })
})
