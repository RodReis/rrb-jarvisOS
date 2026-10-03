/**
 * A revisão independente do resultado integrado (SPEC-Squads-04, critérios 2, 3, 4 e 6).
 *
 * **O revisor propõe, o kernel decide.** Cada revisor roda pelo ponto único, **sem ferramenta e sem
 * Git** (a fase de planejamento é a que o adapter isola assim) e devolve um parecer estruturado.
 * O kernel o lê de modo estrito, **reencontra o trecho de cada achado no arquivo do commit**
 * (achado sem localização verificável é observação, nunca defeito confirmado), deduplica por
 * assinatura, revalida o que já estava registrado contra o resultado novo e deriva o veredito dos
 * achados — não do `parecer` que o agente declarou.
 *
 * A entrada traz o que o `REVIEW.md` exige: SPEC, contrato de revisão, diff contra a base, o
 * manifesto, o resultado dos testes e os achados ainda abertos. Relatório anterior serve só para
 * avaliar o delta novo e regressão real (regra 2).
 *
 * Nunca lança: todo caminho termina em `revisada` ou `parada`, com motivo.
 */

import { createHash } from 'node:crypto'
import type { AiProvider, AiRequest } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  PARECER_DE_REVISAO,
  bloqueia,
  conferirEvidencia,
  contestar,
  decidirTriagem,
  esquemaDoParecer,
  incorporarAchados,
  lerParecer,
  revalidar,
  veredito,
  type AchadoDoRevisor,
  type AchadoRegistrado,
  type ParecerDoRevisor,
  type VereditoDaRevisao
} from '@shared/domain/squad-achado'
import { providerSemFerramenta, type RevisorCandidato } from '@shared/domain/squad-revisores'
import type { ContextService, FonteDaTarefa } from '../context/context-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { AchadoRepository } from './achado-repository'
import { MS_POR_MINUTO, chamarModelo } from './squad-chamada'
import { MAX_FONTES_DA_TAREFA } from './squad-contexto'
import { dividirPorArquivo } from './squad-diff'
import type { ChamadorDeIa } from './squad-gerador'
import type { SquadGit } from './squad-git'
import { extrairJsonFinal } from './squad-planejador'
import { montarPromptDoRevisor } from './squad-revisor-prompt'

const MAX_TOKENS_DA_SAIDA_PADRAO = 16_384
const MAX_TOKENS_DA_ENTRADA_PADRAO = 150_000
const MAX_MINUTOS_PADRAO = 15
/** O mesmo teto por fonte do contexto: um diff cortado ao meio entraria como se fosse inteiro. */
const TETO_POR_FONTE_BYTES = 256 * 1024
const MAX_OBSERVACAO = 300
const MAX_OBSERVACOES = 40

export interface PedidoDeRevisao {
  readonly runId: string
  readonly projectId: string
  readonly repositorio: string
  readonly baseSha: string
  /** O commit integrado: é ele que os revisores olham, e o seu SHA identifica o delta. */
  readonly resultadoSha: string
  readonly rota: AiProvider
  /** Já escolhidos (`escolherRevisores`): distintos dos escritores e do integrador. */
  readonly revisores: readonly RevisorCandidato[]
  readonly spec: { readonly caminho: string; readonly texto: string }
  /** O texto de `docs/REVIEW.md`. */
  readonly contratoDeRevisao: string
  /** O resumo do manifesto de hunks, em texto do kernel. */
  readonly manifesto: string
  /** O resultado da etapa TESTE, em texto do kernel. */
  readonly testes: string
  /** A rodada de revisão, a partir de 1: a tentativa do DEVELOPER que está sendo revista. */
  readonly rodada: number
  readonly maxTokensSaida?: number
  readonly maxTokensEntrada?: number
  readonly maxMinutos?: number
  readonly signal?: AbortSignal
}

export type EstadoDoRevisor = 'parecer' | 'invalido' | 'timeout' | 'cancelado' | 'falhou'

