/**
 * O contrato entre o kernel e qualquer CLI executor de código (SPEC-Multi-Executor-01).
 *
 * A fronteira que este arquivo desenha: **o kernel governa, o adapter traduz**. Escopo,
 * política, orçamento, efeitos externos e Git são decisões do kernel e não aparecem aqui;
 * o adapter recebe um pedido já decidido e devolve execução, eventos, uso, sessão e
 * cancelamento. Nada mais.
 *
 * `CodingExecutorRuntime` é irmão de `AIProviderRuntime` e `ConnectorRuntime`
 * (ARCHITECTURE § Pipeline V2), e não uma variação do `AiAdapter`: aquele contrato é
 * talhado para conversa (prompt entra, texto sai), e este para trabalho em árvore de
 * arquivos — com worktree, paths, validações e sessão retomável. Forçar os dois na mesma
 * interface daria a cada consumidor a metade dos campos que não lhe servem.
 *
 * Zero import de Node neste arquivo, de propósito: é o que F02 e F03 importam para
 * implementar os adapters concretos, e um `child_process` aqui obrigaria todo teste do
 * contrato a carregar o mundo.
 */

/**
 * Como esta execução é cobrada.
 *
 * `unmetered`: rota de assinatura, sem custo por chamada (o plano já foi pago).
 * `subscription_limited`: assinatura com teto de uso — tem quota a respeitar.
 * `metered`: pago por token, com custo por chamada.
 *
 * Existe no request porque o runtime **recusa modo que o executor não suporta antes de
 * iniciar o CLI** (critério 4): descobrir no meio do stream que a rota cobra o que ninguém
 * autorizou é descobrir depois de já ter gastado.
 */
export const MODOS_DE_COBRANCA = ['unmetered', 'subscription_limited', 'metered'] as const
export type ModoDeCobranca = (typeof MODOS_DE_COBRANCA)[number]

/**
 * A autenticação, **opaca** (critério 5).
 *
 * O adapter recebe um identificador do que usar, nunca o segredo. Quem resolve a referência
 * em credencial de verdade é o kernel, que conhece usuário e workspace; um adapter que
 * lesse o Vault por conta própria precisaria conhecer esse escopo — e passaria a ser mais
 * um lugar onde o segredo é buscado, mais uma superfície de vazamento e mais um caminho
 * que o renderer poderia alcançar.
 *
 * `escopo` diz **qual sessão** usar (o `CODEX_HOME` dedicado da F02 é um caso), nunca o
 * conteúdo dela. Nenhum campo deste tipo carrega valor de credencial, e o teste do critério
 * 5 afirma justamente a ausência.
 */
export interface ReferenciaDeAutenticacao {
  /** O identificador da sessão/perfil a usar. Opaco: só o kernel sabe traduzi-lo. */
  readonly referencia: string
  /** Escopo da sessão, quando o executor tem mais de uma. */
  readonly escopo?: string
}

/**
 * O pedido normalizado de execução.
 *
 * Tudo já resolvido pelo kernel: o executor foi escolhido, o modelo foi congelado, as
 * revisões foram aprovadas, o sandbox está de pé. O adapter não decide nenhuma destas
 * coisas — ele as obedece.
 */
