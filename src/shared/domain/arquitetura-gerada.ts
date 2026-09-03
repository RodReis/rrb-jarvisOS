/**
 * A arquitetura, as decisões, a estratégia de testes e a revisão geradas por IA
 * (SPEC-Jornada-04).
 *
 * A pergunta que este arquivo responde: **o que os quatro documentos podem afirmar sobre um
 * sistema que ainda não existe, e o que sustenta cada afirmação?**
 *
 * É a mesma inversão que a SPEC-Jornada-03 fez com o PRD, um degrau adiante. Na M8-F05 os quatro
 * documentos eram **compostos** das decisões do wizard e das jornadas que o protótipo mostrou —
 * a não-invenção era consequência da construção, e o preço era um `ARCHITECTURE.md` que
 * repetia o formulário. Aqui eles são **gerados por modelo**, e a garantia precisa ser
 * verificada sobre a saída antes de qualquer gravação.
 *
 * Quatro decisões governam o arquivo:
 *
 *  - **`prototipo` é origem de primeira classe, com o hash do anexo** (decisão cravada pelo
 *    Cowork). É o que torna *"a arquitetura não promete fluxo ausente dos protótipos"*
 *    verificável em texto gerado: a afirmação cita a jornada e o hash do arquivo em que ela
 *    aparece, e o validador confere os dois contra os anexos do gate. Sem o hash, a âncora
 *    apontaria para um caminho cujo conteúdo pode ter mudado depois.
 *  - **Fluxo sem âncora em protótipo reprova** (critério 2). É a regra mais dura do arquivo, e
 *    a única que recusa por **seção**: um módulo pode ser `proposto`, um fluxo não. Fluxo é
 *    promessa de comportamento, e prometer o que ninguém desenhou é exatamente o que a M8-F05
 *    fechou ao só compor a partir de `jornadasCobertas`.
 *  - **A análise de coerência nunca altera o anexo** (critério 4). Telas sem requisito e
 *    requisitos sem tela viram `AjusteProposto` — lista que o PI autoriza item a item. Nada
 *    aqui escreve em protótipo nem em PRD.
 *  - **O PRD é âncora por id de afirmação, como o brief era na F03.** `prd` referencia a
 *    afirmação da revisão aceita, e o validador confere que aquele id existe.
 *
 * Mora em `src/shared/domain` porque a tela mostra origem por afirmação, separa os `proposto` e
 * lista os ajustes — e a regra precisa ser verificável sem carregar o Electron, como em
 * `prd.ts` e `brief.ts`.
 */

import type { WorkspaceId } from './entities'
import type { Anexo } from './anexos-de-design'
import type { DocumentoDaArquitetura } from './arquitetura'
import type { AchadoDoPrototipo } from './validacao-de-prototipo'
import { DOCUMENTOS_DA_ARQUITETURA } from './arquitetura'
import { TERMOS_QUE_EXIGEM_ORIGEM_HUMANA, normalizar } from './brief'
import { TERMOS_DE_OUTRO_PROJETO } from './prd'

/**
 * De onde uma afirmação dos quatro documentos veio.
 *
 * **Quatro origens, e a assimetria entre elas é o contrato.** `prd` referencia o requisito
 * aceito; `prototipo` referencia a tela desenhada, com o hash do anexo; `decisao` referencia uma
 * escolha registrada no refinamento; `proposto` é a única que a IA cria sozinha — e é a única
 * que o gate lista separada, por documento, para o PI cortar antes de aceitar.
 *
 * Não existe origem "modelo" para conteúdo material. É a mesma ausência deliberada de `prd.ts`:
 * o que a IA infere se chama `proposto` e carrega essa marca até o aceite.
 */
export const ORIGENS_DA_ARQUITETURA = ['prd', 'prototipo', 'decisao', 'proposto'] as const

export type OrigemDaArquitetura = (typeof ORIGENS_DA_ARQUITETURA)[number]

