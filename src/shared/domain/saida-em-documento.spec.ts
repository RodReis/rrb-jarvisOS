import { describe, expect, it } from 'vitest'
import { lerSaidaComoDocumento } from './saida-em-documento'

/** Uma afirmação como o modelo a escreve. */
function afirmacao(
  id: string,
  secao = 'Problema',
  texto = 'O usuário precisa acompanhar preço sem buscar.',
  origem = 'brief'
): string {
  return JSON.stringify({ id, documento: 'PRD', secao, texto, origem, fontes: [] })
}

describe('lerSaidaComoDocumento', () => {
  it('agrupa as afirmações por documento e seção, na ordem de chegada', () => {
    const saida = `{"afirmacoes":[${afirmacao('a-1')},${afirmacao('a-2')},${afirmacao('a-3', 'Usuários')}]}`

    const { topicos, restante } = lerSaidaComoDocumento(saida)

    expect(restante).toBe('')
    expect(topicos).toHaveLength(2)
    expect(topicos[0]?.secao).toBe('Problema')
    expect(topicos[0]?.afirmacoes).toHaveLength(2)
    expect(topicos[1]?.secao).toBe('Usuários')
  })

  it('lê o que já chegou quando o JSON ainda não fechou', () => {
    // É o caso do streaming: sem isto o painel ficaria vazio durante toda a geração, que é
    // exatamente o intervalo em que ele existe para mostrar algo.
    const parcial = `{"afirmacoes":[${afirmacao('a-1')},{"id":"a-2","documento":"PRD","secao":"Pro`

    const { topicos } = lerSaidaComoDocumento(parcial)

    expect(topicos).toHaveLength(1)
    expect(topicos[0]?.afirmacoes).toHaveLength(1)
    expect(topicos[0]?.afirmacoes[0]?.id).toBe('a-1')
  })

  it('não repete a afirmação quando o texto acumulado é relido a cada evento', () => {
    // A varredura roda sobre o texto inteiro a cada chunk. Sem a guarda por id, a mesma frase
    // apareceria uma vez por evento recebido.
    const saida = `[${afirmacao('a-1')},${afirmacao('a-1')}]`

    const { topicos } = lerSaidaComoDocumento(saida)

    expect(topicos[0]?.afirmacoes).toHaveLength(1)
  })

  it('preserva seção com espaço no nome', () => {
    // Chave concatenada por espaço truncaria "Visão Geral" em "Visão".
    const saida = `[${afirmacao('a-1', 'Visão Geral')}]`

    const { topicos } = lerSaidaComoDocumento(saida)

    expect(topicos[0]?.secao).toBe('Visão Geral')
  })

  it('não confunde chave dentro de string com fim de objeto', () => {
    const saida = JSON.stringify({
      id: 'a-1',
      documento: 'PRD',
      secao: 'Problema',
      texto: 'O texto cita um objeto } e uma aspa \\" escapada.',
      origem: 'brief'
    })

    const { topicos } = lerSaidaComoDocumento(saida)

    expect(topicos[0]?.afirmacoes[0]?.texto).toContain('}')
  })

  it('devolve o texto como restante quando não há afirmação nenhuma', () => {
    // Recusa do modelo, prosa solta, saída malformada: os três precisam ser lidos. Engolir isso
    // deixaria o PI olhando um painel vazio sem saber por quê.
    const { topicos, restante } = lerSaidaComoDocumento('Não posso gerar o PRD sem o brief.')

    expect(topicos).toHaveLength(0)
    expect(restante).toBe('Não posso gerar o PRD sem o brief.')
  })

  it('descarta objeto sem texto, mas mantém os irmãos', () => {
    const saida = `[{"id":"a-0","secao":"Problema"},${afirmacao('a-1')}]`

    const { topicos } = lerSaidaComoDocumento(saida)

    expect(topicos[0]?.afirmacoes).toHaveLength(1)
    expect(topicos[0]?.afirmacoes[0]?.id).toBe('a-1')
  })

  it('mantém a afirmação cujo rótulo veio faltando', () => {
    // Perder a frase porque o modelo esqueceu a seção seria trocar a informação pelo enfeite.
    const saida = JSON.stringify({ texto: 'Uma afirmação sem rótulo nenhum.' })

    const { topicos } = lerSaidaComoDocumento(saida)

    expect(topicos[0]?.afirmacoes[0]?.texto).toBe('Uma afirmação sem rótulo nenhum.')
    expect(topicos[0]?.secao).toBe('')
  })

  it('texto vazio não vira tópico', () => {
    expect(lerSaidaComoDocumento('').topicos).toHaveLength(0)
  })
})
