/**
 * Persistência do `ContextPack` e dos fingerprints de falha (SPEC-Planejamento-02).
 *
 * **Append-only por ausência de `UPDATE`, não por convenção.** Não existe método que altere um
 * pack gravado: expandir contexto insere outro, com `packAnterior` apontando para este. Um
 * manifesto editável descreveria um contexto que talvez não tenha sido o enviado, e o critério
 * 2 ("reproduzir quais revisões foram enviadas") passaria a depender de ninguém ter mexido.
 *
 * O `failure_fingerprint` é a exceção deliberada: ele **é** estado mutável (a mesma falha volta
 * a acontecer, e um dia é resolvida). A diferença é que ele não é evidência do que foi enviado —
 * é o índice que decide o que entra no próximo pack.
 *
 * Auditar fica no serviço, que conhece o contexto da recusa — mesma divisão de
 * `ProjectRepository`.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type {
  ContextItem,
  ContextPack,
  FalhaNoContexto,
  FalhaRegistrada,
  OrigemDeContexto
} from '@shared/domain/context-pack'
import type { OrigemDePaths } from '@shared/domain/preflight'
import { log } from '../logging/logger'

interface PackRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  /** `null` = contexto do próprio app, sem projeto (SPEC-Voz-03, E1). */
  readonly project_id: string | null
  readonly tarefa: string
  readonly regras: string
  readonly falhas: string
  readonly resumo_anterior: string | null
  readonly etapa: string
  readonly unmetered: number
  readonly teto_de_tokens: number
  readonly tokens_estimados: number
  readonly estimado_usd: number | null
  readonly motivo_da_expansao: string | null
  readonly excecao_motivo: string | null
  readonly excecao_teto_bytes: number | null
  readonly excecao_autorizado_por: string | null
  readonly excecao_autorizado_em: string | null
  readonly rota: string
  readonly pack_anterior: string | null
  readonly hash: string
  readonly created_at: string
}

interface PathRow {
  readonly caminho: string
  readonly origem: string
  readonly justificativa: string
}

interface ItemRow {
  readonly caminho: string
  readonly hash: string
  readonly origem: string
  readonly bytes: number
  readonly linha_de: number | null
  readonly linha_ate: number | null
  readonly motivo: string
}

interface FalhaRow {
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly fingerprint: string
  readonly resumo: string
  readonly ocorrencias: number
  readonly resolvida: number
  readonly primeira_em: string
  readonly ultima_em: string
}

/**
 * Lê uma coluna JSON. Conteúdo ilegível vira lista vazia com aviso, em vez de estourar: o pack
 * é evidência do passado, e uma coluna corrompida não deve impedir a leitura do resto do
 * manifesto — os itens e os hashes, que são o que o critério 2 precisa, moram em outra tabela.
 */
function lerLista(raw: string, campo: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    log.db.warn('Campo JSON do ContextPack ilegível; lido como vazio', {
      op: 'select',
      table: 'context_pack',
      campo
    })
    return []
  }
}

function lerFalhas(raw: string): readonly FalhaNoContexto[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FalhaNoContexto[]) : []
  } catch {
    log.db.warn('Falhas do ContextPack ilegíveis; lidas como vazias', {
      op: 'select',
      table: 'context_pack'
    })
    return []
  }
}

function toItem(row: ItemRow): ContextItem {
  return {
    caminho: row.caminho,
    hash: row.hash,
    origem: row.origem as OrigemDeContexto,
    bytes: row.bytes,
    // Os dois juntos, ou nenhum: uma faixa com só um lado não é faixa. Gravados juntos pelo
    // `save`, lidos juntos aqui.
    ...(row.linha_de === null || row.linha_ate === null
      ? {}
      : { linhas: { de: row.linha_de, ate: row.linha_ate } }),
    motivo: row.motivo
  }
}

function toFalha(row: FalhaRow): FalhaRegistrada {
  return {
    fingerprint: row.fingerprint,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    resumo: row.resumo,
    ocorrencias: row.ocorrencias,
    resolvida: row.resolvida === 1,
    primeiraEm: row.primeira_em,
    ultimaEm: row.ultima_em
  }
}

