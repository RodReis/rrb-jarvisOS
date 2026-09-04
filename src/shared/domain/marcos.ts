/**
 * Os marcos do planejamento no Git: o que está versionado, e o que impede a Construção
 * (SPEC-Fases-04).
 *
 * A pergunta que este arquivo responde é uma só: **o que o PI aceitou está de fato no Git?**
 *
 * "Está no Git" é ambíguo de um jeito que custa caro, e a spec desfaz a ambiguidade em três
 * condições distintas — cada uma com um remédio diferente para o usuário:
 *
 *  - **sem commit**: a revisão foi aceita e nunca virou commit. O documento existe no SQLite e
 *    talvez no disco, mas não no histórico.
 *  - **blob divergente**: existe commit do arquivo, mas o conteúdo commitado **não é** a revisão
 *    aceita. É o caso que "existe commit" mascararia: um `PRD.md` commitado na versão antiga,
 *    com o PI tendo aceitado uma revisão posterior. A tela diria "versionado" e estaria mentindo.
 *  - **worktree sujo / HEAD interrompido**: o repositório não está num estado em que "o que está
 *    commitado" seja uma resposta estável.
 *
 * **O que este arquivo não faz:** não roda Git, não lê disco, não conhece `GitRunner`. Recebe
 * fatos já coletados e decide o que eles significam — a mesma divisão de `aprovacoes.ts`, e pela
 * mesma razão: é aqui que mora a decisão de bloquear o gate, e decisão precisa ser testável sem
 * repositório de verdade.
 */

/**
 * O estado de um marco. Enum fechado: a tela decide o que mostrar a partir dele, e um quarto
 * estado é mudança de contrato — nunca uma string que apareceu porque alguém escreveu outro nome.
 */
export const ESTADOS_DO_MARCO = [
  /** Nenhuma revisão aceita ainda: não há o que cobrar. Não bloqueia. */
  'sem-revisao',
  /** Há revisão aceita, mas nenhum commit do arquivo. Bloqueia. */
  'revisao-sem-commit',
  /** Há commit, mas o blob commitado não é a revisão aceita. Bloqueia. */
  'blob-divergente',
  /** O commit contém exatamente a revisão aceita. */
  'commitado'
] as const

export type EstadoDoMarco = (typeof ESTADOS_DO_MARCO)[number]

/**
 * O que se sabe de um documento do planejamento, já coletado do Git e do banco.
 *
 * Os dois hashes têm o **mesmo algoritmo de propósito**: `hashDaRevisao` é o que o serviço gravou
 * quando o PI aceitou (SHA-256 do conteúdo, utf8), e `hashDoBlob` é o SHA-256 recalculado sobre o
 * conteúdo do arquivo **como ele está no commit**. Comparar `git hash-object` com o hash da
 * revisão nunca funcionaria — um é SHA-1 de blob com header, o outro SHA-256 de texto — e essa
 * comparação impossível é a armadilha que este contrato existe para fechar.
 */
export interface FatoDoMarco {
  /** O caminho do documento no projeto, como `docs/PRD.md`. Identifica a linha do painel. */
  readonly caminho: string
  /** O hash da revisão aceita pelo PI, ou `undefined` se nenhuma foi aceita. */
  readonly hashDaRevisao?: string
  /** O commit mais recente que tocou o arquivo, ou `undefined` se não há nenhum. */
  readonly commit?: string
  /** A data do commit, em ISO. Só existe quando `commit` existe. */
  readonly data?: string
  /** SHA-256 do conteúdo do arquivo **no commit** — recalculado, nunca `git hash-object`. */
  readonly hashDoBlob?: string
}

/** Uma linha do painel: o fato mais o veredito. */
export interface LinhaDeMarco extends FatoDoMarco {
  readonly estado: EstadoDoMarco
}

/**
 * O estado do repositório no momento da leitura.
 *
 * `sujos` carrega **só os caminhos**, nunca o conteúdo (critério 2 e ADR-004): o painel mostra
 * *que* há trabalho não commitado, e mostrar o diff exporia conteúdo numa tela que existe para
 * falar sobre versionamento.
 */
export interface EstadoDoRepositorio {
  /** Caminhos com modificação não commitada. Vazio ⇒ árvore limpa. */
  readonly sujos: readonly string[]
  /** `true` quando há merge, rebase ou cherry-pick interrompido no `HEAD`. */
  readonly headInterrompido: boolean
  /** O `HEAD` no instante da leitura. É por ele que a verificação expira (critério 5). */
  readonly head: string
  /** O SHA publicado no remoto, ou `undefined` quando o projeto não foi publicado. */
  readonly publicadoEm?: string
}

/**
 * Um item que impede a Construção: o motivo e **a ação concreta** (critério 4).
 *
 * A ação é obrigatória, não opcional, e é o que separa este bloqueio de um erro genérico. A spec
 * proíbe "aceitar mesmo assim"; um bloqueio sem saída seria a mesma coisa que uma parede — a
 * ação é o que faz do bloqueio um passo, e não um beco.
 */
export interface ItemPendente {
  readonly caminho: string
  readonly estado: Exclude<EstadoDoMarco, 'sem-revisao' | 'commitado'> | 'arvore-suja' | 'head-interrompido'
  readonly mensagem: string
  /** O que fazer para destravar. Nunca vazio. */
  readonly acao: string
}