export function isOrigemDaArquitetura(value: unknown): value is OrigemDaArquitetura {
  return typeof value === 'string' && (ORIGENS_DA_ARQUITETURA as readonly string[]).includes(value)
}

/**
 * A âncora de uma afirmação de origem `prototipo`.
 *
 * **Os três campos são o ponto.** `anexo` diz em qual arquivo; `hash` diz em qual *conteúdo*
 * daquele arquivo; `jornada` diz qual tela ou fluxo dentro dele. Guardar só o caminho faria a
 * âncora envelhecer em silêncio quando o PI reanexasse o protótipo — e o critério 2 existe
 * justamente para que "este fluxo foi desenhado" continue verdade depois do fato.
 */
export interface AncoraNoPrototipo {
  /** O caminho do anexo, relativo ao projeto — como o `Anexo` o registra. */
  readonly anexo: string
  /** O sha256 do anexo no instante em que a arquitetura saiu. */
  readonly hash: string
  /** A jornada/tela do protótipo que sustenta a afirmação. */
  readonly jornada: string
}

/**
 * Uma afirmação de um dos quatro documentos.
 *
 * `origem` não é opcional, e `referencia`/`ancora` são o que a torna verificável:
 *
 *  - `prd` ⇒ `referencia` é o **id da afirmação** do PRD aceito (âncora, não texto).
 *  - `prototipo` ⇒ `ancora` é o anexo, o hash e a jornada.
 *  - `decisao` ⇒ `referencia` é o id da decisão do refinamento.
 *  - `proposto` ⇒ nenhuma das duas; se houvesse, não seria inferência.
 */
export interface AfirmacaoDaArquitetura {
  readonly id: string
  readonly documento: DocumentoDaArquitetura
  readonly secao: string
  readonly texto: string
  readonly origem: OrigemDaArquitetura
  /** Id da afirmação do PRD (origem `prd`) ou da decisão (origem `decisao`). */
  readonly referencia?: string
  /** Onde a tela foi desenhada. Obrigatória na origem `prototipo`. */
  readonly ancora?: AncoraNoPrototipo
}

/**
 * Um ajuste que a IA propõe depois de ler os protótipos contra o PRD (critério 4).
 *
 * **Não é achado de validador, e a distinção é a fatia inteira.** A validação estrutural da
 * M8-F05 é determinística e roda antes — é o que o gate mede. Isto é leitura semântica: a IA viu
 * uma tela que nenhum requisito pede, ou um requisito que nenhuma tela atende. É `proposto` por
 * construção, e **nada aqui é aplicado ao anexo**: o PI autoriza item a item, e o histórico e a
 * autoria do protótipo permanecem intactos.
 */
export interface AjusteProposto {
  readonly id: string
  readonly tipo: TipoDeAjuste
  /** A tela do protótipo, quando o ajuste fala de uma. */
  readonly jornada?: string
  /** O id da afirmação do PRD, quando o ajuste fala de um requisito. */
  readonly requisito?: string
  readonly observacao: string
  readonly recomendacao: string
}

/**
 * O que a análise de coerência sabe apontar. Enum fechado: a tela agrupa por tipo, e um tipo
 * novo quebra a compilação em vez de cair num rótulo genérico.
 */
export const TIPOS_DE_AJUSTE = ['tela-sem-requisito', 'requisito-sem-tela', 'estado-ausente'] as const

export type TipoDeAjuste = (typeof TIPOS_DE_AJUSTE)[number]

export function isTipoDeAjuste(value: unknown): value is TipoDeAjuste {
  return typeof value === 'string' && (TIPOS_DE_AJUSTE as readonly string[]).includes(value)
}

/** O conteúdo dos quatro documentos, antes de virar prosa. A prosa é renderizada disto. */
export interface ConteudoDaArquitetura {
  readonly projectId: string
  readonly afirmacoes: readonly AfirmacaoDaArquitetura[]
  readonly ajustes: readonly AjusteProposto[]
}