export type MotivoDaRevisaoParada =
  | 'diff-recusado'
  | 'resultado-ilegivel'
  | 'delta-grande-demais'
  | 'sem-revisor'
  | 'contexto-recusado'
  | 'contexto-acima-do-limite'
  | 'modelo-local-sem-janela'
  | 'provider-com-ferramenta'

export type ResultadoDaRevisao =
  | {
      readonly estado: 'revisada'
      readonly veredito: VereditoDaRevisao
      /** Todos os achados do run depois desta rodada, em qualquer estado. */
      readonly achados: readonly AchadoRegistrado[]
      /** O que não é defeito confirmado: pergunta, achado sem localização, fora da SPEC. */
      readonly observacoes: readonly string[]
      readonly revisores: readonly { readonly id: string; readonly estado: EstadoDoRevisor }[]
      readonly novos: number
    }
  | {
      readonly estado: 'parada'
      readonly motivo: MotivoDaRevisaoParada
      readonly detalhe?: string
    }

export interface DependenciasDoRevisor {
  readonly git: Pick<SquadGit, 'diffEntre' | 'listarNaRevisao' | 'lerNaRevisao'>
  readonly contexto: Pick<ContextService, 'montarDaTarefa'>
  readonly ia: ChamadorDeIa
  readonly achados: Pick<AchadoRepository, 'listar' | 'salvar'>
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
}

type Parada = Extract<ResultadoDaRevisao, { estado: 'parada' }>

const parada = (motivo: MotivoDaRevisaoParada, detalhe?: string): Parada => ({
  estado: 'parada',
  motivo,
  ...(detalhe === undefined ? {} : { detalhe })
})

const sha256 = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex')
const bytes = (texto: string): number => Buffer.byteLength(texto, 'utf8')

interface RodadaDoRevisor {
  readonly id: string
  readonly estado: EstadoDoRevisor
  readonly parecer?: ParecerDoRevisor
}

/** O revisor que nem chegou a rodar porque o pedido não cabe: vale para a revisão inteira. */
interface RodadaImpedida {
  readonly id: string
  readonly parada: Parada
}

export class RevisorService {
  constructor(private readonly deps: DependenciasDoRevisor) {}

  async revisar(pedido: PedidoDeRevisao): Promise<ResultadoDaRevisao> {
    this.auditar(pedido, 'inicio')
    let resultado: ResultadoDaRevisao
    try {
      resultado = await this.executar(pedido)
    } catch (erro) {
      // O revisor nunca lança: o que escapou é falha, e a revisão sem parecer para o run.
      resultado = parada(
        'sem-revisor',
        `erro inesperado: ${erro instanceof Error ? erro.name : 'desconhecido'}`
      )
    }
    this.auditar(pedido, 'fim', resultado)
    return resultado
  }

