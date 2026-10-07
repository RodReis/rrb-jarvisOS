import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { SpecGerada } from '@shared/domain/roadmap-gerado'
import { NOME_DO_JOB_AGREGADO } from '@shared/domain/ci-profile'
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
      if (
        workflow !== gerarWorkflowDoPerfil(perfil.perfil) ||
        !workflow.includes('  pull_request:') ||
        /^\x20{2}push:/m.test(workflow) ||
        !workflow.includes(`  ${NOME_DO_JOB_AGREGADO}:`)
      )
        problemas.push({
          mensagem:
            'O workflow gerado não preserva determinismo, gatilho único e contexto obrigatório.',
          acao: 'Corrigir o perfil ou o gerador de workflow.'
        })
    } catch {
      problemas.push({
        mensagem: 'O workflow não pôde ser gerado a partir do perfil.',
        acao: 'Corrigir o perfil e suas dependências.'
      })
    }
  }

  return { revisoes: problemas.length === 0 ? revisoes : [], problemas }
}