export class ContextRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava o pack e seus itens numa transação.
   *
   * Transação porque **pack sem item é manifesto vazio**: um pack gravado cujos itens falharam
   * afirmaria ter mandado nada, e o critério 2 leria isso como verdade. Ou os dois entram, ou
   * nenhum entra.
   *
   * A `ordem` do item é gravada porque a ordem **é** o dado: o contexto foi montado numa
   * sequência, e reproduzir o envio exige reproduzi-la. Sem coluna de ordem, o `SELECT`
   * devolveria o que o SQLite achasse conveniente.
   */
  save(pack: ContextPack): ContextPack {
    const inserirPack = this.db.prepare(
      `INSERT INTO context_pack
         (id, user_id, workspace_id, project_id, tarefa, regras, falhas, resumo_anterior,
          etapa, unmetered, teto_de_tokens, tokens_estimados, estimado_usd, motivo_da_expansao,
          excecao_motivo, excecao_teto_bytes, excecao_autorizado_por, excecao_autorizado_em,
          rota, pack_anterior, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const inserirItem = this.db.prepare(
      `INSERT INTO context_item
         (pack_id, caminho, hash, origem, bytes, linha_de, linha_ate, motivo, ordem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const inserirPath = this.db.prepare(
      `INSERT INTO context_pack_path (pack_id, caminho, origem, justificativa, ordem)
       VALUES (?, ?, ?, ?, ?)`
    )

    this.db.transaction(() => {
      inserirPack.run(
        pack.id,
        pack.user_id,
        pack.workspace_id,
        // `?? null` e não o valor direto: o driver recusa `undefined` como parâmetro, e o campo
        // é opcional desde a E1. `null` na coluna é o que afirma "não há projeto".
        pack.projectId ?? null,
        pack.tarefa,
        JSON.stringify(pack.regras),
        JSON.stringify(pack.falhasAbertas),
        pack.resumoAnterior ?? null,
        pack.orcamento.etapa,
        pack.orcamento.unmetered ? 1 : 0,
        pack.orcamento.tetoDeTokens,
        pack.orcamento.tokensEstimados,
        pack.orcamento.estimadoUsd,
        pack.orcamento.motivoDaExpansao ?? null,
        pack.excecaoDeLeituraAmpla?.motivo ?? null,
        pack.excecaoDeLeituraAmpla?.tetoDeBytes ?? null,
        pack.excecaoDeLeituraAmpla?.autorizadoPor ?? null,
        pack.excecaoDeLeituraAmpla?.autorizadoEm ?? null,
        pack.rota,
        pack.packAnterior ?? null,
        pack.hash,
        pack.created_at
      )

      pack.itens.forEach((item, ordem) => {
        inserirItem.run(
          pack.id,
          item.caminho,
          item.hash,
          item.origem,
          item.bytes,
          item.linhas?.de ?? null,
          item.linhas?.ate ?? null,
          item.motivo,
          ordem
        )
      })

      pack.pathsPermitidos?.paths.forEach((caminho, ordem) => {
        inserirPath.run(
          pack.id,
          caminho,
          // A origem e a justificativa se repetem por linha porque pertencem à lista, não ao
          // path. Uma segunda tabela só para elas custaria um join em toda leitura de pack para
          // guardar dois campos que nunca divergem dentro da mesma lista.
          pack.pathsPermitidos?.origem ?? 'derivada',
          pack.pathsPermitidos?.justificativa ?? '',
          ordem
        )
      })
    })()

    return pack
  }

  /**
   * O pack com este hash canônico, se já existe.
   *
   * Existe porque `hash` é UNIQUE, e isso é uma **afirmação**: dois packs com o mesmo conteúdo
   * canônico *são* o mesmo pack. Remontar contexto idêntico não produz manifesto novo — produz
   * o mesmo manifesto — e é isso que torna verificável o invariante 2 do CONVENTION §4 (mesma
   * revisão aprovada não pede aceite novo). Sem esta consulta, o serviço bateria na constraint
   * e a igualdade viraria erro em vez de resposta.
   */
  findByHash(userId: string, hash: string): ContextPack | undefined {
    const row = this.db
      .prepare(`SELECT * FROM context_pack WHERE user_id = ? AND hash = ?`)
      .get(userId, hash) as PackRow | undefined

    return row === undefined ? undefined : this.montar(row)
  }

  /** O pack pelo id, com os itens na ordem em que foram enviados. */
  findById(userId: string, packId: string): ContextPack | undefined {
    const row = this.db
      .prepare(`SELECT * FROM context_pack WHERE user_id = ? AND id = ?`)
      .get(userId, packId) as PackRow | undefined

    return row === undefined ? undefined : this.montar(row)
  }

  /**
   * Os packs de um projeto, do mais recente ao mais antigo.
   *
   * O desempate é o **`rowid`**, não o `id`. `created_at` tem precisão de milissegundo, e dois
   * packs montados no mesmo milissegundo empatam — com `id DESC` o desempate cairia num UUID
   * aleatório, e a listagem devolveria uma ordem diferente a cada execução. Foi assim que um
   * teste desta suíte ficou intermitente: passava isolado e falhava na suíte completa, quando
   * a máquina estava rápida o bastante para os dois `INSERT` caírem no mesmo milissegundo.
   * `rowid` é a ordem de inserção, que é exatamente o que "mais recente" quer dizer aqui.
   */
  listByProject(userId: string, projectId: string, limite = 20): readonly ContextPack[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM context_pack
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`
      )
      .all(userId, projectId, limite) as readonly PackRow[]

    return rows.map((row) => this.montar(row))
  }

  private montar(row: PackRow): ContextPack {
    const itens = this.db
      .prepare(
        `SELECT caminho, hash, origem, bytes, linha_de, linha_ate, motivo
           FROM context_item WHERE pack_id = ? ORDER BY ordem`
      )
      .all(row.id) as readonly ItemRow[]

    const paths = this.db
      .prepare(
        `SELECT caminho, origem, justificativa
           FROM context_pack_path WHERE pack_id = ? ORDER BY ordem`
      )
      .all(row.id) as readonly PathRow[]

    return {
      id: row.id,
      user_id: row.user_id,
      workspace_id: row.workspace_id as WorkspaceId,
      // Omitido quando a coluna é `null`, e não `projectId: null`: o tipo diz `string |
      // undefined`, e uma chave presente com `null` faria `pack.projectId !== undefined` ser
      // verdade para um pack que não tem projeto — o oposto do que a leitura precisa dizer.
      ...(row.project_id === null ? {} : { projectId: row.project_id }),
      tarefa: row.tarefa,
      itens: itens.map(toItem),
      regras: lerLista(row.regras, 'regras'),
      falhasAbertas: lerFalhas(row.falhas),
      ...(row.resumo_anterior === null ? {} : { resumoAnterior: row.resumo_anterior }),
      orcamento: {
        etapa: row.etapa,
        unmetered: row.unmetered === 1,
        tetoDeTokens: row.teto_de_tokens,
        tokensEstimados: row.tokens_estimados,
        estimadoUsd: row.estimado_usd,
        ...(row.motivo_da_expansao === null ? {} : { motivoDaExpansao: row.motivo_da_expansao })
      },
      // Os quatro campos da exceção entram juntos ou não entram: uma exceção com motivo e sem
      // teto seria permissão permanente com aparência de exceção.
      ...(row.excecao_motivo === null ||
      row.excecao_teto_bytes === null ||
      row.excecao_autorizado_por === null ||
      row.excecao_autorizado_em === null
        ? {}
        : {
            excecaoDeLeituraAmpla: {
              motivo: row.excecao_motivo,
              tetoDeBytes: row.excecao_teto_bytes,
              autorizadoPor: row.excecao_autorizado_por,
              autorizadoEm: row.excecao_autorizado_em
            }
          }),
      rota: row.rota as AiProvider,
      ...(row.pack_anterior === null ? {} : { packAnterior: row.pack_anterior }),
      // Lista vazia é ausência, não escopo vazio: um pack fora de pipeline não tem run, e
      // `pathsPermitidos: { paths: [] }` afirmaria "nenhum arquivo autorizado" — o oposto de
      // "a pergunta não se aplica". O hash canônico trata os dois casos como a mesma string.
      ...(paths.length === 0
        ? {}
        : {
            pathsPermitidos: {
              origem: paths[0].origem as OrigemDePaths,
              paths: paths.map((p) => p.caminho),
              justificativa: paths[0].justificativa
            }
          }),
      hash: row.hash,
      created_at: row.created_at
    }
  }

  /** Todas as falhas de um projeto — abertas e resolvidas. Quem filtra é o domínio. */
  listFalhas(userId: string, projectId: string): readonly FalhaRegistrada[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM failure_fingerprint
          WHERE user_id = ? AND project_id = ?
          ORDER BY ultima_em DESC`
      )
      .all(userId, projectId) as readonly FalhaRow[]

    return rows.map(toFalha)
  }

  /**
   * Registra uma ocorrência de falha — **incrementa** quando o fingerprint já existe.
   *
   * O `ON CONFLICT ... DO UPDATE` é o critério 4 valendo no storage: a mesma falha relatada de
   * novo não vira segunda linha, ela soma no contador. Duas linhas fariam a falha reaparecer no
   * contexto como se fosse outra — que é exatamente o que o critério proíbe.
   *
   * **Reabrir é deliberado.** Uma falha marcada resolvida que volta a acontecer volta a
   * `resolvida = 0`: ela está acontecendo de novo, e omiti-la do contexto porque um dia foi
   * resolvida esconderia a regressão.
   */
  registrarFalha(falha: Omit<FalhaRegistrada, 'ocorrencias' | 'resolvida'>): FalhaRegistrada {
    this.db
      .prepare(
        `INSERT INTO failure_fingerprint
           (user_id, workspace_id, project_id, fingerprint, resumo, ocorrencias, resolvida,
            primeira_em, ultima_em)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
         ON CONFLICT (user_id, project_id, fingerprint) DO UPDATE SET
           ocorrencias = ocorrencias + 1,
           resolvida   = 0,
           resumo      = excluded.resumo,
           ultima_em   = excluded.ultima_em`
      )
      .run(
        falha.user_id,
        falha.workspace_id,
        falha.projectId,
        falha.fingerprint,
        falha.resumo,
        falha.primeiraEm,
        falha.ultimaEm
      )

    const row = this.db
      .prepare(
        `SELECT * FROM failure_fingerprint
          WHERE user_id = ? AND project_id = ? AND fingerprint = ?`
      )
      .get(falha.user_id, falha.projectId, falha.fingerprint) as FalhaRow

    return toFalha(row)
  }

  /**
   * Marca a falha como resolvida. Devolve `false` quando o fingerprint não existe — resolver o
   * que nunca foi registrado é no-op, não erro.
   */
  resolverFalha(userId: string, projectId: string, fingerprint: string): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE failure_fingerprint SET resolvida = 1
          WHERE user_id = ? AND project_id = ? AND fingerprint = ?`
      )
      .run(userId, projectId, fingerprint)

    return resultado.changes > 0
  }
}
