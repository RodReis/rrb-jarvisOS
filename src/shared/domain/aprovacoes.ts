/**
 * Gates e aprovações por revisão (SPEC-Planejamento-06).
 *
 * A pergunta que este arquivo responde: **o que exatamente o PI aprovou, e o que ainda vale?**
 *
 * A resposta é um **conjunto de hashes**, não uma data nem um booleano. `Approval` guarda as
 * revisões exatas que foram aprovadas (critério 4), e é por elas que se decide se algo mudou —
 * comparar timestamps diria "algo aconteceu depois", que não é a mesma pergunta.
 *
 * Três critérios tomam forma aqui, e cada um é uma decisão sobre o que **não** fazer:
 *
 *  - **Critério 5 — mesma revisão não pede novo aceite.** `aprovacaoVigente` compara o conjunto
 *    de hashes, e não o instante: regerar um pacote que produz exatamente o mesmo conteúdo é a
 *    mesma revisão, e pedir aceite de novo ensinaria o PI a clicar sem ler.
 *  - **Critério 4/invariante 4 — mudança semântica invalida só os dependentes.** Correção
 *    textual, STATUS, evidência e ADR de decisão já tomada **não** invalidam. Sem essa
 *    distinção, corrigir uma vírgula derrubaria todos os gates do projeto, e o PI passaria a
 *    reaprovar por ruído — até parar de ler.
 *  - **Critério 7/invariante 3 — "Decide por mim" não aprova gate.** `Approval` exige
 *    `autor: 'pi'`, e a função que constrói recusa qualquer outro. Delegação **escolhe**; o PI
 *    **aceita**. São atos distintos, e o tipo os mantém distintos.
 *
 * **O que este arquivo não faz:** não lê arquivo, não calcula hash de disco, não consulta
 * sessão. Recebe hashes e decide o que eles significam.
 */

import type { WorkspaceId } from './entities'

/**
 * Os três gates da spec. Enum fechado: cada um tem objeto próprio e momento próprio, e um
 * quarto gate é mudança de contrato — nunca um valor que aparece porque alguém passou outro nome.
 */
export const GATES = ['PROJECT_PACKAGE', 'MVP_ENTRY', 'SLICE_ENTRY'] as const

export type Gate = (typeof GATES)[number]

/**
 * O que cada gate aprova. **Dado, não lógica** — mesma postura do `MENSAGEM_DO_MARCO`.
 */
export const DESCRICAO_DO_GATE: Readonly<Record<Gate, string>> = {
  PROJECT_PACKAGE:
    'PRD, Landscape, Convention, Design System, protótipos, arquitetura, Testing e Review',
  MVP_ENTRY: 'a revisão do MVP que entra na fila',
  SLICE_ENTRY: 'a revisão da SPEC a executar'
}

/**
 * Uma revisão aprovada: o artefato e o hash exato do conteúdo dele.
 *
 * `hash` e não `versao`: um número de versão depende de alguém incrementá-lo, e o critério 4
 * pede o conteúdo *exato*. O hash é a única forma de "exato" que não depende de disciplina.
 */
export interface RevisaoAprovada {
  /** O que foi aprovado — `docs/PRD.md`, o id do MVP, o slug da SPEC. */
  readonly artefato: string
  readonly hash: string
}

/**
 * Uma aprovação registrada.
 *
 * `autor` é sempre `'pi'` por construção — não há variante `'agente'`, e a ausência é o
 * critério 7. Um campo que aceitasse os dois exigiria que todo call site lembrasse de checar;
 * o tipo que só admite um não tem como esquecer.
 *
 * `identidade` guarda **quem** aprovou (o id da sessão autenticada, decisão cravada da spec).
 * Sem sessão válida não há aprovação: o gate falha fechado, nunca "aprova como anônimo".
 */
export interface Approval {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly gate: Gate
  /** O conjunto exato de revisões aprovadas (critério 4). */
  readonly revisoes: readonly RevisaoAprovada[]
  /** O id do usuário autenticado que aprovou. Nunca vazio. */
  readonly identidade: string
  /** Sempre `'pi'`. A delegação não chega aqui (critério 7). */
  readonly autor: 'pi'
  readonly created_at: string
}

/**
 * A natureza de uma mudança — o que decide se ela invalida (invariante 4).
 *
 * `cosmetica` cobre o que a spec lista explicitamente: *"correção textual, STATUS, evidência e
 * ADR registrando decisão já tomada"*. `semantica` é o resto.
 *
 * **O default é `semantica`**, e isso importa: uma mudança que o classificador não reconhece
 * tem de invalidar, não passar. Fechar para o lado seguro é a mesma postura do `autor`
 * desconhecido virando `agente` na M8-F03 — o default nunca é o que autoriza.
 */
