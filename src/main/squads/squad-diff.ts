/**
 * O diff unificado em hunks, para o manifesto da integração e para a revisão (SPEC-Squads-04).
 *
 * É a **leitura de um diff do Git**, com o que o instrumento da prova (`prova/manifesto-hunks`) não
 * precisava e a produção sim:
 *
 *  - o cabeçalho acaba no primeiro `@@`: depois dele `---` e `+++` são **conteúdo** (um comentário
 *    SQL removido aparece como `--- …` e não pode ser tomado por cabeçalho);
 *  - rename: o hunk guarda o caminho da **base** (a origem), e é por ele que o manifesto casa o
 *    que um escritor fez com o que o outro renomeou;
 *  - caminho entre aspas com escape octal (`core.quotePath`) e com espaço (TAB no fim de `---`).
 *
 * A identidade do hunk é o **conteúdo** das linhas alteradas, não a posição: o número da linha
 * muda quando o outro escritor insere acima.
 */

import { createHash } from 'node:crypto'

export interface HunkDoDiff {
  readonly id: string
  /** O caminho depois da alteração (o novo, num rename). */
  readonly arquivo: string
  /** O caminho na base: a origem de um rename, ou o próprio arquivo. */
  readonly base: string
  readonly removidas: readonly string[]
  readonly adicionadas: readonly string[]
}

export interface ArquivoDoDiff {
  readonly arquivo: string
  readonly base: string
  readonly apagado: boolean
  readonly hunks: readonly HunkDoDiff[]
}

const idDoHunk = (base: string, removidas: readonly string[], adicionadas: readonly string[]) =>
  createHash('sha256')
    .update(JSON.stringify([base, removidas, adicionadas]))
    .digest('hex')
    .slice(0, 12)

/** O que o Git escapa entre aspas: `\"`, `\\`, `\t`, `\n` e o byte em octal (`\303\251`). */
function desescapar(token: string): string {
  const bytes: number[] = []
  for (let i = 1; i < token.length - 1; i++) {
    const c = token[i] ?? ''
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'))
      continue
    }
    const proximo = token[i + 1] ?? ''
    const octal = /^[0-7]{3}/.exec(token.slice(i + 1))
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8))
      i += 3
    } else {
      bytes.push(...Buffer.from({ t: '\t', n: '\n', '"': '"', '\\': '\\' }[proximo] ?? proximo))
      i += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Um caminho de cabeçalho: sem o TAB final, sem aspas, sem o prefixo `a/` ou `b/`. */
function caminhoDe(token: string, prefixo?: 'a/' | 'b/'): string | undefined {
  const limpo = token.replace(/\t.*$/, '').trimEnd()
  if (limpo === '/dev/null') return undefined
  const cru = limpo.startsWith('"') && limpo.endsWith('"') ? desescapar(limpo) : limpo
  return prefixo !== undefined && cru.startsWith(prefixo) ? cru.slice(prefixo.length) : cru
}

/** `diff --git a/X b/Y`: o último recurso, para arquivo sem `---`/`+++` (binário, só modo). */
function caminhoDoCabecalhoGit(linha: string): string {
  const resto = linha.slice('diff --git '.length)
  const quoted = /^"(?:[^"\\]|\\.)*" ("(?:[^"\\]|\\.)*")$/.exec(resto)
  if (quoted?.[1] !== undefined) return caminhoDe(quoted[1], 'b/') ?? ''
  const corte = resto.lastIndexOf(' b/')
  return corte === -1 ? '' : resto.slice(corte + 3)
}

function lerSecao(texto: string): ArquivoDoDiff | undefined {
  const linhas = texto.split('\n')
  const cabecalhoGit = linhas[0] ?? ''
  let origem: string | undefined
  let destino: string | undefined
  let de: string | undefined
  let para: string | undefined
  let semOrigem = false
  let semDestino = false

  let i = 1
  for (; i < linhas.length; i++) {
    const linha = linhas[i] ?? ''
    if (linha.startsWith('@@')) break
    if (linha.startsWith('rename from ')) origem = caminhoDe(linha.slice(12))
    else if (linha.startsWith('rename to ')) destino = caminhoDe(linha.slice(10))
    else if (linha.startsWith('--- ')) {
      de = caminhoDe(linha.slice(4), 'a/')
      semOrigem = de === undefined
    } else if (linha.startsWith('+++ ')) {
      para = caminhoDe(linha.slice(4), 'b/')
      semDestino = para === undefined
    }
  }

  // `rename from/to` vem sem prefixo `a/`/`b/`: um diretório que se chama `a` não pode perdê-lo.
  const arquivo = destino ?? para ?? de ?? caminhoDoCabecalhoGit(cabecalhoGit)
  if (arquivo === '') return undefined
  const base = origem ?? (semOrigem ? arquivo : (de ?? arquivo))

  const hunks: HunkDoDiff[] = []
  let removidas: string[] = []
  let adicionadas: string[] = []
  const fecha = (): void => {
    if (removidas.length > 0 || adicionadas.length > 0) {
      hunks.push({
        id: idDoHunk(base, removidas, adicionadas),
        arquivo,
        base,
        removidas,
        adicionadas
      })
    }
    removidas = []
    adicionadas = []
  }
  for (; i < linhas.length; i++) {
    const linha = linhas[i] ?? ''
    if (linha.startsWith('@@')) fecha()
    else if (linha.startsWith('+')) adicionadas.push(linha.slice(1))
    else if (linha.startsWith('-')) removidas.push(linha.slice(1))
  }
  fecha()
  return { arquivo, base, apagado: semDestino, hunks }
}

/** Separa o diff pelos `diff --git`, preservando o texto de cada arquivo. */
function secoes(diff: string): readonly string[] {
  return diff.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git '))
}

/** Lê um diff unificado (`git diff -U0`) em arquivos e hunks. */
export function lerDiff(diff: string): readonly ArquivoDoDiff[] {
  return secoes(diff.replace(/\r\n/g, '\n')).flatMap((s) => {
    const lido = lerSecao(s)
    return lido === undefined ? [] : [lido]
  })
}

/** O diff de cada arquivo, com o texto original: o que o revisor recebe, um por fonte. */
export function dividirPorArquivo(
  diff: string
): readonly { readonly arquivo: string; readonly texto: string }[] {
  return secoes(diff).flatMap((texto) => {
    const lido = lerSecao(texto.replace(/\r\n/g, '\n'))
    return lido === undefined ? [] : [{ arquivo: lido.arquivo, texto }]
  })
}
