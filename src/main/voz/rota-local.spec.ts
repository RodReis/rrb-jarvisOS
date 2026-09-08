import { describe, expect, it } from 'vitest'
import { criarRotaLocal, FRASES_DA_RECUSA, type DepsDaRotaLocal } from './rota-local'

/**
 * A disponibilidade da rota local (SPEC-Voz-03, critério 4).
 *
 * O critério nomeia **dois cenários** — serviço fora e modelo ausente — e o que os separa é a
 * próxima ação, que é falada. Por isso os testes afirmam sobre o *texto* da recusa, e não só
 * sobre `ok: false`: um estado que recusasse com a frase errada passaria numa asserção de
 * booleano e mandaria o usuário fazer a coisa errada, que é exatamente o defeito.
 */

function deps(parcial: Partial<DepsDaRotaLocal> = {}): DepsDaRotaLocal {
  return {
    disponivel: async () => true,
    modelosInstalados: async () => ['qwen3:8b'],
    modeloConfigurado: () => 'qwen3:8b',
    ...parcial
  }
}

describe('rota local da conversa', () => {
  it('aceita quando o serviço responde e o modelo configurado está baixado', async () => {
    await expect(criarRotaLocal(deps())()).resolves.toEqual({ ok: true })
  })

  it('recusa com "suba o Ollama" quando o serviço está fora', async () => {
    const r = await criarRotaLocal(deps({ disponivel: async () => false }))()

    expect(r.ok).toBe(false)
    expect(r.ok === false && r.proximaAcao).toBe(FRASES_DA_RECUSA.SEM_SERVICO)
  })

  it('não consulta os modelos quando o serviço está fora', async () => {
    // Perguntar a lista a um servidor que não responde custa o timeout inteiro do healthcheck
    // por nada — e a resposta seria uma lista vazia que já sabemos ler errado como "sem modelo".
    let consultou = false

    await criarRotaLocal(
      deps({
        disponivel: async () => false,
        modelosInstalados: async () => {
          consultou = true
          return []
        }
      })
    )()

    expect(consultou).toBe(false)
  })

  it('recusa com "ollama pull" nomeando o modelo quando ele não está baixado', async () => {
    const r = await criarRotaLocal(
      deps({ modelosInstalados: async () => ['llama3:8b'], modeloConfigurado: () => 'qwen3:8b' })
    )()

    expect(r.ok).toBe(false)
    expect(r.ok === false && r.proximaAcao).toBe(FRASES_DA_RECUSA.SEM_MODELO('qwen3:8b'))
    // A frase precisa carregar o nome: "baixe o modelo" sem dizer qual não é próxima ação.
    expect(r.ok === false && r.proximaAcao).toContain('qwen3:8b')
  })

  it('as duas recusas são frases diferentes', async () => {
    // Contrafactual do critério: se as frases coincidissem, os dois testes acima passariam e a
    // fala mandaria subir o Ollama para um serviço que já está no ar.
    expect(FRASES_DA_RECUSA.SEM_SERVICO).not.toBe(FRASES_DA_RECUSA.SEM_MODELO('qwen3:8b'))
  })

  it('aceita o modelo sem tag contra o :latest que o servidor devolve', async () => {
    // `ollama pull qwen3` instala `qwen3:latest`. Igualdade estrita acusaria ausência de um
    // modelo presente, e a recusa mandaria baixar o que já está lá.
    const r = await criarRotaLocal(
      deps({ modelosInstalados: async () => ['qwen3:latest'], modeloConfigurado: () => 'qwen3' })
    )()

    expect(r).toEqual({ ok: true })
  })

  it('não casa modelo de nome parecido', async () => {
    const r = await criarRotaLocal(
      deps({ modelosInstalados: async () => ['qwen3-coder:8b'], modeloConfigurado: () => 'qwen3' })
    )()

    expect(r.ok).toBe(false)
  })

  it('recusa quando a tag configurada não é a instalada', async () => {
    const r = await criarRotaLocal(
      deps({ modelosInstalados: async () => ['qwen3:4b'], modeloConfigurado: () => 'qwen3:8b' })
    )()

    expect(r.ok).toBe(false)
  })

  it('recusa quando o modelo configurado está vazio', async () => {
    const r = await criarRotaLocal(deps({ modeloConfigurado: () => '   ' }))()

    expect(r.ok).toBe(false)
  })
})
