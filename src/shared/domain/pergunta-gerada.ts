/**
 * O validador da pergunta gerada por modelo (SPEC-Jornada-02, critério 3).
 *
 * A pergunta que este arquivo responde: **como o contrato da M8-F03 continua valendo quando
 * ninguém escreve mais as perguntas à mão?**
 *
 * O deslocamento é a razão de o arquivo existir. Na M8-F03 as perguntas viviam num catálogo
 * estático e `wizard-catalogo.spec.ts` as varria em **tempo de teste** — se alguém escrevesse
 * uma pergunta sobre consentimento, o CI ficava vermelho antes de o código sair da máquina.
 * Com perguntas geradas, esse teste não protege mais nada: o que chega ao PI é texto que nenhum
 * humano leu, produzido depois de todo CI ter passado.
 *
 * Então a mesma varredura vira **validador de runtime**, rodando sobre cada pergunta antes de
 * ela ser mostrada. E fail closed: pergunta que não passa não é corrigida nem mostrada com
 * ressalva — ela é recusada, e quem gerou tenta de novo.
 *
 * O contrato validado é o da SPEC-Planejamento-03, literal: título, enunciado, duas ou três
 * opções mutuamente exclusivas, recomendada entre elas com justificativa, impacto por opção.
 */

import type { Pergunta } from './wizard'
import type { BlocoDoBrief } from './brief'
import { TERMOS_QUE_EXIGEM_ORIGEM_HUMANA, isBlocoDoBrief, normalizar } from './brief'

/**
 * Quantas opções uma pergunta admite (spec § Contrato da pergunta: "2–3 opções excludentes").
 *
 * Uma opção não é escolha; quatro ou mais deixa de ser uma decisão e vira um formulário — que é
 * exatamente o que o contrato "uma pergunta por pop-up" recusa.
 */
export const MINIMO_DE_OPCOES = 2
export const MAXIMO_DE_OPCOES = 3

/** Por que a pergunta gerada foi recusada. Fechado: a tela e o log decidem a partir dele. */
export const RECUSAS_DA_PERGUNTA = [
  'titulo-vazio',
  'enunciado-vazio',
  'opcoes-fora-do-contrato',
  'opcao-sem-rotulo',
  'opcao-sem-impacto',
  'opcoes-repetidas',
  'recomendada-inexistente',
  'justificativa-vazia',
  'bloco-desconhecido',
  'requisito-inventado'
] as const

export type RecusaDaPergunta = (typeof RECUSAS_DA_PERGUNTA)[number]

export interface ProblemaNaPergunta {
  readonly recusa: RecusaDaPergunta
  readonly mensagem: string
}

export interface ValidacaoDaPergunta {
  readonly valida: boolean
  readonly problemas: readonly ProblemaNaPergunta[]
}

/**
 * Uma pergunta gerada: o contrato da M8-F03 mais o bloco que ela preenche.
 *
 * `bloco` e `porQue` são a exigência do design §9.1 — a pergunta declara **o que** ela preenche
 * e **por quê**. Sem isso, uma pergunta gerada seria indistinguível de uma pergunta solta, e o
 * progresso por bloco que a spec pede na tela não teria como ser calculado.
 */
export interface PerguntaGerada extends Pergunta {
  readonly bloco: BlocoDoBrief
  readonly porQue: string
}

/**
 * Todo texto que o PI **lê** numa pergunta. É a superfície onde um requisito inventado
 * apareceria — e por isso a varredura cobre a pergunta inteira, não só o enunciado.
 *
 * `porQue` entra: ele é mostrado ao PI como justificativa do que está sendo perguntado, e um
 * requisito inventado escondido ali chegaria à tela igual.
 */
function textoVisivel(p: PerguntaGerada): string {
  return [
    p.titulo,
    p.enunciado,
    p.justificativa,
    p.porQue,
    ...p.opcoes.flatMap((o) => [o.rotulo, o.impacto])
  ].join(' | ')
}

/**
 * Valida uma pergunta gerada contra o contrato (critério 3).
 *
 * Devolve todos os problemas, não o primeiro: quem gerou corrige a pergunta inteira numa
 * rodada, em vez de uma chamada de modelo por defeito.
 */
