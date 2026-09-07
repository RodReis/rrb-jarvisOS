/**
 * O **console da geração** (SPEC-Fases-03) — os eventos que uma geração emite enquanto acontece,
 * e o que deles fica gravado.
 *
 * A pergunta que este arquivo responde: **o que o PI vê enquanto a IA trabalha, e o que sobra
 * disso depois?** O documento é o produto; este é o registro de como ele nasceu.
 *
 * ## Por que domínio puro
 *
 * Nada aqui conhece o CLI, o SQLite ou o React. O parser do `stream-json` mora no main e produz
 * estes tipos; o painel mora no renderer e os consome. Os dois lados dependem deste arquivo e
 * nenhum depende do outro — o que impede o formato de terceiro (o JSON do CLI) de vazar para a
 * tela, onde uma mudança dele viraria quebra de UI.
 *
 * ## O que é resumo e o que é conteúdo
 *
 * Ferramenta tem argumento e resultado, e os dois podem ser enormes (um `Read` de arquivo
 * grande, um `WebFetch`) ou sensíveis (um `Bash` com token na linha). A decisão da spec é que
 * **nem o argumento nem o resultado completos são persistidos**: o que fica é um resumo curto,
 * redigido, com o tamanho original ao lado. A tela precisa de "o quê e quanto", não do conteúdo.
 */

/** Teto do resumo do resultado de uma ferramenta, em bytes. Acima disto, trunca. */
export const LIMITE_RESUMO_BYTES = 2 * 1024

/** Teto do resumo do argumento de uma ferramenta desconhecida, em caracteres. */
export const LIMITE_ARGUMENTO_DESCONHECIDO = 120

/** Como terminou uma chamada de ferramenta. */
export type StatusDaFerramenta = 'ok' | 'erro'

/**
 * Um evento da geração, fechado (SPEC-Fases-03 § Eventos).
 *
 * União discriminada e não um objeto com campos opcionais: `ferramenta-fim` sem `chamadaId` não
 * é um estado que deva compilar, e um `tipo?: string` deixaria cada consumidor inventar a sua
 * própria checagem — a terceira delas erraria.
 */
export type GenerationEvent =
  | { readonly tipo: 'texto'; readonly delta: string }
  | {
      readonly tipo: 'ferramenta-inicio'
      readonly chamadaId: string
      readonly nome: string
      readonly resumoDoArgumento: string
    }
  | {
      readonly tipo: 'ferramenta-fim'
      readonly chamadaId: string
      readonly status: StatusDaFerramenta
      readonly resumoDoResultado: string
      /** O tamanho antes do truncamento, em bytes. Igual ao resumo quando nada foi cortado. */
      readonly tamanhoOriginal: number
    }
  | {
      readonly tipo: 'uso'
      readonly tokensEntrada: number
      readonly tokensSaida: number
      readonly duracaoMs: number
    }
  | { readonly tipo: 'erro'; readonly mensagem: string }
  | {
      readonly tipo: 'etapa'
      readonly etapa: EtapaDaGeracao
      readonly estado: EstadoDaEtapa
      /**
       * O que a etapa produziu, em uma frase. Presente só quando ela **termina** — antes disso
       * não há saída a resumir, e prometer uma frase que ainda não existe faria a tela reservar
       * espaço para um vazio.
       */
      readonly resumo?: string
    }

/**
 * As etapas de uma geração de pacote, **na ordem em que acontecem** (SPEC-Jornada-03 § Geração).
 *
 * A lista é o que dá porcentagem honesta: o progresso é *quantas destas terminaram*, não um
 * cronômetro estimando o que falta. Cronômetro mentiria — a duração de uma chamada ao modelo
 * não é conhecida antes dela terminar, e uma barra que anda sozinha promete um fim que ninguém
 * pode prometer.
 *
 * `pesquisa` entra na lista mesmo quando o PI não confirmou termo: ela acontece de qualquer
 * forma, só que terminando imediatamente com a lacuna declarada. Tirá-la da lista nesse caso
 * faria a mesma geração ter denominadores diferentes, e a porcentagem saltaria sem que nada
 * tivesse mudado.
 */
export const ETAPAS_DA_GERACAO = [
  'pesquisa',
  'documentos',
  'validacao',
  'contradicoes',
  'gravacao'
] as const

/**
 * As etapas da geração da **arquitetura** (issue #337).
 *
 * Não são as do PRD, e é por isso que a lista existe: `pesquisa` não acontece aqui, e no lugar
 * das contradições vem a **análise de coerência** — a leitura dos protótipos contra o PRD, que é
 * o que produz os ajustes. Reaproveitar a lista do PRD daria porcentagem sobre etapas que nunca
 * chegam, e a barra pararia em 60% numa geração que terminou.
 *
 * `prototipos` é a validação determinística que roda **antes da IA**, e ela é o gate: nomeá-la
 * separado é o que deixa o PI ver que o custo ainda não começou quando ela falha.
 */
