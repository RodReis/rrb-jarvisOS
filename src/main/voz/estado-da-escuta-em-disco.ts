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
import { HOTKEY_DE_MUTE_PADRAO, isHotkeyDeMuteDaEscuta } from '@shared/domain/voz'
import { LIMIAR_PADRAO_WAKE_WORD } from './wake-word-engine'
import type { EstadoPersistidoDaEscuta } from './escuta-service'

const FALHA_FECHADO: EstadoPersistidoDaEscuta = {
  ativa: false,
  frase: true,
  palmas: true,
  sensibilidade: LIMIAR_PADRAO_WAKE_WORD,
  hotkey: HOTKEY_DE_MUTE_PADRAO
}

/** Lê o estado; a hotkey é a única parte tolerante, porque arquivo antigo não a tinha. */
function forma(valor: unknown): EstadoPersistidoDaEscuta | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined
  const v = valor as Record<string, unknown>
  if (
    typeof v.ativa !== 'boolean' ||
    typeof v.frase !== 'boolean' ||
    typeof v.palmas !== 'boolean' ||
    typeof v.sensibilidade !== 'number' ||
    !Number.isFinite(v.sensibilidade)
  ) {
    return undefined
  }
  return {
    ativa: v.ativa,
    frase: v.frase,
    palmas: v.palmas,
    sensibilidade: v.sensibilidade,
    hotkey: isHotkeyDeMuteDaEscuta(v.hotkey) ? v.hotkey : HOTKEY_DE_MUTE_PADRAO
  }
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
        return forma(lido) ?? FALHA_FECHADO
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
