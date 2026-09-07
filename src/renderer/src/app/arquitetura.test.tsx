import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComTrilha } from './trilha-de-teste'
import { ArquiteturaDoProjeto } from './ArquiteturaDoProjeto'

/**
 * O gate da arquitetura, das decisões, dos testes e da revisão (SPEC-Jornada-04, categoria Tela).
 *
 * A tela é testada **isolada**, e a ponte é mockada: o renderer não decide nada — o gate de
 * anexos, o validador de âncora e a análise de coerência são do main, e um mock que decidisse
 * aqui provaria a política do teste, não a do produto.
 *
 * O que estes testes protegem:
 *  - **Critério 1:** "faltam anexos" chega nomeando o que falta, com tom de aviso, não de erro.
 *  - **Critério 2:** a âncora do protótipo é **visível** — tela, arquivo e hash —, e não só o
 *    rótulo "do protótipo".
 *  - **Critério 4:** os ajustes aparecem com a recomendação, **só podem ser descartados**, e não
 *    travam o aceite. É a garantia de que a tela não promete mexer no anexo do PI.
 *  - **§ Gate:** os propostos são visíveis por documento, não descobertos lendo tudo.
 *  - **Princípio 2:** a origem é dita em texto, não pintada.
 */

const gerarArquiteturaPorIa = vi.fn()
const carregarArquitetura = vi.fn()
const cortarPropostoDaArquitetura = vi.fn()
const descartarAjusteDaArquitetura = vi.fn()
const aplicarEventoDaJornada = vi.fn()
const aprovarGate = vi.fn()

const HASH = 'a'.repeat(64)

function doPrototipo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    documento: 'ARCHITECTURE',
    secao: 'Fluxos cobertos',
    texto: 'O usuário entra na conta e chega à lista.',
    origem: 'prototipo',
    ancora: { anexo: 'docs/prototipos/login.html', hash: HASH, jornada: 'Entrar na conta' },
    ...over
  }
}

function arquitetura(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    pacoteEstruturalId: 'pac-1',
    afirmacoes: [doPrototipo()],
    ajustes: [],
    anexos: [],
    hash: 'h',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  }
}

/**
 * Monta o painel **junto do botão que a trilha desenha** (#332, defeito 4).
 *
 * O gerar e o aceitar saíram do painel por decisão do PI, e é a trilha que os oferece agora. A
 * etapa escolhe qual dos dois: `arquitetura` gera, `pacote-aceito` aceita.
 */
function montar(etapa: 'arquitetura' | 'pacote-aceito' = 'arquitetura'): void {
  render(
    <ComTrilha
      etapa={etapa}
      painel={({ onAcaoDaEtapa, onOcupado }) => (
        <ArquiteturaDoProjeto
          workspace="jarvis"
          projectId="p-1"
          nomeDoProjeto="Leituras"
          onAceito={vi.fn()}
          etapa={etapa}
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupado}
        />
      )}
    />
  )
}

beforeEach(() => {
  gerarArquiteturaPorIa.mockReset().mockResolvedValue({ resultado: 'gerada', mensagem: 'ok' })
  carregarArquitetura.mockReset().mockResolvedValue(null)
  cortarPropostoDaArquitetura.mockReset().mockResolvedValue(null)
  descartarAjusteDaArquitetura.mockReset().mockResolvedValue(null)
  aplicarEventoDaJornada.mockReset().mockResolvedValue({ resultado: 'avancou' })
  aprovarGate.mockReset().mockResolvedValue({ reason: 'aprovado', mensagem: 'Aprovado.' })

  Object.defineProperty(window, 'jarvis', {
    value: {
      gerarArquiteturaPorIa,
      carregarArquitetura,
      cortarPropostoDaArquitetura,
      descartarAjusteDaArquitetura,
      aplicarEventoDaJornada,
      aprovarGate,
      sendLog: vi.fn()
    },
    configurable: true,
    writable: true
  })
})

