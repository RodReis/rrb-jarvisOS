import { useState } from 'react'
import { ACENTO_PADRAO, type CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import { Choice } from './Choice'
import { NoaHoje } from './NoaHoje'
import { JarvisHud } from './JarvisHud'

/**
 * A jornada de prova da F06 — CHOICE → NOA Hoje → JARVIS HUD.
 *
 * Não é um roteador de produto: é o mínimo para que as três telas sejam **percorridas**, e é o
 * percurso que prova o critério 2. Estático, cada tela isolada, não provaria o que importa — que
 * o acento escolhido na CHOICE **chega** à tela interna, e que trocar de espaço não vaza a
 * identidade do outro.
 *
 * O acento vive aqui, acima das telas, porque é isso que o app real fará: a CHOICE escolhe, o
 * Settings persiste (SPEC-Fundacao-05) e as telas internas consomem. O DS nunca persiste nada.
 */

export type TelaDaJornada = 'choice' | 'noa' | 'jarvis'

export function Jornada({
  telaInicial = 'choice',
  uiTheme = 'dark'
}: {
  readonly telaInicial?: TelaDaJornada
  readonly uiTheme?: ModoUi
}): React.JSX.Element {
  const [tela, setTela] = useState<TelaDaJornada>(telaInicial)
  const [acentoJarvis, setAcentoJarvis] = useState<CorAcento>(ACENTO_PADRAO.jarvis)
  const [acentoNoa, setAcentoNoa] = useState<CorAcento>(ACENTO_PADRAO.noa)

  function escolherAcento(modulo: Modulo, cor: CorAcento): void {
    // Um setter por módulo, não um objeto compartilhado: é a garantia estrutural de que escolher
    // no NOA não move o JARVIS (critério 3, herdado da F05).
    if (modulo === 'jarvis') setAcentoJarvis(cor)
    else setAcentoNoa(cor)
  }

  if (tela === 'choice') {
    return (
      <Choice
        acentoJarvis={acentoJarvis}
        acentoNoa={acentoNoa}
        onEscolherAcento={escolherAcento}
        onEntrar={setTela}
      />
    )
  }

  if (tela === 'noa') {
    return <NoaHoje uiTheme={uiTheme} acento={acentoNoa} />
  }

  return <JarvisHud uiTheme={uiTheme} acento={acentoJarvis} />
}
