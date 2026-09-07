import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  Afirmacao,
  BlocoDoBrief,
  BriefRegistrado,
  OrigemDaAfirmacao
} from '@shared/domain/brief'
import { BLOCOS_DO_BRIEF, podeAceitar, propostos } from '@shared/domain/brief'
import { Button, EmptyState, InlineAlert, LoadingState } from '@design/ui'
import { log } from '../lib/log'

/**
 * O brief e o gate de aceite (SPEC-Jornada-02, critérios 4 e 5).
 *
 * A tela responde duas perguntas ao mesmo tempo, e a segunda é a que a fatia existe para
 * responder: **o que o app afirma sobre este projeto, e de onde cada coisa veio?**
 *
 * Quatro decisões de forma:
 *
 *  - **A origem é dita em texto, não pintada.** Cada afirmação leva um rótulo em mono maiúsculo
 *    com a procedência — a mesma convenção que o índice de projetos usa para metadado de
 *    máquina. Um badge colorido por origem faria a distinção depender de cor, contra o
 *    princípio 2 do `PRODUCT.md`, e as três origens não são estados de severidade.
 *  - **Os propostos aparecem duas vezes, de propósito.** No corpo, junto ao bloco a que
 *    pertencem, porque é ali que se lê se a inferência faz sentido. E numa lista própria acima,
 *    porque o critério 4 pede que o que a IA inventou seja **visível como conjunto** antes do
 *    aceite — não descoberto lendo dez blocos.
 *  - **Corte item a item** (decisão do PI, 2026-09-03), com o botão na própria linha. Aceitar
 *    ou rejeitar o bloco inteiro faria um proposto ruim obrigar a regenerar todos.
 *  - **Bloco vazio não vira seção.** O brief mostra o que tem; um cabeçalho com "nenhuma
 *    afirmação" dez vezes seria ruído que esconde o conteúdo real.
 */

interface BriefDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /**
   * Relê a jornada depois do aceite — aceitar o brief move a etapa, e sem isto a trilha
   * ficaria mostrando "Aceitar o brief" num brief já aceito.
   */
  readonly onAceito?: () => void
  /**
   * Publica no pai a ação que o botão da trilha dispara (#332, defeito 4).
   *
   * A regra do PI: **avanço e aceite ficam na trilha**. O botão de aceitar saiu daqui, senão
   * seriam dois com o mesmo nome — o que o PI recusou explicitamente.
   */
  readonly onAcaoDaEtapa?: (acao: (() => void) | null) => void
  /** Avisa o pai enquanto aceita: é o botão da trilha que mostra o carregando agora. */
  readonly onOcupado?: (ocupado: boolean) => void
  /**
   * Por que o aceite não pode agir agora, ou `undefined` quando pode.
   *
   * Quem sabe é este painel — só ele conta as pendências materiais. Com o botão na trilha, sem
   * este aviso ele sairia habilitado prometendo um aceite que o gate recusa.
   */
  readonly onBloqueioDoAceite?: (motivo: string | undefined) => void
}

/**
 * O rótulo de cada origem. **Dado, não lógica** — e o texto é o sinal, não a cor: quem lê em
 * escala de cinza recebe a mesma informação.
 */
const CHAVE_DA_ORIGEM: Readonly<Record<OrigemDaAfirmacao, string>> = {
  prompt: 'brief.origem.prompt',
  decisao: 'brief.origem.decisao',
  proposto: 'brief.origem.proposto'
}