describe('as recusas do gate são conteúdo, não erro (critério 1)', () => {
  it('faltam anexos: mostra o que falta, nomeado', async () => {
    const user = userEvent.setup()
    gerarArquiteturaPorIa.mockResolvedValue({
      resultado: 'anexos-pendentes',
      pendencias: ['prototipo'],
      mensagem: 'Faltam anexos do design: prototipo.'
    })
    montar()

    await user.click(await screen.findByRole('button', { name: /gerar/i }))

    // O título vem do contrato (o motivo da recusa) e a mensagem, do serviço. Os dois aparecem:
    // o primeiro diz **o que** aconteceu, o segundo **qual** anexo falta.
    expect(await screen.findByText('Faltam anexos do design')).toBeInTheDocument()
    expect(screen.getByText('Faltam anexos do design: prototipo.')).toBeInTheDocument()
    expect(screen.getByText('Protótipo HTML')).toBeInTheDocument()
  })

  it('protótipo inválido chega como pergunta com recomendação, não como veredito', async () => {
    const user = userEvent.setup()
    gerarArquiteturaPorIa.mockResolvedValue({
      resultado: 'prototipos-invalidos',
      achados: [
        {
          id: 'x',
          prototipo: 'docs/prototipos/login.html',
          severidade: 'impede-arquitetura',
          pergunta: 'A tela abriu em branco. O protótipo está completo?',
          recomendacao: 'Reanexe o protótipo renderizado.',
          evidencia: 'elementosVisiveis = 0'
        }
      ],
      mensagem: 'Os protótipos têm problemas.'
    })
    montar()

    await user.click(await screen.findByRole('button', { name: /gerar/i }))

    expect(await screen.findByText(/o protótipo está completo\?/i)).toBeInTheDocument()
  })

  it('a saída recusada lista os problemas do validador, um por linha', async () => {
    const user = userEvent.setup()
    gerarArquiteturaPorIa.mockResolvedValue({
      resultado: 'saida-invalida',
      problemas: ['A afirmação "a-9" descreve um fluxo sem âncora.'],
      mensagem: 'A saída não passou no validador.'
    })
    montar()

    await user.click(await screen.findByRole('button', { name: /gerar/i }))

    expect(await screen.findByText(/descreve um fluxo sem âncora/i)).toBeInTheDocument()
  })
})

describe('a âncora do protótipo é visível (critério 2)', () => {
  it('mostra a tela, o arquivo e o hash que sustentam o fluxo', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar()

    expect(await screen.findByText('Entrar na conta')).toBeInTheDocument()
    expect(screen.getByText('docs/prototipos/login.html')).toBeInTheDocument()
    expect(screen.getByText(`sha256:${HASH.slice(0, 16)}`)).toBeInTheDocument()
  })

  it('a origem é dita em texto, não pintada (princípio 2)', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar()

    expect(await screen.findByText(/do protótipo que você desenhou/i)).toBeInTheDocument()
  })
})

