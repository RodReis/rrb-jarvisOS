/**
 * A composição do roadmap e do `STATUS.md` (SPEC-Planejamento-06).
 *
 * A pergunta que este arquivo responde: **como as decisões do wizard e as jornadas dos
 * protótipos viram MVPs e fatias sem passar por um modelo?**
 *
 * Por composição, e a escolha é a mesma da M8-F04 (decisão do PI, 2026-08-30). Cada MVP e cada
 * fatia carrega `origem` obrigatória, e as origens são as duas de sempre: `decisao` e
 * `evidencia`. **Não existe origem "modelo"** — e é isso que impede o roadmap de propor um MVP
 * que ninguém decidiu.
 *
 * **A regra de composição é o escopo decidido.** A pergunta `escopo` do wizard tem duas opções
 * mutuamente exclusivas, e elas descrevem *estratégias de roadmap diferentes*:
 *
 *  - **`fatia-vertical`** — um MVP por jornada prototipada, cada um entregando aquela jornada de
 *    ponta a ponta. É o que "fatia vertical" significa: valor completo, escopo estreito.
 *  - **`fundacao-ampla`** — um MVP de fundação primeiro, e as jornadas depois, dependendo dele.
 *    O DAG reflete literalmente a escolha: tudo depende da fundação.
 *
 * Isso é o oposto de inventar: as duas formas **já estavam** na decisão, e o roadmap só as
 * escreve. Uma terceira estratégia exigiria uma terceira opção no wizard — não uma heurística
 * aqui.
 *
 * **O `STATUS.md` gerado espelha o formato deste repositório** (decisão cravada da spec), porque
 * é o formato que o MVP-009 lê. E é ele a **fonte única** do par Fatia ↔ SPEC (invariante 1): o
 * índice sai daqui, e nenhuma outra estrutura o duplica.
 *
 * **O que este arquivo não faz:** não escreve arquivo, não calcula hash de disco, não consulta
 * banco. Só monta texto e estrutura a partir do que recebe.
 */

import type { Decision, DecisoesPorPergunta, Pergunta } from './wizard'
import type { OrigemDaAfirmacao } from './pacote-estrutural'
import type { Mvp, Roadmap, Slice } from './roadmap'
import { ordemDeExecucao } from './roadmap'
import { textoDaDecisao } from './pacote-compositor'

/** Os arquivos que esta fatia escreve, na raiz de `docs/` do projeto gerado. */
export const ARQUIVO_DO_STATUS = 'docs/STATUS.md'
export const ARQUIVO_DO_ARQUIVO_HISTORICO = 'docs/STATUS-ARQUIVO.md'

/** Onde a SPEC da próxima fatia é escrita. Um diretório, como neste repositório. */
export const DIRETORIO_DAS_SPECS = 'docs/spec'

/** A origem de uma decisão, no formato que MVP e fatia carregam. */
function origemDaDecisao(decisao: Decision): OrigemDaAfirmacao {
  return { tipo: 'decisao', decisaoId: decisao.id, perguntaId: decisao.perguntaId }
}

/** Transforma texto em slug — o mesmo formato de `spec-<mvp>-<nn>-<slug>.md`. */
export function slugificar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Compõe o roadmap das decisões e das jornadas cobertas.
 *
 * **Sem decisão de escopo não há roadmap.** Devolve vazio em vez de assumir uma estratégia: a
 * escolha entre fatia vertical e fundação ampla é do PI, e escolher por ele seria o oposto do
 * que a M8-F03 construiu.
 *
 * **Sem jornada não há MVP.** Um roadmap de projeto cujos protótipos não mostram tela nenhuma
 * descreveria trabalho que ninguém desenhou — e o critério 4 da M8-F05 já recusou prometer
 * fluxo ausente dos protótipos. A mesma recusa vale aqui.
 */
