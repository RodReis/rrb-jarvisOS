/**
 * Independência entre fatias: quando duas podem rodar juntas (SPEC-Scheduler-02).
 *
 * A pergunta que este arquivo responde: **estas duas fatias provam, com o que sabemos agora, que
 * não colidem — e se não provam, por quê?** Ausência de aresta no DAG não é prova: duas fatias sem
 * dependência podem editar o mesmo lockfile, a mesma migration, o mesmo contrato. A prova olha
 * três dimensões — dependências, conjuntos de escrita e recursos exclusivos — e exige as três.
 *
 * Quatro decisões governam o desenho:
 *
 *  - **Desconhecido nunca autoriza** (regra 1). Write set ausente, vazio ou com caminho inválido,
 *    e dependências que o roadmap não soube resolver, tornam a prova *incompleta* — e incompleta
 *    é sequencial. "Vazio" não é "não escreve nada": é ausência de decisão, o mesmo raciocínio de
 *    `listaDePathsValida`.
 *  - **Conservadora por construção.** Caminho é prefixo por *segmento*, e a sobreposição vale nos
 *    dois sentidos: quem escreve em `prisma` toca as migrations, e quem escreve numa migration toca
 *    `prisma`. A comparação ignora caixa (NTFS e APFS tratam `Src` e `src` como o mesmo diretório),
 *    porque um falso "disjunto" é o erro caro; um falso "conflito" só custa tempo.
 *  - **Recurso exclusivo é lógico, não só caminho.** Dois conjuntos disjuntos que tocam o mesmo
 *    lockfile ainda colidem; por isso o catálogo nomeia áreas globais (migrations, schema, lockfile,
 *    build, contrato) e a prova compara os *recursos* além dos caminhos.
 *  - **Determinística.** O mesmo snapshot dá as mesmas razões, na mesma ordem, e a mesma
 *    `entradaCanonica` (critério 4). O hash dela é do `src/main`, que é quem pode importar `crypto`.
 *
 * Mora em `src/shared/domain`: pura, sem disco, sem relógio, verificável sem o Electron.
 */

import { validarDag, type Mvp, type Slice } from './roadmap'

/** Versão do catálogo padrão. Mudar o conteúdo muda este número: ele entra na prova e no fingerprint. */
export const VERSAO_DO_CATALOGO = 1

export interface RecursoExclusivo {
  readonly id: string
  readonly descricao: string
  /** Arquivos e diretórios (prefixo por segmento, relativos à raiz do repositório) que o compõem. */
  readonly caminhos: readonly string[]
}

export interface CatalogoDeRecursos {
  readonly versao: number
  readonly recursos: readonly RecursoExclusivo[]
}

/**
 * As áreas globais da SPEC: dois runs nunca as alteram ao mesmo tempo. Dado versionado — mudar é
 * decisão, não refatoração. Um projeto-alvo com outras áreas passa o próprio catálogo.
 */
export const CATALOGO_PADRAO: CatalogoDeRecursos = {
  versao: VERSAO_DO_CATALOGO,
  recursos: [
    {
      id: 'lockfile',
      descricao: 'Manifestos e travas de dependências (mudar um invalida o outro)',
      caminhos: [
        'package-lock.json',
        'npm-shrinkwrap.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lock',
        'bun.lockb',
        'Cargo.lock',
        'poetry.lock',
        'uv.lock',
        'Pipfile.lock',
        'go.sum',
        'composer.lock',
        'Gemfile.lock',
        'package.json',
        'pnpm-workspace.yaml',
        'pyproject.toml',
        'requirements.txt',
        'Cargo.toml',
        'go.mod',
        'composer.json',
        'Gemfile'
      ]
    },
    {
      id: 'migrations',
      descricao: 'Migrations do banco',
      caminhos: [
        'prisma/migrations',
        'supabase/migrations',
        'migrations',
        'db/migrate',
        'alembic',
        'src/main/storage/migrations.ts'
      ]
    },
    {
      id: 'schema-publico',
      descricao: 'Schema público e contratos de API',
      caminhos: [
        'prisma/schema.prisma',
        'openapi.yaml',
        'openapi.yml',
        'openapi.json',
        'schema.graphql',
        'docs/openapi.yaml',
        'docs/api'
      ]
    },
    {
      id: 'build-config',
      descricao: 'Configuração de build, toolchain e CI',
      caminhos: [
        'package.json',
        'pyproject.toml',
        'Cargo.toml',
        'go.mod',
        'tsconfig.json',
        'tsconfig.node.json',
        'tsconfig.web.json',
        'vite.config.ts',
        'electron.vite.config.ts',
        'electron-builder.yml',
        'eslint.config.js',
        'eslint.config.mjs',
        'vitest.config.ts',
        'playwright.config.ts',
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.yaml',
        '.nvmrc',
        '.npmrc',
        '.github/workflows'
      ]
    },
    {
      id: 'contrato-arquitetural',
      descricao: 'Arquitetura e decisões que as demais fatias assumem',
      caminhos: ['docs/ARCHITECTURE.md', 'docs/DECISIONS.md', 'docs/adr', 'CLAUDE.md']
    }
  ]
}