/** A revisão gravada, com a procedência: qual PRD e quais anexos a originaram. */
export interface ArquiteturaRegistrada extends ConteudoDaArquitetura {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /** A revisão do PRD que esta arquitetura assume (critério 3). */
  readonly pacoteEstruturalId: string
  /** Os anexos como estavam quando a arquitetura saiu — com hash (critério 5). */
  readonly anexos: readonly Anexo[]
  readonly hash: string
  readonly commitHash: string | null
  readonly contextPackId: string | null
  readonly created_at: string
}

/**
 * As seções em que **fluxo** é prometido, e que por isso exigem âncora em protótipo (critério 2).
 *
 * Só estas duas, e a lista curta é deliberada: "Módulos e fronteiras", "Dados" e "Resiliência"
 * descrevem como o sistema se organiza, não o que o usuário vê — exigir protótipo delas obrigaria
 * o PI a desenhar tela para um índice de banco. O que o critério protege é a **promessa de
 * comportamento**, e ela mora onde o documento fala de fluxo.
 */
export const SECOES_DE_FLUXO: Readonly<Partial<Record<DocumentoDaArquitetura, readonly string[]>>> =
  {
    ARCHITECTURE: ['Fluxos cobertos'],
    TESTING: ['Estratégia']
  }

/**
 * As origens que cada documento admite.
 *
 * **`DECISIONS` não admite `prototipo`**: um ADR registra uma escolha estrutural, e um desenho
 * de tela não é escolha estrutural — ele é a consequência de uma. As decisões vêm do refinamento
 * (`decisao`), do PRD (`prd`) ou são propostas pela IA (`proposto`), que é exatamente o que o PI
 * decidiu em 2026-09-03 na pergunta 1 da SPEC.
 */
export const ORIGENS_POR_DOCUMENTO_DA_ARQUITETURA: Readonly<
  Record<DocumentoDaArquitetura, readonly OrigemDaArquitetura[]>
> = {
  ARCHITECTURE: ['prd', 'prototipo', 'decisao', 'proposto'],
  DECISIONS: ['prd', 'decisao', 'proposto'],
  TESTING: ['prd', 'prototipo', 'decisao', 'proposto'],
  REVIEW: ['prd', 'prototipo', 'decisao', 'proposto']
}

/**
 * Por que o validador recusou. Enum fechado: a tela decide o que mostrar a partir dele, e um
 * motivo novo quebra a compilação em vez de cair num default silencioso.
 */
export const RECUSAS_DA_ARQUITETURA = [
  'origem-ausente',
  'origem-desconhecida',
  'documento-desconhecido',
  'secao-desconhecida',
  'texto-vazio',
  'referencia-ausente',
  /** Origem `prd` citando um id que não existe na revisão aceita (critério 3). */
  'ancora-inexistente',
  /** Fluxo prometido sem âncora em protótipo — a recusa do critério 2. */
  'fluxo-sem-prototipo',
  /** Âncora citando anexo que não está no gate, ou hash que não bate com o do anexo. */
  'prototipo-inexistente',
  /** Âncora citando jornada que o protótipo validado não mostrou. */
  'jornada-inexistente',
  /** Requisito legal/regulatório inferido pelo modelo (invariante 9). */
  'requisito-sem-origem-humana',
  /** Processo de outro projeto — inclusive as labels `proplan:*` deste repositório. */
  'regra-de-outro-projeto'
] as const

export type RecusaDaArquitetura = (typeof RECUSAS_DA_ARQUITETURA)[number]

export interface ProblemaNaArquitetura {
  readonly recusa: RecusaDaArquitetura
  /** Qual afirmação causou. Vazio quando o problema é do documento, não de uma linha. */
  readonly afirmacaoId?: string
  readonly mensagem: string
}

