/**
 * O `ContextPack` — o manifesto imutável do contexto enviado (SPEC-Planejamento-02).
 *
 * A pergunta que este arquivo responde: **o que exatamente foi mandado ao modelo, e por quê?**
 * Não é organização de prompt. É o registro que torna uma geração reproduzível: quais revisões
 * de quais arquivos, quais decisões valiam, quais falhas ainda estavam abertas, qual teto de
 * orçamento e por qual rota a chamada saiu.
 *
 * **Imutável por construção.** O pack é montado uma vez, hasheado e nunca editado: um manifesto
 * que muda depois da chamada descreve um contexto que não foi o enviado, e o critério 2
 * ("reproduzir quais revisões foram enviadas") passaria a depender de ninguém ter mexido.
 * Expandir contexto é montar **outro** pack, com `packAnterior` apontando para o anterior.
 *
 * O que este arquivo **não** decide: como os arquivos são escolhidos (isso é I/O, mora no main)
 * nem se a chamada cabe no orçamento (`avaliarOrcamento`, em `budget.ts`). Aqui vivem a forma
 * do manifesto e as **regras puras** sobre ela — o que conta como exceção, o que conta como
 * falha nova, quantos tokens um conjunto de itens custa.
 *
 * Mora em `src/shared/domain` porque a tela mostra o manifesto (critério 3: a exceção de
 * whole-repo precisa ser *visível*), e o contrato precisa ser verificável sem Electron.
 */

import type { WorkspaceId } from './entities'
import type { AiProvider } from './ai'
import type { PathsPermitidos } from './preflight'

/**
 * De onde um item do contexto veio (spec § ContextPack: "origem das fontes").
 *
 * Enum fechado, não string livre: a origem é o que distingue "o usuário anexou isto" de "a
 * busca estrutural encontrou isto" — garantias diferentes sobre a mesma linha do manifesto.
 * Quem audita precisa saber se um arquivo entrou porque alguém pediu ou porque um `rg` casou.
 */
export const ORIGENS_DE_CONTEXTO = [
  /** Indicado explicitamente pelo usuário ou pela tarefa (o caminho preferencial da spec). */
  'explicito',
  /** Encontrado por busca estrutural (`rg`, índice, mapa) — a seleção dirigida da spec. */
  'busca-estrutural',
  /** Trazido por leitura ampla, que só acontece sob exceção registrada. */
  'leitura-ampla',
  /** Decisão, ADR ou regra de domínio já aprovada, anexada por ser aplicável. */
  'decisao-aprovada',
  /** Evidência externa coletada pelo ResearchAdapter (SPEC-Conectores-06). */
  'evidencia-externa',
  /**
   * Resumo que o **app fez do próprio estado** — não veio de arquivo nenhum (SPEC-Voz-03, E1).
   *
   * É a origem que distingue "isto o `rg` achou no disco" de "isto o app escreveu sobre si
   * mesmo agora". A diferença importa para quem audita: um item de arquivo pode ser reaberto e
   * conferido meses depois; um resumo do estado descreve um instante que já passou, e o hash
   * prova o texto exato que o modelo viu, não um arquivo a reler.
   */
  'estado-do-app'
] as const

export type OrigemDeContexto = (typeof ORIGENS_DE_CONTEXTO)[number]

/**
 * Um item do contexto: um arquivo (ou trecho) com o hash da revisão exata que foi enviada.
 *
 * **O hash é o item, não um adorno.** É ele que sustenta o critério 2: sem hash, o manifesto
 * diz "mandei `src/foo.ts`" — e `src/foo.ts` de quando? Com hash, a pergunta "esta geração viu
 * esta versão?" tem resposta binária, meses depois, sem depender de o arquivo não ter mudado.
 */
