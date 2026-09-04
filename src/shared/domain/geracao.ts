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