export const ETAPAS_DA_ARQUITETURA = [
  'prototipos',
  'documentos',
  'validacao',
  'coerencia',
  'gravacao'
] as const

/**
 * As etapas da geração do **roadmap** (issue #337).
 *
 * `dag` é o validador de ciclo entre MVPs — o passo que nomeia a dependência circular e pede ao
 * modelo que a desfaça. É próprio desta geração, e sem ele o PI via 58,9 segundos de espera sem
 * saber que havia uma correção em curso.
 */
export const ETAPAS_DO_ROADMAP = ['mvps', 'validacao', 'dag', 'gravacao'] as const

/**
 * As etapas de **escolher o MVP que entra na fila** (issue #337).
 *
 * Parece um clique e é uma geração: escolher produz a **SPEC da primeira fatia**, com chamada ao
 * modelo. O PI clicou em "Colocar na fila" e viu dois botões girando sem nada dizer o que
 * acontecia — a mesma queixa da geração do roadmap, numa ação que nem parecia gerar.
 */
export const ETAPAS_DA_ESCOLHA = ['spec', 'validacao', 'gravacao'] as const

/**
 * Toda etapa que qualquer geração pode anunciar.
 *
 * União das três listas: o canal é um só, e o tipo precisa aceitar o que qualquer serviço emite.
 * Quem decide **quais** contam para o progresso é a lista da geração, não este tipo.
 */
export type EtapaDaGeracao =
  | (typeof ETAPAS_DA_GERACAO)[number]
  | (typeof ETAPAS_DA_ARQUITETURA)[number]
  | (typeof ETAPAS_DO_ROADMAP)[number]
  | (typeof ETAPAS_DA_ESCOLHA)[number]

/**
 * Em que ponto uma etapa está.
 *
 * `falhou` é estado próprio e não ausência de `concluida`: uma etapa que falhou e uma que ainda
 * não começou parecem idênticas quando o único sinal é "não concluiu" — e são coisas opostas
 * para quem está olhando a tela decidindo se espera ou intervém.
 */
export type EstadoDaEtapa = 'iniciada' | 'concluida' | 'falhou'

/**
 * Quanto da geração já terminou, de 0 a 100.
 *
 * Conta **etapas concluídas** sobre o total conhecido. Uma etapa em curso não conta como meia:
 * não há como saber quanto dela já passou, e inventar meio passo faria a barra andar por
 * suposição em vez de por fato.
 */
export function progressoDaGeracao(
  etapas: ReadonlyMap<EtapaDaGeracao, EstadoDaEtapa>,
  contrato: readonly EtapaDaGeracao[] = [...ETAPAS_DA_GERACAO]
): number {
  let concluidas = 0
  for (const etapa of contrato) {
    if (etapas.get(etapa) === 'concluida') concluidas += 1
  }
  return Math.round((concluidas / contrato.length) * 100)
}

/** O andamento de uma etapa: em que ponto está e o que ela produziu quando terminou. */
export interface AndamentoDaEtapa {
  readonly estado: EstadoDaEtapa
  readonly resumo?: string
}

/**
 * Aplica um anúncio de etapa ao andamento **de uma rodada** (#318).
 *
 * A rodada é a unidade honesta: o PI viu uma geração nova abrir em 60%, com "Gravação — os três
 * documentos foram gravados" pendurado de uma rodada anterior enquanto esta ainda gerava. Contar
 * etapas de duas gerações somadas responde uma pergunta que ninguém fez.
 *
 * **A fronteira é a primeira etapa do contrato iniciando** — o único marco que o serviço já
 * emite, sem inventar um evento de "rodada nova" que ninguém manda. Concluir a primeira **não**
 * abre rodada: sem termo de pesquisa ela inicia e conclui em sequência, e zerar ali apagaria a
 * si mesma.
 *
 * Devolve mapa novo, nunca muta o recebido: quem guarda o andamento é o estado do React, e mutar
 * o mapa anterior deixaria a tela sem saber que algo mudou.
 */
export function aplicarEtapa(
  anterior: ReadonlyMap<EtapaDaGeracao, AndamentoDaEtapa>,
  evento: {
    readonly etapa: EtapaDaGeracao
    readonly estado: EstadoDaEtapa
    readonly resumo?: string
  },
  /** A lista da geração em curso. A primeira dela é a fronteira da rodada nova. */
  contrato: readonly EtapaDaGeracao[] = [...ETAPAS_DA_GERACAO]
): ReadonlyMap<EtapaDaGeracao, AndamentoDaEtapa> {
  const rodadaNova = evento.etapa === contrato[0] && evento.estado === 'iniciada'
  const mapa = new Map(rodadaNova ? [] : anterior)

  // O andamento é **substituído**, não mesclado: um estado sem resumo apaga o resumo anterior.
  // Mesclar deixaria "os três documentos foram gravados" ao lado de `falhou`.
  mapa.set(evento.etapa, {
    estado: evento.estado,
    ...(evento.resumo === undefined ? {} : { resumo: evento.resumo })
  })

  return mapa
}

