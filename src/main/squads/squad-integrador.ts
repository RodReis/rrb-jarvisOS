/**
 * O integrador de dois escritores (SPEC-Squads-04, critérios 1 e 4; ADR-006 decisão 6).
 *
 * **O kernel integra, o agente só decide o conflito** (decisão do PI de 2026-10-03). O Git junta o
 * que é determinístico no worktree de integração; o agente, na camada da fase, recebe **um bloco
 * em conflito de cada vez** e devolve texto — sem ferramenta, sem Git, sem tocar arquivo. O kernel
 * monta o arquivo, adiciona, commita e **confere o manifesto de hunks contra o diff real**: um
 * hunk que não está no resultado e não foi explicado por um descarte com motivo **para o run**
 * (regra 1; não existe "aceitar mesmo assim").
 *
 * O que o agente devolve é dado não confiável: forma estrita, sem marcador de conflito, e um
 * descarte só explica o que está **no bloco daquele arquivo**. O que vale é o que está no commit —
 * o manifesto lê o diff do commit, nunca o texto que o integrador diz ter escrito.
 *
 * **O texto do arquivo é do escritor**, então a estrutura do conflito que se lê dele pode ser
 * forjada: marcador dentro de um lado, bloco sem `=======`. Estrutura ambígua para o run, e o
 * resultado que ainda tem marcador de conflito não é aceito.
 *
 * Nunca lança: todo caminho termina em `integrado` ou `parado`, com motivo.
 */

import type { AiProvider, AiRequest } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import {
  contextoDoBloco,
  esquemaDaResolucao,
  estruturaAmbigua,
  lerBlocos,
  lerResolucao,
  montarArquivo,
  temMarcadorDeConflito,
  totalDeBlocos,
  type BlocoEmConflito,
  type ParteDoArquivo,
  type ResolucaoDoBloco
} from '@shared/domain/squad-conflito'
import { providerSemFerramenta } from '@shared/domain/squad-revisores'
import type { ContextService, FonteDaTarefa } from '../context/context-service'
import type { AuditRepository } from '../storage/audit-repository'
import { MS_POR_MINUTO, chamarModelo } from './squad-chamada'
import { lerDiff } from './squad-diff'
import type { ChamadorDeIa } from './squad-gerador'
import type { SquadGit, WorktreeDeEscritor } from './squad-git'
import { montarPromptDoIntegrador } from './squad-integrador-prompt'
import {
  auditarComDescartes,
  manifestoDosEscritores,
  textoDoManifesto,
  type DescarteDoArquivo,
  type HunkDoDiff,
  type ResumoDaAuditoria
} from './squad-manifesto'
import { extrairJsonFinal } from './squad-planejador'

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
/** O contexto fixo de cada lado do bloco: o bastante para entender, sem trazer o arquivo. */
const LINHAS_DE_CONTEXTO = 12
const MAX_TOKENS_DA_SAIDA_PADRAO = 16_384
const MAX_TOKENS_DA_ENTRADA_PADRAO = 100_000
const MAX_MINUTOS_PADRAO = 10
/** Uma chamada paga por bloco: sem teto, um arquivo de 1 MB gera milhares delas. */
const MAX_BLOCOS_PADRAO = 50
/**
 * Os arquivos que dizem ao Git o que executar (filtro, driver de merge, LFS) ou o que é
 * submódulo. Quem os escreve é o agente, e nem o merge nem a resolução do integrador os tocam.
 */
const CONFIGURACAO_DO_GIT = ['.gitattributes', '.gitmodules', '.lfsconfig']

const ehConfiguracaoDoGit = (caminho: string): boolean =>
  CONFIGURACAO_DO_GIT.includes(caminho.split('/').pop() ?? '')

const compacto = (texto: string): string => texto.toLowerCase().replace(/\s+/g, '')

export interface EscritorIntegrado {
  readonly escritor: string
  /** O commit do kernel no worktree do escritor (`ResultadoDoEscritor.commitSha`). */
  readonly commitSha: string
}

export interface PedidoDeIntegracao {
  readonly runId: string
  readonly projectId: string
  readonly repositorio: string
  /** O SHA de onde os dois escritores partiram. */
  readonly baseSha: string
  /** Exatamente dois: o integrador só existe com dois escritores (perfil). */
  readonly escritores: readonly EscritorIntegrado[]
  /** Onde o kernel cria o worktree de integração, e a branch que guarda o resultado. */
  readonly worktree: string
  readonly branch: string
  /** A camada do integrador, resolvida pelo snapshot (a da fase, pela nota pós-F00b). */
  readonly modelo: ModeloEscolhido
  readonly numCtx?: number
  readonly rota: AiProvider
  readonly maxTokensSaida?: number
  readonly maxTokensEntrada?: number
  readonly maxMinutos?: number
  readonly maxBlocos?: number
  readonly signal?: AbortSignal
}

