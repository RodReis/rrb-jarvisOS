/**
 * O estado persistido da escuta (SPEC-Escuta-01, critério 8): kill switch, gatilhos, sensibilidade.
 *
 * Arquivo local sob `userData` e não coluna de preferências: o estado é do main (a tela só o lê
 * pela ponte) e uma coluna nova arrastaria migração e o tipo compartilhado de preferências.
 *
 * **Falha fechado.** Arquivo ausente é primeira execução e vale o padrão do serviço (ligada, depois
 * de o modelo estar pronto). Arquivo que existe e não se lê — corrompido, forma errada — **não** é
 * primeira execução: se o PI havia desligado o microfone, abri-lo "por padrão" seria o pior
 * desfecho possível. Nesse caso volta desligada, com o restante no padrão.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LIMIAR_PADRAO_WAKE_WORD } from './wake-word-engine'
import type { EstadoPersistidoDaEscuta } from './escuta-service'

const FALHA_FECHADO: EstadoPersistidoDaEscuta = {
  ativa: false,
  frase: true,
  palmas: true,
  sensibilidade: LIMIAR_PADRAO_WAKE_WORD
}

function forma(valor: unknown): valor is EstadoPersistidoDaEscuta {
  if (typeof valor !== 'object' || valor === null) return false
  const v = valor as Record<string, unknown>
  return (
    typeof v.ativa === 'boolean' &&
    typeof v.frase === 'boolean' &&
    typeof v.palmas === 'boolean' &&
    typeof v.sensibilidade === 'number' &&
    Number.isFinite(v.sensibilidade)
  )
}

export function criarEstadoDaEscutaEmDisco(caminho: string): {
  readonly ler: () => EstadoPersistidoDaEscuta | undefined
  readonly gravar: (estado: EstadoPersistidoDaEscuta) => void
} {
  return {
    ler() {
      let texto: string
      try {
        texto = readFileSync(caminho, 'utf8')
      } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        return FALHA_FECHADO
      }
      try {
        const lido: unknown = JSON.parse(texto)
        return forma(lido) ? lido : FALHA_FECHADO
      } catch {
        return FALHA_FECHADO
      }
    },

    gravar(estado) {
      mkdirSync(dirname(caminho), { recursive: true })
      // Gravar e renomear: queda no meio da escrita não pode deixar o arquivo pela metade, que
      // a leitura acima trataria como corrompido e desligaria a escuta sem o PI ter pedido.
      const temporario = `${caminho}.tmp`
      writeFileSync(temporario, JSON.stringify(estado))
      renameSync(temporario, caminho)
    }
  }
}
