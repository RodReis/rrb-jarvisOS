/**
 * Quando um anexo pesado pode sair (SPEC-Entrega-06, critério 9).
 *
 * A pergunta que este arquivo responde: **destes artefatos, quais podem ser apagados agora sem
 * destruir evidência que alguém ainda vai precisar?**
 *
 * **O que sai é o anexo, nunca a prova.** Metadados, hashes, auditoria e relatórios versionados
 * permanecem — a spec é explícita. Por isso a função devolve os itens elegíveis em vez de apagar:
 * quem marca a referência como expirada no mesmo passo é o serviço, e essa ordem é o que impede
 * uma referência versionada apontar para conteúdo que ela afirme estar presente.
 *
 * **Proteção vence cota, e o protegido sai da conta.** Um run não resolvido pode sozinho passar
 * dos 5 GB. Se ele contasse para a cota, o coletor tentaria caber apagando tudo o mais — e
 * apagaria artefato recente e legítimo por causa de um vizinho que ele nem pode tocar. A cota
 * governa o que já acabou; o que ainda está vivo não entra na conta nem na fila de remoção.
 *
 * **O que este arquivo não faz:** não toca o disco, não lê banco, não conhece o layout dos
 * anexos. Ele decide *o que* é elegível; quem apaga mora em `retencao-service.ts`.
 */

import type { EstadoDoRun } from './pipeline'
import { ehTerminal } from './pipeline'

/** A janela de retenção fixada pela spec. */
export const RETENCAO_DIAS = 30

/** A cota global de anexos, também fixada pela spec: 5 GB. */
export const COTA_BYTES = 5 * 1024 ** 3

export interface ArtefatoRetido {
  readonly id: string
  readonly runId: string
  readonly hash: string
  readonly bytes: number
  readonly criadoEm: string
  /** Fixado pelo usuário: nunca expira, por mais velho que fique. */
  readonly fixado: boolean
  readonly estadoDoRun: EstadoDoRun
}

/**
 * O artefato está protegido?
 *
 * `AWAITING_MERGE` e `BLOCKED` são terminais na máquina de estados, mas **pendentes** para a
 * retenção: no primeiro o PI ainda vai olhar aquele PR, e o anexo é o que ele lê; no segundo o
 * anexo é a evidência da causa do bloqueio. Expirar qualquer um dos dois apagaria exatamente o
 * material de quem ainda tem uma decisão a tomar.
 */
function protegido(item: ArtefatoRetido): boolean {
  if (item.fixado) return true
  if (!ehTerminal(item.estadoDoRun)) return true
  return item.estadoDoRun === 'AWAITING_MERGE' || item.estadoDoRun === 'BLOCKED'
}

/**
 * Os artefatos que podem sair agora, do mais antigo para o mais novo.
 *
 * Duas causas independentes: idade acima de `RETENCAO_DIAS`, e cota acima de `COTA_BYTES`. A
 * segunda remove **primeiro o elegível mais antigo**, como a spec manda, e para assim que couber.
 */
export function elegiveisParaExpirar(
  itens: readonly ArtefatoRetido[],
  agoraMs: number
): readonly ArtefatoRetido[] {
  const candidatos = itens
    .filter((item) => !protegido(item))
    .slice()
    .sort((a, b) => Date.parse(a.criadoEm) - Date.parse(b.criadoEm))

  const limiteDeIdade = agoraMs - RETENCAO_DIAS * 24 * 60 * 60 * 1000
  const saem = new Set(
    candidatos.filter((item) => Date.parse(item.criadoEm) < limiteDeIdade).map((item) => item.id)
  )

  // A cota mede só o que é removível: o protegido ocupa disco de verdade, mas incluí-lo aqui
  // faria um único run travado condenar todo o resto — remoção em cascata por culpa alheia.
  let ocupado = candidatos
    .filter((item) => !saem.has(item.id))
    .reduce((total, item) => total + item.bytes, 0)

  for (const candidato of candidatos) {
    if (ocupado <= COTA_BYTES) break
    if (saem.has(candidato.id)) continue
    saem.add(candidato.id)
    ocupado -= candidato.bytes
  }

  return candidatos.filter((item) => saem.has(item.id))
}
