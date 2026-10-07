import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  validarPerfilDeCi,
  type ResultadoDaSelecaoDeStack,
  type RuntimeDoPerfil
} from '@shared/domain/ci-profile'
import { perfilNodeEmWindows, perfilPythonEmWindows } from '@shared/domain/ci-profile-perfis'
import type { ProjectRepository } from './project-repository'
import { lerPerfilDeCiVersionado } from './ci-profile-revision'

/** O PI escolhe a stack; o planejamento não a deduz dos arquivos ou do projeto JarvisOS. */
export class CiProfileSetupService {
  constructor(
    private readonly projects: Pick<ProjectRepository, 'findById'>,
    private readonly userId: () => string
  ) {}

  estado(projectId: string, workspaceId: WorkspaceId): ResultadoDaSelecaoDeStack {
    const projeto = this.projects.findById(this.userId(), projectId)
    if (projeto === undefined || projeto.workspace_id !== workspaceId)
      return { ok: false, mensagem: 'Projeto não encontrado neste espaço.' }
    const lido = lerPerfilDeCiVersionado(projeto.diretorio)
    return lido === undefined
      ? { ok: false, mensagem: 'Escolha a stack de CI antes do aceite da fatia.' }
      : { ok: true, runtime: lido.perfil.runtime, mensagem: 'Perfil de CI presente no pacote.' }
  }

  selecionar(
    projectId: string,
    workspaceId: WorkspaceId,
    runtime: RuntimeDoPerfil
  ): ResultadoDaSelecaoDeStack {
    if (runtime !== 'node' && runtime !== 'python')
      return { ok: false, mensagem: 'Stack de CI não suportada.' }
    const projeto = this.projects.findById(this.userId(), projectId)
    if (projeto === undefined || projeto.workspace_id !== workspaceId)
      return { ok: false, mensagem: 'Projeto não encontrado neste espaço.' }

    try {
      const raiz = realpathSync(projeto.diretorio)
      const dentro = (caminho: string): boolean => {
        if (!existsSync(caminho)) return false
        const relativo = relative(raiz, realpathSync(caminho))
        return (
          !isAbsolute(relativo) &&
          relativo !== '..' &&
          !relativo.startsWith(`..\\`) &&
          !relativo.startsWith('../')
        )
      }
      for (const arquivo of ['docs/TESTING.md', 'docs/REVIEW.md']) {
        const caminho = join(raiz, arquivo)
        if (!dentro(caminho))
          return { ok: false, mensagem: `${arquivo} precisa existir no projeto antes do perfil.` }
      }

      if (runtime === 'node') {
        if (!dentro(join(raiz, 'package.json')) || !dentro(join(raiz, 'package-lock.json')))
          return {
            ok: false,
            mensagem: 'O pacote Node precisa de package.json e package-lock.json.'
          }
        const pacote = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as {
          scripts?: Record<string, string>
        }
        const faltantes = ['lint', 'typecheck', 'test', 'build'].filter(
          (script) => !pacote.scripts?.[script]
        )
        if (faltantes.length > 0)
          return {
            ok: false,
            mensagem: `O pacote Node precisa de scripts lint, typecheck, test e build. Faltam: ${faltantes.join(', ')}.`
          }
      } else if (!dentro(join(raiz, 'requirements.txt'))) {
        return { ok: false, mensagem: 'O pacote Python precisa de requirements.txt.' }
      }

      const perfil =
        runtime === 'node' ? perfilNodeEmWindows(projectId) : perfilPythonEmWindows(projectId)
      if (validarPerfilDeCi(perfil).length > 0)
        return { ok: false, mensagem: 'O perfil gerado não passou na validação.' }

      const alvo = join(raiz, 'ci-profile.json')
      if (existsSync(alvo)) {
        if (lstatSync(alvo).isSymbolicLink())
          return { ok: false, mensagem: 'ci-profile.json é um link simbólico.' }
        const anterior = lerPerfilDeCiVersionado(raiz)
        if (anterior === undefined || anterior.perfil.profileId !== projectId)
          return {
            ok: false,
            mensagem: 'O pacote já contém um perfil próprio; revise-o sem sobrescrita automática.'
          }
      }

      const temporario = join(raiz, `.ci-profile-${randomUUID()}.tmp`)
      try {
        writeFileSync(temporario, `${JSON.stringify(perfil, null, 2)}\n`, { flag: 'wx' })
        renameSync(temporario, alvo)
      } finally {
        if (existsSync(temporario)) unlinkSync(temporario)
      }
      return {
        ok: true,
        runtime,
        mensagem: 'Perfil gerado. Revise a matriz de prova antes do aceite.'
      }
    } catch {
      return { ok: false, mensagem: 'Não foi possível gerar o perfil de CI neste projeto.' }
    }
  }
}