const RAIZ = '.'
const EH_ABSOLUTO = /^([\\/]|[A-Za-z]:)/
/** Tetos: write set e caminho acima disto são recusados (fail closed), não processados. */
export const MAX_CAMINHOS_NO_WRITE_SET = 100
export const MAX_TAMANHO_DO_CAMINHO = 256
/** O que uma resposta carrega de conflitos e razões: o resto vira "pelo menos estes". */
export const MAX_CONFLITOS_REPORTADOS = 50

/**
 * Caractere que nunca é legítimo num caminho de repositório: controle (inclui quebra de linha e
 * NUL), C1, separadores de linha/parágrafo, marcas de direção (bidi), invisíveis de largura zero e
 * BOM. Os de apresentação deixam o texto do bloqueio e da auditoria dizer o que o código não faz.
 */
function ehCaractereProibido(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2069) ||
    cp === 0xfeff
  )
}

/** Caracteres que o Windows reserva (`:` abre stream alternativo e `::$DATA`; `?` e `*` são glob). */
const RESERVADOS = ['*', '?', ':', '<', '>', '"', '|']

/**
 * Um segmento que o sistema de arquivos pode resolver para outro nome: ponto ou espaço no fim
 * (`prisma.` e `prisma ` abrem `prisma` no Windows) e nome curto 8.3 (`MIGRAT~1`). Recusar é o
 * fail closed; aceitar daria um "disjunto" falso entre dois nomes do mesmo arquivo.
 */
const segmentoAmbiguo = (s: string): boolean => /[. ]$/.test(s) || /~\d/.test(s)

/**
 * O caminho como prefixo relativo normalizado, ou `undefined` se não vale: não-texto, vazio, grande
 * demais, glob, absoluto, unidade, `..`, caractere proibido ou segmento que o Windows resolve para
 * outro nome. `.` é a raiz do repositório e vale — sobrepõe tudo. Recusa em vez de consertar:
 * normalizar `src/**` para `src` escolheria sozinho o que o autor quis.
 */
export function normalizarCaminho(bruto: unknown): string | undefined {
  if (typeof bruto !== 'string') return undefined
  // NFC: `é` composto e decomposto são o mesmo diretório no APFS, e dois nomes para ele seriam um
  // falso "disjunto".
  const texto = bruto.normalize('NFC')
  if (texto.trim() === '' || texto.length > MAX_TAMANHO_DO_CAMINHO) return undefined
  if ([...texto].some(ehCaractereProibido)) return undefined
  if (RESERVADOS.some((r) => texto.includes(r))) return undefined
  if (EH_ABSOLUTO.test(texto.trim())) return undefined
  const partes = texto.split(/[\\/]+/).filter((p) => p !== '' && p !== '.')
  if (partes.includes('..') || partes.some(segmentoAmbiguo)) return undefined
  return partes.length === 0 ? RAIZ : partes.join('/')
}

const segmentos = (caminho: string): readonly string[] =>
  caminho === RAIZ ? [] : caminho.toLowerCase().split('/')

