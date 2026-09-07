import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/domain/projects'
import type { EstadoDaJornada, Etapa } from '@shared/domain/jornada'
import { CTA_DA_ETAPA, montarTrilha } from '@shared/domain/jornada'
import { ProjetoAberto } from './ProjetoAberto'

/**
 * A ligação entre a trilha e o painel da etapa (#332, defeito 4).
 *
 * **Por que este arquivo existe.** O botão da trilha prometia "Gerar a arquitetura" e só rolava
 * a página até um segundo botão de mesmo nome, dentro do painel. Quem clicava no primeiro não
 * via nada acontecer — e nenhum teste reprovava, porque cada painel era testado isolado e
 * `ProjetoAberto` não tinha teste nenhum. O buraco estava exatamente na costura.
 *
 * A regra que o PI fixou: **avanço e aceite ficam na trilha**; `Gerar de novo` e
 * `Verificar de novo` ficam no painel. Estes testes montam a árvore inteira — trilha, painel e a
 * costura — e afirmam que o clique **chega ao main**.
 *
 * Os painéis irmãos usam o helper `ComTrilha`, que simula esta costura para não repetir a
 * montagem inteira em cada arquivo. É aqui que a costura real é medida; sem este arquivo, aquele
 * helper estaria provando a si mesmo.
 */

const estadoDaJornada = vi.fn()
const carregarArquitetura = vi.fn()
const gerarArquiteturaPorIa = vi.fn()
const aplicarEventoDaJornada = vi.fn()
const aprovarGate = vi.fn()
const marcosDoProjeto = vi.fn()
const generationHistory = vi.fn()
const onGenerationEvent = vi.fn()

const PROJETO: Project = {
  id: 'p-1',
  user_id: 'u-1',
  workspace_id: 'jarvis',
  nome: 'Projeto Alfa',
  slug: 'projeto-alfa',
  diretorio: 'C:/proj/alfa',
  origem: 'criado',
  gitPreexistente: false,
  created_at: '2026-09-03T10:00:00.000Z'
}

function jornada(etapa: Etapa): EstadoDaJornada {
  return {
    projectId: 'p-1',
    etapa,
    cta: CTA_DA_ETAPA[etapa],
    trilha: montarTrilha(etapa),
    motivoDaRegressao: null,
    recalculada: false
  }
}

function arquitetura(): Record<string, unknown> {
  return {
    id: 'r-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    pacoteEstruturalId: 'pac-1',
    afirmacoes: [],
    ajustes: [],
    anexos: [],
    hash: 'h',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-03T10:00:00.000Z'
  }
}

function montar(): void {
  render(<ProjetoAberto workspace="jarvis" projeto={PROJETO} onVoltar={vi.fn()} />)
}

beforeEach(() => {
  estadoDaJornada.mockReset()
  carregarArquitetura.mockReset().mockResolvedValue(null)
  gerarArquiteturaPorIa.mockReset().mockResolvedValue({ resultado: 'gerada', mensagem: 'ok' })
  aplicarEventoDaJornada.mockReset().mockResolvedValue({ resultado: 'avancou' })
  aprovarGate.mockReset().mockResolvedValue({ reason: 'aprovado', mensagem: 'Aprovado.' })
  marcosDoProjeto.mockReset().mockResolvedValue({
    disponivel: true,
    linhas: [],
    repositorio: { sujos: [], headInterrompido: false, head: 'abc123' }
  })
  generationHistory.mockReset().mockResolvedValue([])
  onGenerationEvent.mockReset().mockReturnValue(() => {})

  vi.stubGlobal('jarvis', {
    estadoDaJornada,
    carregarArquitetura,
    gerarArquiteturaPorIa,
    aplicarEventoDaJornada,
    aprovarGate,
    marcosDoProjeto,
    generationHistory,
    onGenerationEvent
  })
})

describe('o botão da trilha executa a ação da etapa', () => {
  it('gerar a arquitetura chama o main — não rola a página até outro botão', async () => {
    const usuario = userEvent.setup()
    estadoDaJornada.mockResolvedValue(jornada('arquitetura'))
    montar()

    await usuario.click(await screen.findByRole('button', { name: 'Gerar a arquitetura' }))

    // O defeito: este `expect` reprovava. O clique só chamava `scrollIntoView`.
    await waitFor(() => expect(gerarArquiteturaPorIa).toHaveBeenCalledWith('p-1', 'jarvis'))
  })

  it('aceitar o pacote aprova o gate e vai pelo canal de evento da jornada', async () => {
    const usuario = userEvent.setup()
    estadoDaJornada.mockResolvedValue(jornada('pacote-aceito'))
    carregarArquitetura.mockResolvedValue(arquitetura())
    montar()

    await usuario.click(await screen.findByRole('button', { name: 'Aceitar o pacote' }))

    /*
     * **Os dois, nesta ordem.** A etapa `pacote-aceito` exige um `Approval` do gate, e o evento o
     * confere antes de mover: aprovar depois faria o evento recusar a si mesmo. O defeito que o
     * PI relatou era exatamente a metade que faltava — a tela chamava só o evento, e o main
     * recusava toda vez com `aceite-ausente`.
     */
    await waitFor(() =>
      expect(aprovarGate).toHaveBeenCalledWith('p-1', 'PROJECT_PACKAGE', 'jarvis')
    )
    expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'pacote-aceito', 'jarvis')
  })

  it('há um botão só para o avanço: o do painel não voltou', async () => {
    estadoDaJornada.mockResolvedValue(jornada('arquitetura'))
    montar()

    // A queixa do PI, literal: "2 botões para fazer a mesma coisa e um do lado do outro não dá".
    await screen.findByRole('button', { name: 'Gerar a arquitetura' })
    expect(screen.getAllByRole('button', { name: /gerar a arquitetura/i })).toHaveLength(1)
  })
})