export interface ContextItem {
  /**
   * Caminho relativo à raiz do projeto. Relativo, não absoluto: o manifesto viaja.
   *
   * Para a origem `estado-do-app` não há arquivo, e o campo carrega um **identificador lógico**
   * (`app://snapshot`, `app://persona`) — o esquema `app://` é o que impede confundir os dois ao
   * ler o manifesto, e nenhum caminho de arquivo o produz.
   */
  readonly caminho: string
  /**
   * SHA-256 do conteúdo exato enviado. Ver `hashDoConteudo` no main.
   *
   * Na origem `estado-do-app` é o hash do **texto gerado**, não de um arquivo relido. A pergunta
   * que ele responde continua a mesma — "o modelo viu exatamente isto?" —, mas a resposta não
   * depende de o arquivo ainda existir.
   */
  readonly hash: string
  readonly origem: OrigemDeContexto
  /** Bytes do conteúdo enviado — o insumo do teto de contexto, medido e não estimado. */
  readonly bytes: number
  /**
   * Faixa de linhas, quando só um trecho entrou. Ausente = arquivo inteiro.
   *
   * Existe porque a spec manda começar por busca estrutural: o resultado de um `rg` é um
   * trecho, e registrar o arquivo inteiro afirmaria ter enviado o que não foi enviado.
   */
  readonly linhas?: { readonly de: number; readonly ate: number }
  /** Por que este item entrou — uma frase, para quem lê o manifesto sem conhecer a tarefa. */
  readonly motivo: string
}

/**
 * Uma falha ainda aberta, carregada para o contexto (spec § ContextPack: "falhas ainda
 * abertas"). O `fingerprint` é o que impede o critério 4 de ser convenção — ver
 * `FalhaRegistrada`.
 */
export interface FalhaNoContexto {
  readonly fingerprint: string
  /** Descrição curta, em pt-BR, do que falhou. Sem stack e sem saída crua de ferramenta. */
  readonly resumo: string
  /** Quantas tentativas já bateram nesta mesma falha. Insumo de "não insistir no mesmo erro". */
  readonly ocorrencias: number
}

/**
 * O teto e o consumo desta etapa (spec § Orçamento).
 *
 * **A rota decide o que é medido.** Rota paga tem `estimadoUsd` e é gateada pela
 * `BudgetPolicy`; rota de assinatura registra chamadas, tokens e tempo, e `estimadoUsd` é
 * `null` — não zero. Zero afirmaria "custou nada"; `null` diz **"não se converte em USD"**, que
 * é o fato (emenda do PI de 2026-08-29). Converter uso do MAX em dólar estimado seria número
 * inventado, e o gate barraria com base nele.
 */
export interface OrcamentoDaEtapa {
  /** A etapa do planejamento a que este teto se aplica. Texto livre da fatia que a define. */
  readonly etapa: string
  /** `true` quando a rota registra uso sem valor monetário (`isRotaUnmetered`). */
  readonly unmetered: boolean
  /** Teto de tokens desta etapa — vale nas duas rotas, porque contexto tem custo em ambas. */
  readonly tetoDeTokens: number
  /** Tokens estimados para esta chamada (contexto medido + teto de saída). */
  readonly tokensEstimados: number
  /** USD estimado na rota paga; `null` na rota de assinatura, por decisão do PI. */
  readonly estimadoUsd: number | null
  /**
   * Por que o teto foi expandido, quando foi (critério 6: "expansão fica atribuída a uma
   * causa"). Ausente = teto padrão, sem expansão.
   */
  readonly motivoDaExpansao?: string
}

/**
 * A exceção que autoriza leitura ampla (critério 3: "whole-repo exige exceção visível").
 *
 * Existe como **objeto obrigatório quando há leitura ampla**, e não como booleano: um flag
 * `wholeRepo: true` registraria que aconteceu sem registrar por que e sob que teto — e o
 * critério pede a exceção *visível*, não o fato. Sem motivo e sem teto, não é exceção
 * registrada: é leitura ampla com um rótulo.
 */