export interface ExecutorRequest {
  /** O run a que esta tentativa pertence. */
  readonly runId: string
  /**
   * A tentativa. **Só o kernel a abre** (regra 1), e é a identidade que faz evento atrasado
   * não reabrir estado terminal: um evento que chega com `attemptId` de tentativa já
   * encerrada é diagnóstico, nunca transição.
   */
  readonly attemptId: string
  /**
   * A chave idempotente da tentativa (regra 2).
   *
   * Separada do `attemptId` porque responde outra pergunta: o `attemptId` identifica **esta**
   * tentativa, a chave identifica **o trabalho** que ela faz. Depois de um crash, o kernel
   * retoma com chave igual e `attemptId` novo; é a chave que permite reconhecer "isto já foi
   * executado" em vez de duplicar o efeito.
   */
  readonly chaveIdempotente: string
  /** Qual executor atende (`claude-code`, `codex-exec`, o fake nos testes). */
  readonly executor: string
  /** O modelo, congelado pelo kernel — nunca resolvido aqui. */
  readonly modelo: string
  readonly modoDeCobranca: ModoDeCobranca
  /**
   * As revisões que o kernel aprovou para esta execução.
   *
   * Lista e não booleano: o runtime recusa revisão que o executor não conhece (critério 4),
   * e para isso precisa saber **quais** foram aprovadas, não apenas que houve aprovação.
   */
  readonly revisoesAprovadas: readonly string[]
  /** O manifesto de contexto que autorizou esta execução. */
  readonly contextPackId: string
  /** Onde o trabalho acontece: o worktree no host e, quando há, o container. */
  readonly worktree: string
  readonly container?: string
  /**
   * Os paths que esta execução pode tocar.
   *
   * O adapter os recebe como **informação**, não como permissão a conceder: quem autoriza
   * escrita é o kernel, que verifica o resultado depois (regra 3). Passá-los aqui serve
   * para o executor saber onde trabalhar, e não para ele se policiar.
   */
  readonly pathsPermitidos: readonly string[]
  /** Os comandos de validação a rodar, no vocabulário do projeto-alvo. */
  readonly validacoes: readonly (readonly string[])[]
  readonly limiteDeTempoMs: number
  /** O JSON Schema que a saída deve obedecer, já serializado. Ausente = saída livre. */
  readonly schemaDeSaida?: string
  readonly autenticacao: ReferenciaDeAutenticacao
  /** Retomada de sessão: a sessão anterior a continuar. Ausente = execução nova. */
  readonly sessaoAnterior?: string
  /** Aborta a execução (timeout do kernel, ou o usuário cancelando). */
  readonly signal?: AbortSignal
}

/**
 * O que o adapter emite, normalizado.
 *
 * União discriminada e não objeto com campos opcionais: o consumidor precisa saber, pelo
 * tipo, que `usage` só existe em `usage` e que `erro` só existe em `failed`. Campos
 * opcionais num objeto único deixariam todo consumidor checando presença em runtime do que
 * o compilador podia garantir.
 *
 * `desconhecido` é o caso que a regra 4 exige: evento que o adapter não reconhece é
 * **preservado como diagnóstico**, sem alterar estado por inferência. Descartá-lo perderia
 * o sinal justo quando o fornecedor muda o formato; inferir transição dele faria o estado
 * do kernel depender de um campo que ninguém contratou.
 */
export type ExecutorEvent =
  | { readonly tipo: 'started'; readonly sessao?: string }
  | { readonly tipo: 'progress'; readonly mensagem: string }
  | { readonly tipo: 'tool_used'; readonly nome: string; readonly argumentos?: string }
  | { readonly tipo: 'path_changed'; readonly path: string }
  | {
      readonly tipo: 'usage'
      readonly tokensEntrada: number
      readonly tokensSaida: number
      readonly duracaoMs?: number
    }
  | { readonly tipo: 'done'; readonly resumo?: string }
  | { readonly tipo: 'failed'; readonly erro: string; readonly assinatura?: string }
  | { readonly tipo: 'canceled' }
  | { readonly tipo: 'desconhecido'; readonly bruto: string }

/**
 * Os eventos que **encerram** a tentativa.
 *
 * Lista nomeada e não `switch` espalhado: a máquina de estados, o runtime e o contract test
 * todos precisam da mesma resposta para "isto é terminal?", e três lugares decidindo por
 * conta própria é onde um deles discorda.
 */
export const EVENTOS_TERMINAIS = ['done', 'failed', 'canceled'] as const
export type EventoTerminal = (typeof EVENTOS_TERMINAIS)[number]