function LinhaDaAfirmacao({
  afirmacao,
  onCortar,
  ocupado
}: {
  readonly afirmacao: Afirmacao
  /** Presente só para `proposto` — as outras origens não são cortáveis. */
  readonly onCortar?: () => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <li
      data-jos-afirmacao={afirmacao.id}
      data-jos-origem={afirmacao.origem}
      /* `gap-0.5` no par e `py-3.5` entre itens: a afirmação e sua origem são **um** grupo, e a
         medida mostrou 6px internos contra 11px de separação — perto demais de virar a origem
         da linha seguinte. Grupo apertado, separação generosa. */
      className="flex flex-col gap-0.5 py-3.5"
    >
      {/* `justify-start` com o texto em largura de leitura, e não `justify-between`: empurrado
          para a borda oposta, o botão ficava a meia tela do que ele corta, e o olho tinha de
          percorrer o vazio para ligar um ao outro. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/*
          Sem teto próprio de medida: quem limita agora é a **coluna**.

          O `max-w-[58ch]` fazia sentido quando o documento ocupava a tela inteira. Dentro da
          coluna esquerda ele passou a sufocar duas vezes — a captura mediu 366px de texto numa
          coluna de 536px, com 170px vazios do lado direito *dentro* da própria coluna, além do
          vazio da página. Duas medidas empilhadas cortam pelo menor, e o menor aqui era o teto
          que a coluna já garante.
        */}
        <p className="min-w-0 flex-1 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
          {afirmacao.texto}
        </p>

        {onCortar !== undefined && (
          <Button
            variante="secundaria"
            onClick={onCortar}
            desabilitado={ocupado}
            /* O nome acessível carrega o texto da afirmação: numa lista de botões "Cortar"
               idênticos, o leitor de tela não diria qual corta o quê. */
            aria-label={t('brief.cortarEsta', { texto: afirmacao.texto })}
            iconeInicial={<X aria-hidden="true" className="size-4" />}
          >
            {t('brief.cortar')}
          </Button>
        )}
      </div>

      {/* A origem em mono maiúsculo: metadado de máquina, mesma forma que o índice usa para
          "criado" e "importado". É texto, e por isso sobrevive ao daltonismo e ao leitor. */}
      <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
        {t(CHAVE_DA_ORIGEM[afirmacao.origem])}
      </span>
    </li>
  )
}

