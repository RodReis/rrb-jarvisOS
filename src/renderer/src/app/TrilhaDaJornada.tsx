import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { EstadoDaJornada, EtapaNaTrilha } from '@shared/domain/jornada'
import { exigeAceiteDoPi } from '@shared/domain/jornada'
import { Button, InlineAlert } from '@design/ui'

/**
 * A jornada como trilha (SPEC-Jornada-01).
 *
 * A pergunta que esta tela responde é *"onde estou e qual é o próximo passo?"* — a que o
 * MVP-008 deixou sem resposta ao entregar quatro botões lado a lado sem ordem entre eles.
 *
 * **A trilha é uma coluna com espinha contínua, não uma fileira de cartões.** Cartões
 * uniformes são o container preguiçoso: eles dariam o mesmo peso visual às doze etapas quando
 * exatamente uma importa agora. A espinha vertical carrega a ordem sem que ninguém precise
 * lê-la, e o recuo do conteúdo em relação ao marcador é o que separa "a trilha" de "esta
 * etapa".
 *
 * **Progresso nunca é só cor** (princípio 2 do PRODUCT.md). Cada posição tem três sinais
 * redundantes: a **forma** do marcador (marca de concluído, disco cheio, anel vazado), o
 * **peso** do texto e a **presença ou ausência do botão**. Quem vê em escala de cinza, quem
 * olha de relance e quem ouve a interface recebem o mesmo fato.
 *
 * **Só a etapa atual tem botão** (critério 3). Etapa futura diz o que falta em texto e não
 * oferece ação (critério 4); etapa concluída é consultável, não reexecutável. Um botão
 * desabilitado em cada linha futura encheria a coluna de alvos mortos — a ausência comunica
 * melhor que a desabilitação.
 */

interface TrilhaDaJornadaProps {
  readonly estado: EstadoDaJornada
  /** Dispara o CTA da etapa atual. */
  readonly onAgir: () => void
  readonly ocupado?: boolean
}

/**
 * O marcador de cada posição. **Forma antes de cor**: o concluído leva a marca de verificação,
 * o atual é um disco cheio com halo, e o futuro é um anel vazado. Em escala de cinza os três
 * continuam distinguíveis, que é o teste que o princípio 2 exige.
 */
