/**
 * O resumo que o app faz do próprio estado (SPEC-Voz-03, critério 6 e decisão 4 do PI).
 *
 * É o que permite perguntar *"o que está na fila?"* e receber uma resposta sobre **este** app, e
 * não uma alucinação plausível. O modelo recebe o resumo **pronto**: não consulta, não executa,
 * não dispara nada (critério 8 — sem tool use).
 *
 * ## Contrato próprio porque o MVP-019 vai consumir o mesmo serviço
 *
 * A decisão 4 do PI antecipou a fonte de dados do briefing proativo, e a spec registrou a
 * mitigação: este serviço nasce com contrato e teste próprios, e o 019 **reutiliza**. Duas
 * montagens do mesmo estado — uma para responder, outra para anunciar — divergiriam no dia em
 * que uma ganhasse um campo, e o usuário ouviria duas versões do mesmo app.
 *
 * A fronteira entre os dois é de **gatilho**, não de dado: aqui é *pull* (responde quando
 * perguntado), lá é *push* (anuncia sem pergunta).
 *
 * ## A fonte é o banco local, sempre
 *
 * Nenhuma leitura do GitHub na montagem (critério 6). O estado operacional é local (ADR-001), e
 * ir à rede aqui poria a conversa na dependência de uma chamada externa — além de tornar
 * *"quantas entregas aguardam aceite?"* uma pergunta que pode falhar por timeout.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { PipelineRun, VistaDaFila } from '@shared/domain/pipeline'
import type { Project } from '@shared/domain/projects'

/** O que o snapshot precisa ler. Injetado: o teste de contrato roda sem banco. */
export interface FontesDoSnapshot {
  readonly projetos: (workspace: WorkspaceId) => readonly Project[]
  /** A fila de um projeto. `undefined` quando o projeto não tem pipeline ainda. */
  readonly fila: (projectId: string, workspace: WorkspaceId) => VistaDaFila | undefined
}

/** Um projeto, como a conversa fala dele. */
export interface ProjetoNoSnapshot {
  readonly nome: string
  readonly emAndamento: number
  readonly aguardandoAceite: number
  readonly bloqueadas: number
}

/**
 * O estado do app num instante, em forma de dado.
 *
 * Estrutura e não string porque o MVP-019 vai querer decidir *o que anunciar* a partir dele —
 * comparar dois snapshots, contar o que mudou. Um texto pronto obrigaria o 019 a fazer parsing
 * do que este serviço acabou de formatar. O texto vem depois, em `textoDoSnapshot`.
 */
export interface SnapshotDoApp {
  readonly workspace: WorkspaceId
  readonly projetos: readonly ProjetoNoSnapshot[]
  /** Total de entregas aguardando o aceite do PI, somando os projetos. */
  readonly aguardandoAceite: number
  /** ISO 8601. O snapshot descreve um instante, e quem o lê depois precisa saber qual. */
  readonly em: string
}

export function montarSnapshot(fontes: FontesDoSnapshot, workspace: WorkspaceId): SnapshotDoApp {
  const projetos = fontes.projetos(workspace).map((projeto) => {
    const vista = fontes.fila(projeto.id, workspace)
    const ativos = vista?.ativos ?? []

    return {
      nome: projeto.nome,
      // `AWAITING_PI` sai da contagem de "em andamento": ele é o gate de aceite, e somá-lo ao
      // trabalho corrente diria que algo está sendo feito quando o que falta é uma decisão.
      emAndamento: ativos.filter((run: PipelineRun) => run.estado !== 'AWAITING_PI').length,
      aguardandoAceite: ativos.filter((run: PipelineRun) => run.estado === 'AWAITING_PI').length,
      bloqueadas: vista?.bloqueadas.length ?? 0
    }
  })

  return {
    workspace,
    projetos,
    aguardandoAceite: projetos.reduce((soma, p) => soma + p.aguardandoAceite, 0),
    em: new Date().toISOString()
  }
}

/**
 * O snapshot como texto, para entrar no contexto da chamada.
 *
 * Separado da montagem de propósito: o MVP-019 vai consumir a **estrutura** para decidir o que
 * anunciar, e só a conversa precisa da prosa. Juntar os dois faria o 019 dar parsing no que este
 * arquivo acabou de formatar.
 *
 * Frases curtas e números explícitos porque isto vai ser **falado**. "2 projetos, 3 entregas
 * aguardando aceite" se ouve; uma tabela markdown, não — e o bloco fixo da persona proíbe
 * markdown justamente por isso.
 */
export function textoDoSnapshot(snapshot: SnapshotDoApp): string {
  if (snapshot.projetos.length === 0) {
    // Estado vazio dito explicitamente. Omitir a seção faria o modelo preencher a lacuna com
    // suposição — e "não há projetos" é uma resposta útil, não uma falta de dado.
    return 'Estado do app: nenhum projeto neste espaço.'
  }

  const linhas = snapshot.projetos.map((p) => {
    const partes = [`${p.emAndamento} em andamento`]
    if (p.aguardandoAceite > 0) partes.push(`${p.aguardandoAceite} aguardando aceite`)
    if (p.bloqueadas > 0) partes.push(`${p.bloqueadas} bloqueadas`)
    return `- ${p.nome}: ${partes.join(', ')}.`
  })

  return [
    `Estado do app em ${snapshot.em}:`,
    ...linhas,
    `Total aguardando aceite: ${snapshot.aguardandoAceite}.`
  ].join('\n')
}