/**
 * Um evento a caminho da tela: o evento e a geração a que ele pertence.
 *
 * O `traceId` viaja **no payload** e não no nome do canal porque o transporte é um canal único
 * (`IPC_EVENT_CHANNELS.generationEvent`); quem filtra por geração é o preload. Mora aqui, e não
 * no main, justamente porque atravessa a ponte — os dois lados precisam do mesmo tipo.
 */
export interface EventoDaGeracao {
  readonly traceId: string
  readonly evento: GenerationEvent
}

/** Como terminou a geração inteira. */
export type StatusDoTrace = 'concluido' | 'falhou' | 'cancelado'

/**
 * O cabeçalho de uma geração gravada.
 *
 * `ledgerEntryId` é o `call_id` do ponto único — o mesmo identificador que já correlaciona
 * `cost_event`, auditoria e log (decisão do PI de 2026-09-04). **Obrigatório**: um trace sem ele
 * seria uma segunda contabilidade de uso, paralela ao ledger e divergindo dele em silêncio.
 */
export interface GenerationTrace {
  readonly id: string
  readonly projectId: string
  readonly ledgerEntryId: string
  readonly etapa: string
  readonly fase: string
  readonly provider: string
  readonly modelo: string
  readonly iniciadoEm: string
  readonly terminadoEm?: string
  readonly status: StatusDoTrace
}

/**
 * Corta um texto em `limite` **bytes** de UTF-8, devolvendo o tamanho original.
 *
 * Bytes e não caracteres porque o limite existe para proteger o banco, e o banco guarda bytes:
 * 2048 caracteres de acentuação viram quase 4 KB.
 *
 * O corte cai em fronteira de caractere. `TextDecoder` **não** basta sozinho: o modo padrão é
 * tolerante e troca a sequência partida por `�` (U+FFFD), então o resumo terminaria com um
 * losango de erro em vez de terminar limpo — foi o que o teste pegou. `fatal: true` transforma
 * isso em exceção, e recuar byte a byte até decodificar é o que corta onde o caractere acaba.
 * No máximo três recuos: nenhuma sequência UTF-8 passa de quatro bytes.
 */
export function truncarBytes(
  texto: string,
  limite: number = LIMITE_RESUMO_BYTES
): { readonly resumo: string; readonly tamanhoOriginal: number } {
  const bytes = new TextEncoder().encode(texto)
  if (bytes.length <= limite) return { resumo: texto, tamanhoOriginal: bytes.length }

  const decodificador = new TextDecoder('utf-8', { fatal: true })

  for (let fim = limite; fim > limite - 4 && fim >= 0; fim -= 1) {
    try {
      return { resumo: decodificador.decode(bytes.slice(0, fim)), tamanhoOriginal: bytes.length }
    } catch {
      // Sequência partida: recua um byte e tenta de novo.
    }
  }

  return { resumo: '', tamanhoOriginal: bytes.length }
}

/**
 * De qual campo do argumento sai o resumo, por ferramenta (SPEC-Fases-03 § Eventos).
 *
 * Tabela e não `switch`: acrescentar ferramenta é acrescentar linha, e a lista fica legível como
 * o contrato que ela é. Ferramenta ausente cai no genérico — os primeiros
 * `LIMITE_ARGUMENTO_DESCONHECIDO` caracteres do JSON —, que é informação pobre mas honesta, e
 * nunca uma exceção: o CLI ganhar uma ferramenta nova não pode derrubar o console.
 */
export const RESUMO_POR_FERRAMENTA: Readonly<Record<string, readonly string[]>> = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  Bash: ['command'],
  PowerShell: ['command'],
  WebSearch: ['query'],
  WebFetch: ['url'],
  Task: ['description'],
  Skill: ['skill']
}

/**
 * O resumo do argumento de uma chamada de ferramenta.
 *
 * **Não redige.** A redação é responsabilidade de quem persiste (o mesmo redator do terminal do
 * MVP-004, ADR-004), e fazê-la aqui a esconderia dentro de uma função de formatação — onde o
 * próximo call site esqueceria que ela acontece e passaria a confiar num resumo que talvez não
 * tenha passado por lugar nenhum. Aqui se decide **qual campo mostrar**; o que pode ser mostrado
 * é decisão de outra camada.
 */
export function resumoDoArgumento(nome: string, argumento: unknown): string {
  const campos = RESUMO_POR_FERRAMENTA[nome]

  if (campos !== undefined && typeof argumento === 'object' && argumento !== null) {
    const registro = argumento as Record<string, unknown>
    for (const campo of campos) {
      const valor = registro[campo]
      if (typeof valor === 'string' && valor !== '') return valor
    }
  }

  // Genérico: o JSON cru, cortado. `JSON.stringify` devolve `undefined` (o valor, não a string)
  // para `undefined` e para função — daí o `??`, sem o qual o resumo viraria a string "undefined"
  // por um caminho e um crash de `.slice` por outro.
  const cru = JSON.stringify(argumento) ?? ''
  return cru.slice(0, LIMITE_ARGUMENTO_DESCONHECIDO)
}
