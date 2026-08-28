/**
 * Extrai os tokens de tema (`jt*`/`nt*`) do protótipo para dado versionado.
 *
 * SPEC-DesignSystem-02 exige **fidelidade ao protótipo**: o valor escuro de cada token é a cor
 * original, e o claro é o par derivado. São 71 tokens × 2 modos = 142 valores. Transcrever isso
 * à mão convida o typo silencioso — uma cor errada não quebra nada, só fica sutilmente errada.
 *
 * Por isso o dado é **extraído** de `docs/design/JARVIS Platform (offline).html`, que é a fonte
 * canônica (a spec: "onde protótipo e PRD divergirem, o protótipo vence"). Rodar este script de
 * novo sobre o mesmo protótipo tem de produzir exatamente o mesmo arquivo — é o que permite ao
 * teste de paridade afirmar que o escuro *é* o do protótipo, em vez de supor.
 *
 * Uso: `node scripts/extrair-tokens-prototipo.mjs`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PROTOTIPO = resolve('docs/design/JARVIS Platform (offline).html')
const SAIDA = resolve('src/design/tokens/tema-prototipo.json')

/**
 * Lê um literal `const <nome> = { … };` de dentro do HTML.
 *
 * O protótipo é um documento DC: o JS vive numa string JSON-escapada, então as aspas chegam como
 * `\"`. Desescapar é o bastante — o conteúdo é JSON válido depois disso.
 */
function extrairMapa(fonte, nome) {
  const inicio = fonte.indexOf(`const ${nome} = {`)
  if (inicio < 0) throw new Error(`Mapa \`${nome}\` não encontrado no protótipo.`)

  const fim = fonte.indexOf('};', inicio)
  if (fim < 0) throw new Error(`Fim do mapa \`${nome}\` não encontrado.`)

  const bruto = fonte.slice(inicio, fim + 1)
  const objeto = bruto.slice(bruto.indexOf('{'))
  return JSON.parse(objeto.replaceAll('\\"', '"'))
}

const fonte = readFileSync(PROTOTIPO, 'utf8')
const dark = extrairMapa(fonte, '_tmDark')
const light = extrairMapa(fonte, '_tmLight')

// Os dois modos têm de descrever o mesmo conjunto de papéis. Uma chave só num deles significa
// token sem par — no claro renderizaria `undefined`, que o CSS engole em silêncio.
const chavesDark = Object.keys(dark).sort()
const chavesLight = Object.keys(light).sort()
if (chavesDark.join() !== chavesLight.join()) {
  throw new Error('Os mapas dark e light não têm as mesmas chaves — token sem par.')
}

writeFileSync(SAIDA, JSON.stringify({ dark, light }, null, 2) + '\n', 'utf8')

const jt = chavesDark.filter((k) => k.startsWith('jt')).length
const nt = chavesDark.filter((k) => k.startsWith('nt')).length
console.log(`[tokens] ${chavesDark.length} tokens (${jt} jt + ${nt} nt) × 2 modos → ${SAIDA}`)