export interface ExcecaoDeLeituraAmpla {
  readonly motivo: string
  /** Teto de bytes que a exceção autoriza. Exceção sem teto é permissão permanente. */
  readonly tetoDeBytes: number
  /** Quem autorizou. Nesta fatia, sempre o usuário — agente autônomo é MVP-009. */
  readonly autorizadoPor: string
  readonly autorizadoEm: string
}

/**
 * O manifesto completo — imutável depois de montado.
 *
 * `hash` é do **pack inteiro**, e é o que a auditoria guarda: dois packs com o mesmo hash
 * mandaram o mesmo contexto, e é assim que "mesma revisão aprovada não solicita novo aceite"
 * (CONVENTION §4, invariante 2) se verifica sem comparar campo a campo.
 */
export interface ContextPack {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /**
   * O projeto sobre o qual a geração acontece. **Ausente** quando o contexto é do próprio app
   * (SPEC-Voz-03, E1) — a conversa por voz pergunta sobre a fila e os aceites, não sobre um
   * projeto.
   *
   * Ausente é uma afirmação, não um campo por preencher: diz que **não há** projeto, e é o que
   * faz a verificação contra o `ProjectRepository` ser pulada em vez de falhar. Um pack de
   * geração documental sem `projectId` continua sendo recusado, porque quem o monta sempre o
   * declara.
   */
  readonly projectId?: string
  /** A SPEC ou tarefa que motivou a geração (spec § ContextPack: "SPEC/tarefa"). */
  readonly tarefa: string
  readonly itens: readonly ContextItem[]
  /** Regras de domínio aplicáveis, como texto já resolvido. */
  readonly regras: readonly string[]
  readonly falhasAbertas: readonly FalhaNoContexto[]
  /**
   * Resumo da tentativa anterior, quando esta é uma retomada (spec § ContextPack). Ausente na
   * primeira tentativa — e ausente é diferente de vazio: vazio diria "houve tentativa e ela não
   * produziu nada".
   */
  readonly resumoAnterior?: string
  readonly orcamento: OrcamentoDaEtapa
  /** Presente **se e somente se** algum item tem origem `leitura-ampla` (critério 3). */
  readonly excecaoDeLeituraAmpla?: ExcecaoDeLeituraAmpla
  /** A rota por onde a chamada saiu — decisão cravada do Cowork na spec. */
  readonly rota: AiProvider
  /** O pack anterior, quando este é uma expansão dele. */
  readonly packAnterior?: string
  /**
   * O escopo de arquivos que o run pode alterar (SPEC-Entrega-03, critério 13).
   *
   * Ausente fora de pipeline: um pack montado para uma geração avulsa não tem run, e um valor
   * vazio afirmaria "nenhum arquivo é permitido" quando o certo é "a pergunta não se aplica".
   * Quem exige a presença é o preflight, não a montagem do pack.
   */
  readonly pathsPermitidos?: PathsPermitidos
  /** SHA-256 do manifesto canônico. Ver `hashDoPack` no main. */
  readonly hash: string
  readonly created_at: string
}

/**
 * Por que a montagem de um pack foi recusada. Enum fechado pela mesma razão de
 * `ProjectReason`: a UI decide o que mostrar a partir dele, e um motivo novo é mudança de
 * contrato — nunca uma string vazando de um `catch`.
 */
export const CONTEXT_PACK_REASONS = [
  'montado',
  /** Leitura ampla pedida sem exceção registrada (critério 3). */
  'leitura-ampla-sem-excecao',
  /** A exceção existe, mas o conteúdo pedido passa do teto que ela autorizou. */
  'teto-da-excecao-excedido',
  /** Algum item carrega segredo (critério 7). O pack **não** é montado. */
  'segredo-no-contexto',
  /** O contexto passa do teto de tokens da etapa e ninguém autorizou expandir (critério 6). */
  'teto-de-tokens-excedido',
  /** Projeto inexistente ou fora do escopo do usuário. */
  'projeto-desconhecido',
  /** Nenhum item selecionado — pack vazio não é contexto, é ausência dele. */
  'contexto-vazio'
] as const

