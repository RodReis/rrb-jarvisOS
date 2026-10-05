/** Lê somente a fonte local previamente escolhida no diálogo do main. */
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { ConfiguracaoDasBoasVindas } from '@shared/domain/boas-vindas'

const TIPOS: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4'
}
const LIMITE_BYTES = 50 * 1024 * 1024

export async function lerMidiaDasBoasVindas(
  fonte: NonNullable<ConfiguracaoDasBoasVindas['midia']>
): Promise<{ readonly dados: Uint8Array; readonly tipo: string }> {
  let caminho = fonte.caminho
  if (fonte.tipo === 'pasta') {
    const entradas = await readdir(caminho, { withFileTypes: true })
    const primeira = entradas
      .filter(
        (entrada) => entrada.isFile() && TIPOS[extname(entrada.name).toLowerCase()] !== undefined
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))[0]
    if (!primeira) throw new Error('Pasta sem mídia de áudio compatível')
    caminho = join(caminho, primeira.name)
  }
  const tipo = TIPOS[extname(caminho).toLowerCase()]
  if (!tipo) throw new Error('Formato de mídia não suportado')
  const informacoes = await stat(caminho)
  if (!informacoes.isFile() || informacoes.size > LIMITE_BYTES) {
    throw new Error('Mídia indisponível ou acima de 50 MB')
  }
  return { dados: new Uint8Array(await readFile(caminho)), tipo }
}