export interface ValidacaoDaArquitetura {
  readonly valido: boolean
  readonly problemas: readonly ProblemaNaArquitetura[]
}

/** O que o validador precisa saber sobre o mundo, para conferir as âncoras. */
export interface ContextoDaValidacaoDaArquitetura {
  /** Os ids das afirmações do PRD aceito — as âncoras válidas da origem `prd`. */
  readonly afirmacoesDoPrd: readonly string[]
  /** Os anexos do gate, com hash — as âncoras válidas da origem `prototipo`. */
  readonly anexos: readonly { readonly caminho: string; readonly hash: string }[]
  /** As jornadas que os protótipos validados mostraram (`jornadasCobertas`). */
  readonly jornadas: readonly string[]
  /** As seções válidas de cada documento. */
  readonly secoes: Readonly<Record<DocumentoDaArquitetura, readonly string[]>>
}

export function isDocumentoDaArquitetura(valor: unknown): valor is DocumentoDaArquitetura {
  return typeof valor === 'string' && (DOCUMENTOS_DA_ARQUITETURA as readonly string[]).includes(valor)
}

/** A seção promete fluxo, e por isso exige âncora em protótipo? */
export function exigeAncoraEmPrototipo(
  documento: DocumentoDaArquitetura,
  secao: string
): boolean {
  return (SECOES_DE_FLUXO[documento] ?? []).includes(secao)
}

/**
 * Valida a saída do modelo **antes de gravar** (critérios 2 e 3).
 *
 * Devolve todos os problemas, não o primeiro, pela mesma razão de `validarPrd`: quem gerou
 * corrige a saída inteira, e parar no primeiro faria o conserto virar uma rodada de modelo por
 * problema.
 *
 * **Fail closed em toda decisão.** Origem desconhecida é recusa, não default para `proposto`;
 * seção desconhecida é recusa, não seção extra; hash que não bate é recusa, não aviso. Cada um
 * desses lados permissivos seria exatamente a porta que os critérios existem para fechar.
 */
