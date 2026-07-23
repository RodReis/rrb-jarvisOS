import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  Meter,
  NotificationCenter,
  NotificationItem,
  Panel,
  Progress,
  Skeleton,
  Spinner,
  Table,
  Tag,
  Tree,
  UnreadIndicator,
  type Coluna,
  type Notificacao
} from './index'

/**
 * Dados, feedback e notificações (SPEC-DesignSystem-03b, critérios 4 e 5; PRD §11.4/§11.5/§12.6).
 *
 * O critério 4 — "estado identificável **sem cor**" — é o eixo desta suíte. Ele não se prova
 * medindo cor: prova-se afirmando que existe um sinal **não-cromático** para cada estado. Em
 * jsdom isso é texto e papel ARIA, que é justamente o que sobrevive ao daltonismo, ao alto
 * contraste e ao leitor de tela. Um componente que passasse a comunicar só por `className` de
 * cor derrubaria estas asserções.
 */

interface Linha {
  readonly id: string
  readonly nome: string
  readonly custo: number
}

const COLUNAS: ReadonlyArray<Coluna<Linha>> = [
  { chave: 'nome', cabecalho: 'Workflow', celula: (l) => l.nome },
  { chave: 'custo', cabecalho: 'Custo', celula: (l) => l.custo, numerica: true }
]

const LINHAS: readonly Linha[] = [
  { id: 'a', nome: 'Backup diário', custo: 12 },
  { id: 'b', nome: 'Sync de contatos', custo: 340 }
]

describe('Badge (critério 4)', () => {
  it('o estado está no texto; o ponto é reforço e não é anunciado', () => {
    render(
      <Badge tom="ok" comPonto>
        Operacional
      </Badge>
    )

    // A palavra "Operacional" é o estado. Se o componente comunicasse por cor da borda, este
    // texto seria dispensável — e o badge ficaria mudo em alto contraste.
    expect(screen.getByText('Operacional')).toBeInTheDocument()
  })

  it('sem tom continua legível — a cor nunca foi o que informava', () => {
    render(<Badge>Desconhecido</Badge>)
    expect(screen.getByText('Desconhecido')).toBeInTheDocument()
  })
})

describe('Progress e Meter (critério 4)', () => {
  it('Progress é progressbar com rótulo e valor — não uma barra anônima', () => {
    render(<Progress valor={40} rotulo="Enviando arquivos" />)

    const barra = screen.getByRole('progressbar', { name: 'Enviando arquivos' })
    expect(barra).toHaveAttribute('aria-valuenow', '40')
  })

  it('Progress indeterminado não finge saber o valor', () => {
    render(<Progress rotulo="Processando" />)

    // Sem `aria-valuenow`, o leitor anuncia "indeterminado" em vez de um número inventado.
    // Um `0` aqui seria pior que a ausência: diria "nada foi feito".
    expect(screen.getByRole('progressbar', { name: 'Processando' })).not.toHaveAttribute(
      'aria-valuenow'
    )
  })

  it('Meter é meter (medida estática), com o valor **em texto** ao lado da barra', () => {
    render(
      <Meter
        valor={82}
        rotulo="Orçamento usado"
        formatar={(v) => `${v}%`}
        faixas={[
          { ate: 70, tom: 'ok' },
          { ate: 90, tom: 'warn' },
          { ate: 100, tom: 'err' }
        ]}
      />
    )

    const medidor = screen.getByRole('meter', { name: 'Orçamento usado' })
    expect(medidor).toHaveAttribute('aria-valuenow', '82')
    expect(medidor).toHaveAttribute('aria-valuetext', '82%')
    // O número aparece escrito: a faixa âmbar sinaliza "atenção" por cor, mas o `82%` é o que
    // permite a alguém que não distingue a cor saber **quanto** falta.
    expect(screen.getByText('82%')).toBeInTheDocument()
  })
})

