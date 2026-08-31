/**
 * Os verificadores de container e porta para a reconciliação (SPEC-Entrega-03, critério 4).
 *
 * A M9-F02 deixou o ponto de extensão pronto — `VerificadorDeRecurso`, casado por prefixo do
 * recurso — e declarou que a M9-F03 registraria os dela **sem tocar** o serviço. É o que este
 * arquivo faz: nada aqui edita a reconciliação; ela apenas passa a receber mais dois
 * verificadores.
 *
 * ## Por que a pergunta é "ainda está em uso", e não "o dono morreu"
 *
 * Um lease expirado significa que o heartbeat parou — máquina lenta e processo morto produzem
 * o mesmo sintoma. O que desempata é o **recurso**: se o container ainda está de pé, alguém
 * pode estar trabalhando nele, e derrubar o lease criaria dois executores sobre o mesmo
 * worktree. Por isso `emUso` devolvendo `true` mantém o lease, e a decisão de bloquear é da
 * reconciliação, não daqui.
 *
 * **Fail closed na dúvida:** se o Docker não responde, respondemos `true` (em uso). Dizer "não
 * está em uso" porque não conseguimos perguntar seria transformar ignorância em permissão para
 * reatribuir — exatamente o roubo que o critério 3 da M9-F02 proíbe.
 */

import { RECURSO_CONTAINER, RECURSO_PORTA } from '@shared/domain/preflight'
import type { VerificadorDeRecurso } from './reconciliacao-service'
import type { DockerRunner } from './docker-runner'

/**
 * O container do lease ainda existe?
 *
 * O nome do container **é** o sufixo do recurso (`container:<runId>` ↔ `jarvisos-run-<runId>`),
 * então não há mapa a manter: quem renomear um dos dois quebra o outro no mesmo commit.
 */
export function verificadorDeContainer(
  docker: DockerRunner,
  cwd: () => string
): VerificadorDeRecurso {
  return {
    prefixo: RECURSO_CONTAINER,
    emUso: (lease) => {
      const runId = lease.recurso.slice(RECURSO_CONTAINER.length)
      try {
        return docker.containerExiste(`jarvisos-run-${runId}`, cwd())
      } catch {
        // Não conseguimos perguntar. "Em uso" é a resposta segura — ver o cabeçalho.
        return true
      }
    }
  }
}

/** A porta do lease ainda está publicada por algum container? */
export function verificadorDePorta(docker: DockerRunner, cwd: () => string): VerificadorDeRecurso {
  return {
    prefixo: RECURSO_PORTA,
    emUso: (lease) => {
      const porta = Number(lease.recurso.slice(RECURSO_PORTA.length))
      if (!Number.isInteger(porta)) return true
      try {
        return docker.portaOcupadaPorContainer(porta, cwd())
      } catch {
        return true
      }
    }
  }
}
