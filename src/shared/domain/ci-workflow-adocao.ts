/**
 * A decisão sobre escrever, preservar ou propor adoção do workflow (SPEC-Pipeline-01 §6).
 *
 * A vertical 1 decidia isso por **uma substring**: se o arquivo começa com a marca do cabeçalho, é
 * nosso e pode ser reescrito; senão, preserva. Funciona para o caso honesto e falha nos dois que a
 * spec nomeia — um humano que edita o arquivo gerado **mantendo** o cabeçalho perderia a edição, e
 * um arquivo escrito por outra ferramenta com aquela linha no topo seria sobrescrito.
 *
 * O que a §6 pede no lugar: guardar o **hash do que escrevemos**, e comparar o disco contra ele.
 *
 *  - disco igual ao hash registrado → o arquivo é nosso e ninguém o tocou desde então;
 *  - disco diferente do registrado → **alguém editou**, e os bytes ficam como estão;
 *  - sem registro nenhum → não sabemos a procedência, e não sabemos não autoriza escrever por cima.
 *
 * A diferença que isto faz: "posso reescrever" deixa de ser uma opinião sobre o conteúdo e passa a
 * ser um fato sobre o histórico. A spec diz a mesma coisa por outras palavras — *nunca concluir
 * equivalência apenas por encontrar uma substring `run:`*.
 *
 * **Função pura sobre hash já calculado.** `src/shared` compila para o renderer, onde `node:crypto`
 * não existe; quem calcula é o main, como já fazem `pacote-estrutural.ts` e `arquitetura-gerada.ts`.
 */

/** O que a pipeline registrou da última vez que escreveu o workflow deste projeto. */
export interface ManifestoDoWorkflow {
  /** O perfil que gerou o arquivo. */
  readonly profileId: string
  /** O hash do perfil naquele momento. Perfil diferente é diferença material (§6). */
  readonly hashDoPerfil: string
  /** O hash do conteúdo que a pipeline escreveu. É contra ele que o disco é comparado. */
  readonly hashDoConteudo: string
  /** A versão do gerador. Versão nova **não** migra sozinha (§6). */
  readonly versaoDoGerador: number
}

/** O que fazer com o arquivo. */
export type DecisaoSobreWorkflow =
  /** Não existe: escrever pela primeira vez. */
  | { readonly acao: 'criar' }
  /** Nosso, intocado, e o conteúdo desejado mudou por diferença material aprovada. */
  | { readonly acao: 'atualizar'; readonly motivo: string }
  /** Nosso e já idêntico ao desejado: nada a fazer, e não reescrever por cosmética. */
  | { readonly acao: 'manter' }
  /**
   * Preservar os bytes e propor adoção.
   *
   * Não é falha: é a pipeline dizendo que **não consegue comprovar equivalência**, que a §6 manda
   * tratar preservando o arquivo e informando o impedimento — nunca substituindo.
   */
  | {
      readonly acao: 'propor-adocao'
      readonly causa: 'editado-externamente' | 'procedencia-desconhecida'
      readonly mensagem: string
      /** O diff proposto, para o humano decidir. A §6 pede diff, não veredicto. */
      readonly diff: readonly LinhaDeDiff[]
    }

/** Uma linha do diff proposto. */
export interface LinhaDeDiff {
  readonly tipo: 'igual' | 'remover' | 'acrescentar'
  readonly texto: string
}

export interface EntradaDaDecisao {
  /** O conteúdo em disco, ou `undefined` quando o arquivo não existe. */
  readonly conteudoAtual?: string
  /** O hash do conteúdo em disco. Ausente quando o arquivo não existe. */
  readonly hashAtual?: string
  /** O que o gerador produziria para o perfil vigente. */
  readonly conteudoDesejado: string
  readonly hashDesejado: string
  readonly hashDoPerfil: string
  readonly profileId: string
  readonly versaoDoGerador: number
  /** O registro da última escrita da pipeline, quando existe. */
  readonly manifesto?: ManifestoDoWorkflow
}

/**
 * Decide, sem tocar em disco.
 *
 * A ordem das checagens é deliberada, como a de `avaliarGateDeMerge`:
 *
 *  1. **Ausência primeiro**, porque não há procedência a julgar.
 *  2. **Procedência antes de conteúdo.** Sem manifesto não sabemos quem escreveu, e comparar o
 *     conteúdo desejado com o disco responderia à pergunta errada: "é igual ao que eu faria" não
 *     é "fui eu que fiz".
 *  3. **Edição externa antes de diferença material.** Um arquivo editado por alguém e cujo perfil
 *     também mudou continua sendo edição a preservar; a mudança do perfil não dá licença de
 *     sobrescrever o trabalho de outra pessoa.
 *  4. **Igualdade por último**, que é o caminho de "não reescrever por cosmética" (critério 4).
 */
