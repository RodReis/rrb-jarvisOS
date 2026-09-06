import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EstadoDaJornada, Etapa, EtapaNaTrilha } from '@shared/domain/jornada'
import { ETAPAS, CTA_DA_ETAPA, montarTrilha } from '@shared/domain/jornada'
import { TrilhaDaJornada } from './TrilhaDaJornada'

/**
 * A trilha agrupada por fase (SPEC-Fases-01, critério 6).
 *
 * Testada **isolada**, e não pela tela de projeto: entrar num projeto monta a tela da etapa
 * atual, que puxa os canais dela — testar o agrupamento por ali mediria a montagem daquelas
 * telas, não o agrupamento. É a mesma postura de `brief.test.tsx`.
 *
 * O que estes testes protegem:
 *  - **Os três blocos existem e são rotulados**, com a fase atual marcada.
 *  - **Condensar não é esconder:** as etapas das fases não-atuais continuam na árvore. Um
 *    accordion fechado economizaria mais espaço e custaria justamente ver para onde a jornada
 *    vai — que é o que separa uma trilha de uma barra de progresso.
 *  - **Agrupar não multiplica alvos:** continua havendo um botão só, o da etapa atual.
 */

function estado(atual: Etapa): EstadoDaJornada {
  return {
    projectId: 'p-1',
    etapa: atual,
    cta: CTA_DA_ETAPA[atual],
    trilha: montarTrilha(atual),
    motivoDaRegressao: null,
    recalculada: false
  }
}

describe('TrilhaDaJornada agrupada por fase (critério 6)', () => {
  it('mostra as três fases como blocos rotulados', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    // Por papel: "Construção" é rótulo de fase **e** nome da etapa `construcao`, e as duas
    // ocorrências são corretas. O papel distingue o cabeçalho do bloco do item da lista.
    expect(screen.getByRole('heading', { name: 'Planejamento' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Especificação' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Construção' })).toBeInTheDocument()
  })

  it('marca a fase da etapa atual e não as outras', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    expect(screen.getByTestId('fase-planejamento')).toHaveAttribute('data-jos-fase-atual', 'true')
    expect(screen.getByTestId('fase-especificacao')).toHaveAttribute('data-jos-fase-atual', 'false')
    expect(screen.getByTestId('fase-construcao')).toHaveAttribute('data-jos-fase-atual', 'false')
  })

  it('acompanha a fase quando a etapa atual muda de bloco', () => {
    render(<TrilhaDaJornada estado={estado('roadmap')} onAgir={vi.fn()} />)

    expect(screen.getByTestId('fase-especificacao')).toHaveAttribute('data-jos-fase-atual', 'true')
    expect(screen.getByTestId('fase-planejamento')).toHaveAttribute('data-jos-fase-atual', 'false')
  })

  it('mantém as doze etapas na árvore — condensar não é esconder', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    // Nenhuma etapa some ao ser condensada: ver para onde a jornada vai é o ponto da trilha.
    expect(screen.getAllByRole('listitem')).toHaveLength(ETAPAS.length)
  })

  it('distribui as etapas entre os blocos sem sobra nem repetição', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    const porFase = ['planejamento', 'especificacao', 'construcao'].map(
      (fase) => screen.getByTestId(`fase-${fase}`).querySelectorAll('li').length
    )

    expect(porFase).toEqual([8, 3, 1])
    expect(porFase.reduce((a, b) => a + b, 0)).toBe(ETAPAS.length)
  })

  it('preserva o único botão da etapa atual (critério 3 da SPEC-Jornada-01)', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    // Agrupar não pode multiplicar alvos: um botão na trilha inteira, e ele é o da etapa atual.
    const botoes = screen.getAllByRole('button')
    expect(botoes).toHaveLength(1)
    expect(botoes[0]).toHaveTextContent(CTA_DA_ETAPA.prd)
  })

  it('o CTA travado fica desabilitado com a razão ao lado, não oferecendo um aceite que não vai (#318)', () => {
    // O botão da trilha levava o rótulo "Aceitar o PRD" e saía primário enquanto o gate estava
    // travado por contradição — prometendo um aceite que o painel de baixo recusava.
    render(
      <TrilhaDaJornada
        estado={estado('prd-aceito')}
        onAgir={vi.fn()}
        bloqueio="Resolva as contradições acima para aceitar."
      />
    )

    const botao = screen.getByRole('button', { name: CTA_DA_ETAPA['prd-aceito'] })
    expect(botao).toBeDisabled()
    expect(screen.getByText('Resolva as contradições acima para aceitar.')).toBeInTheDocument()
  })

  it('sem bloqueio, o CTA continua acionável', () => {
    render(<TrilhaDaJornada estado={estado('prd-aceito')} onAgir={vi.fn()} />)

    expect(screen.getByRole('button', { name: CTA_DA_ETAPA['prd-aceito'] })).toBeEnabled()
  })

  it('mantém a etapa atual anunciada para quem ouve a interface', () => {
    render(<TrilhaDaJornada estado={estado('roadmap')} onAgir={vi.fn()} />)

    const atual = screen.getAllByRole('listitem').filter((li) => li.ariaCurrent === 'step')

    expect(atual).toHaveLength(1)
    expect(atual[0]).toHaveAttribute('data-jos-etapa', 'roadmap')
  })

  it('cada bloco tem nome acessível próprio, para a navegação por região funcionar', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    // `aria-label` no bloco é o que faz um leitor de tela anunciar "Planejamento" ao entrar
    // nele — sem isso, o agrupamento seria só visual e o teclado atravessaria doze itens rasos.
    expect(screen.getByTestId('fase-planejamento')).toHaveAttribute('aria-label', 'Planejamento')
  })

  it('não perde o que falta das etapas futuras ao condensar (critério 4)', () => {
    render(<TrilhaDaJornada estado={estado('prd')} onAgir={vi.fn()} />)

    const futuras: readonly EtapaNaTrilha[] = montarTrilha('prd').filter(
      (e) => e.posicao === 'futura'
    )

    expect(futuras.length).toBeGreaterThan(0)
    expect(screen.getAllByText(/para chegar aqui/)).toHaveLength(futuras.length)
  })
})
