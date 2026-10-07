import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { load } from 'js-yaml'
import type { RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { SpecGerada } from '@shared/domain/roadmap-gerado'
import { NOME_DO_JOB_AGREGADO, VERSAO_DO_GERADOR } from '@shared/domain/ci-profile'
import { CAMINHO_DO_WORKFLOW } from '@shared/domain/ci-workflow'
import { decidirSobreWorkflow, type ManifestoDoWorkflow } from '@shared/domain/ci-workflow-adocao'
import { gerarWorkflowDoPerfil } from '@shared/domain/ci-profile-workflow'
import { lerMatrizDeProva, problemasDaMatrizDeProva } from '@shared/domain/ci-proof-matrix'
import { lerPerfilDeCiVersionado } from './ci-profile-revision'

export interface ProntidaoDeCi {
  readonly revisoes: readonly RevisaoAprovada[]
  readonly problemas: readonly { readonly mensagem: string; readonly acao: string }[]
}

function lerArquivo(raiz: string, caminho: string): { texto: string; hash: string } | undefined {
  try {
    const real = realpathSync(join(raiz, caminho))
    const relativo = relative(raiz, real)
    if (
      isAbsolute(relativo) ||
      relativo === '..' ||
      relativo.startsWith('..\\') ||
      relativo.startsWith('../')
    )
      return undefined
    const bytes = readFileSync(real)
    return { texto: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex') }
  } catch {
    return undefined
  }
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Parser real do YAML e verificação dos pontos estáveis exigidos pela E1. */
export function validarWorkflowGerado(workflow: string): readonly string[] {
  try {
    const raiz: unknown = load(workflow)
    if (!ehObjeto(raiz)) return ['O workflow YAML não é um objeto.']
    const gatilhos = raiz['on']
    const jobs = raiz['jobs']
    if (!ehObjeto(gatilhos) || !('pull_request' in gatilhos) || 'push' in gatilhos)
      return ['O workflow deve executar em pull_request, sem gatilho push.']
    if (!ehObjeto(jobs) || !ehObjeto(jobs[NOME_DO_JOB_AGREGADO]))
      return [`O workflow não declara o contexto agregado ${NOME_DO_JOB_AGREGADO}.`]
    return []
  } catch {
    return ['O workflow gerado não é YAML válido.']
  }
}

/** Sem efeito remoto: todos os artefatos que o PI aceita são lidos dos bytes atuais do pacote. */
export function verificarProntidaoDeCi(
  diretorio: string,
  specSlug: string,
  spec: SpecGerada
): ProntidaoDeCi {
  const problemas: { mensagem: string; acao: string }[] = []
  const revisoes: RevisaoAprovada[] = []
  let raiz: string
  try {
    raiz = realpathSync(diretorio)
  } catch {
    return {
      revisoes: [],
      problemas: [
        {
          mensagem: 'O diretório do projeto não está disponível.',
          acao: 'Restaurar o projeto local.'
        }
      ]
    }
  }

  const perfil = lerPerfilDeCiVersionado(raiz)
  if (perfil === undefined)
    problemas.push({
      mensagem: 'ci-profile.json não existe ou é inválido.',
      acao: 'Escolher a stack no app ou corrigir o perfil do pacote.'
    })
  else revisoes.push({ artefato: 'ci-profile.json', hash: perfil.hash })

  const specArquivo = lerArquivo(raiz, specSlug)
  if (specArquivo === undefined)
    problemas.push({
      mensagem: 'A SPEC versionada da fatia não está disponível.',
      acao: 'Gerar e versionar a SPEC antes do aceite.'
    })
  else {
    revisoes.push({ artefato: specSlug, hash: specArquivo.hash })
    const matriz = lerMatrizDeProva(specArquivo.texto)
    if (matriz === undefined)
      problemas.push({
        mensagem: 'A SPEC não contém uma matriz de prova estruturada válida.',
        acao: 'Preencher a seção Matriz de prova da SPEC.'
      })
    else if (perfil !== undefined)
      for (const mensagem of problemasDaMatrizDeProva(
        spec.criteriosDeAceite,
        perfil.perfil,
        matriz
      ))
        problemas.push({ mensagem, acao: 'Corrigir a matriz de prova da SPEC.' })
  }

  for (const caminho of ['docs/TESTING.md', 'docs/REVIEW.md']) {
    const documento = lerArquivo(raiz, caminho)
    if (documento === undefined)
      problemas.push({
        mensagem: `${caminho} não existe no pacote.`,
        acao: `Gerar e versionar ${caminho}.`
      })
    else revisoes.push({ artefato: caminho, hash: documento.hash })
  }

  if (perfil !== undefined) {
    try {
      const workflow = gerarWorkflowDoPerfil(perfil.perfil)
      if (workflow !== gerarWorkflowDoPerfil(perfil.perfil))
        problemas.push({
          mensagem: 'O workflow gerado não é determinístico.',
          acao: 'Corrigir o gerador de workflow.'
        })
      for (const mensagem of validarWorkflowGerado(workflow))
        problemas.push({ mensagem, acao: 'Corrigir o perfil ou o gerador de workflow.' })

      const workflowAtual = lerArquivo(raiz, CAMINHO_DO_WORKFLOW)
      if (workflowAtual !== undefined) {
        const manifestoArquivo = lerArquivo(raiz, '.github/ci-workflow-manifesto.json')
        let manifesto: ManifestoDoWorkflow | undefined
        if (manifestoArquivo !== undefined) {
          try {
            const valor: unknown = JSON.parse(manifestoArquivo.texto)
            if (
              ehObjeto(valor) &&
              typeof valor.profileId === 'string' &&
              typeof valor.hashDoPerfil === 'string' &&
              typeof valor.hashDoConteudo === 'string' &&
              typeof valor.versaoDoGerador === 'number'
            )
              manifesto = valor as unknown as ManifestoDoWorkflow
          } catch {
            // Manifesto ilegível é procedência desconhecida; decidirSobreWorkflow falha fechado.
          }
        }
        const decisao = decidirSobreWorkflow({
          conteudoAtual: workflowAtual.texto,
          hashAtual: workflowAtual.hash,
          conteudoDesejado: workflow,
          hashDesejado: createHash('sha256').update(workflow).digest('hex'),
          hashDoPerfil: createHash('sha256').update(JSON.stringify(perfil.perfil)).digest('hex'),
          profileId: perfil.perfil.profileId,
          versaoDoGerador: VERSAO_DO_GERADOR,
          ...(manifesto === undefined ? {} : { manifesto })
        })
        if (decisao.acao === 'propor-adocao')
          problemas.push({
            mensagem: decisao.mensagem,
            acao: 'Revise e adote o workflow no pacote antes do aceite da fatia.'
          })
      }
    } catch {
      problemas.push({
        mensagem: 'O workflow não pôde ser gerado a partir do perfil.',
        acao: 'Corrigir o perfil e suas dependências.'
      })
    }
  }

  return { revisoes: problemas.length === 0 ? revisoes : [], problemas }
}
