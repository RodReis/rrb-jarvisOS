import { ProvedorDeTema } from '@design/tokens/provider'
import { ACENTO_PADRAO, type CorAcento } from '@design/tokens/acento'
import { identidade } from '@design/tokens/identidade'
import type { Modulo } from '@design/tokens/semantic'
import { AccentSwatchSelector } from '@design/patterns'
import { Button, Card, VoiceMascot } from '@design/ui'

/**
 * Tela CHOICE — a 2ª do protótipo (README §1), primeira da jornada de prova da F06.
 *
 * O que ela prova, e por isso é a primeira: **as duas identidades lado a lado**, com acento
 * independente por módulo. Se a base única falhasse, falharia aqui — os dois cards são o mesmo
 * componente recebendo dados diferentes, e um olho humano os vê juntos.
 *
 * **Sempre escura.** É superfície de marca (README §2.6), como Login e Toast: `superficie` vale
 * `'choice'`, e o `modoEfetivo` da F02 ignora o `uiTheme` aqui. Por isso esta tela não aparece na
 * matriz claro/escuro do critério 2 — ela não tem modo claro, por decisão de produto.
 */

export function Choice({
  acentoJarvis,
  acentoNoa,
  onEscolherAcento,
  onEntrar
}: {
  readonly acentoJarvis: CorAcento
  readonly acentoNoa: CorAcento
  readonly onEscolherAcento: (modulo: Modulo, cor: CorAcento) => void
  readonly onEntrar: (modulo: Modulo) => void
}): React.JSX.Element {
  return (
    <ProvedorDeTema
      // `superficie='choice'` é o que trava o escuro. Passar `'jarvis'` aqui faria a tela de
      // marca inverter no tema claro — o defeito que a F02 criou o conceito para impedir.
      superficie="choice"
      modulo="jarvis"
      uiTheme="dark"
      accentJarvis={acentoJarvis}
      accentNoa={acentoNoa}
    >
      <div
        data-jornada="choice"
        className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--jos-cor-superficie)] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
      >
        <h1 className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-tela)]">
          Escolha o espaço
        </h1>

        <div className="flex flex-wrap justify-center gap-6">
          {(['noa', 'jarvis'] as const).map((modulo) => (
            <CardDeIdentidade
              key={modulo}
              modulo={modulo}
              acento={modulo === 'jarvis' ? acentoJarvis : acentoNoa}
              onEscolherAcento={(cor) => onEscolherAcento(modulo, cor)}
              onEntrar={() => onEntrar(modulo)}
            />
          ))}
        </div>
      </div>
    </ProvedorDeTema>
  )
}

/**
 * Um card por identidade — **o mesmo componente para os dois**.
 *
 * Note o provider aninhado: cada card monta o seu próprio `ProvedorDeTema` com o seu `modulo`,
 * o que faz o acento e o mascote virem da identidade certa sem nenhum `if` aqui dentro. É a
 * tese da F05 sendo usada, não repetida.
 */
function CardDeIdentidade({
  modulo,
  acento,
  onEscolherAcento,
  onEntrar
}: {
  readonly modulo: Modulo
  readonly acento: CorAcento
  readonly onEscolherAcento: (cor: CorAcento) => void
  readonly onEntrar: () => void
}): React.JSX.Element {
  const id = identidade(modulo)

  return (
    <ProvedorDeTema
      superficie="choice"
      modulo={modulo}
      uiTheme="dark"
      accentJarvis={modulo === 'jarvis' ? acento : ACENTO_PADRAO.jarvis}
      accentNoa={modulo === 'noa' ? acento : ACENTO_PADRAO.noa}
    >
      <div data-jornada-card={modulo} className="w-72">
        <Card titulo={id.nome}>
          <div className="flex flex-col items-center gap-4">
            <VoiceMascot modulo={modulo} tamanho="medio" />

            <p className="text-center text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
              {modulo === 'noa' ? 'Espaço pessoal' : 'Espaço profissional'}
            </p>

            <div className="flex w-full flex-col gap-2">
              <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
                Tema
              </span>
              <AccentSwatchSelector
                valor={acento}
                onEscolher={onEscolherAcento}
                rotulo={`Acento de ${id.nome}`}
              />
            </div>

            {/* `Button` do DS, não um `<button>` com classes soltas: o critério 1 exige que a
                jornada seja composta **só** com componentes públicos. Um botão local aqui seria
                exatamente o estilo paralelo que esta fatia existe para eliminar. */}
            <Button larguraTotal onClick={onEntrar}>
              Entrar em {id.nome}
            </Button>
          </div>
        </Card>
      </div>
    </ProvedorDeTema>
  )
}