export type MotivoDaParada =
  | 'escritores-invalidos'
  | 'provider-com-ferramenta'
  | 'modelo-local-sem-janela'
  | 'diff-recusado'
  | 'arquivo-de-configuracao-do-git'
  | 'worktree-recusado'
  | 'merge-recusado'
  | 'conflito-nao-suportado'
  | 'blocos-demais'
  | 'contexto-recusado'
  | 'contexto-acima-do-limite'
  | 'resolucao-invalida'
  | 'resolucao-nao-gravada'
  | 'marcador-no-resultado'
  | 'commit-recusado'
  | 'resultado-ilegivel'
  | 'hunk-perdido-sem-registro'
  | 'conflito-nao-resolvido'
  | 'timeout'
  | 'cancelada'
  | 'falhou'

export type ResultadoDaIntegracao =
  | {
      readonly estado: 'integrado'
      readonly commitSha: string
      readonly branch: string
      readonly arquivosEmConflito: readonly string[]
      readonly blocos: number
      readonly manifesto: ResumoDaAuditoria
      /** Linhas da resolução que nem os lados nem a base têm: o revisor as vê. */
      readonly linhasNovas: number
      /** O manifesto em texto do kernel, com cada descarte: a entrada do REVIEWER. */
      readonly manifestoTexto: string
    }
  | {
      readonly estado: 'parado'
      readonly motivo: MotivoDaParada
      readonly detalhe?: string
      readonly manifesto?: ResumoDaAuditoria
    }

export interface DependenciasDoIntegrador {
  readonly git: Pick<
    SquadGit,
    | 'diffEntre'
    | 'ehDescendente'
    | 'criarWorktree'
    | 'mesclar'
    | 'lerArquivoDoWorktree'
    | 'resolverArquivo'
    | 'commitarIntegracao'
    | 'abortarMerge'
    | 'remover'
  >
  readonly contexto: Pick<ContextService, 'montarDaTarefa'>
  readonly ia: ChamadorDeIa
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
}

type Parada = Extract<ResultadoDaIntegracao, { estado: 'parado' }>

const parada = (
  motivo: MotivoDaParada,
  detalhe?: string,
  manifesto?: ResumoDaAuditoria
): Parada => ({
  estado: 'parado',
  motivo,
  ...(detalhe === undefined ? {} : { detalhe }),
  ...(manifesto === undefined ? {} : { manifesto })
})

interface ArquivoEmConflito {
  readonly arquivo: string
  readonly partes: readonly ParteDoArquivo[]
}

interface ArquivoResolvido {
  readonly descartes: readonly DescarteDoArquivo[]
  readonly blocos: number
  readonly linhasNovas: number
}

export class IntegradorService {
  constructor(private readonly deps: DependenciasDoIntegrador) {}

  async integrar(pedido: PedidoDeIntegracao): Promise<ResultadoDaIntegracao> {
    this.auditar(pedido, 'inicio')
    let resultado: ResultadoDaIntegracao
    try {
      resultado = await this.executar(pedido)
    } catch (erro) {
      // O integrador nunca lança: o que escapou até aqui é falha, e falha tem motivo.
      resultado = parada(
        'falhou',
        `erro inesperado: ${erro instanceof Error ? erro.name : 'desconhecido'}`
      )
    }
    this.auditar(pedido, 'fim', resultado)
    return resultado
  }