export function comporRoadmap(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta,
  jornadas: readonly string[]
): Roadmap {
  const decisaoDeEscopo = decisoes.escopo
  if (decisaoDeEscopo === undefined || jornadas.length === 0) {
    return { mvps: [], slices: [] }
  }

  const origem = origemDaDecisao(decisaoDeEscopo)
  const perguntaDeEscopo = catalogo.find((p) => p.id === 'escopo')
  const escolha = decisaoDeEscopo.escolha

  const mvps: Mvp[] = []
  const slices: Slice[] = []

  // A estratégia "fundação ampla": um MVP de fundação, e as jornadas dependendo dele. O DAG
  // reflete a decisão literalmente.
  const comFundacao = escolha === 'fundacao-ampla'
  if (comFundacao) {
    mvps.push({
      id: 'mvp-fundacao',
      numero: 1,
      titulo: 'Fundação',
      tese:
        perguntaDeEscopo !== undefined
          ? `${perguntaDeEscopo.titulo}: ${textoDaDecisao(perguntaDeEscopo, decisaoDeEscopo)}`
          : 'Fundação ampla antes de qualquer fluxo completo.',
      estado: 'proposto',
      dependeDe: [],
      origem
    })

    slices.push({
      id: 'slice-fundacao-1',
      mvpId: 'mvp-fundacao',
      numero: 1,
      titulo: 'Estrutura, dados e fronteiras',
      specSlug: `${DIRETORIO_DAS_SPECS}/spec-fundacao-01-estrutura.md`,
      detalhada: false,
      origem
    })
  }

  const deslocamento = comFundacao ? 1 : 0

  for (const [i, jornada] of jornadas.entries()) {
    const numero = i + 1 + deslocamento
    const slug = slugificar(jornada)
    const mvpId = `mvp-${slug}`

    mvps.push({
      id: mvpId,
      numero,
      titulo: jornada,
      // A tese cita a jornada **e** a decisão que a enquadra: as duas metades vêm de fato
      // registrado, e nenhuma frase é inventada entre elas.
      tese: `Entregar a jornada "${jornada}" de ponta a ponta.`,
      estado: 'proposto',
      dependeDe: comFundacao ? ['mvp-fundacao'] : [],
      origem
    })

    // Uma fatia por MVP nesta composição. Fatiar mais fino exigiria saber o que a jornada tem
    // dentro — conhecimento que nenhuma decisão registrada contém, e inventá-lo seria conteúdo
    // sem origem.
    slices.push({
      id: `slice-${slug}-1`,
      mvpId,
      numero: 1,
      titulo: jornada,
      specSlug: `${DIRETORIO_DAS_SPECS}/spec-${slug}-01-${slug}.md`,
      detalhada: false,
      origem
    })
  }

  return { mvps, slices }
}

/**
 * Renderiza o `STATUS.md` do projeto gerado.
 *
 * O formato espelha o deste repositório (decisão cravada da spec) porque é o que o MVP-009 lê:
 * **Agora**, **MVPs** e **Índice Fatia ↔ SPEC**. O índice é a invariante 1 tomando forma de
 * arquivo — é *aqui* que o par Fatia ↔ SPEC vive, e em nenhum outro lugar.
 */
export function renderizarStatus(
  nomeDoProjeto: string,
  roadmap: Roadmap,
  proxima: Slice | undefined,
  geradoEm: string
): string {
  const linhas: string[] = [
    `# STATUS.md — ${nomeDoProjeto}`,
    '',
    `Gerado em: **${geradoEm}**. Fonte única do índice Fatia ↔ SPEC.`,
    '',
    '## Agora',
    ''
  ]

  if (proxima === undefined) {
    linhas.push('_Nenhuma fatia pendente de detalhamento._', '')
  } else {
    const mvp = roadmap.mvps.find((m) => m.id === proxima.mvpId)
    linhas.push(
      `| Coluna | Item |`,
      `|---|---|`,
      `| Próximo | ${mvp?.titulo ?? proxima.mvpId} · ${proxima.titulo} — \`${proxima.specSlug}\` |`,
      ''
    )
  }

  linhas.push('## MVPs', '', '| # | MVP | Estado | Depende de |', '|---|---|---|---|')
  for (const mvp of [...roadmap.mvps].sort((a, b) => a.numero - b.numero)) {
    const deps =
      mvp.dependeDe.length === 0
        ? '—'
        : mvp.dependeDe.map((d) => roadmap.mvps.find((m) => m.id === d)?.titulo ?? d).join(', ')
    linhas.push(`| ${mvp.numero} | ${mvp.titulo} | ${mvp.estado} | ${deps} |`)
  }

  linhas.push(
    '',
    '## Índice Fatia ↔ SPEC',
    '',
    // A frase não é decorativa: ela declara no próprio arquivo que ele é a fonte única, para
    // quem o lê depois não montar um segundo índice em outro lugar.
    'Fonte única do par (invariante 1). Nenhuma outra estrutura guarda esta relação.',
    '',
    '| Fatia | MVP | SPEC | Detalhada |',
    '|---|---|---|---|'
  )

  for (const slice of roadmap.slices) {
    const mvp = roadmap.mvps.find((m) => m.id === slice.mvpId)
    linhas.push(
      `| ${slice.titulo} | ${mvp?.titulo ?? slice.mvpId} | \`${slice.specSlug}\` | ${slice.detalhada ? 'sim' : 'não'} |`
    )
  }

  const ordem = ordemDeExecucao(roadmap.mvps)
  linhas.push('', '## Ordem de execução', '')
  linhas.push(
    ordem === undefined
      ? '_O DAG tem ciclo ou dependência ausente; não há ordem válida._'
      : ordem.map((id) => roadmap.mvps.find((m) => m.id === id)?.titulo ?? id).join(' → ')
  )
  linhas.push('')

  return linhas.join('\n')
}