export function validarArquitetura(
  conteudo: ConteudoDaArquitetura,
  contexto: ContextoDaValidacaoDaArquitetura
): ValidacaoDaArquitetura {
  const problemas: ProblemaNaArquitetura[] = []
  const ancoras = new Set(contexto.afirmacoesDoPrd)
  const jornadas = new Set(contexto.jornadas)
  const hashPorAnexo = new Map(contexto.anexos.map((a) => [a.caminho, a.hash]))

  for (const a of conteudo.afirmacoes) {
    if (!isDocumentoDaArquitetura(a.documento)) {
      problemas.push({
        recusa: 'documento-desconhecido',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" declara o documento "${a.documento}", que não existe no pacote de arquitetura.`
      })
      continue
    }

    if (a.texto.trim().length === 0) {
      problemas.push({
        recusa: 'texto-vazio',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" está vazia.`
      })
    }

    // Seção fora do contrato é recusa, e não uma seção nova no arquivo: o documento gerado é
    // lido pelo MVP-009, que espera estas seções — inventar uma quebraria quem consome.
    if (!contexto.secoes[a.documento].includes(a.secao)) {
      problemas.push({
        recusa: 'secao-desconhecida',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" usa a seção "${a.secao}", que não existe em ${a.documento}.`
      })
      continue
    }

    // A ausência é checada antes do valor, mesma ordem de `validarPrd`: origem ausente e origem
    // inválida são problemas diferentes, e fundi-los esconderia qual dos dois ocorreu.
    if (a.origem === undefined || a.origem === null) {
      problemas.push({
        recusa: 'origem-ausente',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" não declara origem. Toda afirmação carrega origem (critério 2).`
      })
      continue
    }

    if (!isOrigemDaArquitetura(a.origem)) {
      problemas.push({
        recusa: 'origem-desconhecida',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" declara a origem "${a.origem}", que não existe.`
      })
      continue
    }

    if (!ORIGENS_POR_DOCUMENTO_DA_ARQUITETURA[a.documento].includes(a.origem)) {
      problemas.push({
        recusa: 'origem-desconhecida',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" usa a origem "${a.origem}" no documento ${a.documento}, que não a admite.`
      })
      continue
    }

    // **O critério 2 em uma linha.** Seção que promete fluxo exige âncora em protótipo — e não
    // basta a origem estar declarada: `problemasDaOrigem` confere o anexo, o hash e a jornada
    // logo abaixo. Sem esta guarda, um fluxo `proposto` passaria por ser uma origem válida do
    // documento, que é exatamente a promessa sem desenho que a SPEC recusa.
    if (exigeAncoraEmPrototipo(a.documento, a.secao) && a.origem !== 'prototipo') {
      problemas.push({
        recusa: 'fluxo-sem-prototipo',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" descreve um fluxo em "${a.secao}" com origem "${a.origem}". Fluxo só é prometido com âncora no protótipo que o desenhou (critério 2).`
      })
      continue
    }

    problemas.push(...problemasDaOrigem(a, ancoras, hashPorAnexo, jornadas))

    // A invariante 9, em runtime — a mesma de `validarPrd`, sobre outro texto: requisito legal,
    // regulatório ou de consentimento só existe se o PI o disse ou o escolheu.
    if (a.origem === 'proposto') {
      const texto = normalizar(a.texto)
      const termo = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.find((t) => texto.includes(t))

      if (termo !== undefined) {
        problemas.push({
          recusa: 'requisito-sem-origem-humana',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" trata de "${termo}" com origem "proposto". Requisito legal, regulatório, de consentimento ou de classificação de domínio só entra vindo do PRD ou de uma decisão do PI (invariante 9).`
        })
      }
    }

    // O `REVIEW.md` gerado descreve como revisar **este** projeto. As labels `proplan:*`, os
    // papéis do trio e o ciclo de vida das issues são política do rrb-jarvisOS — e é justo num
    // documento de revisão que um modelo tende a copiá-los, porque foi onde ele os leu.
    const texto = normalizar(a.texto)
    const deOutro = TERMOS_DE_OUTRO_PROJETO.find((t) => texto.includes(t))

    if (deOutro !== undefined) {
      problemas.push({
        recusa: 'regra-de-outro-projeto',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" traz "${deOutro}", que é vocabulário de outro projeto. Estes documentos descrevem o processo deste projeto.`
      })
    }
  }

  return { valido: problemas.length === 0, problemas }
}

/**
 * O que cada origem exige, além de existir.
 *
 * Separado do laço principal pela mesma razão de `problemasDaOrigem` em `prd.ts`: são quatro
 * regras distintas sobre o mesmo campo, e mantê-las juntas empilharia condicionais sobre um
 * `switch` que aqui cabe em uma leitura.
 */