  private async executar(pedido: PedidoDeIntegracao): Promise<ResultadoDaIntegracao> {
    const invalido = this.recusar(pedido)
    if (invalido !== undefined) return invalido
    const [a, b] = pedido.escritores as readonly [EscritorIntegrado, EscritorIntegrado]

    // Os dois escritores partiram da base declarada: um commit de outra história traria arquivos
    // que o diff da base não mostra e o manifesto não confere.
    for (const e of [a, b]) {
      const desce = this.deps.git.ehDescendente(pedido.repositorio, pedido.baseSha, e.commitSha)
      if (!desce.ok) return parada('diff-recusado', desce.motivo)
      if (!desce.valor) return parada('escritores-invalidos', 'o commit não descende da base')
    }

    const diffs: string[] = []
    for (const e of [a, b]) {
      const diff = this.deps.git.diffEntre(pedido.repositorio, pedido.baseSha, e.commitSha)
      if (!diff.ok) return parada('diff-recusado', diff.motivo)
      diffs.push(diff.valor)
    }
    const manifesto = manifestoDosEscritores(diffs)
    const config = lerDiff(diffs.join('\n')).find(
      (f) => ehConfiguracaoDoGit(f.arquivo) || ehConfiguracaoDoGit(f.base)
    )
    if (config !== undefined) return parada('arquivo-de-configuracao-do-git', config.arquivo)

    const criado = this.deps.git.criarWorktree({
      repositorio: pedido.repositorio,
      worktree: pedido.worktree,
      branch: pedido.branch,
      baseSha: a.commitSha
    })
    if (!criado.ok) return parada('worktree-recusado', criado.motivo)
    const w = criado.valor

    try {
      return await this.integrarNoWorktree(pedido, w, b.commitSha, manifesto)
    } finally {
      // Limpeza do kernel: desfaz o merge que ficou aberto e remove o worktree **sem `--force`**.
      // O resultado (se houve) já está num commit da branch; o que sobrar sujo fica para o PI ver.
      this.deps.git.abortarMerge(w)
      this.deps.git.remover(w)
    }
  }

  private async integrarNoWorktree(
    pedido: PedidoDeIntegracao,
    w: WorktreeDeEscritor,
    commitDoOutro: string,
    manifesto: readonly HunkDoDiff[]
  ): Promise<ResultadoDaIntegracao> {
    const merge = this.deps.git.mesclar(w, commitDoOutro)
    if (!merge.ok) return parada('merge-recusado', merge.motivo)

    // Primeiro **ler tudo** e só depois chamar o agente: conflito que não é de texto, estrutura
    // forjada ou bloco demais param o run antes de gastar uma chamada.
    const lidos = this.lerConflitos(w, merge.valor.conflitos, pedido.maxBlocos ?? MAX_BLOCOS_PADRAO)
    if ('estado' in lidos) return lidos

    const descartes: DescarteDoArquivo[] = []
    let blocos = 0
    let linhasNovas = 0
    for (const lido of lidos) {
      const resolvido = await this.resolverArquivo(pedido, w, lido, blocos)
      if ('estado' in resolvido) return resolvido
      descartes.push(...resolvido.descartes)
      blocos += resolvido.blocos
      linhasNovas += resolvido.linhasNovas
    }

    let commitSha = w.baseSha
    if (merge.valor.emAndamento) {
      const commit = this.deps.git.commitarIntegracao(w, `jarvis integração ${pedido.runId}`)
      if (!commit.ok) return parada('commit-recusado', commit.motivo)
      commitSha = commit.valor
    }

    // O que ficou no commit, da base até ele: é isto que o manifesto confere.
    const diff = this.deps.git.diffEntre(pedido.repositorio, pedido.baseSha, commitSha)
    if (!diff.ok) return parada('resultado-ilegivel', diff.motivo)
    const { auditoria, resumo } = auditarComDescartes(manifesto, diff.valor, descartes)
    if (!resumo.aprovada) {
      // Um conflito que ficou aberto é falha de resolução; um hunk que sumiu é perda de trabalho.
      const motivo =
        resumo.perdidosSemRegistro > 0 ? 'hunk-perdido-sem-registro' : 'conflito-nao-resolvido'
      return parada(motivo, undefined, resumo)
    }
    return {
      estado: 'integrado',
      commitSha,
      branch: pedido.branch,
      arquivosEmConflito: merge.valor.conflitos,
      blocos,
      manifesto: resumo,
      linhasNovas,
      manifestoTexto: textoDoManifesto(auditoria, linhasNovas)
    }
  }

  /** O que impede a integração de nem começar. */
  private recusar(pedido: PedidoDeIntegracao): Parada | undefined {
    const { escritores } = pedido
    if (
      escritores.length !== 2 ||
      !escritores.every((e) => SHA.test(e.commitSha)) ||
      escritores[0]?.commitSha === escritores[1]?.commitSha ||
      escritores[0]?.escritor === escritores[1]?.escritor
    ) {
      return parada('escritores-invalidos')
    }
    // Critério 4: sem Git nem por prompt. Só quem prova a ausência de ferramenta por construção.
    if (!providerSemFerramenta(pedido.modelo.provider)) {
      return parada('provider-com-ferramenta', pedido.modelo.provider)
    }
    if (pedido.modelo.provider === 'ollama' && (pedido.numCtx ?? 0) <= 0) {
      return parada('modelo-local-sem-janela')
    }
    return undefined
  }

