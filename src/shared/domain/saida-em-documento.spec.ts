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

describe('as outras saídas da jornada (issue #337)', () => {
  const MVP = {
    id: 'mvp-1',
    numero: 1,
    titulo: 'Cadastro e autenticação',
    tese: 'Entrega o fluxo de criação de conta do investidor.',
    resultado: 'Um investidor cria a conta e entra sozinho.',
    dependeDe: [],
    fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário de cadastro' }]
  }

  it('o roadmap vira documento, não a parede de JSON que o PI viu', () => {
    /*
     * O defeito medido: o leitor reconhecia só a forma das afirmações do PRD, e o roadmap caía
     * inteiro no `restante`. Um MVP não tem `texto` — tem `tese` e `resultado`, que dizem coisas
     * diferentes: o que ele entrega e como se sabe que fechou.
     */
    const { topicos, restante } = lerSaidaComoDocumento(JSON.stringify({ mvps: [MVP] }))

    expect(topicos[0]?.secao).toBe('Cadastro e autenticação')
    expect(topicos[0]?.afirmacoes.map((a) => a.texto)).toEqual([
      'Entrega o fluxo de criação de conta do investidor.',
      'Um investidor cria a conta e entra sozinho.',
      'Formulário de cadastro'
    ])
    expect(restante).toBe('')
  })

  it('a fatia sozinha não vira seção: ela é o checklist do MVP', () => {
    // A varredura lê a fatia como objeto completo antes do MVP fechar. Sem `tese`, ela não é
    // MVP — e uma seção por fatia faria a tela rolar o que o PI lê de relance.
    const { topicos } = lerSaidaComoDocumento(
      JSON.stringify({ id: 'f-1', numero: 1, titulo: 'Formulário de cadastro' })
    )

    expect(topicos).toHaveLength(0)
  })

  it('a SPEC vira documento, com o rótulo de cada lista', () => {
    const spec = {
      titulo: 'Formulário de cadastro',
      objetivo: 'Capturar os dados do investidor antes de criar a conta.',
      fluxo: ['Visitante acessa a tela'],
      regras: ['CPF é validado'],
      criteriosDeAceite: ['Salvar sem nome mostra erro'],
      testes: ['Unitário da validação'],
      perguntas: [{ id: 'p-1', enunciado: 'Qual gateway?' }]
    }

    const { topicos } = lerSaidaComoDocumento(JSON.stringify({ spec }))

    const lidas = topicos[0]?.afirmacoes ?? []
    expect(topicos[0]?.secao).toBe('Formulário de cadastro')
    expect(lidas.map((a) => a.origem)).toEqual([
      'objetivo',
      'passo',
      'regra',
      'critério de aceite',
      'teste'
    ])

    /*
     * As perguntas abertas ficam de fora de propósito: elas têm tela própria, com as opções e o
     * impacto de cada uma. Mostrá-las aqui sem as opções seria exibir a decisão sem o que ela
     * decide.
     */
    expect(lidas.map((a) => a.texto)).not.toContain('Qual gateway?')
  })

  it('o PRD continua lido pela forma dele: as outras não sequestram a afirmação', () => {
    const saida = JSON.stringify({
      afirmacoes: [{ id: 'a-1', documento: 'PRD', secao: 'Problema', texto: 'Uma frase.' }]
    })

    const { topicos } = lerSaidaComoDocumento(saida)

    expect(topicos[0]?.documento).toBe('PRD')
    expect(topicos[0]?.afirmacoes).toHaveLength(1)
  })
})
