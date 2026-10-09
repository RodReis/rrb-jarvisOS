import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ServiceProfile } from './adapters/local-compose-adapter'
import type { PreparationProject } from './release-preparation-service'

/**
 * Perfil do projeto (JSON) que alimenta o template único do Compose: contexto de build, portas,
 * migrations, seed e onde publicar. Caminhos relativos valem a partir do arquivo do perfil.
 * Só descreve **onde estão** as coisas — nenhum valor de chave mora aqui.
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

function servico(valor: unknown, nome: string, base: string): ServiceProfile {
  const bruto = objeto(valor, nome)
  const healthPath = texto(bruto.healthPath, `${nome}.healthPath`)
  if (!healthPath.startsWith('/')) throw new TypeError(`"${nome}.healthPath" deve começar com "/".`)
  return {
    context: resolve(base, texto(bruto.context, `${nome}.context`)),
    ...(bruto.dockerfile ? { dockerfile: texto(bruto.dockerfile, `${nome}.dockerfile`) } : {}),
    containerPort: porta(bruto.containerPort, `${nome}.containerPort`),
    healthPath,
    preferredPort: porta(bruto.preferredPort, `${nome}.preferredPort`)
  }
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
    migrationsDir: resolve(base, texto(bruto.migrationsDir, 'migrationsDir')),
    ...(bruto.seedFile ? { seedFile: resolve(base, texto(bruto.seedFile, 'seedFile')) } : {}),
    envExampleFile: resolve(base, texto(bruto.envExampleFile, 'envExampleFile')),
    envLocalFile: resolve(base, texto(bruto.envLocalFile, 'envLocalFile')),
    repository,
    contextDir: backend.context,
    sourceSha
  }
}