describe('Spinner e Skeleton', () => {
  it('Spinner anuncia o que carrega em vez de girar em silêncio', () => {
    render(<Spinner rotulo="Carregando execuções" />)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando execuções')
  })

  it('Skeleton é decorativo — quem anuncia é a região que o contém', () => {
    const { container } = render(<Skeleton />)
    // Um esqueleto anunciado seria ruído: o leitor leria "imagem, imagem, imagem" enquanto o
    // conteúdo real ainda nem chegou.
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Feedback (critério 4)', () => {
  it('InlineAlert carrega o tom em texto, além do ícone e da borda', () => {
    render(
      <InlineAlert tom="err" titulo="Não foi possível salvar">
        Verifique a conexão.
      </InlineAlert>
    )

    // `alert` para err: assertivo, interrompe para avisar de um problema.
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent(/erro:/i)
    expect(alerta).toHaveTextContent('Não foi possível salvar')
  })

  it('InlineAlert informativo não usa a urgência de um erro', () => {
    render(<InlineAlert tom="info" titulo="Sincronização agendada" />)

    // Anunciar tudo com urgência máxima treina o usuário a ignorar o canal.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Sincronização agendada')).toBeInTheDocument()
  })

  it('InlineAlert dispensável nomeia a ação de fechar', async () => {
    const user = userEvent.setup()
    const onDispensar = vi.fn()
    render(<InlineAlert tom="warn" titulo="Cota quase no limite" onDispensar={onDispensar} />)

    await user.click(screen.getByRole('button', { name: 'Dispensar alerta' }))
    expect(onDispensar).toHaveBeenCalledTimes(1)
  })

  it('ErrorState oferece o caminho de volta — erro sem saída é beco', async () => {
    const user = userEvent.setup()
    const onTentarNovamente = vi.fn()
    render(
      <ErrorState
        titulo="Falha ao carregar execuções"
        descricao="O serviço local não respondeu."
        onTentarNovamente={onTentarNovamente}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao carregar execuções')
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onTentarNovamente).toHaveBeenCalledTimes(1)
  })

  it('LoadingState com skeletons continua anunciando o carregamento', () => {
    render(
      <LoadingState rotulo="Carregando painel">
        <Skeleton />
        <Skeleton />
      </LoadingState>
    )

    // Os esqueletos são `aria-hidden`; sem o `role="status"` com rótulo na região, o
    // carregamento seria **completamente** silencioso para quem usa leitor de tela.
    expect(screen.getByRole('status', { name: 'Carregando painel' })).toBeInTheDocument()
  })
})

describe('EmptyState (critério 4)', () => {
  it('explica o vazio em texto, não com um ícone solto', () => {
    render(<EmptyState titulo="Nenhum workflow" descricao="Crie o primeiro para começar." />)

    expect(screen.getByText('Nenhum workflow')).toBeInTheDocument()
    expect(screen.getByText('Crie o primeiro para começar.')).toBeInTheDocument()
  })
})

describe('Table', () => {
  it('é uma tabela semântica com legenda e cabeçalhos de coluna', () => {
    render(
      <Table colunas={COLUNAS} linhas={LINHAS} chaveDaLinha={(l) => l.id} legenda="Workflows" />
    )

    expect(screen.getByRole('table', { name: 'Workflows' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.getByRole('cell', { name: 'Backup diário' })).toBeInTheDocument()
  })

  it('linha clicável é alcançável por teclado, não só por mouse', async () => {
    const user = userEvent.setup()
    const onLinhaClique = vi.fn()
    render(
      <Table
        colunas={COLUNAS}
        linhas={LINHAS}
        chaveDaLinha={(l) => l.id}
        legenda="Workflows"
        onLinhaClique={onLinhaClique}
      />
    )

    // Uma `<tr onClick>` muda de cor no hover e é inalcançável sem mouse. Tab + Enter é o que
    // separa "clicável" de "acionável".
    const linhas = screen.getAllByRole('button')
    linhas[0].focus()
    await user.keyboard('{Enter}')
    expect(onLinhaClique).toHaveBeenCalledWith(LINHAS[0])

    await user.keyboard(' ')
    expect(onLinhaClique).toHaveBeenCalledTimes(2)
  })

  it('sem linhas mostra o vazio no lugar de uma tabela oca', () => {
    render(
      <Table
        colunas={COLUNAS}
        linhas={[]}
        chaveDaLinha={(l) => l.id}
        legenda="Workflows"
        vazio={<EmptyState titulo="Nenhum workflow" />}
      />
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhum workflow')).toBeInTheDocument()
  })
})

describe('Tree', () => {
  it('é uma árvore com papel e rótulo', () => {
    render(
      <Tree
        rotulo="Diretórios permitidos"
        nos={[
          { id: '1', rotulo: 'Documentos', filhos: [{ id: '1a', rotulo: 'Projetos' }] },
          { id: '2', rotulo: 'Downloads' }
        ]}
      />
    )

    expect(screen.getByRole('tree', { name: 'Diretórios permitidos' })).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThanOrEqual(2)
  })
})

describe('Card e Panel', () => {
  it('card clicável é botão de verdade — recebe foco e responde ao teclado', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Card titulo="Backup diário" interativo onClick={onClick}>
        <p>Última execução às 03:00</p>
      </Card>
    )

    const card = screen.getByRole('button', { name: /Backup diário/ })
    card.focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('card não clicável é article, não um botão sem ação', () => {
    render(
      <Card titulo="Resumo">
        <p>conteúdo</p>
      </Card>
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toBeInTheDocument()
    // O título vira `<h3>`: quem navega por cabeçalhos encontra o card.
    expect(screen.getByRole('heading', { name: 'Resumo', level: 3 })).toBeInTheDocument()
  })

  it('Panel com tom anuncia o tom em texto, não só na borda colorida (critério 4)', () => {
    render(
      <Panel titulo="Execução bloqueada" tom="err">
        <p>A política barrou a etapa.</p>
      </Panel>
    )

    // Sem o texto do tom, um painel de erro seria anunciado como um painel qualquer — a borda
    // vermelha não chega ao leitor de tela. E o nome precisa carregar os dois: pousar no painel
    // anuncia "erro: execução bloqueada", não só um ou outro.
    expect(screen.getByRole('region', { name: /erro.*execução bloqueada/i })).toBeInTheDocument()
  })

  it('Panel sem tom é região nomeada só pelo título', () => {
    render(
      <Panel titulo="Resumo do dia">
        <p>conteúdo</p>
      </Panel>
    )

    expect(screen.getByRole('region', { name: 'Resumo do dia' })).toBeInTheDocument()
  })
})

describe('Tag', () => {
  it('o botão de remover nomeia o alvo', async () => {
    const user = userEvent.setup()
    const onRemover = vi.fn()
    render(
      <Tag onRemover={onRemover} rotuloRemover="Remover a tag Finanças">
        Finanças
      </Tag>
    )

    // Numa lista de tags, "Remover" repetido faria o leitor anunciar vários botões idênticos —
    // o usuário não saberia qual está prestes a acionar.
    await user.click(screen.getByRole('button', { name: 'Remover a tag Finanças' }))
    expect(onRemover).toHaveBeenCalledTimes(1)
  })
})

describe('Notificações (PRD §12.6)', () => {
  const NOTIFICACOES: readonly Notificacao[] = [
    {
      id: 'n1',
      tom: 'err',
      titulo: 'Execução falhou',
      quando: '14:02',
      lida: false
    },
    { id: 'n2', tom: 'ok', titulo: 'Backup concluído', quando: '13:40', lida: true }
  ]

  it('não-lida é dita em texto, não só pelo ponto colorido (critério 4)', () => {
    render(<NotificationCenter notificacoes={NOTIFICACOES} onLer={vi.fn()} />)

    const naoLida = screen.getByRole('button', { name: /Execução falhou/ })
    expect(naoLida).toHaveAccessibleName(/não lida/i)

    const lida = screen.getByRole('button', { name: /Backup concluído/ })
    expect(lida).not.toHaveAccessibleName(/não lida/i)
  })

  it('a lista vem por props e a leitura é evento — o DS não persiste nada', async () => {
    const user = userEvent.setup()
    const onLer = vi.fn()
    const onLerTodas = vi.fn()
    render(<NotificationCenter notificacoes={NOTIFICACOES} onLer={onLer} onLerTodas={onLerTodas} />)

    // A fronteira do PRD §8.1: o componente emite quem foi lido e **não** grava. Persistência
    // é da SPEC-Fundacao-04.
    await user.click(screen.getByRole('button', { name: /Execução falhou/ }))
    expect(onLer).toHaveBeenCalledWith('n1')

    await user.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
    expect(onLerTodas).toHaveBeenCalledTimes(1)
  })

  it('lista vazia mostra o vazio, não um cabeçalho órfão', () => {
    render(<NotificationCenter notificacoes={[]} onLer={vi.fn()} />)
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument()
  })

  it('NotificationItem isolado continua íntegro', async () => {
    const user = userEvent.setup()
    const onLer = vi.fn()
    render(
      <ul>
        <NotificationItem notificacao={NOTIFICACOES[0]} onLer={onLer} />
      </ul>
    )

    await user.click(screen.getByRole('button', { name: /Execução falhou/ }))
    expect(onLer).toHaveBeenCalledWith('n1')
  })

  it('UnreadIndicator avulso é anunciado; acompanhado de texto, cala', () => {
    const { rerender } = render(<UnreadIndicator tom="err" rotulo="2 não lidas" />)
    // Sozinho — um sino com um ponto — ele é a **única** indicação e precisa de voz.
    expect(screen.getByRole('status', { name: '2 não lidas' })).toBeInTheDocument()

    rerender(<UnreadIndicator tom="err" />)
    // Sem rótulo é decoração: quem informa é o texto ao lado (o caso do NotificationItem).
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
