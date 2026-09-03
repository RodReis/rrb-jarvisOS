/**
 * O coletor que expira anexos pesados (SPEC-Entrega-06, critério 9).
 *
 * A pergunta que este arquivo responde: **quais anexos podem sair do disco agora, e como
 * removê-los sem que alguma referência passe a mentir?**
 *
 * **Marca antes de apagar, e essa ordem é a garantia.** Marcada e não apagada, a linha diz que o
 * anexo saiu e ele ainda está lá — desperdício de disco, nada mais. Apagada e não marcada, a
 * referência versionada afirma que o conteúdo está presente quando ele já sumiu, que é
 * literalmente o que o critério 9 proíbe. Entre os dois modos de falhar, só um destrói evidência.
 *
 * **A falha de remoção não interrompe a coleta.** Um arquivo travado pelo antivírus não pode
 * impedir os outros de expirarem; ele fica registrado no log e a linha segue marcada — na volta
 * seguinte, `listarArtefatos` já não o oferece, porque o que sobrou é lixo de disco, não prova.
 *
 * **O que este arquivo não faz:** não decide o que é elegível (isso é `retencao.ts`) e não conhece
 * o layout do diretório de anexos — `caminhoDoAnexo` entra por injeção.
 */

import { rmSync } from 'node:fs'
import { elegiveisParaExpirar } from '@shared/domain/retencao'
import type { ArtefatoRetido } from '@shared/domain/retencao'
import { log } from '../logging/logger'
import type { ExecutionLedgerRepository } from './execution-ledger-repository'

export interface RetencaoDeps {
  readonly ledger: ExecutionLedgerRepository
  /** Onde mora o anexo daquele artefato. O layout é do main, não do coletor. */
  readonly caminhoDoAnexo: (item: ArtefatoRetido) => string
  readonly agora?: () => number
}

export class RetencaoService {
  private readonly agora: () => number

  constructor(private readonly deps: RetencaoDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /** Expira o que puder e devolve o que saiu. Síncrona: tudo aqui é disco e SQLite síncronos. */
  coletar(userId: string): readonly ArtefatoRetido[] {
    const agoraMs = this.agora()
    const elegiveis = elegiveisParaExpirar(this.deps.ledger.listarArtefatos(userId), agoraMs)
    if (elegiveis.length === 0) return []

    const quando = new Date(agoraMs).toISOString()

    for (const item of elegiveis) {
      this.deps.ledger.marcarExpirado(userId, item.id, quando)

      try {
        rmSync(this.deps.caminhoDoAnexo(item), { force: true })
      } catch (erro) {
        log.sistema.warn('Anexo expirado não pôde ser apagado do disco', {
          artefato: item.id,
          motivo: erro instanceof Error ? erro.message : 'desconhecido'
        })
      }
    }

    log.sistema.info('Retenção expirou anexos', { quantidade: elegiveis.length })

    return elegiveis
  }
}