describe('os propostos, por documento (§ Gate)', () => {
  const PROPOSTO = doPrototipo({
    id: 'a-2',
    documento: 'DECISIONS',
    secao: 'Decisões estruturais',
    texto: 'Guardar o histórico numa tabela separada.',
    origem: 'proposto',
    ancora: undefined
  })

  it('reúne os propostos na aba "A revisar", agrupados por documento', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura({ afirmacoes: [doPrototipo(), PROPOSTO] }))
    montar()

    // A aba abre primeiro quando há pendência: é a resposta a "há algo a cortar aqui?", que antes
    // exigia rolar a etapa inteira (#333).
    const revisar = await screen.findByRole('tabpanel')
    expect(within(revisar).getByText(/afirmações propostas pela IA/i)).toBeInTheDocument()
    expect(
      within(revisar).getByText('Guardar o histórico numa tabela separada.')
    ).toBeInTheDocument()
  })

  it('o proposto aparece uma vez por aba — a duplicação dentro do documento saiu', async () => {
    /*
     * **Este teste afirmava o defeito.** Ele esperava `toHaveLength(2)` com o comentário "duas
     * ocorrências do mesmo proposto", porque o documento repetia acima das seções o que já
     * mostrava no corpo — a mesma frase duas vezes na mesma tela, com botão nas duas. Era metade
     * da altura desta etapa (#333).
     *
     * Agora cada aba mostra o proposto uma vez: na "A revisar" para decidir, na do documento para
     * ler no contexto da seção. Os painéis inativos são desmontados pelo DS, então o que a árvore
     * tem é o que a aba aberta mostra.
     */
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura({ afirmacoes: [doPrototipo(), PROPOSTO] }))
    montar()

    const cortar = await screen.findAllByRole('button', { name: /cortar a afirmação/i })
    expect(cortar).toHaveLength(1)

    await user.click(cortar[0]!)

    await waitFor(() => {
      expect(cortarPropostoDaArquitetura).toHaveBeenCalledWith('p-1', 'a-2', 'jarvis')
    })
  })

  it('o corte continua ao alcance dentro da aba do documento', async () => {
    // A garantia que o redesenho não pode perder: afirmação `proposto` distinguível e cortável.
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura({ afirmacoes: [doPrototipo(), PROPOSTO] }))
    montar()

    // O proposto do fixture vive em DECISIONS: a aba certa é a dele.
    await user.click(await screen.findByRole('tab', { name: 'Decisões' }))

    const painel = screen.getByRole('tabpanel')
    expect(
      within(painel).getByText('Guardar o histórico numa tabela separada.')
    ).toBeInTheDocument()

    /*
     * **Uma vez, não duas.** `getByRole` no singular é o que prova: com a duplicação de volta, o
     * proposto aparece no bloco acima das seções e de novo no corpo, e a chamada falha por achar
     * dois. `getAllByRole(...).toHaveLength(1)` diria o mesmo, mas a mensagem de erro do singular
     * nomeia o defeito ("found multiple elements") sem que ninguém precise ler o teste.
     */
    expect(within(painel).getByRole('button', { name: /cortar a afirmação/i })).toBeInTheDocument()
    expect(within(painel).getAllByText('Guardar o histórico numa tabela separada.')).toHaveLength(1)
  })
})

describe('os ajustes da análise de coerência (critério 4)', () => {
  const AJUSTE = {
    id: 'j-1',
    tipo: 'tela-sem-requisito',
    jornada: 'Entrar na conta',
    observacao: 'A tela existe e nenhum requisito a pede.',
    recomendacao: 'Confirmar se o login entra nesta versão.'
  }

  it('mostra a observação e a recomendação', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar()

    expect(await screen.findByText(/nenhum requisito a pede/i)).toBeInTheDocument()
    expect(screen.getByText(/confirmar se o login entra/i)).toBeInTheDocument()
  })

  it('diz que nada foi alterado no anexo — a garantia do critério 4 em texto', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar()

    expect(await screen.findByText(/nada foi alterado nos anexos/i)).toBeInTheDocument()
  })

  it('a única ação é descartar: não existe botão que prometa aplicar', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar()

    await screen.findByRole('button', { name: /descartar o ajuste/i })
    expect(screen.queryByRole('button', { name: /aplicar/i })).not.toBeInTheDocument()
  })

  it('descartar manda o id do ajuste', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar()

    await user.click(await screen.findByRole('button', { name: /descartar o ajuste/i }))

    await waitFor(() => {
      expect(descartarAjusteDaArquitetura).toHaveBeenCalledWith('p-1', 'j-1', 'jarvis')
    })
  })

  it('ajuste pendente NÃO trava o aceite: é proposta sobre o desenho, não conflito interno', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar('pacote-aceito')

    expect(await screen.findByRole('button', { name: /aceitar o pacote/i })).toBeEnabled()
  })
})

/**
 * O aviso de chegada dos ajustes (#332, defeito 5).
 *
 * O PI gerou a arquitetura, a tela mostrou "8 ajustes propostos", e ele só descobriu isso
 * rolando a página por conta própria. A lista fica abaixo da dobra, e quem acabou de clicar em
 * gerar está olhando o topo.
 */
/**
 * As abas (issue #333).
 *
 * O que elas resolvem: a etapa media 4.941px numa janela de 900 — cinco telas e meia para um
 * projeto pequeno. Nenhuma aba passa de duas telas agora.
 */