function problemasDaOrigem(
  a: AfirmacaoDaArquitetura,
  ancoras: ReadonlySet<string>,
  hashPorAnexo: ReadonlyMap<string, string>,
  jornadas: ReadonlySet<string>
): readonly ProblemaNaArquitetura[] {
  switch (a.origem) {
    // Âncora, não texto: o id tem de existir na revisão aceita do PRD. Sem a conferência,
    // "origem prd" seria uma etiqueta que o modelo cola em qualquer frase (critério 3).
    case 'prd': {
      if (a.referencia === undefined || a.referencia.trim() === '') {
        return [
          {
            recusa: 'referencia-ausente',
            afirmacaoId: a.id,
            mensagem: `A afirmação "${a.id}" diz vir do PRD, mas não referencia qual requisito.`
          }
        ]
      }

      return ancoras.has(a.referencia)
        ? []
        : [
            {
              recusa: 'ancora-inexistente',
              afirmacaoId: a.id,
              mensagem: `A afirmação "${a.id}" ancora em "${a.referencia}", que não existe na revisão aceita do PRD.`
            }
          ]
    }

    // O coração do critério 2: o anexo tem de estar no gate, o hash tem de bater com o dele, e a
    // jornada tem de ser uma das que o protótipo validado mostrou. Os três, e não um: o caminho
    // sozinho envelhece, o hash sozinho não diz qual tela, e a jornada sozinha não prova arquivo.
    case 'prototipo': {
      const ancora = a.ancora

      if (ancora === undefined) {
        return [
          {
            recusa: 'referencia-ausente',
            afirmacaoId: a.id,
            mensagem: `A afirmação "${a.id}" diz vir de um protótipo, mas não diz de qual tela nem de qual anexo.`
          }
        ]
      }

      const problemas: ProblemaNaArquitetura[] = []
      const hash = hashPorAnexo.get(ancora.anexo)

      if (hash === undefined) {
        problemas.push({
          recusa: 'prototipo-inexistente',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" ancora no anexo "${ancora.anexo}", que não está entre os anexos do gate.`
        })
      } else if (hash !== ancora.hash) {
        // Hash que não bate é anexo trocado depois: a tela citada pode não existir mais no
        // arquivo. Aceitar seria manter uma âncora que aponta para conteúdo que ninguém leu.
        problemas.push({
          recusa: 'prototipo-inexistente',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" cita o hash "${ancora.hash.slice(0, 16)}" para "${ancora.anexo}", que hoje tem outro conteúdo.`
        })
      }

      if (!jornadas.has(ancora.jornada)) {
        problemas.push({
          recusa: 'jornada-inexistente',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" ancora na jornada "${ancora.jornada}", que nenhum protótipo validado mostrou.`
        })
      }

      return problemas
    }

    case 'decisao':
      return a.referencia === undefined || a.referencia.trim() === ''
        ? [
            {
              recusa: 'referencia-ausente',
              afirmacaoId: a.id,
              mensagem: `A afirmação "${a.id}" diz vir de uma decisão, mas não referencia qual.`
            }
          ]
        : []

    // `proposto` não exige nada — é inferência, e exigir referência dela seria pedir que a IA
    // atribuísse a outro o que ela mesma inventou.
    default:
      return []
  }
}

/**
 * Os `proposto` de um documento — o que o PI corta item a item no gate.
 *
 * **Por documento**, e não numa lista só, pela mesma razão de `propostosDoDocumento` em `prd.ts`:
 * uma inferência sobre a estratégia de teste se julga com outra cabeça que uma sobre os módulos.
 */
export function propostosDoDocumentoDaArquitetura(
  conteudo: ConteudoDaArquitetura,
  documento: DocumentoDaArquitetura
): readonly AfirmacaoDaArquitetura[] {
  return conteudo.afirmacoes.filter((a) => a.documento === documento && a.origem === 'proposto')
}

/** As afirmações de um documento, na ordem em que o modelo as produziu. */
export function afirmacoesDoDocumentoDaArquitetura(
  conteudo: ConteudoDaArquitetura,
  documento: DocumentoDaArquitetura
): readonly AfirmacaoDaArquitetura[] {
  return conteudo.afirmacoes.filter((a) => a.documento === documento)
}

/**
 * Remove um `proposto`, preservando tudo o mais.
 *
 * Só corta o que é `proposto`, mesma guarda de `cortarPropostoDoPrd`: um id de outra origem passa
 * e o conteúdo volta igual. Sem ela, um id errado apagaria em silêncio uma afirmação ancorada no
 * protótipo — e o documento perderia justo a linha que o critério 2 protege.
 */
export function cortarPropostoDaArquitetura(
  conteudo: ConteudoDaArquitetura,
  afirmacaoId: string
): ConteudoDaArquitetura {
  return {
    ...conteudo,
    afirmacoes: conteudo.afirmacoes.filter(
      (a) => !(a.id === afirmacaoId && a.origem === 'proposto')
    )
  }
}