  /** Lê cada arquivo em conflito: só texto, estrutura inequívoca e até o teto de blocos. */
  private lerConflitos(
    w: WorktreeDeEscritor,
    conflitos: readonly string[],
    maxBlocos: number
  ): readonly ArquivoEmConflito[] | Parada {
    const lidos: ArquivoEmConflito[] = []
    let total = 0
    for (const arquivo of conflitos) {
      // A resolução do integrador não escreve o que diz ao Git o que executar.
      if (ehConfiguracaoDoGit(arquivo)) return parada('conflito-nao-suportado', arquivo)
      const texto = this.deps.git.lerArquivoDoWorktree(w, arquivo)
      if (!texto.ok) return parada('conflito-nao-suportado', arquivo)
      const partes = lerBlocos(texto.valor)
      // Conflito sem bloco de texto (apagado de um lado, binário): não é o que o integrador resolve.
      if (totalDeBlocos(partes) === 0) return parada('conflito-nao-suportado', arquivo)
      if (estruturaAmbigua(partes))
        return parada('conflito-nao-suportado', `${arquivo}: estrutura ambígua`)
      total += totalDeBlocos(partes)
      lidos.push({ arquivo, partes })
    }
    return total > maxBlocos ? parada('blocos-demais', String(total)) : lidos
  }

  private async resolverArquivo(
    pedido: PedidoDeIntegracao,
    w: WorktreeDeEscritor,
    { arquivo, partes }: ArquivoEmConflito,
    blocosAntes: number
  ): Promise<ArquivoResolvido | Parada> {
    const resolucoes: ResolucaoDoBloco[] = []
    const descartes: DescarteDoArquivo[] = []
    let linhasNovas = 0
    for (const [i, parte] of partes.entries()) {
      if (parte.tipo !== 'bloco') continue
      const contexto = contextoDoBloco(partes, i, LINHAS_DE_CONTEXTO)
      const resolvido = await this.resolverBloco(
        pedido,
        arquivo,
        parte.bloco,
        contexto,
        blocosAntes + resolucoes.length + 1
      )
      if ('estado' in resolvido) return resolvido
      resolucoes.push(resolvido)
      // Um descarte só explica o que **está no bloco**: o que o agente cita fora dele não vale.
      const doBloco = compacto([...parte.bloco.a, ...parte.bloco.base, ...parte.bloco.b].join('\n'))
      for (const d of resolvido.descartes) {
        if (compacto(d.trecho) !== '' && doBloco.includes(compacto(d.trecho))) {
          descartes.push({ arquivo, trecho: d.trecho, motivo: d.motivo })
        }
      }
      linhasNovas += this.linhasNovasDaResolucao(resolvido.resolucao, parte.bloco, contexto)
    }

    const texto = montarArquivo(partes, resolucoes)
    if (texto === undefined) return parada('resolucao-invalida', arquivo)
    // Guarda final: o que o kernel vai gravar não pode ainda ser um conflito com outra aparência.
    if (temMarcadorDeConflito(texto)) return parada('marcador-no-resultado', arquivo)
    const gravado = this.deps.git.resolverArquivo(w, arquivo, texto)
    if (!gravado.ok) return parada('resolucao-nao-gravada', gravado.motivo)
    return { descartes, blocos: resolucoes.length, linhasNovas }
  }

  /** As linhas da resolução que nem os lados, nem a base, nem o contexto têm. */
  private linhasNovasDaResolucao(
    resolucao: string,
    bloco: BlocoEmConflito,
    contexto: { readonly antes: readonly string[]; readonly depois: readonly string[] }
  ): number {
    const conhecidas = new Set(
      [...bloco.a, ...bloco.base, ...bloco.b, ...contexto.antes, ...contexto.depois].map((l) =>
        l.trimEnd()
      )
    )
    return resolucao.split(/\r?\n/).filter((l) => l.trim() !== '' && !conhecidas.has(l.trimEnd()))
      .length
  }

