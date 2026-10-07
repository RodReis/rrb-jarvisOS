import { describe, expect, it } from 'vitest'
import {
  MAX_BYTES_POR_ARQUIVO_DO_PAINEL,
  MAX_BYTES_POR_RUN_DO_PAINEL,
  caminhoRelativoDoPainelValido,
  decidirSnapshot
} from './painel-tarefa'

describe('contrato de snapshot do painel de tarefa', () => {
  it('aceita arquivo e diff até o limite total do run', () => {
    expect(
      decidirSnapshot({
        bytesDoConteudo: MAX_BYTES_POR_ARQUIVO_DO_PAINEL,
        bytesDoDiff: 1024,
        bytesDoRunJaGravados: MAX_BYTES_POR_RUN_DO_PAINEL - MAX_BYTES_POR_ARQUIVO_DO_PAINEL - 1024
      })
    ).toEqual({ permitido: true, bytesReservados: MAX_BYTES_POR_ARQUIVO_DO_PAINEL + 1024 })
  })

  it('omite arquivo que ultrapassa 10 MiB', () => {
    expect(
      decidirSnapshot({
        bytesDoConteudo: MAX_BYTES_POR_ARQUIVO_DO_PAINEL + 1,
        bytesDoRunJaGravados: 0
      })
    ).toEqual({ permitido: false, motivo: 'arquivo-acima-do-limite' })
  })

  it('omite o item que ultrapassaria 50 MiB no run', () => {
    expect(
      decidirSnapshot({
        bytesDoConteudo: 10,
        bytesDoDiff: 5,
        bytesDoRunJaGravados: MAX_BYTES_POR_RUN_DO_PAINEL - 14
      })
    ).toEqual({ permitido: false, motivo: 'run-acima-do-limite' })
  })

  it.each(['src/main.ts', 'docs/a b.md', 'área/arquivo.ts'])(
    'aceita caminho relativo %s',
    (path) => {
      expect(caminhoRelativoDoPainelValido(path)).toBe(true)
    }
  )

  it.each(['C:/secret.txt', '/etc/passwd', '../fora', 'src/../../fora', 'src\\file.ts', ''])(
    'recusa caminho não relativo seguro %s',
    (path) => expect(caminhoRelativoDoPainelValido(path)).toBe(false)
  )
})
