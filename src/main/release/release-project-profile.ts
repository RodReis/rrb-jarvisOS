import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ServiceProfile } from './adapters/local-compose-adapter'
import type { PreparationProject } from './release-preparation-service'

/**
 * Perfil do projeto (JSON) que alimenta o template único do Compose: contexto de build, portas,
 * migrations, seed e onde publicar. Caminhos relativos valem a partir do arquivo do perfil e
 * **não podem sair da pasta dele**: um perfil de projeto não confiável não escolhe ler `~/.ssh`
 * nem enviar um diretório qualquer ao registry. Nenhum valor de chave mora aqui.
 */

type Bruto = Record<string, unknown>

function objeto(valor: unknown, nome: string): Bruto {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor))
    throw new TypeError(`O perfil exige o objeto "${nome}".`)
  return valor as Bruto
}

function texto(valor: unknown, nome: string): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new TypeError(`O perfil exige "${nome}".`)
  return valor
}

function porta(valor: unknown, nome: string): number {
  if (!Number.isInteger(valor) || (valor as number) < 1 || (valor as number) > 65_535)
    throw new TypeError(`"${nome}" deve ser uma porta de 1 a 65535.`)
  return valor as number
}

/** Resolve a partir da pasta do perfil e recusa o que escapa dela (`..`, absoluto em outra raiz). */
function caminhoDoProjeto(base: string, valor: unknown, nome: string): string {
  const alvo = resolve(base, texto(valor, nome))
  const rel = relative(base, alvo)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new TypeError(`"${nome}" deve ficar dentro da pasta do perfil.`)
  return alvo
}

function servico(valor: unknown, nome: string, base: string): ServiceProfile {
  const bruto = objeto(valor, nome)
  const healthPath = texto(bruto.healthPath, `${nome}.healthPath`)
  if (!healthPath.startsWith('/')) throw new TypeError(`"${nome}.healthPath" deve começar com "/".`)
  return {
    context: caminhoDoProjeto(base, bruto.context, `${nome}.context`),
    ...(bruto.dockerfile ? { dockerfile: texto(bruto.dockerfile, `${nome}.dockerfile`) } : {}),
    containerPort: porta(bruto.containerPort, `${nome}.containerPort`),
    healthPath,
    preferredPort: porta(bruto.preferredPort, `${nome}.preferredPort`)
  }
}

/**
 * O destino da publicação é decisão do operador (registry e, de preferência, dono), nunca só do
 * arquivo do projeto: o `docker login` do operador é quem autoriza a escrita.
 */
export function assertRepositorioPermitido(
  repository: string,
  registry: string,
  namespace?: string
): void {
  const prefixo = namespace ? `${registry}/${namespace}/` : `${registry}/`
  if (!repository.startsWith(prefixo))
    throw new TypeError(`O repositório do perfil deve começar com ${prefixo}`)
}

export function carregarPerfilDoProjeto(arquivo: string, sourceSha: string): PreparationProject {
  let bruto: Bruto
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8')) as Bruto
  } catch {
    throw new TypeError('O perfil do projeto não é um JSON válido.')
  }
  const base = dirname(resolve(arquivo))
  const repository = texto(bruto.repository, 'repository')
  // O primeiro segmento é o host (pode levar `:porta`); o resto é o caminho, sem tag nem digest.
  if (/[:@]/.test(repository.slice(repository.indexOf('/') + 1)))
    throw new TypeError('O repositório não leva tag nem digest: o digest nasce da publicação.')
  const backend = servico(bruto.backend, 'backend', base)
  return {
    profile: {
      backend,
      frontend: servico(bruto.frontend, 'frontend', base),
      postgresPreferredPort: porta(bruto.postgresPreferredPort, 'postgresPreferredPort')
    },
    migrationsDir: caminhoDoProjeto(base, bruto.migrationsDir, 'migrationsDir'),
    ...(bruto.seedFile ? { seedFile: caminhoDoProjeto(base, bruto.seedFile, 'seedFile') } : {}),
    envExampleFile: caminhoDoProjeto(base, bruto.envExampleFile, 'envExampleFile'),
    envLocalFile: caminhoDoProjeto(base, bruto.envLocalFile, 'envLocalFile'),
    repository,
    contextDir: backend.context,
    sourceSha
  }
}