  /** Um bloco, uma chamada, sem ferramenta. */
  private async resolverBloco(
    pedido: PedidoDeIntegracao,
    arquivo: string,
    bloco: BlocoEmConflito,
    contexto: { readonly antes: readonly string[]; readonly depois: readonly string[] },
    numero: number
  ): Promise<ResolucaoDoBloco | Parada> {
    const { system, prompt } = montarPromptDoIntegrador({ arquivo, bloco, contexto })
    const tokensDeEntrada = Math.ceil(Buffer.byteLength(system + prompt, 'utf8') / 4)
    if (tokensDeEntrada > (pedido.maxTokensEntrada ?? MAX_TOKENS_DA_ENTRADA_PADRAO)) {
      return parada('contexto-acima-do-limite', arquivo)
    }

    const fonte: FonteDaTarefa = {
      caminho: arquivo,
      texto: [...contexto.antes, ...bloco.a, ...bloco.base, ...bloco.b, ...contexto.depois].join(
        '\n'
      ),
      origem: 'explicito',
      motivo: `bloco ${numero} em conflito`
    }
    const montado = this.deps.contexto.montarDaTarefa(
      {
        projectId: pedido.projectId,
        tarefa: `squad:${pedido.runId}/integracao-${numero}@${pedido.escritores[0]?.commitSha.slice(0, 12) ?? ''}`,
        etapa: 'squad-integracao',
        fontes: [fonte],
        rota: pedido.rota
      },
      this.deps.workspaceId()
    )
    if (montado.pack === undefined) return parada('contexto-recusado', montado.reason)
    // Fonte que o contexto descartou como inválida **não passou pelo scan de segredo** e iria ao
    // modelo mesmo assim: o pack tem de ter exatamente as fontes que o prompt carrega.
    if (montado.pack.itens.length !== 1) return parada('contexto-recusado', 'fonte-invalida')

    const esquema = JSON.stringify(esquemaDaResolucao())
    const request: AiRequest = {
      provider: pedido.modelo.provider,
      model: pedido.modelo.modelo,
      system,
      prompt,
      maxTokens: pedido.maxTokensSaida ?? MAX_TOKENS_DA_SAIDA_PADRAO,
      contextPackId: montado.pack.id,
      runId: pedido.runId,
      tentativa: 1,
      // Sem ferramentas, sem settings do ambiente, esquema imposto: é a fase que o adapter isola
      // assim. O integrador devolve texto; quem escreve o arquivo é o kernel.
      fase: 'planejamento',
      ...(pedido.modelo.provider === 'ollama'
        ? { opcoesLocais: { numCtx: pedido.numCtx as number, formato: esquema } }
        : { jsonSchema: esquema })
    }

    const chamada = await chamarModelo({
      ia: this.deps.ia,
      request,
      userId: this.deps.userId(),
      workspace: this.deps.workspaceId(),
      prazoMs: (pedido.maxMinutos ?? MAX_MINUTOS_PADRAO) * MS_POR_MINUTO,
      ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
    })
    if (!chamada.ok) {
      return parada(
        chamada.estado === 'invalida' ? 'resolucao-invalida' : chamada.estado,
        chamada.motivo
      )
    }
    const bruto = extrairJsonFinal(chamada.texto, (v) => 'resolucao' in v)
    if (bruto === undefined) return parada('resolucao-invalida', 'saida-sem-json')
    const lida = lerResolucao(bruto)
    return lida.ok ? lida.valor : parada('resolucao-invalida', lida.motivo)
  }

  /**
   * Ids, estados e contagens — nunca o texto do bloco nem o do agente (ADR-004): a auditoria
   * responde "o que aconteceu com esta integração?" sem repetir o código do projeto.
   */
  private auditar(
    pedido: PedidoDeIntegracao,
    marco: 'inicio' | 'fim',
    r?: ResultadoDaIntegracao
  ): void {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-integracao',
      payload: {
        marco,
        runId: pedido.runId,
        provider: pedido.modelo.provider,
        modelo: pedido.modelo.modelo,
        escritores: pedido.escritores.map((e) => e.escritor),
        estado: r?.estado ?? 'em-execucao',
        ...(r === undefined
          ? {}
          : r.estado === 'integrado'
            ? {
                commitSha: r.commitSha,
                arquivosEmConflito: r.arquivosEmConflito.length,
                blocos: r.blocos,
                linhasNovas: r.linhasNovas,
                manifesto: r.manifesto
              }
            : {
                motivo: r.motivo,
                ...(r.manifesto === undefined ? {} : { manifesto: r.manifesto })
              })
      }
    })
  }
}