/**
 * Renderiza o `STATUS-ARQUIVO.md` — o histórico longo (§ Saídas).
 *
 * Separado do `STATUS.md` porque os dois respondem perguntas diferentes: o STATUS responde
 * *"onde estamos?"* e precisa caber numa tela; o arquivo responde *"o que já aconteceu?"* e
 * cresce para sempre. Fundi-los faria o primeiro deixar de servir ao uso que o justifica.
 */
export function renderizarArquivoHistorico(
  nomeDoProjeto: string,
  entradas: readonly string[],
  geradoEm: string
): string {
  const linhas = [
    `# STATUS-ARQUIVO.md — ${nomeDoProjeto}`,
    '',
    `Histórico longo. O estado corrente vive em \`${ARQUIVO_DO_STATUS}\`.`,
    '',
    `Gerado em: **${geradoEm}**.`,
    ''
  ]

  if (entradas.length === 0) {
    linhas.push('_Nenhuma entrada ainda._', '')
  } else {
    for (const entrada of entradas) linhas.push(`- ${entrada}`)
    linhas.push('')
  }

  return linhas.join('\n')
}

/**
 * Renderiza a SPEC executável da próxima fatia (§ Saídas).
 *
 * O cabeçalho obrigatório é o que a `CONVENTION.md` § Specs exige: MVP pai, status e
 * dependências. Nasce como **`rascunho`**, e não `aprovada-pi`: a aprovação é o gate
 * `SLICE_ENTRY`, um ato do PI. Uma spec que nascesse aprovada faria a geração aprovar a si
 * mesma — o mesmo erro que o critério 3 impede no MVP.
 */
export function renderizarSpec(fatia: Slice, mvp: Mvp | undefined, geradoEm: string): string {
  return [
    `# SPEC — ${fatia.titulo}`,
    '',
    `- MVP: ${mvp?.titulo ?? fatia.mvpId}.`,
    `- Status: **rascunho** (${geradoEm}) — a aprovação é o gate \`SLICE_ENTRY\`, ato do PI.`,
    `- Depende de: ${(mvp?.dependeDe ?? []).length === 0 ? '—' : (mvp?.dependeDe ?? []).join(', ')}.`,
    '',
    '## Objetivo',
    '',
    mvp?.tese ?? fatia.titulo,
    '',
    '## Escopo',
    '',
    `Dentro: a jornada "${fatia.titulo}", como os protótipos anexados a mostram.`,
    '',
    'Fora: o que não aparece nos protótipos desta revisão.',
    '',
    '## Perguntas abertas ao PI',
    '',
    // A spec nasce com a pergunta em aberto de propósito: a `CONVENTION.md` exige que ela seja
    // resolvida antes de virar `aprovada-pi`, e nascer sem nenhuma sugeriria que não há nada a
    // decidir — que é exatamente o que a geração não sabe.
    '- O recorte desta fatia está correto, ou ela deve ser dividida?',
    ''
  ].join('\n')
}