  private async executar(pedido: PedidoDeRevisao): Promise<ResultadoDaRevisao> {
    if (pedido.revisores.length === 0) return parada('sem-revisor')
    // Critério 4: sem Git nem por prompt. Só revisa quem prova a ausência de ferramenta por construção.
    const comFerramenta = pedido.revisores.find((r) => !providerSemFerramenta(r.modelo.provider))
    if (comFerramenta !== undefined) return parada('provider-com-ferramenta', comFerramenta.id)
    const localSemJanela = pedido.revisores.find(
      (r) => r.modelo.provider === 'ollama' && (r.numCtx ?? 0) <= 0
    )
    if (localSemJanela !== undefined) return parada('modelo-local-sem-janela', localSemJanela.id)

    const arvore = this.deps.git.listarNaRevisao(pedido.repositorio, pedido.resultadoSha)
    if (!arvore.ok) return parada('resultado-ilegivel', arvore.motivo)
    const lerArquivo = (arquivo: string): string | undefined => {
      const entrada = arvore.valor.get(arquivo)
      if (entrada === undefined) return undefined
      const texto = this.deps.git.lerNaRevisao(pedido.repositorio, entrada)
      return texto.ok ? texto.valor : undefined
    }

    const existentes = this.deps.achados.listar(this.deps.userId(), pedido.runId)
    const montadas = this.montarFontes(pedido, lerArquivo, existentes)
    if ('estado' in montadas) return montadas
    const { fontes, arquivosDoDelta } = montadas

    const todas = await Promise.all(pedido.revisores.map((r) => this.rodar(pedido, r, fontes)))
    const impedida = todas.find((r): r is RodadaImpedida => 'parada' in r)
    if (impedida !== undefined) return impedida.parada
    const rodadas = todas.filter((r): r is RodadaDoRevisor => !('parada' in r))
    const pareceres = rodadas.flatMap((r) =>
      r.parecer === undefined ? [] : [{ id: r.id, p: r.parecer }]
    )

    const { lista, novos, observacoes, parecerSemEvidencia } = this.consolidar(
      pedido,
      existentes,
      pareceres,
      lerArquivo,
      arquivosDoDelta
    )
    this.deps.achados.salvar(
      { userId: this.deps.userId(), workspaceId: this.deps.workspaceId(), runId: pedido.runId },
      lista
    )
    return {
      estado: 'revisada',
      // Quórum: **todo** revisor escolhido tem de ter devolvido parecer. Um revisor cruzado que deu
      // timeout não pode sumir em silêncio deixando o outro aprovar sozinho.
      veredito: veredito(lista, pareceres.length === rodadas.length, {
        algumRevisorBloqueou: pareceres.some((x) => x.p.parecer === 'BLOCKED'),
        parecerSemEvidencia
      }),
      achados: lista,
      observacoes,
      revisores: rodadas.map((r) => ({ id: r.id, estado: r.estado })),
      novos
    }
  }

  /**
   * Revalida o que já estava registrado contra o resultado novo, incorpora o que os revisores
   * acharam (só com evidência que o kernel reencontra), marca as contestações e tria o que volta
   * ao DEVELOPER. A ordem importa: revalidar **antes** de incorporar, para um achado corrigido
   * sair de `open` sem que um revisor precise dizer que sumiu.
   */
  private consolidar(
    pedido: PedidoDeRevisao,
    existentes: readonly AchadoRegistrado[],
    pareceres: readonly { id: string; p: ParecerDoRevisor }[],
    lerArquivo: (arquivo: string) => string | undefined,
    arquivosDoDelta: ReadonlySet<string>
  ): {
    lista: readonly AchadoRegistrado[]
    novos: number
    observacoes: readonly string[]
    parecerSemEvidencia: boolean
  } {
    const observacoes: string[] = []
    const verificados: AchadoDoRevisor[] = []
    let parecerSemEvidencia = false
    for (const { id, p } of pareceres) {
      let bloqueantesDoRevisor = 0
      for (const achado of p.achados) {
        // Só vale achado em arquivo **do delta** e com trecho que o kernel reencontra: sem isso o
        // revisor forjaria um P0 em qualquer arquivo da árvore, com `correcao` escrita por ele.
        if (arquivosDoDelta.has(achado.arquivo) && conferirEvidencia(achado, lerArquivo)) {
          verificados.push({ revisor: id, achado })
          if (bloqueia(achado.severidade) && !achado.foraDaSpec) bloqueantesDoRevisor += 1
        } else {
          observacoes.push(`sem localização verificável: ${achado.arquivo} — ${achado.titulo}`)
        }
      }
      observacoes.push(...p.observacoes)
      // Reprovou e o kernel não achou nada que confira: um P0 real mal citado sumiria como
      // observação. Não vira `PASS` em silêncio.
      if (p.parecer === 'FIX_REQUIRED' && bloqueantesDoRevisor === 0) parecerSemEvidencia = true
    }

    const revalidados = revalidar(existentes, lerArquivo, pedido.resultadoSha)
    const incorporados = incorporarAchados(revalidados, verificados, pedido.resultadoSha, sha256)
    const contestacoes = pareceres.flatMap(({ id, p }) =>
      p.contestacoes.map((c) => ({ revisor: id, assinatura: c.assinatura, motivo: c.motivo }))
    )
    const lista = decidirTriagem(contestar(incorporados, contestacoes), lerArquivo)
    const conhecidos = new Set(existentes.map((a) => a.assinatura))
    return {
      lista,
      novos: lista.filter((a) => !conhecidos.has(a.assinatura)).length,
      observacoes: observacoes.map((o) => o.slice(0, MAX_OBSERVACAO)).slice(0, MAX_OBSERVACOES),
      parecerSemEvidencia
    }
  }

