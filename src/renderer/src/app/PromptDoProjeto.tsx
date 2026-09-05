import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { GeracaoOutcome } from '@shared/domain/brief'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { Button, Disclosure, Field, InlineAlert, LoadingState, Textarea } from '@design/ui'
import { log } from '../lib/log'
import { AvisoDaRotaPaga, SeloDaRota } from './RotaDaGeracao'

/**
 * A etapa do prompt (SPEC-Jornada-02, critério 1).
 *
 * A tela que faltava no MVP-008: **em nenhum momento o PI dizia o que o projeto é**. O wizard
 * perguntava sobre escopo e público, mas ninguém nunca escrevia a frase que originou tudo.
 *
 * Três decisões de forma:
 *
 *  - **Um campo, e nada mais.** Sem contador de caracteres, sem sugestão de estrutura, sem
 *    exemplo pré-preenchido. A página inteira é a pergunta, e qualquer moldura ao redor dela
 *    empurraria o PI a preencher um formulário em vez de descrever o que quer.
 *  - **O bloqueio de rota aparece antes do botão**, não depois do clique. Descobrir que não há
 *    rota autorizada só ao tentar gerar é a mesma fricção que o critério 6 evita no custo — e
 *    o aviso traz a ação, porque bloqueio sem saída é beco.
 *  - **Salvar e gerar são um ato só.** Dois botões fariam o PI escolher entre guardar e
 *    avançar, quando o que ele quer é seguir; o texto é salvo no caminho para a geração.
 */

interface PromptDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Chamado quando o prompt foi salvo e a geração pediu para avançar a jornada. */
  readonly onAvancar: () => void
}

