import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { validarPerfilDeCi, type PerfilDeCi } from '@shared/domain/ci-profile'

export interface PerfilDeCiVersionado {
  readonly perfil: PerfilDeCi
  readonly hash: string
}

/** Lê o mesmo arquivo apresentado ao PI, sem aceitar symlink para fora do projeto. */
export function lerPerfilDeCiVersionado(raiz: string): PerfilDeCiVersionado | undefined {
  try {
    const raizReal = realpathSync(raiz)
    const caminho = realpathSync(join(raizReal, 'ci-profile.json'))
    const relativo = relative(raizReal, caminho)
    if (isAbsolute(relativo) || relativo.startsWith('..')) return undefined
    const conteudo = readFileSync(caminho)
    const valor: unknown = JSON.parse(conteudo.toString('utf8'))
    if (typeof valor !== 'object' || valor === null) return undefined
    const perfil = valor as PerfilDeCi
    if (validarPerfilDeCi(perfil).length > 0) return undefined
    return { perfil, hash: createHash('sha256').update(conteudo).digest('hex') }
  } catch {
    return undefined
  }
}
