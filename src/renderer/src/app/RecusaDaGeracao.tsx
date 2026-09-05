import { useTranslation } from 'react-i18next'
import type { GeracaoOutcome } from '@shared/domain/brief'
import { Disclosure, InlineAlert } from '@design/ui'

/**
 * Por que a geração não produziu o brief — dito de forma que o PI possa agir.
 *
 * A versão anterior desta tela mostrava uma linha: *"A saída do modelo não passou no validador,
 * nem depois da correção. Nada foi gravado."* Ela é verdadeira e inútil. O que o PI precisava
 * saber estava no console, embaixo, rolado para fora da vista: o modelo tinha encontrado outro
 * produto no diretório e recusado sobrescrever, pedindo uma confirmação. O alerta descrevia um
 * defeito de máquina onde havia uma **pergunta esperando resposta**.
 *
 * Três decisões de forma governam este bloco:
 *
 *  - **A observação do modelo vem primeiro, em texto legível.** Quando ele respondeu em prosa,
 *    isso *é* o conteúdo do erro — não um anexo dele. Fica aberto, em corpo, não em mono: é
 *    português escrito para ser lido, e mono aqui seria o costume de "técnico" que o
 *    PRODUCT.md lista como anti-referência.
 *  - **O detalhe do validador fica colapsado.** Ele importa quando importa, e sempre visível
 *    ensinaria o olho a pular o bloco inteiro — a mesma régua do bloqueio no card.
 *  - **A próxima ação está sempre na tela.** Erro que não diz o que fazer é beco; o PRD §14 e o
 *    PRODUCT.md pedem o par problema + recuperação, e é o mínimo que este bloco entrega.
 */
export function RecusaDaGeracao({
  desfecho
}: {
  readonly desfecho: GeracaoOutcome
}): React.JSX.Element {
  const { t } = useTranslation()

  const observacao = desfecho.textoDoModelo?.trim()
  const temObservacao = observacao !== undefined && observacao.length > 0

  /*
   * Vermelho é para o que quebrou. **Nada quebrou aqui.**
   *
   * Falta de rota é uma credencial que ninguém conectou; o modelo respondendo com uma
   * observação é ele lendo o pedido e levantando um ponto — o mais parecido com uma pergunta
   * que o produto tem. Pintar os dois de erro ensina o PI a ler estado normal como falha, e aí
   * o vermelho para de significar alguma coisa no dia em que algo de fato quebrar. É a mesma
   * régua que o índice de projetos já aplica: colisão de nome é `warn`, não `err`.
   *
   * Sobra `err` para o que é de fato defeito: resposta malformada e falha de chamada.
   */
  const tom = desfecho.resultado === 'bloqueado-sem-rota' || temObservacao ? 'warn' : 'err'

  // Deduplicado: a correção repete a mesma recusa quando o modelo erra igual duas vezes, e a
  // frase idêntica repetida não conta que houve duas tentativas — parece descuido.
  const problemas = [...new Set(desfecho.problemas ?? [])]

  return (
    <InlineAlert
      tom={tom}
      titulo={temObservacao ? t('prompt.modeloRespondeu') : t('prompt.naoGerou')}
    >
      {/*
        A ordem é a da leitura, e não a da estrutura de dados.
        
        Primeiro **o que o modelo disse** — é o conteúdo, e o motivo de o bloco existir. Depois
        **o que fazer**. Só então "nada foi gravado", que é garantia, não notícia: ela tranquiliza
        quem já leu o resto, e abrindo o bloco roubaria a primeira linha da observação.
      */}
      <div className="flex flex-col gap-3">
        {temObservacao && (
          /*
           * O que o modelo escreveu, com a marca de citação à esquerda: é fala de outra parte,
           * e a borda diz isso sem precisar de rótulo. `max-h` com rolagem porque a observação
           * pode ser longa — e um alerta que cresce sem teto empurra o campo do prompt para
           * fora da tela, que é justamente onde o PI vai agir depois de ler.
           */
          /*
           * Filete neutro de 1px, não uma barra colorida: faixa colorida à esquerda é decoração
           * fingindo de semântica — o tom já vive no ícone e na borda do alerta, e repeti-lo
           * aqui só engrossa. O recuo é o que diz "outra voz"; a linha só o ancora.
           */
          <blockquote className="max-h-56 overflow-auto whitespace-pre-wrap border-l border-[rgba(var(--jos-borda-rgb),0.30)] pl-3.5 text-[length:var(--jos-texto-corpo)] leading-relaxed text-[var(--jos-cor-texto)]">
            {observacao}
          </blockquote>
        )}

        {desfecho.acao !== undefined && (
          <p className="font-[var(--jos-peso-medio)] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
            {desfecho.acao}
          </p>
        )}

        {/* A garantia, em micro: "nada foi gravado" importa e não precisa competir. */}
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {desfecho.mensagem}
        </p>

        {problemas.length > 0 && (
          <Disclosure
            compacto
            rotulo={t('prompt.detalheTecnico')}
            resumo={
              <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
                {problemas.length}
              </span>
            }
          >
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
              {problemas.map((problema) => (
                <li key={problema}>{problema}</li>
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
    </InlineAlert>
  )
}
