import { describe, expect, it } from 'vitest'
import { ACCENT_PALETTE } from '@shared/domain/entities'
import { PALETA_ACENTO } from '@design/tokens/acento'

/**
 * A paleta de acento vive em dois lugares por uma razão de fronteira (F01): o `@shared`
 * (`ACCENT_PALETTE`) valida a cor gravada no main, e o DS (`PALETA_ACENTO`) a oferece na UI. Os dois
 * não podem importar um do outro — o DS é proibido de importar `@shared`, e o `@shared` não importa
 * o DS por convenção de camadas. Este teste mora no **renderer**, que pode importar ambos, e é o que
 * impede as duas cópias de divergirem em silêncio.
 *
 * Só a **lista** é travada, não o default de fábrica (`ACCENT_DEFAULT` vs `ACENTO_PADRAO`): a paleta
 * é estável, mas o default do JARVIS está sendo alinhado para prata em paralelo, e travar o valor
 * acoplaria esta fatia a essa mudança. Divergência de default é cosmética; divergência de paleta
 * deixaria a UI oferecer uma cor que o main recusa — por isso esta é travada.
 */
describe('paleta de acento — shared e DS em sincronia', () => {
  it('as duas listas têm as mesmas 8 cores, na mesma ordem', () => {
    expect([...ACCENT_PALETTE]).toEqual([...PALETA_ACENTO])
  })
})