/**
 * Descarta um ajuste proposto pela análise de coerência (critério 4).
 *
 * **Descartar é a única operação que o app faz com um ajuste.** Autorizar um deles é um ato do
 * PI sobre o *anexo* — reabrir o protótipo, redesenhar a tela, reanexar —, e nada aqui toca o
 * arquivo. Um "aplicar" nesta camada reescreveria o desenho do PI a partir de uma inferência,
 * que é exatamente o que o critério 4 proíbe.
 */
export function descartarAjuste(
  conteudo: ConteudoDaArquitetura,
  ajusteId: string
): ConteudoDaArquitetura {
  return { ...conteudo, ajustes: conteudo.ajustes.filter((a) => a.id !== ajusteId) }
}

/** Os ajustes de um tipo — a tela agrupa por tipo, porque cada um se responde diferente. */
export function ajustesDoTipo(
  conteudo: ConteudoDaArquitetura,
  tipo: TipoDeAjuste
): readonly AjusteProposto[] {
  return conteudo.ajustes.filter((a) => a.tipo === tipo)
}

/**
 * Por que a geração não produziu revisão. Fechado: a tela decide o que mostrar a partir dele.
 *
 * Mora no domínio, e não no serviço, porque atravessa a ponte IPC — mesma razão de
 * `ResultadoDoPrd`: o contrato precisa do tipo e não pode importar do main.
 *
 * **`anexos-pendentes`, `prd-ausente` e `prototipos-invalidos` são os três desfechos herdados da
 * M8-F05**, e continuam com o mesmo nome de propósito: o gate de anexos não muda nesta fatia, e
 * renomeá-los faria parecer que mudou.
 */
export const RESULTADOS_DA_ARQUITETURA = [
  'gerada',
  'projeto-inexistente',
  /** O gate de anexos não abriu: falta `DESIGN-SYSTEM.md` ou protótipo (critério 1). */
  'anexos-pendentes',
  /** Não há PRD a que se referir — a arquitetura não tem revisão para assumir (critério 3). */
  'prd-ausente',
  /** Os protótipos têm problema que impede prometer o fluxo. */
  'prototipos-invalidos',
  'bloqueado-sem-rota',
  'saida-invalida',
  'sem-contexto',
  'falha-de-escrita'
] as const

export type ResultadoDaArquitetura = (typeof RESULTADOS_DA_ARQUITETURA)[number]

/**
 * O desfecho da geração. Recusa volta como *outcome*, nunca como promise rejeitada.
 *
 * Mora no domínio, e não no serviço, porque atravessa a ponte IPC — mesma razão de `PrdOutcome`:
 * o contrato precisa do tipo e o renderer não pode importar do main.
 */
export interface ArquiteturaGeradaOutcome {
  readonly resultado: ResultadoDaArquitetura
  readonly arquitetura?: ArquiteturaRegistrada
  readonly mensagem: string
  /** Em `anexos-pendentes`: o que falta anexar. */
  readonly pendencias?: readonly string[]
  /** Em `prototipos-invalidos`: os achados que impedem, com pergunta e recomendação. */
  readonly achados?: readonly AchadoDoPrototipo[]
  /** O que o PI faz para destravar, quando a rota bloqueou. */
  readonly acao?: string
  /** Os problemas do validador, quando a saída foi recusada. */
  readonly problemas?: readonly string[]
}

/**
 * A marca de origem que acompanha cada afirmação no arquivo gerado.
 *
 * Comentário HTML, mesma escolha de `marcaDeOrigemDoPrd` e pelo mesmo motivo: some na leitura
 * renderizada e permanece no arquivo versionado — o revisor lê o documento, e quem audita lê o
 * rastro.
 *
 * **A marca do protótipo leva o hash abreviado**, e não só o caminho: é o que permite a quem lê o
 * `ARCHITECTURE.md` meses depois conferir se o fluxo descrito ainda corresponde ao protótipo que
 * está no repositório. Um caminho sozinho envelhece sem avisar.
 */
