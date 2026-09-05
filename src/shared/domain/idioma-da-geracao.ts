/**
 * A declaração de idioma que **todo** system de geração carrega (#271, emenda E1 § Decisão 6).
 *
 * A pergunta que este arquivo responde: **em que língua o modelo escreve o documento?**
 *
 * Até aqui a resposta era acidente. Os systems estão escritos em português, e o modelo
 * respondia em português por imitação — nunca porque alguém tivesse pedido. Imitação não é
 * contrato: o dia em que um prompt do PI viesse em inglês, ou em que o provider trocasse de
 * modelo, a saída mudaria de língua sem que nada no código tivesse mudado.
 *
 * A fonte do comportamento correto é o CLAUDE.md § Regras de trabalho — documentação e
 * comunicação sempre em pt-BR, código e identificadores em inglês. Aqui isso deixa de ser regra
 * do repositório e passa a ser instrução que o modelo recebe.
 *
 * Constante única e não uma frase copiada em cada schema: nove cópias divergiriam na primeira
 * vez que alguém reescrevesse uma delas, e o teste que confere "todo system declara o idioma"
 * não teria o que comparar.
 */
export const IDIOMA_DA_SAIDA =
  'Escreva todo o conteúdo em português do Brasil (pt-BR). Identificadores de código permanecem em inglês.'