describe('as abas do pacote (issue #333)', () => {
  const AJUSTE = {
    id: 'j-1',
    tipo: 'tela-sem-requisito',
    jornada: 'Entrar na conta',
    observacao: 'A tela existe e nenhum requisito a pede.',
    recomendacao: 'Confirmar se o login entra no escopo desta versão.'
  }
  const PROPOSTO = doPrototipo({
    id: 'a-9',
    documento: 'DECISIONS',
    secao: 'Decisões estruturais',
    texto: 'Guardar o histórico numa tabela separada.',
    origem: 'proposto',
    ancora: undefined
  })

  it('há uma aba por documento, mais a de revisão', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar()

    await screen.findByRole('tablist')
    // Quatro documentos + "A revisar".
    expect(screen.getAllByRole('tab')).toHaveLength(5)
  })

  it('o contador aparece no rótulo da aba — sem precisar entrar nela', async () => {
    carregarArquitetura.mockResolvedValue(
      arquitetura({ afirmacoes: [PROPOSTO], ajustes: [AJUSTE] })
    )
    montar()

    // 1 proposto + 1 ajuste. O defeito 5 da #332 foi o PI descobrir os oito rolando a página; o
    // número no rótulo é o que torna a pendência visível de fora.
    expect(await screen.findByRole('tab', { name: 'A revisar (2)' })).toBeInTheDocument()
  })

  it('sem pendência o rótulo diz isso, em vez de anunciar zero', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar()

    // "A revisar (0)" seria ruído: anunciaria uma pendência que não existe.
    expect(await screen.findByRole('tab', { name: 'Nada a revisar' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /\(0\)/ })).not.toBeInTheDocument()
  })

  it('abre no que pede decisão quando há pendência', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar()

    expect(await screen.findByRole('tab', { name: 'A revisar (1)' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('sem nada a decidir, abre no primeiro documento — só resta ler', async () => {
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar()

    expect(await screen.findByRole('tab', { name: 'Arquitetura' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('as abas são operáveis por teclado', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar()

    const primeira = await screen.findByRole('tab', { name: 'A revisar (1)' })
    primeira.focus()
    await user.keyboard('{ArrowRight}')

    // A seta move o foco **e** a seleção, que é o padrão ARIA de abas automáticas.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Arquitetura' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    )
  })

  it('o aceite fica fora das abas — alcançável de qualquer uma', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE] }))
    montar('pacote-aceito')

    await screen.findByLabelText('Aceite do pacote')
    await user.click(screen.getByRole('tab', { name: 'Testes' }))

    // Trocar de aba não pode esconder a soleira da etapa.
    expect(screen.getByLabelText('Aceite do pacote')).toBeInTheDocument()
  })
})

describe('a chegada dos ajustes', () => {
  const AJUSTE_NOVO = {
    id: 'j-9',
    tipo: 'estado-ausente',
    jornada: 'Painel',
    observacao: 'A tela não mostra o estado de carregando.',
    recomendacao: 'Desenhar o estado no protótipo.'
  }

  it('avisa em pop-up quando a geração traz ajustes', async () => {
    const user = userEvent.setup()
    // Sem revisão antes de gerar; a geração traz a revisão com o ajuste.
    carregarArquitetura.mockResolvedValueOnce(null)
    montar()

    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE_NOVO] }))
    await user.click(await screen.findByRole('button', { name: 'Gerar a arquitetura' }))

    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/A IA propôs 1 ajuste/)).toBeInTheDocument()
  })

  it('o aviso responde "ajuste é DISCARTE?" — a pergunta que o PI fez', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValueOnce(null)
    montar()

    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE_NOVO] }))
    await user.click(await screen.findByRole('button', { name: 'Gerar a arquitetura' }))

    const dialogo = await screen.findByRole('dialog')
    expect(
      within(dialogo).getByText(/única ação sobre um ajuste é descartá-lo/)
    ).toBeInTheDocument()
  })

  it('geração sem ajustes não abre pop-up — aviso à toa vira ruído', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValueOnce(null)
    montar()

    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [] }))
    await user.click(await screen.findByRole('button', { name: 'Gerar a arquitetura' }))

    await waitFor(() => expect(carregarArquitetura).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('revisão já lida que volta à tela não reabre o aviso', async () => {
    // O PI trocou de menu e voltou. Um pop-up a cada montagem viraria ruído, e ruído se fecha
    // sem ler — que é exatamente o defeito que este aviso existe para não repetir.
    carregarArquitetura.mockResolvedValue(arquitetura({ ajustes: [AJUSTE_NOVO] }))
    montar()

    await screen.findByText('A tela não mostra o estado de carregando.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('o aceite do pacote', () => {
  it('vai pelo canal de evento da jornada, com o evento pacote-aceito', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar('pacote-aceito')

    await user.click(await screen.findByRole('button', { name: /aceitar o pacote/i }))

    await waitFor(() => {
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'pacote-aceito', 'jarvis')
    })
  })

  /*
   * **O defeito que o PI relatou:** "o botão ACEITAR PACOTE não funciona".
   *
   * Ele funcionava — chamava o main a cada clique, e o main recusava as oito vezes com
   * `aceite-ausente`. A etapa `pacote-aceito` está em `GATE_DA_ETAPA` e exige um `Approval` do
   * gate `PROJECT_PACKAGE`; a tela chamava só `aplicarEventoDaJornada`, e o gate só era aprovável
   * na tela do **roadmap**, que aparece depois desta etapa.
   *
   * Nenhum teste pegava porque o dublê não tinha `aprovarGate`: a chamada que faltava também
   * faltava na prova.
   */
  it('aprova o gate PROJECT_PACKAGE antes de mover a etapa', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar('pacote-aceito')

    await user.click(await screen.findByRole('button', { name: /aceitar o pacote/i }))

    await waitFor(() =>
      expect(aprovarGate).toHaveBeenCalledWith('p-1', 'PROJECT_PACKAGE', 'jarvis')
    )
    expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'pacote-aceito', 'jarvis')
  })

  it('gate recusado não move a etapa — e diz por quê', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura())
    aprovarGate.mockResolvedValue({
      reason: 'sem-revisoes',
      mensagem: 'Nenhuma revisão a aprovar.'
    })
    montar('pacote-aceito')

    await user.click(await screen.findByRole('button', { name: /aceitar o pacote/i }))

    // Mover a etapa sem a evidência é o que o serviço da jornada recusa; tentar mesmo assim faria
    // a tela pedir o que já sabe que vai falhar.
    await screen.findByText('Nenhuma revisão a aprovar.')
    expect(aplicarEventoDaJornada).not.toHaveBeenCalled()
  })

  it('a recusa traz a ação que destrava, não só a mensagem', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura())
    aprovarGate.mockResolvedValue({
      reason: 'marcos-pendentes',
      mensagem: 'Faltam marcos commitados.',
      problemas: [{ mensagem: 'docs/PRD.md sem commit', acao: 'Commite o PRD aceito.' }]
    })
    montar('pacote-aceito')

    await user.click(await screen.findByRole('button', { name: /aceitar o pacote/i }))

    // Bloqueio sem saída é beco: a spec proíbe o "aceitar mesmo assim" porque o caminho é o
    // remédio, não um botão de contornar.
    expect(await screen.findByText('docs/PRD.md sem commit')).toBeInTheDocument()
    expect(screen.getByText('Commite o PRD aceito.')).toBeInTheDocument()
  })

  it('gate já aprovado segue em frente — não trava o PI numa etapa que pode avançar', async () => {
    const user = userEvent.setup()
    carregarArquitetura.mockResolvedValue(arquitetura())
    aprovarGate.mockResolvedValue({ reason: 'ja-aprovado', mensagem: 'Já aprovado.' })
    montar('pacote-aceito')

    await user.click(await screen.findByRole('button', { name: /aceitar o pacote/i }))

    // A evidência que o evento confere já existe: recusar aqui seria travar por um estado certo.
    await waitFor(() =>
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'pacote-aceito', 'jarvis')
    )
  })

  it('sem revisão, a tela pede a geração em vez de oferecer o aceite', async () => {
    montar()

    expect(await screen.findByText(/nenhum documento ainda/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aceitar o pacote/i })).not.toBeInTheDocument()
  })

  it('o aceite não aparece duplicado dentro do painel — ele mora na trilha', async () => {
    // A regra do PI (#332): avanço e aceite ficam na trilha; dois botões com o mesmo nome, um
    // do lado do outro, não dá. Este teste reprova se o botão do painel voltar.
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar('pacote-aceito')

    const painel = await screen.findByLabelText('Aceite do pacote')
    expect(within(painel).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aceitar o pacote/i })).toBeInTheDocument()
  })
})
