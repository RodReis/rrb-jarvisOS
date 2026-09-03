/**
 * Os arquivos que o roadmap gerado escreve: `STATUS.md`, o histórico, o documento do MVP e a
 * SPEC da primeira fatia (SPEC-Jornada-05).
 *
 * A pergunta que este arquivo responde: **como o roadmap gerado vira os arquivos que o MVP-009
 * lê?**
 *
 * **A composição saiu daqui** (decisão do PI de 2026-09-03, mesma da F04 com a arquitetura). Até
 * a M8-F06 este arquivo *montava* os MVPs a partir da decisão de escopo e das jornadas
 * prototipadas; agora quem os propõe é o modelo, verificado por `roadmap-gerado.ts`. Dois
 * caminhos para o mesmo `STATUS.md` produziriam dois roadmaps com garantias diferentes, e só um
 * deles passa pelo validador de origem — então sobrou um.
 *
 * O que permanece, e é o que o MVP-009 consome:
 *
 *  - **O `STATUS.md` é a fonte única do par Fatia ↔ SPEC** (invariante 1, mantida da M8-F06). O
 *    índice sai daqui, e nenhuma outra estrutura o duplica.
 *  - **O formato espelha o deste repositório**, porque é o formato que o MVP-009 lê.
 *  - **A SPEC nasce `rascunho` com as perguntas abertas visíveis.** A aprovação é o gate
 *    `SLICE_ENTRY`, ato do PI; uma spec que nascesse aprovada faria a geração aprovar a si mesma.
 *
 * **O que este arquivo não faz:** não escreve arquivo, não calcula hash de disco, não consulta
 * banco, não chama modelo. Só monta texto a partir do que recebe.
 */

import type { Mvp, Roadmap, Slice } from './roadmap'
import { ordemDeExecucao } from './roadmap'
import type { MvpGerado, OrigemDoRoadmap, SpecGerada } from './roadmap-gerado'

/** Os arquivos que esta fatia escreve, na raiz de `docs/` do projeto gerado. */
export const ARQUIVO_DO_STATUS = 'docs/STATUS.md'
export const ARQUIVO_DO_ARQUIVO_HISTORICO = 'docs/STATUS-ARQUIVO.md'

/** Onde a SPEC da próxima fatia é escrita. Um diretório, como neste repositório. */
export const DIRETORIO_DAS_SPECS = 'docs/spec'

/** Onde o documento de cada MVP é escrito. Um diretório, como neste repositório. */
export const DIRETORIO_DOS_MVPS = 'docs/mvp'

/**
 * O rótulo de cada origem no texto dos documentos.
 *
 * **Texto, não símbolo nem cor**: o arquivo é lido em qualquer editor, e um marcador que
 * dependesse de renderização perderia a informação justo onde ela precisa sobreviver — no
 * arquivo commitado que outra pessoa abre depois.
 */
export const MARCA_DA_ORIGEM: Readonly<Record<OrigemDoRoadmap, string>> = {
  prd: 'PRD',
  arquitetura: 'ARQUITETURA',
  proposto: 'PROPOSTO PELA IA'
}

/** A marca de origem de um MVP ou fatia, com a referência quando ela existe. */
function marcaDeOrigem(origem: OrigemDoRoadmap, referencia: string | undefined): string {
  const marca = MARCA_DA_ORIGEM[origem]
  return referencia === undefined ? `_origem: ${marca}_` : `_origem: ${marca} (${referencia})_`
}

/**
 * O caminho do documento de um MVP, derivado do número e do título.
 *
 * O número entra com dois dígitos porque é ele que ordena a listagem do diretório — sem o zero à
 * esquerda, o MVP 10 apareceria antes do 2.
 */
export function arquivoDoMvp(mvp: Pick<MvpGerado, 'numero' | 'titulo'>, slug: string): string {
  return `${DIRETORIO_DOS_MVPS}/mvp-${String(mvp.numero).padStart(2, '0')}-${slug}.md`
}

/**
 * Renderiza o `STATUS.md` do projeto gerado.
 *
 * O formato espelha o deste repositório porque é o que o MVP-009 lê: **Agora**, **MVPs** e
 * **Índice Fatia ↔ SPEC**. O índice é a invariante 1 tomando forma de arquivo — é *aqui* que o
 * par Fatia ↔ SPEC vive, e em nenhum outro lugar.
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
 * Renderiza o documento de um MVP: a tese, o resultado, as dependências e o **checklist** das
 * fatias previstas (§ 1 e § Regras).
 *
 * **O checklist é o que faz o MVP ser container e não fatia.** As fatias existem aqui como texto
 * até que uma delas ganhe SPEC — é a mesma hierarquia deste repositório, onde a issue-épico nasce
 * com o checklist e as filhas só viram issue quando a spec é aprovada.
 *
 * A origem aparece em cada linha porque é o que o gate `MVP_ENTRY` pede ao PI que leia: um MVP
 * `proposto` é uma inferência do modelo, e escolhê-lo para a fila é aceitar essa inferência.
 */