export function decidirSobreWorkflow(entrada: EntradaDaDecisao): DecisaoSobreWorkflow {
  if (entrada.conteudoAtual === undefined) return { acao: 'criar' }

  if (entrada.manifesto === undefined) {
    return {
      acao: 'propor-adocao',
      causa: 'procedencia-desconhecida',
      mensagem:
        'Existe um workflow no projeto que a pipeline não escreveu, ou cujo registro se perdeu. ' +
        'Os bytes ficam como estão: sem o registro da escrita anterior, não há como comprovar ' +
        'equivalência, e um arquivo parecido com o gerado não é prova de que foi gerado.',
      diff: diffDeLinhas(entrada.conteudoAtual, entrada.conteudoDesejado)
    }
  }

  if (entrada.manifesto.hashDoConteudo !== entrada.hashAtual) {
    return {
      acao: 'propor-adocao',
      causa: 'editado-externamente',
      mensagem:
        'O workflow mudou depois da última escrita da pipeline: o conteúdo em disco não bate com ' +
        'o hash registrado. A edição é preservada, e a adoção precisa de decisão humana.',
      diff: diffDeLinhas(entrada.conteudoAtual, entrada.conteudoDesejado)
    }
  }

  if (entrada.conteudoAtual === entrada.conteudoDesejado) return { acao: 'manter' }

  // Nosso, intocado e diferente do desejado. Só duas coisas produzem isso, e a spec trata as duas
  // de forma oposta: perfil diferente é **diferença material** e atualiza; versão de gerador nova
  // sozinha **não migra** (§6), porque migrar todo projeto de uma vez é exatamente o que a spec
  // recusa ao dizer que a versão efetiva permanece fixada até adoção material aprovada.
  if (entrada.manifesto.hashDoPerfil !== entrada.hashDoPerfil) {
    return {
      acao: 'atualizar',
      motivo:
        `O perfil ${entrada.profileId} mudou desde a última escrita ` +
        `(${entrada.manifesto.hashDoPerfil.slice(0, 12)} → ${entrada.hashDoPerfil.slice(0, 12)}).`
    }
  }

  if (entrada.manifesto.versaoDoGerador !== entrada.versaoDoGerador) {
    return {
      acao: 'propor-adocao',
      causa: 'procedencia-desconhecida',
      mensagem:
        `O gerador passou da versão ${entrada.manifesto.versaoDoGerador} para ` +
        `${entrada.versaoDoGerador}, mas o perfil não mudou. Atualizar a versão do gerador não ` +
        'migra projeto por iniciativa própria: a adoção é material e precisa ser aprovada.',
      diff: diffDeLinhas(entrada.conteudoAtual, entrada.conteudoDesejado)
    }
  }

  // Mesmo perfil, mesma versão, conteúdo diferente e hash do disco batendo com o registrado. Isso
  // não deveria acontecer — significa que o gerador não é determinístico, e o critério 4 exige que
  // seja. Preservar e falar é a resposta honesta; reescrever esconderia o defeito.
  return {
    acao: 'propor-adocao',
    causa: 'procedencia-desconhecida',
    mensagem:
      'O mesmo perfil e a mesma versão do gerador produziram conteúdo diferente do registrado. ' +
      'Isso indica geração não determinística (critério 4), não edição externa. O arquivo fica ' +
      'como está até a causa ser entendida.',
    diff: diffDeLinhas(entrada.conteudoAtual, entrada.conteudoDesejado)
  }
}

/**
 * O diff entre dois textos, por linha.
 *
 * Subsequência comum mais longa, programação dinâmica — o algoritmo clássico de diff. Poderia ser
 * uma comparação linha a linha posicional, muito mais curta, mas ela reportaria *todo* o arquivo
 * como alterado quando alguém insere uma linha no topo, e o humano que precisa decidir a adoção
 * receberia ruído em vez de informação.
 *
 * O custo é O(n·m) em tempo e memória. Aceitável aqui: workflows têm dezenas de linhas, não
 * milhares. Se algum dia isso deixar de ser verdade, o limite abaixo evita a explosão.
 */
export function diffDeLinhas(antes: string, depois: string): readonly LinhaDeDiff[] {
  const a = antes.split('\n')
  const b = depois.split('\n')

  // ponytail: LCS quadrática; trocar por Myers se algum workflow passar de ~2000 linhas.
  const LIMITE = 2000
  if (a.length > LIMITE || b.length > LIMITE) {
    return [
      { tipo: 'remover', texto: `<${a.length} linhas do arquivo em disco>` },
      { tipo: 'acrescentar', texto: `<${b.length} linhas do arquivo desejado>` }
    ]
  }

  // tabela[i][j] = tamanho da subsequência comum entre a[i..] e b[j..].
  const tabela: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      tabela[i]![j] =
        a[i] === b[j]
          ? tabela[i + 1]![j + 1]! + 1
          : Math.max(tabela[i + 1]![j]!, tabela[i]![j + 1]!)
    }
  }

  const linhas: LinhaDeDiff[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      linhas.push({ tipo: 'igual', texto: a[i]! })
      i += 1
      j += 1
    } else if (tabela[i + 1]![j]! >= tabela[i]![j + 1]!) {
      linhas.push({ tipo: 'remover', texto: a[i]! })
      i += 1
    } else {
      linhas.push({ tipo: 'acrescentar', texto: b[j]! })
      j += 1
    }
  }
  while (i < a.length) {
    linhas.push({ tipo: 'remover', texto: a[i]! })
    i += 1
  }
  while (j < b.length) {
    linhas.push({ tipo: 'acrescentar', texto: b[j]! })
    j += 1
  }

  return linhas
}