  /**
   * As fontes do pedido: contrato, SPEC, diff por arquivo, o arquivo como ficou, manifesto, testes
   * e achados registrados. Estourar o teto de uma fonte para a revisão: revisar um diff cortado ao
   * meio seria aprovar o que ninguém viu.
   */
  private montarFontes(
    pedido: PedidoDeRevisao,
    lerArquivo: (arquivo: string) => string | undefined,
    existentes: readonly AchadoRegistrado[]
  ): { fontes: readonly FonteDaTarefa[]; arquivosDoDelta: ReadonlySet<string> } | Parada {
    const diff = this.deps.git.diffEntre(pedido.repositorio, pedido.baseSha, pedido.resultadoSha)
    if (!diff.ok) return parada('diff-recusado', diff.motivo)

    const fonte = (caminho: string, texto: string, motivo: string): FonteDaTarefa => ({
      caminho,
      texto,
      origem: 'explicito',
      motivo
    })
    const abertos = existentes
      .filter((a) => a.estado !== 'superseded')
      .map((a) => ({
        assinatura: a.assinatura,
        estado: a.estado,
        severidade: a.severidade,
        categoria: a.categoria,
        arquivo: a.arquivo,
        trecho: a.trecho,
        titulo: a.titulo
      }))
    const fontes: FonteDaTarefa[] = [
      fonte('docs/REVIEW.md', pedido.contratoDeRevisao, 'contrato dos revisores'),
      fonte(pedido.spec.caminho, pedido.spec.texto, 'SPEC aprovada'),
      fonte('revisao/manifesto.txt', pedido.manifesto, 'manifesto de hunks da integração'),
      fonte('revisao/testes.txt', pedido.testes, 'resultado dos testes'),
      fonte('revisao/achados-abertos.json', JSON.stringify(abertos, null, 2), 'achados registrados')
    ]

    const porArquivo = dividirPorArquivo(diff.valor)
    for (const { arquivo, texto } of porArquivo) {
      fontes.push(fonte(`revisao/diff/${arquivo}.patch`, texto, 'diff contra a base'))
    }
    for (const { arquivo } of porArquivo) {
      const atual = lerArquivo(arquivo)
      if (atual !== undefined) fontes.push(fonte(arquivo, atual, 'arquivo alterado, como ficou'))
    }
    const grande = fontes.find((f) => bytes(f.texto) > TETO_POR_FONTE_BYTES)
    if (grande !== undefined) return parada('delta-grande-demais', grande.caminho)
    if (fontes.length > MAX_FONTES_DA_TAREFA) {
      return parada('delta-grande-demais', `${fontes.length} fontes`)
    }
    return { fontes, arquivosDoDelta: new Set(porArquivo.map((p) => p.arquivo)) }
  }

