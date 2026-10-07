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
import type { SpecGerada } from '@shared/domain/roadmap-gerado'
import {
  validarPerfilDeCi,
  type ResultadoDaSelecaoDeStack,
  type RuntimeDoPerfil
} from '@shared/domain/ci-profile'
import { perfilNodeEmWindows, perfilPythonEmWindows } from '@shared/domain/ci-profile-perfis'
import {
  escreverMatrizDeProva,
  ehMatrizDeProva,
  lerMatrizDeProva,
  type EstadoDaMatrizDeProva,
  type MatrizDeProva
} from '@shared/domain/ci-proof-matrix'
import type { ProjectRepository } from './project-repository'
import { lerPerfilDeCiVersionado } from './ci-profile-revision'

export interface SpecAtualDoProjeto {
  readonly specSlug: string
  readonly spec: SpecGerada
}

/** O PI escolhe a stack; o planejamento não a deduz dos arquivos ou do projeto JarvisOS. */
export class CiProfileSetupService {
  constructor(
    private readonly projects: Pick<ProjectRepository, 'findById'>,
    private readonly userId: () => string,
    private readonly specAtual?: (
      projectId: string,
      workspaceId: WorkspaceId
    ) => SpecAtualDoProjeto | undefined
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

  estadoDaMatriz(projectId: string, workspaceId: WorkspaceId): EstadoDaMatrizDeProva {
    const specAtual = this.specAtual?.(projectId, workspaceId)
    const projeto = this.projects.findById(this.userId(), projectId)
    const perfil = projeto === undefined ? undefined : lerPerfilDeCiVersionado(projeto.diretorio)
    if (
      projeto === undefined ||
      projeto.workspace_id !== workspaceId ||
      specAtual === undefined ||
      perfil === undefined
    )
      return {
        ok: false,
        mensagem: 'Gere a SPEC e escolha a stack antes de preparar a matriz.',
        criterios: [],
        validacoes: []
      }

    try {
      const raiz = realpathSync(projeto.diretorio)
      const arquivo = realpathSync(join(raiz, specAtual.specSlug))
      const relativo = relative(raiz, arquivo)
      if (
        isAbsolute(relativo) ||
        relativo === '..' ||
        relativo.startsWith('..\\') ||
        relativo.startsWith('../')
      )
        throw new Error('SPEC fora do projeto')
      const texto = readFileSync(arquivo, 'utf8')
      const matriz = lerMatrizDeProva(texto)
      return {
        ok: true,
        mensagem:
          matriz === undefined
            ? 'Matriz pendente de classificação pelo PI.'
            : 'Matriz carregada para revisão.',
        criterios: specAtual.spec.criteriosDeAceite,
        validacoes: perfil.perfil.validacoes.map(({ id, nome }) => ({ id, nome })),
        ...(matriz === undefined ? {} : { matriz })
      }
    } catch {
      return {
        ok: false,
        mensagem: 'A SPEC versionada não está disponível para editar a matriz.',
        criterios: [],
        validacoes: []
      }
    }
  }

  salvarMatriz(
    projectId: string,
    workspaceId: WorkspaceId,
    entrada: unknown
  ): EstadoDaMatrizDeProva {
    const estado = this.estadoDaMatriz(projectId, workspaceId)
    if (!estado.ok) return estado
    if (!ehMatrizDeProva(entrada))
      return { ...estado, ok: false, mensagem: 'A matriz enviada tem estrutura inválida.' }
    const matriz: MatrizDeProva = entrada
    const projeto = this.projects.findById(this.userId(), projectId)
    const specAtual = this.specAtual?.(projectId, workspaceId)
    if (projeto === undefined || specAtual === undefined)
      return { ...estado, ok: false, mensagem: 'A SPEC atual mudou; recarregue antes de salvar.' }

    try {
      const raiz = realpathSync(projeto.diretorio)
      const arquivo = realpathSync(join(raiz, specAtual.specSlug))
      const relativo = relative(raiz, arquivo)
      if (
        isAbsolute(relativo) ||
        relativo === '..' ||
        relativo.startsWith('..\\') ||
        relativo.startsWith('../')
      )
        throw new Error('SPEC fora do projeto')
      const conteudo = readFileSync(arquivo, 'utf8')
      const secao = escreverMatrizDeProva(matriz)
      const inicio = conteudo.search(/^## Matriz de prova\s*$/m)
      let atualizado: string
      if (inicio < 0) {
        atualizado = `${conteudo.trimEnd()}\n\n${secao}`
      } else {
        const seguinte = conteudo.slice(inicio + 1).search(/^##\s/m)
        const fim = seguinte < 0 ? conteudo.length : inicio + 1 + seguinte
        atualizado = `${conteudo.slice(0, inicio)}${secao}${conteudo.slice(fim)}`
      }
      const temporario = join(raiz, `.spec-matriz-${randomUUID()}.tmp`)
      try {
        writeFileSync(temporario, atualizado, { flag: 'wx' })
        renameSync(temporario, arquivo)
      } finally {
        if (existsSync(temporario)) unlinkSync(temporario)
      }
      return this.estadoDaMatriz(projectId, workspaceId)
    } catch {
      return { ...estado, ok: false, mensagem: 'Não foi possível salvar a matriz na SPEC.' }
    }
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
        const perfilNode = perfilNodeEmWindows(projectId)
        const perfilPython = perfilPythonEmWindows(projectId)
        const pertenceAoGerador =
          anterior !== undefined &&
          anterior.perfil.profileId === projectId &&
          (JSON.stringify(anterior.perfil) === JSON.stringify(perfilNode) ||
            JSON.stringify(anterior.perfil) === JSON.stringify(perfilPython))
        if (!pertenceAoGerador)
          return {
            ok: false,
            mensagem: 'O pacote já contém um perfil próprio; revise-o sem sobrescrita automática.'
          }
        if (anterior.perfil.runtime === runtime)
          return { ok: true, runtime, mensagem: 'O perfil escolhido já está presente.' }
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