export function PromptDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAvancar
}: PromptDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [rota, setRota] = useState<ResultadoDaRota | null>(null)
  /*
   * O desfecho **inteiro**, e não uma string já concatenada.
   *
   * A versão anterior fazia `[mensagem, acao].join(' ')` e jogava fora `problemas` e
   * `textoDoModelo` — que o main já devolvia. O PI lia "a saída do modelo não passou no
   * validador, nem depois da correção" enquanto o console, logo abaixo, mostrava o modelo
   * dizendo que o diretório já continha outro produto e que ele não ia sobrescrever. A tela
   * tinha o fato e mostrava a frase genérica.
   */
  const [recusa, setRecusa] = useState<GeracaoOutcome | null>(null)

  useEffect(() => {
    let ativo = true

    Promise.all([
      window.jarvis.lerPromptDoProjeto(projectId, workspace),
      window.jarvis.rotaDaGeracao(projectId, workspace)
    ])
      .then(([prompt, rotaAtual]) => {
        if (!ativo) return
        // O texto já escrito volta para o campo: reabrir o projeto não pode custar o rascunho.
        if (prompt !== null) setTexto(prompt.texto)
        setRota(rotaAtual)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o prompt', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  async function salvarEGerar(): Promise<void> {
    setOcupado(true)
    setRecusa(null)

    try {
      await window.jarvis.salvarPromptDoProjeto(projectId, texto, workspace)
      const desfecho = await window.jarvis.gerarBrief(projectId, workspace)

      if (desfecho.resultado === 'gerado') {
        onAvancar()
        return
      }

      // Recusa é desfecho, não exceção: o main devolve mensagem, ação, problemas e — quando o
      // modelo respondeu em prosa — o que ele escreveu. A tela guarda tudo e decide o que expor.
      setRecusa(desfecho)
    } catch (error: unknown) {
      log.ui.error('Falha ao salvar o prompt e gerar o brief', { error })
      setRecusa({ resultado: 'saida-invalida', mensagem: t('prompt.falha') })
    } finally {
      setOcupado(false)
    }
  }

  if (carregando) return <LoadingState rotulo={t('prompt.carregando')} />

  const bloqueado = rota?.decisao === 'bloqueado'
  const vazio = texto.trim().length === 0

  return (
    /*
     * O ritmo da coluna, e não sete irmãos com o mesmo `gap`.
     *
     * A versão anterior separava tudo por `gap-4`: cabeçalho, avisos, campo, exemplos e botão
     * pesavam igual, e a tela lida de relance virava uma pilha de blocos sem começo — foi o que
     * a captura do PI mostrou como "poluída". A régua do craft floor é a oposta: grupo apertado,
     * separação generosa. Aqui há **três** grupos, e o espaço entre eles é o que os nomeia.
     *
     * A coluna tem medida de leitura. O campo do prompt herdava a largura inteira do painel, e
     * uma linha de texto de 120 caracteres cansa o retorno de linha exatamente onde o PI escreve
     * o texto mais longo do produto — a prosa acima dele já respeitava `62ch`, e o campo não.
     */
    <div className="flex max-w-[74ch] flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('prompt.titulo')}
        </h3>
        {/* Medida de leitura: prosa larga demais cansa o retorno de linha. */}
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('prompt.descricao', { nome: nomeDoProjeto })}
        </p>
      </header>

      {/*
        Os avisos são um grupo só e só existem quando existe aviso: um contêiner vazio deixaria
        o espaço reservado, e espaço reservado ensina o olho a pular a região — a mesma régua do
        bloqueio no card de projeto.

        O bloqueio vem **acima** do campo, não junto ao botão: se não há rota, escrever o prompt
        ainda vale (o texto é salvo), mas o PI merece saber antes de esperar por uma geração que
        não vai acontecer.
      */}
      {(bloqueado || recusa !== null || rota?.decisao === 'paga') && (
        <div className="flex flex-col gap-3">
          {bloqueado && rota?.acao !== undefined && (
            <InlineAlert tom="warn" titulo={t('prompt.semRota')}>
              {rota.acao}
            </InlineAlert>
          )}

          <AvisoDaRotaPaga rota={rota} />

          {recusa !== null && <RecusaDaGeracao desfecho={recusa} />}
        </div>
      )}

      {/*
        O campo e os exemplos são **um grupo**: os exemplos existem para desbloquear a página em
        branco, e separá-los do campo com o mesmo espaço que separa as seções os transformava num
        bloco autônomo que o olho lê depois de já ter decidido não escrever.

        Exemplos para **ler**, não para clicar (decisão do PI, 2026-09-03). A página em branco é
        o problema real desta tela: o campo grande e vazio chega no momento em que o PI tem menos
        ideia do que escrever. Mas cartão que preenche o campo faria ele partir do texto da IA em
        vez do problema dele — e a decisão de "um campo, e nada mais" existe justamente para a
        tela não virar formulário. Por isso são duas frases curtas, sem controle nenhum: não há
        clique, não há `input`, e a prova visual que trava "um `textarea`, zero `input`" continua
        valendo.
      */}
      <div className="flex flex-col gap-3">
        <Field rotulo={t('prompt.rotulo')} descricao={t('prompt.ajuda')}>
          {(atributos) => (
            <Textarea
              {...atributos}
              valor={texto}
              onMudar={setTexto}
              placeholder={t('prompt.placeholder')}
              desabilitado={ocupado}
              /*
               * Piso de 6 linhas, e o campo cresce daí. O valor fixo anterior abria meio metro
               * de vazio sob uma frase — a captura mostrou 500px de campo escuro embaixo de uma
               * linha de texto, e um campo grande e vazio intimida exatamente quem ainda não
               * sabe o que escrever. Seis linhas convidam sem cobrar.
               */
              linhas={6}
            />
          )}
        </Field>

        <div className="flex flex-col gap-1.5">
          <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {t('prompt.exemplosTitulo')}
          </p>

          {/*
            Grade de duas trilhas em vez de linha que reflui: a frase e o motivo ficam alinhados
            entre os dois exemplos, então o olho lê a coluna do "porquê" de uma vez. Com
            `flex-wrap`, o motivo do primeiro exemplo pousava em qualquer posição horizontal e os
            dois pares deixavam de se ler como uma lista.

            `subgrid` não serve: as trilhas precisam viver na lista, e é onde estão.
          */}
          <ul className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
            {[
              { texto: t('prompt.exemploA'), porque: t('prompt.exemploAPorque') },
              { texto: t('prompt.exemploB'), porque: t('prompt.exemploBPorque') }
            ].map((exemplo) => (
              <li
                key={exemplo.porque}
                className="grid gap-x-3 text-[length:var(--jos-texto-micro)] sm:col-span-2 sm:grid-cols-subgrid sm:items-baseline"
              >
                <span className="text-[var(--jos-cor-texto-secundario)]">“{exemplo.texto}”</span>
                <span className="font-[family-name:var(--jos-fonte-mono)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
                  {exemplo.porque}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/*
        A ação, atrás de uma divisória: escrever e gerar são momentos diferentes, e uma linha é
        o jeito mais barato de dizer isso. Sem ela, o botão era só mais um irmão na pilha — e a
        única ação da tela ficava com o mesmo peso visual dos exemplos acima dele.
      */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-5">
        <Button
          variante="primaria"
          onClick={() => void salvarEGerar()}
          desabilitado={ocupado || vazio || bloqueado}
          carregando={ocupado}
          iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
        >
          {/*
            O rótulo muda durante a espera. A geração do brief leva dezenas de segundos, e o
            botão anterior ficava com o texto "Gerar o brief" e um spinner — indistinguível de
            uma tela travada. Dizer "Gerando o brief…" custa uma chave de tradução e é a
            diferença entre esperar e achar que nada aconteceu.
          */}
          {ocupado ? t('prompt.gerando') : t('prompt.gerar')}
        </Button>

        {/* Diz **por que** o botão está desabilitado. Um alvo morto sem explicação faz o PI
            procurar o defeito na própria escrita. */}
        {vazio && !bloqueado ? (
          <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {t('prompt.escrevaAlgo')}
          </span>
        ) : (
          // Por onde a geração sai. Só aparece quando o botão de fato gera: com o campo vazio,
          // o que o PI precisa saber é o que falta, não a rota.
          <SeloDaRota rota={rota} />
        )}
      </div>
    </div>
  )
}

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
function RecusaDaGeracao({ desfecho }: { readonly desfecho: GeracaoOutcome }): React.JSX.Element {
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