  /** Um revisor: monta o pack, chama o modelo sem ferramenta e lê o parecer de modo estrito. */
  private async rodar(
    pedido: PedidoDeRevisao,
    revisor: RevisorCandidato,
    fontes: readonly FonteDaTarefa[]
  ): Promise<RodadaDoRevisor | RodadaImpedida> {
    const { system, prompt } = montarPromptDoRevisor({
      objetivo:
        'Revise o delta do resultado integrado contra a SPEC aprovada, conforme o contrato de revisão, ' +
        `e devolva o parecer no schema ${PARECER_DE_REVISAO}.`,
      fontes
    })
    const tokensDeEntrada = Math.ceil(bytes(system + prompt) / 4)
    if (tokensDeEntrada > (pedido.maxTokensEntrada ?? MAX_TOKENS_DA_ENTRADA_PADRAO)) {
      return { id: revisor.id, parada: parada('contexto-acima-do-limite', revisor.id) }
    }

    const montado = this.deps.contexto.montarDaTarefa(
      {
        projectId: pedido.projectId,
        tarefa: `squad:${pedido.runId}/revisao-${revisor.id}@${pedido.resultadoSha.slice(0, 12)}`,
        etapa: 'squad-revisao',
        fontes,
        rota: pedido.rota
      },
      this.deps.workspaceId()
    )
    if (montado.pack === undefined) {
      return { id: revisor.id, parada: parada('contexto-recusado', montado.reason) }
    }
    // Fonte que o contexto descartou como inválida **não passou pelo scan de segredo** e iria ao
    // modelo mesmo assim: o pack tem de ter exatamente as fontes que o prompt carrega.
    if (montado.pack.itens.length !== fontes.length) {
      return { id: revisor.id, parada: parada('contexto-recusado', 'fonte-invalida') }
    }

    const esquema = JSON.stringify(esquemaDoParecer())
    const request: AiRequest = {
      provider: revisor.modelo.provider,
      model: revisor.modelo.modelo,
      system,
      prompt,
      maxTokens: pedido.maxTokensSaida ?? MAX_TOKENS_DA_SAIDA_PADRAO,
      contextPackId: montado.pack.id,
      runId: pedido.runId,
      tentativa: pedido.rodada,
      // Sem ferramentas, sem settings do ambiente, esquema imposto: o revisor não tem Git, nem por
      // construção nem por prompt.
      fase: 'planejamento',
      ...(revisor.modelo.provider === 'ollama'
        ? { opcoesLocais: { numCtx: revisor.numCtx as number, formato: esquema } }
        : { jsonSchema: esquema })
    }

    let chamada
    try {
      chamada = await chamarModelo({
        ia: this.deps.ia,
        request,
        userId: this.deps.userId(),
        workspace: this.deps.workspaceId(),
        prazoMs: (pedido.maxMinutos ?? MAX_MINUTOS_PADRAO) * MS_POR_MINUTO,
        ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
      })
    } catch {
      return { id: revisor.id, estado: 'falhou' }
    }
    if (!chamada.ok) {
      const estado: EstadoDoRevisor =
        chamada.estado === 'invalida'
          ? 'invalido'
          : chamada.estado === 'cancelada'
            ? 'cancelado'
            : chamada.estado
      return { id: revisor.id, estado }
    }
    const bruto = extrairJsonFinal(chamada.texto, (v) => 'parecer' in v && 'schema' in v)
    if (bruto === undefined) return { id: revisor.id, estado: 'invalido' }
    const lido = lerParecer(bruto)
    return lido.ok
      ? { id: revisor.id, estado: 'parecer', parecer: lido.parecer }
      : { id: revisor.id, estado: 'invalido' }
  }

  /**
   * Ids, estados e contagens — nunca o texto do achado nem o do agente (ADR-004).
   */
  private auditar(pedido: PedidoDeRevisao, marco: 'inicio' | 'fim', r?: ResultadoDaRevisao): void {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-revisao',
      payload: {
        marco,
        runId: pedido.runId,
        rodada: pedido.rodada,
        resultadoSha: pedido.resultadoSha,
        revisores: pedido.revisores.map((x) => ({
          id: x.id,
          provider: x.modelo.provider,
          modelo: x.modelo.modelo
        })),
        estado: r?.estado ?? 'em-execucao',
        ...(r === undefined
          ? {}
          : r.estado === 'parada'
            ? { motivo: r.motivo }
            : {
                veredito: r.veredito.resultado,
                ...(r.veredito.resultado === 'BLOCKED' ? { motivo: r.veredito.motivo } : {}),
                revisoresComParecer: r.revisores.filter((x) => x.estado === 'parecer').length,
                achados: r.achados.length,
                novos: r.novos,
                observacoes: r.observacoes.length
              })
      }
    })
  }
}
