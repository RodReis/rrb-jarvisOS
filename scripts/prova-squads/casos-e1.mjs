/**
 * Os seis casos sintéticos do integrador na M11-F00b (SPEC-Squads-00 § Emenda E1), nas **mesmas
 * seis fatias** da primeira medição.
 *
 * Em cada um, dois escritores partem do módulo como a fatia o entregou e acrescentam, **no mesmo
 * ponto**, um comportamento diferente com teste próprio — a forma está em
 * `src/main/squads/prova/caso-sintetico.ts`. O alvo mudou de arquivo em quatro fatias (M9-F01,
 * M9-F03, M26-F01 e M26-F02), porque o da primeira medição não tinha como ser testado por spec
 * puro (`terminal-engine.ts` e `index.ts` dependem do Node/Electron, `call-provider.ts` do banco,
 * `ProjetosLocais.tsx` é tela): todo alvo aqui é um módulo puro de `src/shared/domain` com spec
 * vizinho, tocado pela fatia, para que "cada lado coberto por teste próprio" seja verdade e não
 * intenção. M9-F04 e M26-F06 mantêm o alvo.
 *
 * Os comportamentos são pequenos de propósito. O que a prova mede é se o integrador preserva os
 * dois lados quando o `git` conflita, não se ele sabe programar o comportamento.
 */

const teste = (nome, linhas) =>
  `describe('${nome}', () => {\n${linhas.map((l) => `  ${l}`).join('\n')}\n})\n`