export type ContextPackReason = (typeof CONTEXT_PACK_REASONS)[number]

/** O desfecho de montar um pack. Devolvido **sempre**, inclusive nas recusas. */
export interface ContextPackOutcome {
  readonly reason: ContextPackReason
  /** Presente só quando `reason` é `montado`. */
  readonly pack?: ContextPack
  readonly mensagem: string
  /**
   * Os caminhos em que o detector de segredo bateu, quando `reason` é `segredo-no-contexto`.
   * **Só os caminhos** — nunca o trecho casado, que é o segredo em si.
   */
  readonly caminhosComSegredo?: readonly string[]
}

/**
 * Uma falha já vista, com o fingerprint que a identifica (critério 4).
 *
 * O `fingerprint` é derivado do **conteúdo normalizado** da falha, não de um id gerado: dois
 * relatórios da mesma falha em execuções diferentes têm de colidir, senão a falha resolvida
 * volta como descoberta nova — que é exatamente o que o critério proíbe.
 */
export interface FalhaRegistrada {
  readonly fingerprint: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly resumo: string
  readonly ocorrencias: number
  /** `true` quando a falha foi resolvida — resolvida **não volta ao prompt** (spec § Seleção). */
  readonly resolvida: boolean
  readonly primeiraEm: string
  readonly ultimaEm: string
}

/**
 * Teto de tokens padrão de uma etapa de planejamento.
 *
 * Existe como constante e não como parâmetro da UI pelo mesmo motivo de `MAX_TOKENS_PADRAO`:
 * quem escolhe o teto escolhe o tamanho do contexto que sai da máquina, e essa não é decisão de
 * tela. Expandir exige motivo — e o motivo entra no manifesto (critério 6).
 */
export const TETO_DE_TOKENS_PADRAO = 32_000

/**
 * Aproximação de tokens a partir de bytes de texto.
 *
 * ~4 caracteres por token, a mesma razão que `estimarCustoUsd` usa. Uma segunda constante aqui
 * faria a estimativa do orçamento e a do contexto divergirem em silêncio — e as duas respondem
 * à mesma pergunta física.
 */
export const BYTES_POR_TOKEN = 4

/** Tokens aproximados de um conjunto de itens. Puro: é conta, e conta se testa sem Electron. */
export function tokensDosItens(itens: readonly ContextItem[]): number {
  return Math.ceil(itens.reduce((total, item) => total + item.bytes, 0) / BYTES_POR_TOKEN)
}

/** Bytes totais dos itens vindos de leitura ampla — o que a exceção do critério 3 limita. */
export function bytesDeLeituraAmpla(itens: readonly ContextItem[]): number {
  return itens
    .filter((item) => item.origem === 'leitura-ampla')
    .reduce((total, item) => total + item.bytes, 0)
}

/** `true` quando algum item entrou por leitura ampla — o gatilho do critério 3. */
export function exigeExcecao(itens: readonly ContextItem[]): boolean {
  return itens.some((item) => item.origem === 'leitura-ampla')
}

/**
 * As falhas que **devem** entrar no contexto: as abertas, nunca as resolvidas (critério 4).
 *
 * Função pura e nomeada em vez de um `filter` no call site porque é a regra inteira do critério
 * 4 num lugar só. Espalhada por chamadores, o dia em que um deles esquecer o filtro é o dia em
 * que a falha resolvida reaparece como descoberta nova.
 */
export function falhasParaOContexto(
  registradas: readonly FalhaRegistrada[]
): readonly FalhaNoContexto[] {
  return registradas
    .filter((falha) => !falha.resolvida)
    .map((falha) => ({
      fingerprint: falha.fingerprint,
      resumo: falha.resumo,
      ocorrencias: falha.ocorrencias
    }))
}

export function isOrigemDeContexto(value: unknown): value is OrigemDeContexto {
  return typeof value === 'string' && (ORIGENS_DE_CONTEXTO as readonly string[]).includes(value)
}