export const STATUS_DO_RESULTADO = ['concluido', 'falhou', 'cancelado', 'recusado'] as const
export type StatusDoResultado = (typeof STATUS_DO_RESULTADO)[number]

/**
 * O resultado estruturado da execução.
 *
 * `recusado` é status de primeira classe, e não uma falha qualquer: a execução recusada pelo
 * critério 4 **não chegou ao CLI**, então não gastou nada e não tem uso a reportar. Tratá-la
 * como `falhou` diria ao PI que o executor tentou e quebrou, quando o runtime o impediu de
 * começar.
 */
export interface ExecutorResult {
  readonly status: StatusDoResultado
  readonly attemptId: string
  readonly resumo?: string
  /** Os paths que o executor **relatou** ter tocado. Observação, não autorização (regra 3). */
  readonly pathsAlterados: readonly string[]
  readonly validacoes: readonly { readonly comando: string; readonly ok: boolean }[]
  /**
   * As evidências, **já redigidas** (regra 5).
   *
   * Passam por `redigirSegredos` antes de entrar aqui porque este campo vai para log e
   * relatório: um token no meio de um argumento de ferramenta é evidência que o PI precisa
   * ver, e barrar a linha inteira esconderia a ferramenta em vez de esconder o segredo.
   */
  readonly evidencias: readonly string[]
  readonly uso?: {
    readonly tokensEntrada: number
    readonly tokensSaida: number
    readonly duracaoMs?: number
  }
  /** A sessão a retomar, quando o executor a ofereceu. */
  readonly sessaoRetomavel?: string
  /**
   * A assinatura da falha (critério 6).
   *
   * Nossa e não do fornecedor: é o que permite agrupar "a mesma falha" entre executores
   * diferentes. Depender do código de erro interno do Codex faria toda consulta de
   * auditoria quebrar quando ele mudasse a numeração.
   */
  readonly assinaturaDeFalha?: string
  /** Eventos que o adapter não reconheceu, preservados como diagnóstico (regra 4). */
  readonly diagnosticos: readonly string[]
}

/**
 * Um executor de código, reduzido ao que o kernel precisa.
 *
 * Dois métodos. `executar` é o trabalho; `disponivel` é a pergunta mais barata que prova
 * que o executor existe e responde — e é o que o health por executor da spec consome.
 * A tentação seria acrescentar `listarModelos`, `versao`, `autenticar`: tudo isso é F02/F03
 * e não tem consumidor hoje.
 */
export interface CodingExecutorAdapter {
  /** O identificador do executor — o mesmo valor de `ExecutorRequest.executor`. */
  readonly nome: string
  /**
   * Os modos de cobrança que este executor atende.
   *
   * Declarado pelo adapter e verificado pelo runtime **antes** de iniciar o CLI (critério 4):
   * é o que transforma "modo incompatível" de erro descoberto tarde em recusa barata.
   */
  readonly modosSuportados: readonly ModoDeCobranca[]
  /** As revisões que este executor conhece. Revisão fora desta lista é recusada. */
  readonly revisoesSuportadas: readonly string[]
  /** `true` quando o executor aceita impor um JSON Schema à saída. */
  readonly suportaSchemaDeSaida: boolean

  /** O executor está instalado e responde? Nunca lança — ausência é a resposta `false`. */
  disponivel(): Promise<boolean>

  /**
   * Dispara a execução e devolve os eventos conforme chegam.
   *
   * `AsyncIterable` e não callback: o runtime precisa decidir quando parar de consumir (o
   * cancelamento é isso), e um callback inverteria esse controle para dentro do adapter.
   *
   * Lança em falha de processo ou timeout; quem traduz exceção em `ExecutorResult` é o
   * runtime, um lugar só, para todo executor.
   */
  executar(request: ExecutorRequest): AsyncIterable<ExecutorEvent>
}