/** Um é prefixo do outro, por segmento e sem distinguir caixa? A raiz sobrepõe tudo. */
export function caminhosSeSobrepoem(a: string, b: string): boolean {
  const x = segmentos(a)
  const y = segmentos(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false
  return true
}

/**
 * O catálogo com os caminhos já normalizados. `recursosTocados` roda por caminho, por ciclo e por
 * avaliação do `decidirPool`; renormalizar as entradas do catálogo a cada chamada era o custo
 * dominante. O catálogo é imutável, então o cache por referência não envelhece.
 */
const catalogosNormalizados = new WeakMap<
  CatalogoDeRecursos,
  readonly { readonly id: string; readonly caminhos: readonly string[] }[]
>()

function normalizadoDe(catalogo: CatalogoDeRecursos) {
  let n = catalogosNormalizados.get(catalogo)
  if (n === undefined) {
    n = catalogo.recursos.map((r) => ({
      id: r.id,
      caminhos: r.caminhos.map(normalizarCaminho).filter((c): c is string => c !== undefined)
    }))
    catalogosNormalizados.set(catalogo, n)
  }
  return n
}

/** Os ids dos recursos que este caminho toca — por ser parte deles ou por conter parte deles. */
export function recursosTocados(
  caminho: string,
  catalogo: CatalogoDeRecursos = CATALOGO_PADRAO
): readonly string[] {
  const normal = normalizarCaminho(caminho)
  if (normal === undefined) return []
  return normalizadoDe(catalogo)
    .filter((r) => r.caminhos.some((alvo) => caminhosSeSobrepoem(normal, alvo)))
    .map((r) => r.id)
    .sort()
}

/** O que um write set trava: os caminhos normalizados e os recursos lógicos que eles tocam. */
export interface TravasDoWriteSet {
  readonly caminhos: readonly string[]
  readonly recursos: readonly string[]
}

const ordenado = (itens: Iterable<string>): string[] => [...new Set(itens)].sort()

/**
 * As travas de um write set, ou `undefined` se ele não vale: vazio, grande demais ou com algum
 * caminho inválido. Um caminho ruim invalida o conjunto inteiro — travar só os bons deixaria o ruim
 * sem trava. A chave da trava é a **caixa canônica** (minúscula): o `UNIQUE` do banco distingue
 * `Src` de `src`, mas o sistema de arquivos não, e 2^n grafias do mesmo diretório não podem virar
 * 2^n linhas.
 */
export function travasDoWriteSet(
  writeSet: readonly string[],
  catalogo: CatalogoDeRecursos = CATALOGO_PADRAO
): TravasDoWriteSet | undefined {
  if (!Array.isArray(writeSet) || writeSet.length === 0) return undefined
  if (writeSet.length > MAX_CAMINHOS_NO_WRITE_SET) return undefined
  const normais = writeSet.map(normalizarCaminho)
  if (normais.some((c) => c === undefined)) return undefined
  const caminhos = ordenado((normais as string[]).map((c) => c.toLowerCase()))
  return {
    caminhos,
    recursos: ordenado(caminhos.flatMap((c) => recursosTocados(c, catalogo)))
  }
}

export interface TravaExistente {
  readonly runId: string
  readonly tipo: 'caminho' | 'recurso'
  readonly chave: string
}

export interface ConflitoDeTrava {
  readonly tipo: 'caminho' | 'recurso'
  readonly chave: string
  readonly comRunId: string
  readonly comChave: string
}

/**
 * As travas pedidas que colidem com as que **outros** runs já têm. Caminho colide por sobreposição;
 * recurso, por igualdade. O próprio dono não conflita consigo mesmo (a expansão pede só o delta,
 * mas um retry repete caminhos que já são dele). A resposta é limitada a `MAX_CONFLITOS_REPORTADOS`:
 * basta um para negar, e milhares de travas alheias não viram milhares de linhas de evidência.
 */
export function conflitosDeTrava(
  runId: string,
  pedidas: TravasDoWriteSet,
  existentes: readonly TravaExistente[]
): readonly ConflitoDeTrava[] {
  const alheias = existentes.filter((e) => e.runId !== runId)
  const conflitos: ConflitoDeTrava[] = []
  for (const chave of pedidas.caminhos) {
    for (const e of alheias) {
      if (e.tipo === 'caminho' && caminhosSeSobrepoem(chave, e.chave)) {
        conflitos.push({ tipo: 'caminho', chave, comRunId: e.runId, comChave: e.chave })
        if (conflitos.length >= MAX_CONFLITOS_REPORTADOS) return conflitos
      }
    }
  }
  for (const chave of pedidas.recursos) {
    for (const e of alheias) {
      if (e.tipo === 'recurso' && e.chave === chave) {
        conflitos.push({ tipo: 'recurso', chave, comRunId: e.runId, comChave: e.chave })
        if (conflitos.length >= MAX_CONFLITOS_REPORTADOS) return conflitos
      }
    }
  }
  return conflitos
}

/** Uma fatia, como a prova a enxerga. `undefined` em qualquer dimensão = desconhecido. */
export interface FatiaParaProva {
  readonly runId: string
  readonly sliceId: string
  /** O fecho de dependências (ids de fatia), diretas e transitivas. */
  readonly dependeDe: readonly string[] | undefined
  /** Os caminhos que a fatia pode escrever. */
  readonly writeSet: readonly string[] | undefined
}

/** Por que a prova não saiu. Enum fechado: a tela e o fingerprint precisam distinguir as causas. */
export type Razao =
  | { readonly tipo: 'write-set-desconhecido'; readonly runId: string }
  | { readonly tipo: 'dependencias-desconhecidas'; readonly runId: string }
  | { readonly tipo: 'dependencia'; readonly runId: string; readonly aposRunId: string }
  | { readonly tipo: 'mesma-fatia'; readonly runId: string; readonly contraRunId: string }
  | {
      readonly tipo: 'sobreposicao-de-path'
      readonly runId: string
      readonly contraRunId: string
      readonly caminho: string
      readonly contraCaminho: string
    }
  | {
      readonly tipo: 'recurso-exclusivo'
      readonly runId: string
      readonly contraRunId: string
      readonly recurso: string
    }

export interface ProvaCalculada {
  readonly independente: boolean
  readonly razoes: readonly Razao[]
  readonly versaoDoCatalogo: number
  /** A entrada, em JSON canônico. O mesmo snapshot dá o mesmo texto; o hash dele é o fingerprint. */
  readonly entradaCanonica: string
}

const compararRazoes = (a: Razao, b: Razao): number => {
  const x = JSON.stringify(a)
  const y = JSON.stringify(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function forma(f: FatiaParaProva, catalogo: CatalogoDeRecursos) {
  return {
    runId: f.runId,
    sliceId: f.sliceId,
    dependeDe: f.dependeDe === undefined ? null : ordenado(f.dependeDe),
    travas: f.writeSet === undefined ? undefined : travasDoWriteSet(f.writeSet, catalogo)
  }
}

/**
 * O candidato é independente de **todos** os ativos? Pura e determinística.
 *
 * Os ativos são os runs que já ocupam slot no projeto; o candidato é quem pede para entrar ao lado
 * deles. Independente exige: nenhuma dimensão desconhecida, nenhuma dependência entre eles (em
 * qualquer sentido), nenhum caminho sobreposto e nenhum recurso exclusivo em comum.
 */
export function provarIndependencia(
  candidato: FatiaParaProva,
  ativos: readonly FatiaParaProva[],
  catalogo: CatalogoDeRecursos = CATALOGO_PADRAO
): ProvaCalculada {
  const c = forma(candidato, catalogo)
  const todos = [...ativos].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
  const as = todos.map((a) => forma(a, catalogo))
  const razoes: Razao[] = []

  for (const f of [c, ...as]) {
    if (f.travas === undefined) razoes.push({ tipo: 'write-set-desconhecido', runId: f.runId })
    if (f.dependeDe === null) razoes.push({ tipo: 'dependencias-desconhecidas', runId: f.runId })
  }

  for (const a of as) {
    if (a.sliceId === c.sliceId) {
      razoes.push({ tipo: 'mesma-fatia', runId: c.runId, contraRunId: a.runId })
    }
    if (c.dependeDe?.includes(a.sliceId) === true) {
      razoes.push({ tipo: 'dependencia', runId: c.runId, aposRunId: a.runId })
    }
    if (a.dependeDe?.includes(c.sliceId) === true) {
      razoes.push({ tipo: 'dependencia', runId: a.runId, aposRunId: c.runId })
    }
    if (c.travas === undefined || a.travas === undefined) continue

    const existentes: TravaExistente[] = [
      ...a.travas.caminhos.map((chave) => ({ runId: a.runId, tipo: 'caminho' as const, chave })),
      ...a.travas.recursos.map((chave) => ({ runId: a.runId, tipo: 'recurso' as const, chave }))
    ]
    for (const k of conflitosDeTrava(c.runId, c.travas, existentes)) {
      razoes.push(
        k.tipo === 'caminho'
          ? {
              tipo: 'sobreposicao-de-path',
              runId: c.runId,
              contraRunId: a.runId,
              caminho: k.chave,
              contraCaminho: k.comChave
            }
          : { tipo: 'recurso-exclusivo', runId: c.runId, contraRunId: a.runId, recurso: k.chave }
      )
    }
  }

  const unicas = [...new Map(razoes.map((r) => [JSON.stringify(r), r])).values()].sort(
    compararRazoes
  )
  const canonica = (f: ReturnType<typeof forma>): unknown => ({
    r: f.runId,
    s: f.sliceId,
    d: f.dependeDe,
    w: f.travas?.caminhos ?? null
  })
  return {
    independente: unicas.length === 0,
    // O veredito vem de todas; o que se carrega e grava é um recorte (o fingerprint cobre a entrada).
    razoes: unicas.slice(0, MAX_CONFLITOS_REPORTADOS),
    versaoDoCatalogo: catalogo.versao,
    entradaCanonica: JSON.stringify({ v: catalogo.versao, c: canonica(c), a: as.map(canonica) })
  }
}

/**
 * O fecho de dependências de uma fatia: tudo de que ela depende, direta ou transitivamente.
 *
 * A dependência é a implícita de `fila.ts`: as fatias anteriores do MVP e todas as dos MVPs de que o
 * MVP depende (transitivamente pelo DAG). `undefined` quando o roadmap não permite responder — DAG
 * inválido ou fatia/MVP ausente — porque responder `[]` ali declararia a fatia livre de dependência.
 */
export function fechoDeDependencias(
  slice: Slice,
  mvps: readonly Mvp[],
  slices: readonly Slice[]
): readonly string[] | undefined {
  if (validarDag(mvps).length > 0) return undefined
  const porId = new Map(mvps.map((m) => [m.id, m]))
  if (!porId.has(slice.mvpId)) return undefined

  const mvpsDependentes = new Set<string>()
  const pilha = [...(porId.get(slice.mvpId)?.dependeDe ?? [])]
  while (pilha.length > 0) {
    const id = pilha.pop() as string
    if (mvpsDependentes.has(id)) continue
    mvpsDependentes.add(id)
    pilha.push(...(porId.get(id)?.dependeDe ?? []))
  }

  return ordenado(
    slices
      .filter(
        (s) => (s.mvpId === slice.mvpId && s.numero < slice.numero) || mvpsDependentes.has(s.mvpId)
      )
      .map((s) => s.id)
  )
}

/** Uma razão em linguagem de usuário, para a mensagem de espera. O dado estruturado segue na vista. */
export function descreverRazao(r: Razao): string {
  switch (r.tipo) {
    case 'write-set-desconhecido':
      return `não se sabe onde o run ${r.runId} vai escrever`
    case 'dependencias-desconhecidas':
      return `as dependências da fatia do run ${r.runId} não puderam ser resolvidas`
    case 'dependencia':
      return `o run ${r.runId} depende do run ${r.aposRunId}`
    case 'mesma-fatia':
      return `os runs ${r.runId} e ${r.contraRunId} são da mesma fatia`
    case 'sobreposicao-de-path':
      return `os runs ${r.runId} e ${r.contraRunId} escrevem na mesma área (${r.caminho} e ${r.contraCaminho})`
    case 'recurso-exclusivo':
      return `os runs ${r.runId} e ${r.contraRunId} tocam o mesmo recurso exclusivo (${r.recurso})`
  }
}
