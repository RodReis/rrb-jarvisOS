import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnexosDeDesign } from './AnexosDeDesign'

/**
 * O painel de anexos de design (SPEC-Planejamento-05, categoria Tela).
 *
 * O que se investiga aqui é o que a tela **pede** ao main e o que ela **mostra** do que voltou.
 * A ponte é mockada porque o renderer não decide nada: o gate, a validação e a composição são do
 * main — um mock que decidisse aqui provaria a política do teste, não a do produto.
 *
 * As duas coisas que este teste protege e nenhum outro nível protege:
 *  - **escolher não é anexar** — cancelar o seletor não chama o canal do ato nem alerta;
 *  - **o que falta aparece nomeado**, não como contador: o PI precisa saber *qual* metade falta.
 */

const listarAnexos = vi.fn()
const listarArquiteturas = vi.fn()
const escolherAnexo = vi.fn()
const anexarDesign = vi.fn()
const removerAnexo = vi.fn()
const validarPrototipos = vi.fn()
const gerarArquitetura = vi.fn()
const sendLog = vi.fn()

function anexo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    tipo: 'design-system',
    caminho: 'docs/DESIGN-SYSTEM.md',
    origem: 'C:/externo/DESIGN-SYSTEM.md',
    hash: 'a'.repeat(64),
    bytes: 120,
    anexadoEm: '2026-08-30T12:00:00.000Z',
    ...over
  }
}

const PROTOTIPO = anexo({
  id: 'a-2',
  tipo: 'prototipo',
  caminho: 'docs/prototipos/home.html',
  hash: 'b'.repeat(64)
})

function renderizar(): void {
  render(<AnexosDeDesign workspace="jarvis" projectId="p-1" nomeDoProjeto="Projeto Alfa" />)
}

beforeEach(() => {
  listarAnexos.mockReset().mockResolvedValue([])
  listarArquiteturas.mockReset().mockResolvedValue([])
  escolherAnexo.mockReset()
  anexarDesign.mockReset()
  removerAnexo.mockReset().mockResolvedValue(true)
  validarPrototipos.mockReset().mockResolvedValue([])
  gerarArquitetura.mockReset()
  sendLog.mockReset()

  Object.defineProperty(window, 'jarvis', {
    value: {
      listarAnexos,
      listarArquiteturas,
      escolherAnexo,
      anexarDesign,
      removerAnexo,
      validarPrototipos,
      gerarArquitetura,
      sendLog
    },
    configurable: true,
    writable: true
  })
})