export function validarPerguntaGerada(p: PerguntaGerada): ValidacaoDaPergunta {
  const problemas: ProblemaNaPergunta[] = []

  if (p.titulo.trim().length === 0) {
    problemas.push({ recusa: 'titulo-vazio', mensagem: 'A pergunta não tem título.' })
  }

  if (p.enunciado.trim().length === 0) {
    problemas.push({ recusa: 'enunciado-vazio', mensagem: 'A pergunta não tem enunciado.' })
  }

  if (p.justificativa.trim().length === 0) {
    problemas.push({
      recusa: 'justificativa-vazia',
      mensagem: 'A recomendação não vem justificada, e sem justificativa ela é só um default.'
    })
  }

  if (!isBlocoDoBrief(p.bloco)) {
    problemas.push({
      recusa: 'bloco-desconhecido',
      mensagem: `A pergunta declara preencher o bloco "${p.bloco}", que não existe no schema.`
    })
  }

  if (p.opcoes.length < MINIMO_DE_OPCOES || p.opcoes.length > MAXIMO_DE_OPCOES) {
    problemas.push({
      recusa: 'opcoes-fora-do-contrato',
      mensagem: `A pergunta tem ${p.opcoes.length} opções; o contrato pede entre ${MINIMO_DE_OPCOES} e ${MAXIMO_DE_OPCOES}.`
    })
  }

  for (const o of p.opcoes) {
    if (o.rotulo.trim().length === 0) {
      problemas.push({
        recusa: 'opcao-sem-rotulo',
        mensagem: `A opção "${o.id}" não tem rótulo.`
      })
    }

    // "Opção sem impacto é opção sem escolha" — o comentário do contrato original, aplicado ao
    // que o modelo produz. Sem o trade-off declarado, o PI escolhe no escuro.
    if (o.impacto.trim().length === 0) {
      problemas.push({
        recusa: 'opcao-sem-impacto',
        mensagem: `A opção "${o.id}" não declara impacto, e sem ele não há trade-off a comparar.`
      })
    }
  }

  // Opções mutuamente **excludentes** é o contrato. Duas com o mesmo rótulo não são duas
  // escolhas: são a mesma escolha oferecida duas vezes, e o PI não teria como distingui-las.
  //
  // Espaço interno colapsado além do acento e da caixa: um modelo produz "Fatia vertical" e
  // "fatia  vertical" com a mesma facilidade, e sem isso a repetição passaria disfarçada de
  // duas opções. Foi o que o teste pegou.
  const rotulos = p.opcoes.map((o) => normalizar(o.rotulo).trim().replace(/\s+/g, ' '))
  if (new Set(rotulos).size !== rotulos.length) {
    problemas.push({
      recusa: 'opcoes-repetidas',
      mensagem: 'Duas opções têm o mesmo rótulo; elas precisam ser mutuamente excludentes.'
    })
  }

  // A recomendada tem de ser uma das opções. Um id solto faria a tela não destacar nada — e
  // "Decide por mim" gravaria como escolha algo que não está na lista.
  if (!p.opcoes.some((o) => o.id === p.recomendada)) {
    problemas.push({
      recusa: 'recomendada-inexistente',
      mensagem: `A recomendada "${p.recomendada}" não está entre as opções oferecidas.`
    })
  }

  // A invariante 9 em runtime — a razão de este arquivo existir. Na M8-F03 esta varredura era
  // teste sobre catálogo revisado; aqui roda sobre texto que ninguém leu.
  const texto = normalizar(textoVisivel(p))
  const termo = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.find((t) => texto.includes(t))

  if (termo !== undefined) {
    problemas.push({
      recusa: 'requisito-inventado',
      mensagem: `A pergunta menciona "${termo}". A pipeline não inventa requisito legal, regulatório, de consentimento, aceite duplo ou classificação por domínio (invariante 9 do CONVENTION §4).`
    })
  }

  return { valida: problemas.length === 0, problemas }
}

/**
 * Filtra as perguntas que passam, devolvendo também as recusadas.
 *
 * As duas listas, e não só as válidas: uma recusa silenciosa faria o refinamento pular um bloco
 * sem ninguém saber por quê, e o serviço precisa registrar o que foi barrado para pedir de novo.
 */
export function separarPerguntasValidas(perguntas: readonly PerguntaGerada[]): {
  readonly validas: readonly PerguntaGerada[]
  readonly recusadas: readonly {
    pergunta: PerguntaGerada
    problemas: readonly ProblemaNaPergunta[]
  }[]
} {
  const validas: PerguntaGerada[] = []
  const recusadas: { pergunta: PerguntaGerada; problemas: readonly ProblemaNaPergunta[] }[] = []

  for (const p of perguntas) {
    const resultado = validarPerguntaGerada(p)
    if (resultado.valida) validas.push(p)
    else recusadas.push({ pergunta: p, problemas: resultado.problemas })
  }

  return { validas, recusadas }
}
