/**
 * Fronteira do design system (SPEC-DesignSystem-01, critério 2).
 *
 * A regra `no-restricted-imports` de `eslint.config.js` é o que impede o DS de conhecer
 * domínio, main, Electron/Node ou Supabase. Uma regra de lint só vale se alguém a
 * exercita: sem estes testes, um `files:` errado ou um `group:` mal escrito deixaria a
 * regra silenciosamente inerte, e o `lint` verde diria que a fronteira existe.
 *
 * Por isso o teste roda o **ESLint de verdade**, sobre a config de verdade, nos dois
 * sentidos que a spec exige — arquivo que viola falha, arquivo limpo passa. Ele escreve
 * arquivos temporários dentro de `src/design/` (a regra é escopada por caminho, então o
 * arquivo precisa morar lá) e os remove no teardown: por isso é integração, não regra.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const RAIZ_DS = join(process.cwd(), 'src', 'design')
const ID_REGRA = 'no-restricted-imports'

let pastaTemp = ''
const eslint = new ESLint()

/** Escreve um arquivo dentro do DS e devolve os erros da regra de fronteira nele. */
async function errosDeFronteira(nomeArquivo: string, codigo: string): Promise<number> {
  const caminho = join(pastaTemp, nomeArquivo)
  writeFileSync(caminho, codigo, 'utf8')
  const [resultado] = await eslint.lintFiles([caminho])
  return resultado.messages.filter((m) => m.ruleId === ID_REGRA).length
}

beforeAll(() => {
  pastaTemp = mkdtempSync(join(RAIZ_DS, 'fronteira-temp-'))
})

afterAll(() => {
  rmSync(pastaTemp, { recursive: true, force: true })
})

describe('fronteira do design system (ESLint)', () => {
  // Cada caminho proibido é um vetor distinto de acoplamento: domínio, processo main,
  // plataforma e espelho de sync. Um `group:` que cobrisse só parte deles passaria num
  // teste único e deixaria os outros entrarem.
  const proibidos: ReadonlyArray<readonly [string, string]> = [
    ['domínio via alias @shared', "import type { Workspace } from '@shared/domain/entities'"],
    ['renderer via alias @renderer', "import { useAuth } from '@renderer/auth/useAuth'"],
    ['main process', "import { criarJanela } from '../../main/window'"],
    ['Electron', "import { ipcRenderer } from 'electron'"],
    ['Node', "import { readFileSync } from 'node:fs'"],
    ['Supabase', "import { createClient } from '@supabase/supabase-js'"]
  ]

  it.each(proibidos)('quebra o lint ao importar %s', async (rotulo, importacao) => {
    const erros = await errosDeFronteira(
      `viola-${rotulo.replace(/[^a-z]/gi, '')}.ts`,
      `${importacao}\nexport const x = 1\n`
    )
    expect(erros).toBeGreaterThan(0)
  })

  it('passa quando o arquivo importa só dentro do DS e as bases permitidas', async () => {
    const erros = await errosDeFronteira(
      'limpo.tsx',
      [
        "import * as RadixSwitch from '@radix-ui/react-switch'",
        "import { Settings2 } from 'lucide-react'",
        "import { tokenCss } from '../tokens'",
        'export const usa = [RadixSwitch.Root, Settings2, tokenCss]'
      ].join('\n') + '\n'
    )
    expect(erros).toBe(0)
  })

  it('não restringe o resto do app — a regra é escopada a src/design/', async () => {
    // Sem o escopo por `files:`, a regra vazaria para o renderer e o main, onde importar
    // `@shared` e `electron` é o desenho correto. Este teste é o guarda desse escopo.
    const caminhoForaDoDs = join(process.cwd(), 'src', 'renderer', 'src', 'auth', 'useAuth.ts')
    const [resultado] = await eslint.lintFiles([caminhoForaDoDs])
    expect(resultado.messages.filter((m) => m.ruleId === ID_REGRA)).toHaveLength(0)
  })
})
