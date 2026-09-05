/**
 * O `abrirCwd` dos testes de adapter: um run neutro de verdade, em diretório temporário.
 *
 * Diretório real e não um dublê que devolve um caminho: o que os testes da emenda E1 provam é
 * que o diretório **existe**, está **vazio** no spawn e **não existe** depois — e um dublê que
 * só devolvesse string faria as três asserções passarem sem que nada disso fosse verdade.
 *
 * Guarda os caminhos abertos para que o teste possa afirmar sobre eles depois da remoção.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { abrirRunNeutro, type RunNeutro } from './cwd-neutro'

export interface RunsDeTeste {
  /** O que se passa ao adapter no lugar do `abrirRunNeutro` de produção. */
  readonly abrir: () => RunNeutro
  /** Os caminhos abertos, na ordem. O teste confere que sumiram. */
  readonly caminhos: string[]
}

export function runsDeTeste(): RunsDeTeste {
  const base = mkdtempSync(`${tmpdir()}/jarvis-cli-runs-`)
  const caminhos: string[] = []

  return {
    abrir: () => {
      const run = abrirRunNeutro(base)
      caminhos.push(run.caminho)
      return run
    },
    caminhos
  }
}
