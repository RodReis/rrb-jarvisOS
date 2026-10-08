/** Consolida somente commits do kernel de escritores concluídos. */
import type { ProducaoDoTrabalho } from './squad-ciclo'
import type { ResultadoDoSquad } from './squad-executor'
import type { EscritorIntegrado, ResultadoDaIntegracao } from './squad-integrador'

export async function consolidarProducao(
  resultado: ResultadoDoSquad,
  escritoresEsperados: 1 | 2,
  integrar: (escritores: readonly EscritorIntegrado[]) => Promise<ResultadoDaIntegracao>
): Promise<ProducaoDoTrabalho> {
  if (resultado.estado !== 'concluido') {
    return { estado: 'parado', motivo: 'o plano do Squad não concluiu todas as tarefas' }
  }
  const commits = new Map<string, string>()
  for (const tarefa of resultado.tarefas) {
    const execucao = tarefa.execucao
    if (
      tarefa.papel === 'desenvolvedor' &&
      execucao !== undefined &&
      'commitSha' in execucao &&
      typeof execucao.commitSha === 'string' &&
      'escritor' in execucao &&
      typeof execucao.escritor === 'string'
    ) {
      commits.set(execucao.escritor, execucao.commitSha)
    }
  }
  if (commits.size !== escritoresEsperados) {
    return { estado: 'parado', motivo: 'faltou commit de um escritor do Squad' }
  }
  if (commits.size === 1) {
    return { estado: 'pronto', commitSha: [...commits.values()][0]!, manifesto: '' }
  }
  const integrado = await integrar(
    [...commits].map(([escritor, commitSha]) => ({ escritor, commitSha }))
  )
  return integrado.estado === 'integrado'
    ? { estado: 'pronto', commitSha: integrado.commitSha, manifesto: integrado.manifestoTexto }
    : { estado: 'parado', motivo: `integracao-${integrado.motivo}` }
}