describe('o gate na tela', () => {
  it('nomeia o que falta em vez de mostrar um contador', async () => {
    renderizar()

    // "Falta anexar: DESIGN-SYSTEM.md, Protótipo HTML" — e não "0 de 2".
    expect(await screen.findByText(/Falta anexar/)).toBeInTheDocument()
    expect(screen.getByText(/DESIGN-SYSTEM\.md, Protótipo HTML/)).toBeInTheDocument()
  })

  it('mostra o estado de cada exigência com texto, não só cor', async () => {
    listarAnexos.mockResolvedValue([anexo()])

    renderizar()

    // Uma atendida, uma pendente — as duas com rótulo legível.
    expect(await screen.findByText('Anexado')).toBeInTheDocument()
    expect(screen.getByText('Pendente')).toBeInTheDocument()
  })

  it('desabilita gerar arquitetura enquanto o gate estiver fechado', async () => {
    listarAnexos.mockResolvedValue([anexo()])

    renderizar()
    await screen.findByText('Anexado')

    expect(screen.getByRole('button', { name: 'Gerar arquitetura' })).toBeDisabled()
  })

  it('habilita gerar arquitetura quando as duas exigências estão atendidas', async () => {
    listarAnexos.mockResolvedValue([anexo(), PROTOTIPO])

    renderizar()

    expect(await screen.findByText(/Os anexos estão completos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gerar arquitetura' })).toBeEnabled()
  })
})

describe('o ato de anexar', () => {
  it('escolhe no seletor do main e anexa o caminho escolhido', async () => {
    const usuario = userEvent.setup()
    escolherAnexo.mockResolvedValue('C:/externo/DESIGN-SYSTEM.md')
    anexarDesign.mockResolvedValue({ reason: 'anexado', anexo: anexo(), mensagem: 'ok' })

    renderizar()
    await screen.findByText(/Falta anexar/)

    await usuario.click(screen.getAllByRole('button', { name: 'Anexar' })[0]!)

    // A tela manda o **caminho**, nunca o conteúdo: quem lê e copia é o main.
    await waitFor(() =>
      expect(anexarDesign).toHaveBeenCalledWith(
        'p-1',
        'design-system',
        'C:/externo/DESIGN-SYSTEM.md',
        'jarvis'
      )
    )
  })

  /**
   * Escolher não é anexar. Cancelar o seletor não produz desfecho nenhum — mostrar um alerta
   * ensinaria o PI a ler "mudei de ideia" como erro.
   */
  it('cancelar o seletor não anexa nem alerta', async () => {
    const usuario = userEvent.setup()
    escolherAnexo.mockResolvedValue('')

    renderizar()
    await screen.findByText(/Falta anexar/)

    await usuario.click(screen.getAllByRole('button', { name: 'Anexar' })[0]!)

    await waitFor(() => expect(escolherAnexo).toHaveBeenCalled())
    expect(anexarDesign).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('não há campo de caminho digitável', async () => {
    renderizar()
    await screen.findByText(/Falta anexar/)

    // Um caminho digitado apontaria para um arquivo que o app não confirmou existir.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('mostra o hash truncado com o completo no rótulo acessível', async () => {
    listarAnexos.mockResolvedValue([anexo()])

    renderizar()

    const hash = await screen.findByLabelText(`Hash completo: ${'a'.repeat(64)}`)
    expect(hash).toHaveTextContent('a'.repeat(12))
  })
})

describe('os achados da validação', () => {
  it('mostra pergunta e recomendação, não veredito', async () => {
    const usuario = userEvent.setup()
    listarAnexos.mockResolvedValue([anexo(), PROTOTIPO])
    validarPrototipos.mockResolvedValue([
      {
        prototipo: 'docs/prototipos/home.html',
        jornadasCobertas: [],
        achados: [
          {
            id: 'x',
            prototipo: 'docs/prototipos/home.html',
            severidade: 'impede-arquitetura',
            pergunta: 'O arquivo "assets/logo.png" é usado mas não foi anexado. Ele existe?',
            recomendacao: 'Anexe o asset pelo seletor.',
            evidencia: 'Referência não resolvida: assets/logo.png'
          }
        ]
      }
    ])

    renderizar()
    await screen.findByText(/Os anexos estão completos/)

    await usuario.click(screen.getByRole('button', { name: 'Validar protótipos' }))

    expect(await screen.findByText(/Ele existe\?/)).toBeInTheDocument()
    expect(screen.getByText(/Recomendação: Anexe o asset pelo seletor/)).toBeInTheDocument()
    // O que impede leva marcação própria: a consequência é diferente.
    expect(screen.getByText('Impede a arquitetura')).toBeInTheDocument()
  })

  it('diz quando a validação não achou nada, em vez de ficar em branco', async () => {
    const usuario = userEvent.setup()
    listarAnexos.mockResolvedValue([anexo(), PROTOTIPO])
    validarPrototipos.mockResolvedValue([
      { prototipo: 'docs/prototipos/home.html', jornadasCobertas: ['Início'], achados: [] }
    ])

    renderizar()
    await screen.findByText(/Os anexos estão completos/)

    await usuario.click(screen.getByRole('button', { name: 'Validar protótipos' }))

    expect(await screen.findByText(/não apresentaram problemas/)).toBeInTheDocument()
  })

  it('desabilita validar quando não há protótipo anexado', async () => {
    listarAnexos.mockResolvedValue([anexo()])

    renderizar()
    await screen.findByText('Anexado')

    expect(screen.getByRole('button', { name: 'Validar protótipos' })).toBeDisabled()
  })
})

describe('a geração da arquitetura', () => {
  it('mostra a recusa com o que falta, sem tom de erro', async () => {
    const usuario = userEvent.setup()
    listarAnexos.mockResolvedValue([anexo(), PROTOTIPO])
    gerarArquitetura.mockResolvedValue({
      reason: 'prd-ausente',
      mensagem: 'Gere o PRD antes da arquitetura: ela precisa citar a revisão que assume.'
    })

    renderizar()
    await screen.findByText(/Os anexos estão completos/)

    await usuario.click(screen.getByRole('button', { name: 'Gerar arquitetura' }))

    expect(await screen.findByText(/Gere o PRD antes da arquitetura/)).toBeInTheDocument()
  })

  it('mostra os quatro documentos gerados com hash e commit', async () => {
    listarAnexos.mockResolvedValue([anexo(), PROTOTIPO])
    listarArquiteturas.mockResolvedValue([
      {
        id: 'arq-1',
        user_id: 'u-1',
        workspace_id: 'jarvis',
        projectId: 'p-1',
        pacoteEstruturalId: 'pac-1',
        documentos: ['ARCHITECTURE', 'DECISIONS', 'TESTING', 'REVIEW'].map((d) => ({
          documento: d,
          caminho: `docs/${d}.md`,
          conteudo: '#',
          hash: 'c'.repeat(64),
          afirmacoes: []
        })),
        anexos: [],
        hash: 'd'.repeat(64),
        commitHash: 'c0ffee1234',
        created_at: '2026-08-30T12:00:00.000Z'
      }
    ])

    renderizar()

    expect(await screen.findByText('docs/ARCHITECTURE.md')).toBeInTheDocument()
    expect(screen.getByText('docs/REVIEW.md')).toBeInTheDocument()
    expect(screen.getByLabelText('Commit completo: c0ffee1234')).toHaveTextContent('c0ffee12')
  })

  it('não oferece campo de conteúdo de documento', async () => {
    listarAnexos.mockResolvedValue([anexo(), PROTOTIPO])

    renderizar()
    await screen.findByText(/Os anexos estão completos/)

    // Um editor aqui seria o caminho por onde uma afirmação sem origem entraria.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
