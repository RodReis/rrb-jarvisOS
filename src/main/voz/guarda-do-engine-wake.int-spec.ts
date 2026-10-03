/**
 * Só a composição conhece o engine concreto da wake word (SPEC-Escuta-01, critério 1).
 *
 * Mesma razão do teste de fronteira do design system: uma regra de lint que ninguém exercita pode
 * ficar silenciosamente inerte (um `files:` errado, um `group:` mal escrito), e o `lint` verde
 * diria que a garantia existe. O teste roda o ESLint **de verdade**, sobre a config de verdade,
 * nos dois sentidos — o arquivo que viola falha, o que fala com a interface passa.
 *
 * O arquivo temporário mora em `src/main/voz/` porque a regra é escopada por caminho.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ID_REGRA = 'no-restricted-imports'
const RAIZ = join(process.cwd(), 'src', 'main', 'voz')

let pastaTemp = ''
const eslint = new ESLint()

async function errosDaGuarda(nomeArquivo: string, codigo: string): Promise<number> {
  const caminho = join(pastaTemp, nomeArquivo)
  writeFileSync(caminho, codigo, 'utf8')
  const [resultado] = await eslint.lintFiles([caminho])
  return resultado.messages.filter((m) => m.ruleId === ID_REGRA).length
}

beforeAll(() => {
  pastaTemp = mkdtempSync(join(RAIZ, 'guarda-temp-'))
})

afterAll(() => {
  rmSync(pastaTemp, { recursive: true, force: true })
})

describe('o engine concreto da wake word (ESLint)', () => {
  const proibidos: ReadonlyArray<readonly [string, string]> = [
    ['o módulo do engine', "import { criarEngineOpenWakeWord } from '../engine-openwakeword'"],
    [
      'o módulo do engine, caminho irmão',
      "import { criarEngineOpenWakeWord } from './engine-openwakeword'"
    ],
    ['o pacote openwakeword', "import wake from 'openwakeword'"]
  ]

  it.each(proibidos)(
    'quebra o lint ao importar %s fora da composição',
    async (rotulo, importacao) => {
      const erros = await errosDaGuarda(
        `viola-${rotulo.replace(/[^a-z]/gi, '')}.ts`,
        `${importacao}\nexport const x = 1\n`
      )
      expect(erros).toBeGreaterThan(0)
    }
  )

  it('passa quando o arquivo fala só com a interface WakeWordEngine', async () => {
    const erros = await errosDaGuarda(
      'limpo.ts',
      [
        "import type { WakeWordEngine } from '../wake-word-engine'",
        'export const usa = (e: WakeWordEngine) => e.obterLimiar()'
      ].join('\n')
    )
    expect(erros).toBe(0)
  })
})