export function marcaDeOrigemDaArquitetura(afirmacao: AfirmacaoDaArquitetura): string {
  switch (afirmacao.origem) {
    case 'prd':
      return `<!-- origem: prd · ${afirmacao.referencia ?? ''} -->`
    case 'prototipo': {
      const a = afirmacao.ancora
      return a === undefined
        ? '<!-- origem: prototipo -->'
        : `<!-- origem: prototipo · ${a.anexo} · "${a.jornada}" · sha256:${a.hash.slice(0, 16)} -->`
    }
    case 'decisao':
      return `<!-- origem: decisao · ${afirmacao.referencia ?? ''} -->`
    default:
      return '<!-- origem: proposto · inferência da IA, revisada pelo dono do projeto -->'
  }
}

/**
 * O preâmbulo de cada documento. Diz **como o arquivo foi produzido** — sem isso, um leitor
 * futuro não sabe se pode editá-lo à mão nem de onde vieram as marcas de origem.
 *
 * Diferente do preâmbulo da M8-F05 porque o modo de produção mudou: lá era composição a partir
 * das decisões do wizard, aqui é geração verificada. Dizer "derivado do escopo decidido" num
 * arquivo gerado descreveria errado o que ele é.
 */
export const PREAMBULO_DA_ARQUITETURA_GERADA: Readonly<Record<DocumentoDaArquitetura, string>> = {
  ARCHITECTURE:
    '> Gerado a partir do PRD aceito e dos protótipos anexados. Os fluxos citam a tela que os desenhou; fluxo sem protótipo não é prometido.',
  DECISIONS:
    '> Cada decisão cita o requisito ou a escolha que a originou. As propostas pela IA estão marcadas como proposta, não como decisão tomada.',
  TESTING:
    '> Estratégia de evidência deste projeto, derivada dos requisitos aceitos e das jornadas efetivamente prototipadas.',
  REVIEW:
    '> Instruções de revisão deste projeto, a partir do que o PRD pediu e do que os protótipos mostraram.'
}

/**
 * Renderiza um documento a partir das afirmações.
 *
 * O `conteudo` do arquivo é **derivado** das afirmações, nunca digitado em paralelo: é o que
 * permite hashear exatamente o que foi escrito no disco e o que garante que a marca de origem de
 * cada linha corresponde à afirmação que ela acompanha.
 *
 * **Não reusa `renderizarDocumento` da M8-F04** porque a forma da origem é outra: lá são duas
 * variantes de união, aqui são quatro origens com referência ou âncora. Adaptar a função antiga
 * exigiria converter as afirmações para um tipo que perde a âncora — e o critério 2 existe para
 * carregá-la.
 */
export function renderizarDocumentoDaArquitetura(
  documento: DocumentoDaArquitetura,
  nomeDoProjeto: string,
  afirmacoes: readonly AfirmacaoDaArquitetura[],
  secoes: readonly string[]
): string {
  const linhas: string[] = [
    `# ${documento} — ${nomeDoProjeto}`,
    '',
    PREAMBULO_DA_ARQUITETURA_GERADA[documento],
    ''
  ]

  for (const secao of secoes) {
    linhas.push(`## ${secao}`, '')
    const daSecao = afirmacoes.filter((a) => a.secao === secao)

    if (daSecao.length === 0) {
      linhas.push('_Sem conteúdo registrado nesta revisão._', '')
      continue
    }

    for (const a of daSecao) {
      linhas.push(`- ${a.texto}`, `  ${marcaDeOrigemDaArquitetura(a)}`)
    }
    linhas.push('')
  }

  return linhas.join('\n')
}