export const CASOS_E1 = [
  {
    fatia: 'M9-F01',
    modulo: 'src/shared/domain/publicacao.ts',
    lado1: {
      importacao: "import { abreviarUrlDeRemote } from './publicacao'",
      codigo: `/** \`dono/repo\` de uma URL do GitHub; qualquer outra coisa volta como veio. */
export function abreviarUrlDeRemote(url: string): string {
  const achado = /^https:\\/\\/github\\.com\\/([^/\\s]+\\/[^/\\s]+?)(?:\\.git)?\\/?$/.exec(url)
  return achado?.[1] ?? url
}
`,
      teste: teste('abreviarUrlDeRemote', [
        "it('reduz a URL do GitHub a dono/repo', () => {",
        "  expect(abreviarUrlDeRemote('https://github.com/dono/repo.git')).toBe('dono/repo')",
        "  expect(abreviarUrlDeRemote('https://github.com/dono/repo')).toBe('dono/repo')",
        '})',
        "it('devolve inalterado o que não é GitHub', () => {",
        "  expect(abreviarUrlDeRemote('https://gitlab.com/dono/repo')).toBe('https://gitlab.com/dono/repo')",
        '})'
      ])
    },
    lado2: {
      importacao: "import { urlTemTokenEmbutido } from './publicacao'",
      codigo: `/** A URL carrega \`usuario:segredo@\` — o que a redação precisa mascarar antes de qualquer log. */
export function urlTemTokenEmbutido(url: string): boolean {
  return /^https:\\/\\/[^/@\\s]+:[^/@\\s]+@/.test(url)
}
`,
      teste: teste('urlTemTokenEmbutido', [
        "it('acusa credencial dentro da URL', () => {",
        "  expect(urlTemTokenEmbutido('https://x-access-token:abc@github.com/dono/repo.git')).toBe(true)",
        '})',
        "it('não acusa URL limpa', () => {",
        "  expect(urlTemTokenEmbutido('https://github.com/dono/repo.git')).toBe(false)",
        '})'
      ])
    }
  },
  {
    fatia: 'M9-F03',
    modulo: 'src/shared/domain/context-pack.ts',
    lado1: {
      importacao: "import { tokensRestantes } from './context-pack'",
      codigo: `/** Quanto do teto ainda cabe; nunca negativo. */
export function tokensRestantes(teto: number, usados: number): number {
  return Math.max(0, teto - usados)
}
`,
      teste: teste('tokensRestantes', [
        "it('é o teto menos o usado', () => {",
        '  expect(tokensRestantes(10, 3)).toBe(7)',
        '})',
        "it('estourado vira zero, nunca negativo', () => {",
        '  expect(tokensRestantes(10, 12)).toBe(0)',
        '})'
      ])
    },
    lado2: {
      importacao: "import { percentualDoTeto } from './context-pack'",
      codigo: `/** Uso do teto em porcentagem inteira, limitada a 100; teto inválido não divide. */
export function percentualDoTeto(usados: number, teto: number): number {
  if (!(teto > 0)) return 0
  return Math.min(100, Math.round((usados / teto) * 100))
}
`,
      teste: teste('percentualDoTeto', [
        "it('arredonda o uso para inteiro', () => {",
        '  expect(percentualDoTeto(50, 200)).toBe(25)',
        '})',
        "it('passou do teto, 100; teto zero, 0', () => {",
        '  expect(percentualDoTeto(300, 200)).toBe(100)',
        '  expect(percentualDoTeto(1, 0)).toBe(0)',
        '})'
      ])
    }
  },
  {
    fatia: 'M9-F04',
    modulo: 'src/shared/domain/preflight.ts',
    lado1: {
      importacao: "import { nomeDeBranchValido } from './preflight'",
      codigo: `/** Nome de branch que o preflight aceita: minúsculo, sem \`//\` e sem barra no fim. */
export function nomeDeBranchValido(nome: string): boolean {
  return /^[a-z0-9][a-z0-9/_-]*$/.test(nome) && !nome.includes('//') && !nome.endsWith('/')
}
`,
      teste: teste('nomeDeBranchValido', [
        "it('aceita o formato do projeto', () => {",
        "  expect(nomeDeBranchValido('feat/m9-f04-construcao')).toBe(true)",
        '})',
        "it('recusa maiúscula, barra dupla e barra no fim', () => {",
        "  expect(nomeDeBranchValido('Feat/x')).toBe(false)",
        "  expect(nomeDeBranchValido('feat//x')).toBe(false)",
        "  expect(nomeDeBranchValido('feat/x/')).toBe(false)",
        '})'
      ])
    },
    lado2: {
      importacao: "import { sufixoDeTentativa } from './preflight'",
      codigo: `/** A primeira tentativa usa o nome puro; as seguintes ganham \`-tN\`, para não colidir com a anterior. */
export function sufixoDeTentativa(nome: string, tentativa: number): string {
  return tentativa <= 1 ? nome : \`\${nome}-t\${tentativa}\`
}
`,
      teste: teste('sufixoDeTentativa', [
        "it('primeira tentativa não muda o nome', () => {",
        "  expect(sufixoDeTentativa('wip-1', 1)).toBe('wip-1')",
        '})',
        "it('recuperação ganha o número da tentativa', () => {",
        "  expect(sufixoDeTentativa('wip-1', 3)).toBe('wip-1-t3')",
        '})'
      ])
    }
  },
  {
    fatia: 'M26-F01',
    modulo: 'src/shared/domain/fase.ts',
    lado1: {
      importacao: "import { faseSeguinte } from './fase'",
      codigo: `/** A fase depois desta, na ordem de \`FASES\`; \`undefined\` na última. */
export function faseSeguinte(fase: Fase): Fase | undefined {
  return FASES[FASES.indexOf(fase) + 1]
}
`,
      teste: teste('faseSeguinte', [
        "it('avança uma posição na ordem', () => {",
        '  expect(faseSeguinte(FASES[0] as Fase)).toBe(FASES[1])',
        '})',
        "it('a última fase não tem seguinte', () => {",
        '  expect(faseSeguinte(FASES[FASES.length - 1] as Fase)).toBeUndefined()',
        '})'
      ])
    },
    lado2: {
      importacao: "import { ehUltimaFase } from './fase'",
      codigo: `/** Verdadeiro só para a última fase de \`FASES\`. */
export function ehUltimaFase(fase: Fase): boolean {
  return FASES.indexOf(fase) === FASES.length - 1
}
`,
      teste: teste('ehUltimaFase', [
        "it('só a última fase é a última', () => {",
        '  expect(ehUltimaFase(FASES[FASES.length - 1] as Fase)).toBe(true)',
        '  expect(ehUltimaFase(FASES[0] as Fase)).toBe(false)',
        '})'
      ])
    }
  },
  {
    fatia: 'M26-F02',
    modulo: 'src/shared/domain/modelo-da-fase.ts',
    lado1: {
      importacao: "import { rotuloCurtoDoModelo } from './modelo-da-fase'",
      codigo: `/** O modelo sem a etiqueta de tamanho: \`qwen3:8b\` vira \`qwen3\`. */
export function rotuloCurtoDoModelo(modelo: string): string {
  return modelo.split(':')[0] ?? modelo
}
`,
      teste: teste('rotuloCurtoDoModelo', [
        "it('tira a etiqueta depois dos dois-pontos', () => {",
        "  expect(rotuloCurtoDoModelo('qwen3:8b')).toBe('qwen3')",
        '})',
        "it('sem etiqueta, devolve o próprio nome', () => {",
        "  expect(rotuloCurtoDoModelo('claude-fable-5-1')).toBe('claude-fable-5-1')",
        '})'
      ])
    },
    lado2: {
      importacao: "import { ehProviderLocal } from './modelo-da-fase'",
      codigo: `/** Só o Ollama roda na máquina do usuário; todo outro provider sai dela. */
export function ehProviderLocal(provider: string): boolean {
  return provider === 'ollama'
}
`,
      teste: teste('ehProviderLocal', [
        "it('o Ollama é local', () => {",
        "  expect(ehProviderLocal('ollama')).toBe(true)",
        '})',
        "it('assinatura e API paga não são locais', () => {",
        "  expect(ehProviderLocal('claude-code')).toBe(false)",
        "  expect(ehProviderLocal('anthropic')).toBe(false)",
        '})'
      ])
    }
  },
  {
    fatia: 'M26-F06',
    modulo: 'src/shared/domain/rota-de-geracao.ts',
    lado1: {
      importacao: "import { decisaoBloqueada } from './rota-de-geracao'",
      codigo: `/** A decisão de rota é o bloqueio, e não uma rota escolhida. */
export function decisaoBloqueada(decisao: string): boolean {
  return decisao === 'bloqueado'
}
`,
      teste: teste('decisaoBloqueada', [
        "it('reconhece o bloqueio', () => {",
        "  expect(decisaoBloqueada('bloqueado')).toBe(true)",
        '})',
        "it('outra decisão não é bloqueio', () => {",
        "  expect(decisaoBloqueada('assinatura')).toBe(false)",
        '})'
      ])
    },
    lado2: {
      importacao: "import { rotuloDaDecisao } from './rota-de-geracao'",
      codigo: `/** A decisão como texto para a tela: hífen vira espaço. */
export function rotuloDaDecisao(decisao: string): string {
  return decisao.replace(/-/g, ' ')
}
`,
      teste: teste('rotuloDaDecisao', [
        "it('troca hífen por espaço', () => {",
        "  expect(rotuloDaDecisao('api-paga')).toBe('api paga')",
        '})',
        "it('sem hífen, não muda', () => {",
        "  expect(rotuloDaDecisao('bloqueado')).toBe('bloqueado')",
        '})'
      ])
    }
  }
]