export const NATUREZAS = ['cosmetica', 'semantica'] as const

export type NaturezaDaMudanca = (typeof NATUREZAS)[number]

/** Um artefato que mudou, com o hash novo e a natureza da mudança. */
export interface MudancaDeArtefato {
  readonly artefato: string
  readonly hashNovo: string
  readonly natureza: NaturezaDaMudanca
}

/**
 * A aprovação vigente do gate, se houver — **e só se as revisões ainda baterem**.
 *
 * É o critério 5 na forma de função: mesma revisão não pede novo aceite. A comparação é do
 * **conjunto** (artefato → hash), não da lista ordenada: a ordem em que os artefatos foram
 * registrados não é fato sobre a revisão, e ordená-la faria um pacote idêntico parecer novo.
 *
 * Uma revisão a mais **invalida**: aprovar quatro documentos não aprova o quinto que apareceu
 * depois. Uma a menos também: o pacote deixou de conter o que o PI leu.
 */
export function aprovacaoVigente(
  aprovacoes: readonly Approval[],
  gate: Gate,
  revisoesAtuais: readonly RevisaoAprovada[]
): Approval | undefined {
  const atual = new Map(revisoesAtuais.map((r) => [r.artefato, r.hash]))

  // Da mais recente para a mais antiga: se o PI aprovou o mesmo conteúdo duas vezes, a última é
  // a que responde "quando foi aceito".
  const doGate = [...aprovacoes]
    .filter((a) => a.gate === gate)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return doGate.find((aprovacao) => {
    if (aprovacao.revisoes.length !== atual.size) return false
    return aprovacao.revisoes.every((r) => atual.get(r.artefato) === r.hash)
  })
}

/**
 * Quais gates uma mudança invalida (critério 6 e invariante 4).
 *
 * Devolve os gates **antes** de a mudança ser aplicada, que é o que o critério 6 pede:
 * *"mudança estrutural exibe previamente gates invalidados"*. Mostrar depois seria informar o
 * PI de um estrago já feito.
 *
 * **Mudança cosmética não invalida nada** — nem o gate do próprio artefato. É a invariante 4
 * literal, e a razão é prática: se corrigir um typo derrubasse o gate, o PI reaprovaria por
 * ruído até parar de ler o que aprova.
 */
export function gatesInvalidados(
  aprovacoes: readonly Approval[],
  mudancas: readonly MudancaDeArtefato[]
): readonly Gate[] {
  const semanticas = mudancas.filter((m) => m.natureza === 'semantica')
  if (semanticas.length === 0) return []

  const afetados = new Set(semanticas.map((m) => m.artefato))
  const invalidados = new Set<Gate>()

  for (const aprovacao of aprovacoes) {
    for (const revisao of aprovacao.revisoes) {
      // Só invalida se o hash **mudou de verdade**: reescrever um arquivo com o mesmo conteúdo
      // não é mudança, e o critério 5 vale igual aqui.
      const mudanca = semanticas.find((m) => m.artefato === revisao.artefato)
      if (afetados.has(revisao.artefato) && mudanca?.hashNovo !== revisao.hash) {
        invalidados.add(aprovacao.gate)
        break
      }
    }
  }

  return GATES.filter((g) => invalidados.has(g))
}

/**
 * Por que a aprovação não pôde ser registrada. Enum fechado: a tela decide o que mostrar.
 */
export const APROVACAO_REASONS = [
  'aprovado',
  'projeto-inexistente',
  /** Já existe aprovação vigente para estas mesmas revisões (critério 5). */
  'ja-aprovado',
  /** Sem sessão autenticada não há identidade — o gate falha fechado (decisão cravada). */
  'sem-identidade',
  /** O gate não tem o que aprovar: o pacote/MVP/fatia ainda não existe. */
  'sem-revisoes',
  /** O DAG tem ciclo ou dependência ausente — não há roadmap válido a aprovar (critério 1). */
  'dag-invalido'
] as const

export type AprovacaoReason = (typeof APROVACAO_REASONS)[number]

export interface AprovacaoOutcome {
  readonly reason: AprovacaoReason
  readonly approval?: Approval
  /** Em `ja-aprovado`: a aprovação que já cobre estas revisões. */
  readonly vigente?: Approval
  /** Em `dag-invalido`: os problemas encontrados, com os ids envolvidos. */
  readonly problemas?: readonly { readonly mensagem: string }[]
  readonly mensagem: string
}

/** Type guard de fronteira: o IPC recebe `unknown` e não confia no renderer. */
export function isGate(valor: unknown): valor is Gate {
  return typeof valor === 'string' && (GATES as readonly string[]).includes(valor)
}
