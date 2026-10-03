/**
 * O que a M11-F00b acrescenta ao prompt do orquestrador (SPEC-Squads-00 § Emenda E1): a árvore de
 * arquivos da base e a stack do projeto.
 *
 * A primeira medição mostrou o defeito do instrumento: o modelo local recebia só o **nome** dos
 * diretórios e inventava caminho (`.java`, `.go`) ou devolvia plano sem escritor. O validador
 * endurecido recusa path que não existe na base; sem a árvore, o modelo não tinha como acertar.
 *
 * Fica em `prova/` e não no `squad-prompt.ts` de produção de propósito: a F00b mede se o local
 * chega a 80% *com* este contexto, e levá-lo ao produto é a decisão que vem depois do número.
 * Puro: quem lê o git entrega a lista de arquivos e o `package.json`.
 */

const TETO_DE_CARACTERES = 12_000
const MAX_EXTENSOES = 8
const MIN_ARQUIVOS_POR_EXTENSAO = 5

const FRAMEWORKS: readonly (readonly [dependencia: string, nome: string])[] = [
  ['typescript', 'TypeScript'],
  ['electron', 'Electron'],
  ['react', 'React'],
  ['vitest', 'Vitest'],
  ['@playwright/test', 'Playwright']
]

const extensaoDe = (caminho: string): string => {
  const nome = caminho.split('/').pop() ?? ''
  const ponto = nome.lastIndexOf('.')
  return ponto > 0 ? nome.slice(ponto) : ''
}

/** Arquivos diretos de `dir` e as subpastas imediatas; `undefined` se nada na base está sob ele. */
function conteudoDe(
  arquivos: readonly string[],
  dir: string
): { arquivos: string[]; subpastas: string[] } | undefined {
  const prefixo = `${dir}/`
  const diretos: string[] = []
  const subpastas = new Set<string>()
  let existe = false
  for (const caminho of arquivos) {
    if (!caminho.startsWith(prefixo)) continue
    existe = true
    const resto = caminho.slice(prefixo.length)
    const barra = resto.indexOf('/')
    if (barra < 0) diretos.push(resto)
    else subpastas.add(`${resto.slice(0, barra)}/`)
  }
  return existe ? { arquivos: diretos.sort(), subpastas: [...subpastas].sort() } : undefined
}

/**
 * Um diretório por linha, só com o nome dos arquivos. As subpastas entram porque o validador aceita
 * escrita nelas (um diretório permitido vale para a subárvore). Acima do teto a lista é cortada **e
 * o corte é dito**: um arquivo que o modelo não vê não pode parecer um arquivo que não existe.
 */
export function arvoreDaBase(
  arquivosDaBase: readonly string[],
  pathsPermitidos: readonly string[],
  tetoDeCaracteres: number = TETO_DE_CARACTERES
): string {
  let restante = tetoDeCaracteres
  return [...new Set(pathsPermitidos)]
    .sort()
    .map((dir) => {
      const conteudo = conteudoDe(arquivosDaBase, dir)
      if (conteudo === undefined) return `${dir}: (não existe na base)`

      const cabem: string[] = []
      for (const nome of conteudo.arquivos) {
        if (restante - (nome.length + 2) < 0) break
        cabem.push(nome)
        restante -= nome.length + 2
      }
      const omitidos = conteudo.arquivos.length - cabem.length
      const partes = [
        cabem.length === 0 && omitidos === 0 ? '(sem arquivos diretos)' : cabem.join(', '),
        ...(omitidos > 0 ? [`(+${omitidos} arquivo(s) omitido(s))`] : [])
      ].join(' ')
      const subpastas =
        conteudo.subpastas.length === 0 ? '' : `; subpastas: ${conteudo.subpastas.join(', ')}`
      return `${dir}: ${partes}${subpastas}`
    })
    .join('\n')
}

/** Frameworks do `package.json` e as extensões que a base usa — o que torna um arquivo novo plausível. */
export function pilhaDaBase(
  arquivosDaBase: readonly string[],
  packageJson: string,
  minArquivosPorExtensao: number = MIN_ARQUIVOS_POR_EXTENSAO
): string {
  let dependencias: string[] = []
  try {
    const bruto = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    dependencias = [
      ...Object.keys(bruto.dependencies ?? {}),
      ...Object.keys(bruto.devDependencies ?? {})
    ]
  } catch {
    // Sem package.json legível o prompt perde os nomes, não a lista de extensões.
  }
  const nomes = FRAMEWORKS.filter(([dep]) => dependencias.includes(dep)).map(([, nome]) => nome)

  const contagem = new Map<string, number>()
  for (const caminho of arquivosDaBase) {
    const ext = extensaoDe(caminho)
    if (ext !== '') contagem.set(ext, (contagem.get(ext) ?? 0) + 1)
  }
  const extensoes = [...contagem]
    .filter(([, n]) => n >= minArquivosPorExtensao)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_EXTENSOES)
    .map(([ext]) => ext)

  return [
    nomes.length === 0 ? undefined : nomes.join(', '),
    extensoes.length === 0 ? undefined : `extensões em uso: ${extensoes.join(', ')}`
  ]
    .filter((p) => p !== undefined)
    .join('; ')
}

export interface DadosDaBase {
  readonly arquivosDaBase: readonly string[]
  readonly pathsPermitidos: readonly string[]
  readonly packageJson: string
}

/** O bloco que o harness acrescenta ao `system` do pedido de produção. */
export function blocoDaBase(dados: DadosDaBase): string {
  return [
    `Stack do projeto: ${pilhaDaBase(dados.arquivosDaBase, dados.packageJson)}.`,
    '',
    'Arquivos da base nos diretórios permitidos (nome do arquivo por diretório; arquivo novo só com extensão da stack):',
    arvoreDaBase(dados.arquivosDaBase, dados.pathsPermitidos)
  ].join('\n')
}