function Marcador({ posicao }: { readonly posicao: EtapaNaTrilha['posicao'] }): React.JSX.Element {
  if (posicao === 'concluida') {
    return (
      <span
        aria-hidden="true"
        className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--jos-cor-acento)] text-[var(--jos-cor-acento-contraste)]"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  }

  if (posicao === 'atual') {
    return (
      <span
        aria-hidden="true"
        className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-[var(--jos-cor-acento)] bg-[var(--jos-cor-superficie)]"
      >
        {/* O ponto interno é o que distingue "atual" de "futuro" a três metros de distância:
            os dois são anéis, e só um tem núcleo. */}
        <span className="size-2 rounded-full bg-[var(--jos-cor-acento)]" />
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="relative z-10 size-5 shrink-0 rounded-full border border-[rgba(var(--jos-borda-rgb),0.28)] bg-[var(--jos-cor-superficie)]"
    />
  )
}

export function TrilhaDaJornada({
  estado,
  onAgir,
  ocupado = false
}: TrilhaDaJornadaProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      {/*
        A regressão aparece **acima** da trilha, não ao lado da etapa que voltou: o PI precisa
        saber *por que* a jornada andou para trás antes de procurar onde ela parou. Enterrar o
        motivo numa linha da coluna faria a causa competir com o próximo passo.
      */}
      {estado.motivoDaRegressao !== null && (
        <InlineAlert tom="warn" titulo={t('jornada.regrediu')}>
          {estado.motivoDaRegressao}
        </InlineAlert>
      )}

      {/*
        `ol` porque a ordem é o conteúdo: um leitor de tela anuncia "item 4 de 12" e entrega
        de graça a informação que a espinha dá visualmente.
      */}
      <ol className="relative flex flex-col">
        {/*
          A espinha: uma linha só, atrás dos marcadores, começando e terminando no centro do
          primeiro e do último. Desenhá-la por item deixaria emendas visíveis entre as linhas.
        */}
        <span
          aria-hidden="true"
          className="absolute bottom-[1.625rem] left-[0.625rem] top-[1.625rem] w-px -translate-x-1/2 bg-[rgba(var(--jos-borda-rgb),0.28)]"
        />

        {estado.trilha.map((etapa) => {
          const concluida = etapa.posicao === 'concluida'
          const atual = etapa.posicao === 'atual'

          return (
            <li
              key={etapa.etapa}
              data-jos-etapa={etapa.etapa}
              data-jos-posicao={etapa.posicao}
              /* `aria-current="step"` é o que faz "você está aqui" existir para quem ouve a
                 interface — sem ele, a etapa atual seria só mais um item da lista. */
              aria-current={atual ? 'step' : undefined}
              /*
                A etapa atual ganha superfície própria; as outras onze ficam sobre o fundo.
                Doze linhas com a mesma densidade obrigavam a **procurar** onde a jornada
                está — o marcador sozinho carregava esse trabalho num ponto de 20px. O bloco
                estende o sinal do marcador ao rótulo e à ação, que é o que o olho varre.

                O recuo negativo compensa o padding para o marcador não sair do prumo da
                espinha: o realce não pode deslocar a coluna que ele destaca.
              */
              className={
                atual
                  ? // `relative` + fundo opaco: a espinha passa **atrás** de todos os itens, e
                    // num bloco translúcido ela riscava a caixa de ponta a ponta. Opaco, o
                    // bloco a interrompe — que é o que "você está aqui" significa numa linha.
                    'relative -mx-3 flex items-start gap-3 rounded-[var(--jos-raio-card)] border border-[color-mix(in_srgb,var(--jos-cor-acento)_28%,transparent)] bg-[color-mix(in_srgb,var(--jos-cor-acento)_7%,var(--jos-cor-superficie))] px-3 py-3'
                  : 'flex items-start gap-3 py-2.5'
              }
            >
              <Marcador posicao={etapa.posicao} />

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  className={
                    atual
                      ? 'text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]'
                      : concluida
                        ? 'text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]'
                        : 'text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-suave)]'
                  }
                >
                  {t(`jornada.etapas.${etapa.etapa}`)}
                </span>

                {/*
                  As etapas de aceite ficam marcadas **na trilha inteira**, e não só quando
                  chegam: saber de antemão onde a jornada vai parar para pedir a decisão do PI
                  é o que separa uma trilha de uma barra de progresso. São cinco das doze.

                  Em mono maiúsculo — a mesma forma que o resto do app usa para metadado — e
                  não um ícone colorido: é texto, então atravessa daltonismo, escala de cinza e
                  leitor de tela sem depender de legenda.
                */}
                {exigeAceiteDoPi(etapa.etapa) && !concluida && (
                  <span
                    className={
                      atual
                        ? 'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]'
                        : 'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]'
                    }
                  >
                    {t('jornada.pedeAceite')}
                  </span>
                )}

                {/*
                  O botão fica **abaixo** do rótulo, não à direita dele.

                  A trilha é uma coluna de 19rem, e ao lado de um rótulo o botão só cabia
                  quebrando a linha — o que a captura mostrou como um degrau solto entre a etapa
                  atual e a seguinte. Empilhar é a decisão honesta para esta largura: a ação
                  ganha a própria linha e o topo do bloco continua alinhado ao marcador.

                  O espaçamento vive na `div` que o embrulha, e não numa `className` no próprio
                  `Button`: o DS não aceita classe de fora (`PropsDeComposicao`), e é a regra
                  certa — um componente que aceitasse estilo arbitrário deixaria de ter forma
                  própria. Quem posiciona é o layout, não o controle.
                */}
                {atual && (
                  <div className="mt-1 flex">
                    {/* `primaria`: é o próximo passo da jornada, o único botão da coluna e a
                        razão de a trilha existir. No default `secundaria` ele saía contornado
                        e leve — o mesmo peso do "Voltar" — e o acento do usuário, que já pinta
                        o marcador desta etapa, não chegava à ação que o marcador aponta. */}
                    <Button
                      variante="primaria"
                      onClick={onAgir}
                      desabilitado={ocupado}
                      carregando={ocupado}
                    >
                      {etapa.cta}
                    </Button>
                  </div>
                )}

                {/*
                  O que falta, dito em texto (critério 4). Fica sob o nome da etapa e em micro:
                  é resposta a uma pergunta que só se faz olhando para uma etapa futura, e não
                  deve competir com o próximo passo real.
                */}
                {etapa.oQueFalta !== null && (
                  <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                    {etapa.oQueFalta}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