export function renderizarDocumentoDoMvp(
  mvp: MvpGerado,
  nomeDoProjeto: string,
  dependencias: readonly { readonly id: string; readonly titulo: string }[],
  geradoEm: string
): string {
  const titulosDasDependencias = mvp.dependeDe.map(
    (id) => dependencias.find((d) => d.id === id)?.titulo ?? id
  )

  return [
    `# MVP-${String(mvp.numero).padStart(2, '0')} — ${mvp.titulo}`,
    '',
    `Projeto: ${nomeDoProjeto}. Gerado em: **${geradoEm}**.`,
    '',
    marcaDeOrigem(mvp.origem, mvp.referencia),
    '',
    '## Tese',
    '',
    mvp.tese,
    '',
    '## Resultado',
    '',
    mvp.resultado,
    '',
    '## Depende de',
    '',
    titulosDasDependencias.length === 0
      ? '_Nada. Este MVP pode começar._'
      : titulosDasDependencias.map((t) => `- ${t}`).join('\n'),
    '',
    '## Fatias previstas',
    '',
    // Checklist, e não lista: é o formato que marca progresso, e o MVP fecha quando todas as
    // fatias fecham.
    ...mvp.fatias.map((f) => `- [ ] ${f.titulo} — ${marcaDeOrigem(f.origem, f.referencia)}`),
    '',
    'Só a próxima fatia recebe especificação executável. As demais existem aqui como checklist',
    'até chegarem a vez delas.',
    ''
  ].join('\n')
}

/**
 * Renderiza a SPEC executável da primeira fatia (§ 5).
 *
 * **Nasce `rascunho`, e as perguntas abertas vêm com ela.** A aprovação é o gate `SLICE_ENTRY`,
 * um ato do PI — e o critério 4 recusa o aceite enquanto houver pergunta sem resposta. Escrever
 * a resposta no arquivo é o que torna a decisão parte do documento commitado, e não um estado
 * que só o banco conhece.
 */
export function renderizarSpecGerada(
  spec: SpecGerada,
  mvp: MvpGerado | undefined,
  geradoEm: string
): string {
  const linhas: string[] = [
    `# SPEC — ${spec.titulo}`,
    '',
    `- MVP: ${mvp?.titulo ?? '—'}.`,
    `- Status: **rascunho** (${geradoEm}) — a aprovação é o gate \`SLICE_ENTRY\`, ato do dono do projeto.`,
    '',
    '## Objetivo',
    '',
    spec.objetivo,
    ''
  ]

  linhas.push(...secao('Fluxo', spec.fluxo, true))
  linhas.push(...secao('Regras', spec.regras, false))
  linhas.push(...secao('Critérios de aceite', spec.criteriosDeAceite, true))
  linhas.push(...secao('Testes e evidência', spec.testes, false))

  linhas.push('## Perguntas abertas', '')

  if (spec.perguntas.length === 0) {
    // Não deveria acontecer: o validador recusa SPEC sem pergunta. A linha existe para o arquivo
    // nunca sair com uma seção muda se um caminho futuro escapar do validador.
    linhas.push('_Nenhuma registrada._', '')
  }

  for (const pergunta of spec.perguntas) {
    linhas.push(`### ${pergunta.enunciado}`, '')

    for (const opcao of pergunta.opcoes) {
      const recomendada = opcao.id === pergunta.recomendada ? ' **(recomendada)**' : ''
      linhas.push(`- **${opcao.rotulo}**${recomendada} — ${opcao.impacto}`)
    }

    linhas.push('', `_Por que a recomendada:_ ${pergunta.justificativa}`, '')

    const escolhida = pergunta.opcoes.find((o) => o.id === pergunta.resposta)
    linhas.push(
      pergunta.resposta === undefined || pergunta.resposta.trim().length === 0
        ? '**Resposta:** _pendente. A SPEC não pode ser aceita enquanto esta pergunta estiver aberta._'
        : `**Resposta:** ${escolhida?.rotulo ?? pergunta.resposta}`,
      ''
    )
  }

  return linhas.join('\n')
}

/** Uma seção de lista da SPEC. Numerada quando a ordem importa (fluxo, critérios). */
function secao(titulo: string, itens: readonly string[], numerada: boolean): readonly string[] {
  if (itens.length === 0) return [`## ${titulo}`, '', '_Sem conteúdo nesta revisão._', '']

  return [
    `## ${titulo}`,
    '',
    ...itens.map((item, i) => (numerada ? `${i + 1}. ${item}` : `- ${item}`)),
    ''
  ]
}

/** A próxima fatia a detalhar dentro de um MVP: a de menor número. */
export function primeiraFatiaDo(mvp: MvpGerado): MvpGerado['fatias'][number] | undefined {
  return [...mvp.fatias].sort((a, b) => a.numero - b.numero)[0]
}

/** Os MVPs do roadmap gravado, na ordem em que a execução os permite. */
export function mvpsNaOrdem(roadmap: Roadmap): readonly Mvp[] {
  const ordem = ordemDeExecucao(roadmap.mvps)
  if (ordem === undefined) return [...roadmap.mvps].sort((a, b) => a.numero - b.numero)

  return ordem
    .map((id) => roadmap.mvps.find((m) => m.id === id))
    .filter((m): m is Mvp => m !== undefined)
}
