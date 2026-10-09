import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/**
 * `docker buildx build --push` envia o contexto inteiro a um registry. Arquivo de ambiente dentro
 * do contexto, sem exclusão no `.dockerignore`, é um segredo que um `COPY . .` leva para a imagem
 * publicada. A preparação bloqueia antes do build (revisão de segurança, SPEC-Release-02).
 */

const EXEMPLO = '.env.example'

function globParaRegex(padrao: string): RegExp {
  const base = padrao.replace(/^\/+/, '').replace(/\/+$/, '')
  const fonte = base
    .split('**')
    .map((parte) =>
      parte
        .split('*')
        .map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '[^/]'))
        .join('[^/]*')
    )
    .join('.*')
  return new RegExp(`^${fonte}$`)
}

/** Aplica as linhas do `.dockerignore` em ordem; `!` reabre. */
function excluidoPeloDockerignore(contexto: string, caminhoRelativo: string): boolean {
  const arquivo = join(contexto, '.dockerignore')
  if (!existsSync(arquivo)) return false
  let excluido = false
  for (const bruta of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha || linha.startsWith('#')) continue
    const negacao = linha.startsWith('!')
    if (globParaRegex(negacao ? linha.slice(1) : linha).test(caminhoRelativo)) excluido = !negacao
  }
  return excluido
}

/** Caminhos (relativos ao contexto, com `/`) de arquivos de ambiente que iriam na imagem. */
export function segredosNoContexto(contexto: string, arquivoDeAmbiente?: string): string[] {
  const candidatos = new Set<string>()
  for (const nome of readdirSync(contexto)) {
    if (nome !== EXEMPLO && /^\.env(\..+)?$/.test(nome)) candidatos.add(nome)
  }
  if (arquivoDeAmbiente) {
    const rel = relative(contexto, arquivoDeAmbiente)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep).pop() !== EXEMPLO)
      candidatos.add(rel.split(sep).join('/'))
  }
  return [...candidatos].filter((c) => !excluidoPeloDockerignore(contexto, c))
}