export function BriefDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAceito,
  onAcaoDaEtapa,
  onOcupado,
  onBloqueioDoAceite
}: BriefDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [brief, setBrief] = useState<BriefRegistrado | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [falhaNoAceite, setFalhaNoAceite] = useState(false)

  const carregar = useCallback(async (): Promise<void> => {
    try {
      setBrief(await window.jarvis.carregarBrief(projectId, workspace))
    } catch (error: unknown) {
      log.ui.error('Falha ao carregar o brief', { error })
    } finally {
      setCarregando(false)
    }
  }, [projectId, workspace])

  useEffect(() => {
    let ativo = true

    window.jarvis
      .carregarBrief(projectId, workspace)
      .then((b) => {
        if (ativo) setBrief(b)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o brief', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  /**
   * O aceite do brief (critério 5).
   *
   * Vai pelo **mesmo canal de evento** que move toda a jornada, e não por um canal próprio:
   * `aplicarEventoDaJornada` é a única via de escrita da etapa, e abrir uma segunda entrada
   * só para o brief criaria um caminho que escapa da checagem de ordem que ela faz.
   *
   * A recusa por ordem é desfecho, não exceção — o outcome volta e a tela só relê. O que
   * vira mensagem é a falha técnica, porque aí o PI clicou e nada aconteceu.
   */
  const aceitar = useCallback(async (): Promise<void> => {
    setOcupado(true)
    setFalhaNoAceite(false)

    try {
      await window.jarvis.aplicarEventoDaJornada(projectId, 'brief-aceito', workspace)
      await carregar()
      onAceito?.()
    } catch (error: unknown) {
      log.ui.error('Falha ao aceitar o brief', { error })
      setFalhaNoAceite(true)
    } finally {
      setOcupado(false)
    }
  }, [projectId, workspace, carregar, onAceito])

  /*
   * O gate do aceite, calculado **antes** dos early returns para poder subir num efeito.
   *
   * Enquanto carrega, ou sem brief, não há o que aceitar: `false` mantém o botão da trilha
   * travado em vez de prometer um aceite que ainda não existe.
   */
  const liberado = brief !== null && podeAceitar(brief)

  /* O aceite migrou para a trilha (regra do PI, #332): a ação e o gate sobem juntos. */
  useEffect(() => {
    onAcaoDaEtapa?.(() => void aceitar())
    return () => onAcaoDaEtapa?.(null)
  }, [aceitar, onAcaoDaEtapa])

  useEffect(() => {
    onOcupado?.(ocupado)
  }, [ocupado, onOcupado])

  useEffect(() => {
    if (carregando) return
    onBloqueioDoAceite?.(liberado ? undefined : t('brief.aceiteBloqueado'))
  }, [liberado, carregando, onBloqueioDoAceite, t])

  async function cortar(afirmacaoId: string): Promise<void> {
    setOcupado(true)
    try {
      // Manda **um id**, e o main devolve a revisão nova. Mandar a lista do que sobra faria a
      // tela decidir o conteúdo final, e um erro dela apagaria afirmação vinda do PI.
      const novo = await window.jarvis.cortarPropostoDoBrief(projectId, afirmacaoId, workspace)
      if (novo !== null) setBrief(novo)
      else await carregar()
    } catch (error: unknown) {
      log.ui.error('Falha ao cortar o proposto', { error })
    } finally {
      setOcupado(false)
    }
  }

  if (carregando) return <LoadingState rotulo={t('brief.carregando')} />

  if (brief === null) {
    return <EmptyState titulo={t('brief.vazio')} descricao={t('brief.vazioDescricao')} />
  }

  const inferidos = propostos(brief)
  const materiais = brief.pendencias.filter((p) => p.material)

  /*
   * A contagem por origem — o que a coluna da direita resume.
   *
   * Contada aqui e não no main porque é aritmética sobre o que a tela já tem: pedir ao main um
   * número derivado das mesmas afirmações que ele acabou de mandar seria uma segunda resposta
   * para a mesma pergunta, que divergiria no dia em que uma das duas mudasse.
   */
  const porOrigem = {
    prompt: brief.afirmacoes.filter((a) => a.origem === 'prompt').length,
    decisao: brief.afirmacoes.filter((a) => a.origem === 'decisao').length,
    proposto: inferidos.length
  }

  return (
    /*
     *  porque o que decide o layout é o espaço que **este** componente recebe, não a
     * largura da janela. Na tela do projeto a trilha ocupa 19rem fixos à esquerda, então uma
     * media query de janela erraria por essa diferença: a 768px de janela o brief tem ~27rem, e
     * uma coluna dupla ali espremeria as duas metades.
     */
    <div className="@container flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('brief.titulo')}
        </h3>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('brief.descricao', { nome: nomeDoProjeto })}
        </p>
      </div>

      {/*
        Pendência material bloqueia o aceite. **Quais** são elas agora vive no painel lateral, ao
        lado do botão que elas travam — repetir a lista aqui poria o mesmo texto duas vezes na
        mesma tela, e o leitor de tela anunciaria as perguntas em duplicata. O alerta mantém o
        papel que só ele tem: dizer, no topo, que existe bloqueio antes de o PI começar a ler.
      */}
      {!liberado && (
        <InlineAlert tom="warn" titulo={t('brief.pendenciaMaterial')}>
          {t('brief.pendenciaOndeVer', { count: materiais.length })}
        </InlineAlert>
      )}

      {falhaNoAceite && (
        <InlineAlert tom="err" titulo={t('brief.aceiteFalhou')}>
          {t('brief.aceiteDescricao')}
        </InlineAlert>
      )}

      {/*
        Documento à esquerda, julgamento à direita.

        A faixa vazia da captura não era espaço sobrando: era o resumo faltando. As afirmações
        têm medida de leitura (58ch) e não crescem para ocupar a tela — alargá-las cansaria o
        retorno de linha —, então a largura restante fica com o que o PI precisa para decidir:
        quantas afirmações vieram de onde, o que trava o aceite, e o botão.

        Uma coluna só abaixo de 72rem: a régua vem de a coluna auxiliar precisar de ~15rem para
        não espremer os rótulos, e o documento de ~40rem para manter a medida. Abaixo disso as
        duas empilham, e o painel volta a ser o rodapé que era.
      */}
      <div className="grid grid-cols-1 items-start gap-6 @[52rem]:grid-cols-[minmax(0,1fr)_minmax(15rem,18rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          {/*
        O que a IA inferiu, como conjunto (critério 4). Fica **acima** do brief porque é o que o
        PI precisa julgar antes de aceitar — descobrir os propostos lendo dez blocos seria pedir
        que ele fizesse a varredura que esta lista faz por ele.
      */}
          {inferidos.length > 0 && (
            <section
              data-jos-propostos
              aria-labelledby="brief-propostos"
              className="flex flex-col gap-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)] p-4"
            >
              <h4
                id="brief-propostos"
                className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
              >
                {t('brief.propostosTitulo', { count: inferidos.length })}
              </h4>
              <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {t('brief.propostosDescricao')}
              </p>

              <ul className="mt-1 divide-y divide-[rgba(var(--jos-borda-rgb),0.10)]">
                {inferidos.map((a) => (
                  <LinhaDaAfirmacao
                    key={a.id}
                    afirmacao={a}
                    onCortar={() => void cortar(a.id)}
                    ocupado={ocupado}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* O brief por bloco. Bloco sem afirmação não vira seção: o documento mostra o que tem. */}
          {BLOCOS_DO_BRIEF.map((bloco) => {
            const doBloco = brief.afirmacoes.filter((a) => a.bloco === bloco)
            if (doBloco.length === 0) return null

            return (
              <section key={bloco} data-jos-bloco={bloco} className="flex flex-col gap-1">
                <h4 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
                  {t(`brief.blocos.${bloco}` as `brief.blocos.${BlocoDoBrief}`)}
                </h4>

                <ul className="divide-y divide-[rgba(var(--jos-borda-rgb),0.10)]">
                  {doBloco.map((a) => (
                    <LinhaDaAfirmacao
                      key={a.id}
                      afirmacao={a}
                      {...(a.origem === 'proposto' ? { onCortar: () => void cortar(a.id) } : {})}
                      ocupado={ocupado}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>

        {/*
          O painel de julgamento (critérios 4 e 5).

          `sticky` porque o brief é longo e a decisão precisa acompanhar a leitura: com o aceite
          no rodapé, o PI que terminava de ler o quinto bloco tinha de rolar até o fim para agir,
          e a razão do bloqueio ficava a uma tela de distância da pendência que a causou. Acima de
          72rem ele acompanha; empilhado, volta a ser o rodapé que era — e aí `sticky` não faz
          nada, que é o comportamento certo numa coluna estreita.
        */}
        <aside
          data-jos-aceite="brief"
          aria-labelledby="brief-aceite"
          className="flex flex-col overflow-hidden rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_40%),var(--jos-cor-superficie-elevada)] @[52rem]:sticky @[52rem]:top-4"
        >
          <div className="flex flex-col gap-2 border-b border-[rgba(var(--jos-borda-rgb),0.10)] p-4">
            <h4 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
              {t('brief.origensTitulo', { total: brief.afirmacoes.length })}
            </h4>

            {/*
              A contagem por origem, como lista de pares.

              **Sem barra empilhada colorida**: as três origens não são estados de severidade, e
              pintar cada uma de uma cor obrigaria a inventar três matizes que não significam
              nada — ou a usar as semânticas, que significam outra coisa. O que o PI compara aqui
              são três números, e três números se comparam lendo.
            */}
            <dl className="flex flex-col gap-1.5">
              {(
                [
                  ['prompt', porOrigem.prompt],
                  ['decisao', porOrigem.decisao],
                  ['proposto', porOrigem.proposto]
                ] as const
              ).map(([origem, quantas]) => (
                <div key={origem} className="flex items-baseline justify-between gap-3">
                  {/*
                    Rótulo próprio, e não o mesmo da linha: a linha fala de **uma** afirmação
                    ("do seu prompt"), a legenda conta um **conjunto**. Reusar a frase deixaria
                    o mesmo texto na tela com dois papéis, o que é ambíguo de ler e pior ainda
                    de navegar por leitor de tela.
                  */}
                  <dt className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
                    {t(`brief.contagem.${origem}`)}
                  </dt>
                  {/* `tabular-nums` para os três números alinharem na coluna da direita. */}
                  <dd className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] tabular-nums text-[var(--jos-cor-texto)]">
                    {quantas}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/*
            O que trava o aceite, item a item — e não só o total. O alerta no topo já diz que há
            pendência; aqui a lista fica ao lado do botão que ela bloqueia, que é onde o PI está
            olhando quando pergunta "por que não posso aceitar?".
          */}
          {materiais.length > 0 && (
            <div className="flex flex-col gap-2 border-b border-[rgba(var(--jos-borda-rgb),0.10)] p-4">
              <h4 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                {t('brief.pendenciaMaterial')}
              </h4>
              <ul className="flex flex-col gap-2">
                {materiais.map((p) => (
                  <li
                    key={p.pergunta}
                    className="flex items-baseline gap-2 text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]"
                  >
                    {/* Marcador em `warn`: é estado do sistema, não preferência — e essas cores
                        o usuário não retematiza. O texto ao lado carrega o mesmo sinal. */}
                    <span
                      aria-hidden="true"
                      className="mt-[0.4rem] size-1.5 shrink-0 rounded-full bg-[var(--jos-cor-warn-leitura)]"
                    />
                    {p.pergunta}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            O aceite (critério 5) — **o texto fica, o botão foi para a trilha** (regra do PI,
            #332). O que o PI precisa ler antes de aceitar continua ao lado do brief; a razão do
            bloqueio viaja com a ação e aparece sob o botão da trilha, para não haver duas
            explicações do mesmo gate.
          */}
          <div className="flex flex-col gap-2 p-4">
            <h4
              id="brief-aceite"
              className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
            >
              {t('brief.aceiteTitulo')}
            </h4>
            <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
              {t('brief.aceiteDescricao')}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