/**
 * O resultado da verificação. `ok: true` é o único desfecho que deixa o `SLICE_ENTRY` seguir.
 *
 * `head` viaja junto porque o resultado **expira**: entre verificar e clicar em aceitar, alguém
 * pode commitar, e um `ok` de um `HEAD` que já não é o atual autorizaria um aceite sobre um
 * repositório diferente do que foi verificado (critério 5).
 */
export interface ResultadoDaVerificacao {
  readonly ok: boolean
  readonly head: string
  readonly pendencias: readonly ItemPendente[]
}

/**
 * O painel inteiro, como a tela o consome.
 *
 * `disponivel: false` cobre o Git ausente ou não permitido: a tela mostra a explicação em vez de
 * uma lista vazia, que o usuário leria como "nenhum documento" — o oposto do que aconteceu.
 *
 * Vive no domínio, e não no serviço, porque atravessa a ponte: é o tipo que o preload e o
 * renderer consomem, e um tipo do `main/` importado pelo contrato acoplaria os dois lados.
 */
export interface VistaDeMarcos {
  readonly disponivel: boolean
  readonly linhas: readonly LinhaDeMarco[]
  readonly repositorio: EstadoDoRepositorio
  /** Presente quando `disponivel` é `false`: a ação concreta, vinda do `GitRunner`. */
  readonly mensagem?: string
}

/**
 * O veredito de um marco, a partir dos fatos.
 *
 * A ordem das guardas é a ordem das perguntas: sem revisão aceita não há o que cobrar; com
 * revisão mas sem commit, falta commitar; com os dois, resta saber se o commit **é** a revisão.
 */
export function estadoDoMarco(fato: FatoDoMarco): EstadoDoMarco {
  if (fato.hashDaRevisao === undefined) return 'sem-revisao'
  if (fato.commit === undefined) return 'revisao-sem-commit'
  // Blob ausente com commit presente conta como divergência, e não como estado próprio: o
  // arquivo saiu do commit ou não pôde ser lido, e nos dois casos o que está versionado não é a
  // revisão aceita. Um quarto estado aqui daria ao usuário um vocabulário a mais para a mesma
  // ação — recommitar o marco.
  return fato.hashDoBlob === fato.hashDaRevisao ? 'commitado' : 'blob-divergente'
}

/** As linhas do painel, na ordem em que os fatos chegaram. */
export function linhasDeMarcos(fatos: readonly FatoDoMarco[]): readonly LinhaDeMarco[] {
  return fatos.map((fato) => ({ ...fato, estado: estadoDoMarco(fato) }))
}

/**
 * A verificação que o gate consulta (critério 4): determinística, pura, sem I/O.
 *
 * As três condições da spec, nesta ordem — marcos primeiro porque são a pergunta do PI ("os
 * documentos estão versionados?"), estado do repositório depois porque é a condição que torna a
 * primeira resposta confiável.
 *
 * **Falha fechado:** qualquer pendência bloqueia, e não existe parâmetro que ignore uma delas. A
 * regra é do PI — *antes da construção os documentos precisam estar versionados* — e um bypass a
 * transformaria em sugestão.
 */
export function verificarMarcos(
  fatos: readonly FatoDoMarco[],
  repositorio: EstadoDoRepositorio
): ResultadoDaVerificacao {
  const pendencias: ItemPendente[] = []

  for (const linha of linhasDeMarcos(fatos)) {
    if (linha.estado === 'revisao-sem-commit') {
      pendencias.push({
        caminho: linha.caminho,
        estado: 'revisao-sem-commit',
        mensagem: `${linha.caminho} foi aceito mas não está commitado.`,
        acao: `Commitar marco ${linha.caminho}`
      })
      continue
    }

    if (linha.estado === 'blob-divergente') {
      pendencias.push({
        caminho: linha.caminho,
        estado: 'blob-divergente',
        mensagem: `O commit de ${linha.caminho} não contém a revisão aceita.`,
        acao: `Commitar marco ${linha.caminho}`
      })
    }
  }

  if (repositorio.headInterrompido) {
    pendencias.push({
      caminho: 'HEAD',
      estado: 'head-interrompido',
      mensagem: 'O repositório tem um merge ou rebase interrompido.',
      acao: 'Concluir ou abortar a operação em curso no Git antes de aceitar.'
    })
  }

  if (repositorio.sujos.length > 0) {
    pendencias.push({
      caminho: repositorio.sujos.join(', '),
      estado: 'arvore-suja',
      mensagem: `Há ${repositorio.sujos.length} arquivo(s) com alteração não commitada.`,
      acao: `Descartar ou commitar alterações em ${repositorio.sujos.join(', ')}`
    })
  }

  return { ok: pendencias.length === 0, head: repositorio.head, pendencias }
}

/**
 * O resultado ainda vale para este `HEAD`? (critério 5)
 *
 * Separado de `verificarMarcos` porque responde outra pergunta, num outro instante: a
 * verificação diz *"estava ok"*, esta diz *"e continua sendo o mesmo repositório"*. Juntá-las
 * faria a checagem depender de uma segunda leitura do Git no momento do clique — que é
 * justamente o que ela existe para exigir.
 */
export function resultadoAindaVale(
  resultado: ResultadoDaVerificacao | undefined,
  headAtual: string
): boolean {
  return resultado !== undefined && resultado.ok && resultado.head === headAtual
}
