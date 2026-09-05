import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Disclosure, Field, Select, Spinner } from '@design/ui'
import { redigirTexto } from '@design/patterns'
import type { GenerationEvent, GenerationTrace } from '@shared/domain/geracao'
import type { EstadoDaEtapa, EtapaDaGeracao } from '@shared/domain/geracao'
import { ETAPAS_DA_GERACAO, progressoDaGeracao } from '@shared/domain/geracao'
import { lerSaidaComoDocumento } from '@shared/domain/saida-em-documento'
import type { Etapa } from '@shared/domain/jornada'
import type { WorkspaceId } from '@shared/domain/entities'

/**
 * O console da geração (SPEC-Fases-03 § Superfície).
 *
 * Mostra, **enquanto a IA gera**, o texto que ela produz e as ferramentas que usa — e reabre a
 * mesma vista para qualquer geração anterior da etapa.
 *
 * ## Por que vive aqui e não no DS
 *
 * Ele conhece domínio: `GenerationEvent`, `Etapa`, o IPC. A regra do DS é dura nisso — componente
 * da camada `ui` recebe dado por props e não conhece infraestrutura. O que **é** genérico saiu
 * daqui e virou primitivo: o `Disclosure`.
 *
 * ## O painel abre sozinho, e depois obedece
 *
 * O critério 6 pede que ele abra quando a geração começa. Fazer isso a cada render o tornaria
 * impossível de fechar durante uma geração longa — a abertura automática dispara **na transição**
 * para "gerando", uma vez, e daí em diante quem manda é o PI (a posição escolhida vale pela
 * sessão).
 */

/** Quantos eventos o painel mantém em memória durante uma geração. */
const TETO_DE_EVENTOS = 500

interface ConsoleDaGeracaoProps {
  readonly projectId: string
  readonly workspace: WorkspaceId
  readonly etapa: Etapa
}

export function ConsoleDaGeracao({
  projectId,
  workspace,
  etapa
}: ConsoleDaGeracaoProps): React.JSX.Element | null {
  const [aberto, setAberto] = useState(false)
  const [eventos, setEventos] = useState<readonly GenerationEvent[]>([])
  const [historico, setHistorico] = useState<readonly GenerationTrace[]>([])
  const [traceEscolhido, setTraceEscolhido] = useState<string | undefined>(undefined)
  const [carregando, setCarregando] = useState(false)
  const [traceAoVivo, setTraceAoVivo] = useState<string | undefined>(undefined)

  /**
   * A geração corrente é descoberta **pelos próprios eventos**, e não informada pelo pai.
   *
   * A alternativa seria propagar um `gerando` desde cada um dos sete painéis de etapa — que
   * saberiam dizer "estou ocupado", mas nunca o `traceId`: a geração vai por `invoke`, que só
   * resolve no fim, então do lado do renderer o id não existe enquanto ela corre. Sete props
   * novas para entregar metade do dado.
   *
   * Descobrir pelo evento entrega o dado inteiro e é mais honesto: o console mostra que há
   * geração porque **chegou evento dela**, não porque alguém disse que ia gerar.
   */
  const traceCorrente = useRef<string | undefined>(undefined)

  useEffect(() => {
    return window.jarvis.onGenerationEvent(({ traceId, evento }) => {
      // Geração nova: o painel abre sozinho (critério 6) e a trilha anterior sai da tela. O
      // `ref` e não o estado porque a decisão é **por evento** — ler o estado aqui daria o
      // valor do render em que o listener foi criado, e todo evento pareceria de geração nova.
      const eNova = traceCorrente.current !== traceId
      traceCorrente.current = traceId

      if (eNova) {
        setTraceAoVivo(traceId)
        setTraceEscolhido(undefined)
        setAberto(true)
        setEventos([evento])
        return
      }

      setEventos((atuais) =>
        // O teto protege uma geração longa de encher a memória do renderer. O que sai é o
        // começo, não o fim: ao vivo interessa o que acontece agora, e a trilha completa fica
        // no banco para o histórico reabrir.
        atuais.length >= TETO_DE_EVENTOS
          ? [...atuais.slice(atuais.length - TETO_DE_EVENTOS + 1), evento]
          : [...atuais, evento]
      )
    })
  }, [])

  const gerando = traceAoVivo !== undefined && traceEscolhido === undefined

  /**
   * O histórico da etapa. Recarrega quando o projeto/etapa muda e quando uma geração nova
   * aparece — a que acabou de correr passa a ser a primeira da lista.
   *
   * `cancelado` porque a resposta pode chegar depois de o PI ter trocado de etapa: sem ele, o
   * histórico da etapa anterior sobrescreveria o da atual, e a lista mostraria gerações que não
   * pertencem à tela.
   */
  useEffect(() => {
    let cancelado = false

    void window.jarvis.generationHistory(projectId, etapa, workspace).then((lista) => {
      if (!cancelado) setHistorico(lista)
    })

    return () => {
      cancelado = true
    }
  }, [projectId, etapa, workspace, traceAoVivo])

  /**
   * Abrir uma geração do histórico: os eventos vêm do banco, não da assinatura.
   *
   * Handler e não `useEffect`: escolher no seletor é uma **ação do usuário**, e buscar num
   * efeito disparado pela mudança de estado é o `setState` em cascata que o lint recusa — com
   * razão, porque a busca aconteceria também quando o componente remonta pelo mesmo valor.
   */
  const abrirDoHistorico = useCallback(
    (traceId: string | undefined): void => {
      setTraceEscolhido(traceId)

      if (traceId === undefined) {
        // Voltou para a geração atual: a trilha ao vivo continua chegando pela assinatura.
        setEventos([])
        return
      }

      setCarregando(true)
      void window.jarvis
        .generationEvents(traceId, workspace)
        .then(setEventos)
        .finally(() => setCarregando(false))
    },
    [workspace]
  )

  // Nada a mostrar e nada acontecendo: o painel não existe. Um bloco vazio "Console da geração"
  // numa etapa nunca gerada é ruído — a etapa que ainda não gerou não tem trilha nenhuma.
  if (!gerando && historico.length === 0) return null

  return (
    <Disclosure
      aberto={aberto}
      onAbertoChange={setAberto}
      rotulo="Console da geração"
      resumo={<ResumoDoCabecalho gerando={gerando} eventos={eventos} />}
    >
      <div className="flex flex-col gap-3">
        {historico.length > 0 && (
          <SeletorDeGeracao
            historico={historico}
            valor={traceEscolhido}
            gerando={gerando}
            onEscolher={abrirDoHistorico}
          />
        )}

        {carregando ? (
          <div className="flex items-center gap-2 py-4 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            <Spinner rotulo="Carregando a trilha" tamanho="pequeno" />
            Carregando a trilha desta geração.
          </div>
        ) : (
          <>
            {/*
              O andamento fica **acima** da trilha: é o resumo, e a trilha é o detalhe. Quem abre
              o painel durante uma geração longa quer primeiro saber em que ponto ela está.
            */}
            <ProgressoDaGeracao eventos={eventos} gerando={gerando} />
            <TrilhaDaGeracao eventos={eventos} gerando={gerando} />
          </>
        )}
      </div>
    </Disclosure>
  )
}

function ResumoDoCabecalho({
  gerando,
  eventos
}: {
  readonly gerando: boolean
  readonly eventos: readonly GenerationEvent[]
}): React.JSX.Element {
  const ferramentas = eventos.filter((e) => e.tipo === 'ferramenta-inicio').length

  return (
    <span className="flex items-center gap-2">
      {ferramentas > 0 && (
        <Badge>
          {ferramentas} {ferramentas === 1 ? 'ferramenta' : 'ferramentas'}
        </Badge>
      )}
      {gerando && (
        <Badge tom="info" comPonto>
          gerando
        </Badge>
      )}
    </span>
  )
}

function SeletorDeGeracao({
  historico,
  valor,
  gerando,
  onEscolher
}: {
  readonly historico: readonly GenerationTrace[]
  readonly valor: string | undefined
  readonly gerando: boolean
  readonly onEscolher: (traceId: string | undefined) => void
}): React.JSX.Element {
  const opcoes = useMemo(
    () => [
      ...(gerando ? [{ valor: '', rotulo: 'Geração atual' }] : []),
      ...historico.map((trace) => ({
        valor: trace.id,
        rotulo: `${dataCurta(trace.iniciadoEm)} · ${trace.modelo} · ${ROTULO_DO_STATUS[trace.status]}`
      }))
    ],
    [historico, gerando]
  )

  return (
    <Field rotulo="Geração">
      {(atributos) => (
        <Select
          {...atributos}
          opcoes={opcoes}
          valor={valor ?? ''}
          onMudar={(escolhido) => onEscolher(escolhido === '' ? undefined : escolhido)}
        />
      )}
    </Field>
  )
}

const ROTULO_DO_STATUS: Readonly<Record<GenerationTrace['status'], string>> = {
  concluido: 'concluída',
  falhou: 'falhou',
  cancelado: 'cancelada'
}

function dataCurta(iso: string): string {
  const data = new Date(iso)
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

/** O nome de cada etapa na tela. Dado, não lógica — e em pt-BR, como toda a interface. */
const NOME_DA_ETAPA: Readonly<Record<EtapaDaGeracao, string>> = {
  pesquisa: 'Pesquisa de mercado',
  documentos: 'PRD, Landscape e Convention',
  validacao: 'Validação da saída',
  contradicoes: 'Busca de contradições',
  gravacao: 'Gravação dos documentos'
}

/**
 * O andamento da geração: quanto já terminou, o que acontece agora, o que cada etapa produziu.
 *
 * ## Por que o acento não aparece aqui
 *
 * O acento é escolhido pelo usuário entre oito cores, e três delas colidem com significado que o
 * sistema reserva: com `#FF2C2C` uma geração saudável ficaria idêntica a erro, com `#2CFF05` uma
 * etapa pendente pareceria concluída, e `#2323FF` tem 2,58:1 sobre o carbono. Pintar **estado**
 * com a cor da preferência quebra o princípio 5 do produto — preferência visual não altera
 * significado semântico.
 *
 * Então quem distingue as etapas é **forma**: preenchido contra vazado, ícone de concluído
 * contra pendente, peso do texto. Isso funciona nas oito cores, no daltonismo e em escala de
 * cinza, que é o princípio 2. As semânticas (`ok` e `err`) entram só onde há de fato estado de
 * sistema — e essas o usuário não retematiza.
 */
function ProgressoDaGeracao({
  eventos,
  gerando
}: {
  readonly eventos: readonly GenerationEvent[]
  readonly gerando: boolean
}): React.JSX.Element | null {
  // Varre os eventos uma vez por lista nova, e não a cada render: durante uma geração longa a
  // trilha passa de centenas de eventos, e recontá-la a cada frame de digitação é trabalho puro.
  const etapas = useMemo(() => estadoDasEtapas(eventos), [eventos])

  const progresso = useMemo(
    () => progressoDaGeracao(new Map([...etapas].map(([etapa, v]) => [etapa, v.estado]))),
    [etapas]
  )

  // Sem nenhum anúncio não há progresso a mostrar. Uma barra em 0% durante uma geração que não
  // reporta etapas afirmaria que nada aconteceu, o que é diferente de "não se sabe".
  if (etapas.size === 0) return null

  const emCurso = ETAPAS_DA_GERACAO.find((e) => etapas.get(e)?.estado === 'iniciada')
  const atual = emCurso ?? [...ETAPAS_DA_GERACAO].reverse().find((e) => etapas.has(e))
  const resumoAtual = atual === undefined ? undefined : etapas.get(atual)?.resumo

  return (
    <section
      data-jos-progresso
      aria-label="Andamento da geração"
      className="flex flex-col gap-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.14)] bg-[var(--jos-cor-superficie-elevada)] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {atual === undefined ? 'Geração' : NOME_DA_ETAPA[atual]}
        </span>
        {/* `tabular-nums` para o número não dançar de largura entre 8% e 100%. */}
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-realce)] tabular-nums text-[var(--jos-cor-texto)]">
          {progresso}%
        </span>
      </div>

      {/*
        A barra carrega o mesmo número que o texto ao lado, e o `role` diz isso ao leitor de tela
        — sem ele, a barra é uma div decorativa e quem não vê fica sem o progresso.
      */}
      <div
        role="progressbar"
        aria-valuenow={progresso}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da geração"
        className="h-1 w-full overflow-hidden rounded-[var(--jos-raio-pill)] bg-[rgba(var(--jos-borda-rgb),0.14)]"
      >
        <div
          className="h-full rounded-[var(--jos-raio-pill)] bg-[var(--jos-cor-texto)] transition-[width] duration-[var(--jos-duracao-media)] ease-[var(--jos-curva-padrao)]"
          style={{ width: `${progresso}%` }}
        />
      </div>

      <ul className="flex flex-col gap-1.5">
        {ETAPAS_DA_GERACAO.map((etapa) => {
          const registro = etapas.get(etapa)
          const estado = registro?.estado

          return (
            <li
              key={etapa}
              data-jos-etapa={etapa}
              data-jos-estado={estado ?? 'pendente'}
              className="flex items-baseline gap-2.5"
            >
              {/*
                O marcador é **forma antes de cor**: cheio para concluída, anel para a que está
                acontecendo, vazado para o que não começou. Lido em cinza, ele continua dizendo
                as três coisas.
              */}
              <span
                aria-hidden="true"
                className={
                  estado === 'concluida'
                    ? 'mt-[0.35rem] size-2 shrink-0 rounded-full bg-[var(--jos-cor-ok-leitura)]'
                    : estado === 'falhou'
                      ? 'mt-[0.35rem] size-2 shrink-0 rounded-full bg-[var(--jos-cor-err-leitura)]'
                      : estado === 'iniciada'
                        ? 'mt-[0.35rem] size-2 shrink-0 rounded-full border-2 border-[var(--jos-cor-texto)]'
                        : 'mt-[0.35rem] size-2 shrink-0 rounded-full border border-[rgba(var(--jos-borda-rgb),0.35)]'
                }
              />

              <span
                className={
                  estado === 'iniciada'
                    ? 'text-[length:var(--jos-texto-mini)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]'
                    : estado === undefined
                      ? 'text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]'
                      : 'text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]'
                }
              >
                {NOME_DA_ETAPA[etapa]}
              </span>

              {/* O estado também em texto, para quem não distingue as formas nem as cores. */}
              {estado === 'falhou' && (
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-err-leitura)]">
                  falhou
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {/*
        O que a etapa em curso produziu. `aria-live` porque ele muda sozinho durante a geração, e
        `polite` para não interromper quem está lendo outra parte da tela.
      */}
      {resumoAtual !== undefined && (
        <p
          aria-live={gerando ? 'polite' : 'off'}
          className="max-w-[62ch] border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-3 text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]"
        >
          {resumoAtual}
        </p>
      )}
    </section>
  )
}

/**
 * O texto do modelo, lido como documento quando ele **é** um documento.
 *
 * A saída da geração do pacote é JSON, e mostrá-la crua transformava o painel numa parede de
 * chaves e aspas — o PI precisava decodificar o transporte para ler o conteúdo. Aqui a mesma
 * saída aparece com a forma que ela terá depois de aceita: seção como título, afirmação como
 * parágrafo, origem em mono.
 *
 * **Nada é escondido.** O que a leitura não reconhece como afirmação vem como texto normal, e
 * isso não é caso de borda: quando o modelo recusa ou erra o schema, a explicação vive
 * justamente nessa sobra. Um painel que mostrasse só o que entendeu deixaria o PI sem a frase
 * que diz por que a geração falhou.
 */
function TextoDoModelo({ texto }: { readonly texto: string }): React.JSX.Element {
  const { topicos, restante } = useMemo(() => lerSaidaComoDocumento(texto), [texto])

  // Nada reconhecido: é prosa, e prosa se lê como prosa.
  if (topicos.length === 0) {
    return (
      <p className="max-w-[68ch] whitespace-pre-wrap text-[length:var(--jos-texto-corpo)] leading-relaxed text-[var(--jos-cor-texto)]">
        {/*
         * Segunda camada de redação, como no `LogViewer`: a primeira é o main, que impede o
         * segredo de chegar ao banco. O texto do modelo não passa pelo redator do main (ele é o
         * documento), então é aqui que um token citado na resposta é coberto.
         */}
        {redigirTexto(restante)}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {topicos.map((topico) => (
        <section key={`${topico.documento}-${topico.secao}`} className="flex flex-col gap-2">
          {/*
            O cabeçalho do tópico em mono maiúsculo com o acento de leitura: mesma convenção que
            o brief e o PRD já usam para nomear bloco e seção. Repetir a forma é o que faz o
            console parecer o documento nascendo, e não outra tela.

            A régua que sai do título ocupa a largura restante — separa os tópicos com o material
            mais barato que existe, sem acrescentar mais uma caixa ao que já é uma pilha.
          */}
          <h4 className="flex items-center gap-3 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
            <span className="shrink-0">
              {topico.documento === '' ? topico.secao : `${topico.documento} · ${topico.secao}`}
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-[rgba(var(--jos-borda-rgb),0.12)]" />
          </h4>

          <div className="flex flex-col gap-3">
            {topico.afirmacoes.map((a, indice) => (
              <div key={a.id === '' ? `sem-id-${indice}` : a.id} className="flex flex-col gap-0.5">
                <p className="max-w-[68ch] text-[length:var(--jos-texto-corpo)] leading-relaxed text-[var(--jos-cor-texto)]">
                  {redigirTexto(a.texto)}
                </p>
                {/* A origem é dita em texto, nunca por cor: mesma regra do brief, e o princípio
                    2 do produto vale igual aqui. Origem ausente não vira linha vazia. */}
                {a.origem !== '' && (
                  <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                    {a.origem}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * A trilha: o texto do modelo em fluxo, as ferramentas como linhas, o uso no fim.
 *
 * O texto dos `delta` é **concatenado** num bloco só, e não uma linha por evento: o modelo emite
 * pedaços arbitrários (às vezes uma palavra, às vezes meia frase), e renderizá-los separados
 * quebraria o parágrafo em confete. A ordem entre texto e ferramenta é preservada — é o critério
 * 1 —, então blocos de texto consecutivos se juntam, e uma ferramenta no meio abre bloco novo.
 */
function TrilhaDaGeracao({
  eventos,
  gerando
}: {
  readonly eventos: readonly GenerationEvent[]
  readonly gerando: boolean
}): React.JSX.Element {
  const fim = useRef<HTMLDivElement>(null)
  const blocos = useMemo(() => agruparEmBlocos(eventos), [eventos])

  // Rola para o fim enquanto gera. `block: 'nearest'` para não arrastar a página inteira quando
  // o painel está fora da vista — o console não pode sequestrar o scroll de quem lê o documento.
  useEffect(() => {
    if (gerando) fim.current?.scrollIntoView({ block: 'nearest' })
  }, [blocos, gerando])

  if (blocos.length === 0) {
    return (
      <p className="py-3 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
        {gerando
          ? 'A geração começou. O texto e as ferramentas aparecem aqui conforme chegam.'
          : 'Esta geração não deixou registro de texto nem de ferramentas.'}
      </p>
    )
  }

  return (
    <div
      // `tabIndex` para que quem navega por teclado consiga rolar a região — mesma escolha do
      // `LogViewer`, e o motivo do `aria-label`: sem ele o leitor anuncia a região sem dizer de quê.
      tabIndex={0}
      aria-label="Trilha da geração"
      aria-live={gerando ? 'polite' : 'off'}
      /*
       * `max-h-96` e não `80`: a captura mostrou a trilha cortada no meio de um comando, com a
       * rolagem escondendo justamente a linha em que a geração parou. Duas linhas a mais de
       * altura custam nada e mostram a chamada inteira na maioria dos casos.
       *
       * `overscroll-contain` para a rolagem no fim da trilha não continuar na página: rolar
       * dentro de um painel e ver o documento inteiro andar é o defeito clássico de log embutido.
       *
       * `scroll-py` mantém a última linha longe da borda quando o `scrollIntoView` do modo ao
       * vivo pousa nela.
       */
      className="max-h-96 overflow-auto overscroll-contain scroll-py-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-3"
    >
      {/*
        `gap-3`: com `gap-2` a prosa e as linhas de ferramenta encostavam, e o que era narrativa
        com anotações virava uma pilha uniforme. O espaço é o que separa os dois registros.
      */}
      <div className="flex flex-col gap-3">
        {blocos.map((bloco, indice) =>
          bloco.tipo === 'texto' ? (
            /*
             * O texto do modelo lê em **corpo**, não em micro cinza — e, quando é a saída
             * estruturada da geração, lê como documento em vez de JSON cru.
             *
             * Era o inverso nos dois eixos: a prosa que o PI vem ler vinha no menor tamanho e no
             * tom mais fraco, enquanto as linhas de ferramenta (registro de máquina) vinham
             * maiores; e a saída da geração aparecia como uma parede de chaves.
             */
            <TextoDoModelo key={`texto-${indice}`} texto={bloco.texto} />
          ) : bloco.tipo === 'ferramenta' ? (
            <LinhaDeFerramenta key={`ferramenta-${bloco.chamadaId}-${indice}`} bloco={bloco} />
          ) : bloco.tipo === 'uso' ? (
            <LinhaDeUso key={`uso-${indice}`} bloco={bloco} />
          ) : (
            <p
              key={`erro-${indice}`}
              className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-warn-leitura)]"
            >
              {bloco.mensagem}
            </p>
          )
        )}
      </div>
      <div ref={fim} />
    </div>
  )
}

function LinhaDeFerramenta({ bloco }: { readonly bloco: BlocoDeFerramenta }): React.JSX.Element {
  const status = bloco.status
  /*
   * A ferramenta é **registro**, e agora se lê como tal: um degrau abaixo da prosa do modelo,
   * não acima dela. O nome fica em `mini` com o texto secundário; o argumento, em micro suave.
   *
   * Antes o bloco inteiro vinha em `text-sm` — maior que a prosa —, e a trilha parecia uma lista
   * de comandos com um parágrafo enfiado no meio, em vez de uma narrativa com as ferramentas
   * anotadas ao lado.
   */
  const rotulo = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
        {bloco.nome}
      </span>
      <span className="truncate font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
        {bloco.resumoDoArgumento}
      </span>
    </span>
  )

  const selo =
    status === undefined ? (
      <Spinner rotulo={`${bloco.nome} em execução`} tamanho="pequeno" />
    ) : (
      <Badge tom={status === 'ok' ? 'ok' : 'err'}>{status === 'ok' ? 'ok' : 'erro'}</Badge>
    )

  // Sem resultado ainda (a ferramenta está rodando) não há o que colapsar: a linha é só a linha.
  if (bloco.resumoDoResultado === undefined) {
    return (
      <div className="flex items-center gap-2 py-1">
        {rotulo}
        <span className="ml-auto shrink-0">{selo}</span>
      </div>
    )
  }

  return (
    <Disclosure compacto rotulo={rotulo} resumo={selo}>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-[var(--jos-raio-controle)] border border-[rgba(var(--jos-borda-rgb),0.12)] p-2 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
        {bloco.resumoDoResultado === '' ? '(sem saída)' : bloco.resumoDoResultado}
      </pre>
      {bloco.tamanhoOriginal !== undefined &&
        bloco.tamanhoOriginal > bloco.resumoDoResultado.length && (
          <p className="pt-1 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            Resumo de {formatarBytes(bloco.tamanhoOriginal)}. O resultado completo não é guardado.
          </p>
        )}
    </Disclosure>
  )
}

function LinhaDeUso({ bloco }: { readonly bloco: BlocoDeUso }): React.JSX.Element {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[rgba(var(--jos-borda-rgb),0.12)] pt-2 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
      <span>{bloco.tokensEntrada.toLocaleString('pt-BR')} tokens de entrada</span>
      <span>{bloco.tokensSaida.toLocaleString('pt-BR')} de saída</span>
      {bloco.duracaoMs > 0 && <span>{(bloco.duracaoMs / 1000).toFixed(1)}s</span>}
    </p>
  )
}

function formatarBytes(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} kB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface BlocoDeTexto {
  readonly tipo: 'texto'
  readonly texto: string
}

interface BlocoDeFerramenta {
  readonly tipo: 'ferramenta'
  readonly chamadaId: string
  readonly nome: string
  readonly resumoDoArgumento: string
  readonly status?: 'ok' | 'erro'
  readonly resumoDoResultado?: string
  readonly tamanhoOriginal?: number
}

interface BlocoDeUso {
  readonly tipo: 'uso'
  readonly tokensEntrada: number
  readonly tokensSaida: number
  readonly duracaoMs: number
}

interface BlocoDeErro {
  readonly tipo: 'erro'
  readonly mensagem: string
}

type Bloco = BlocoDeTexto | BlocoDeFerramenta | BlocoDeUso | BlocoDeErro

/**
 * Agrupa os eventos no que a tela mostra, **preservando a ordem** (critério 1).
 *
 * Duas junções acontecem aqui, e as duas são sobre o mesmo princípio — a tela mostra o que
 * aconteceu, não o formato em que chegou:
 *
 * - `texto` consecutivo vira um parágrafo. O modelo emite pedaços arbitrários; um `<p>` por
 *   evento quebraria a frase em confete.
 * - `ferramenta-fim` **completa** a linha que o `ferramenta-inicio` abriu, casada pelo
 *   `chamadaId`. Duas linhas por ferramenta seriam dois itens para um acontecimento só.
 *
 * O `fim` sem `inicio` correspondente é ignorado: só acontece quando o teto de eventos cortou o
 * começo da trilha, e uma linha órfã "terminou algo" não informa nada.
 */
export function agruparEmBlocos(eventos: readonly GenerationEvent[]): readonly Bloco[] {
  const blocos: Bloco[] = []
  const porChamada = new Map<string, number>()

  for (const evento of eventos) {
    if (evento.tipo === 'texto') {
      const ultimo = blocos.at(-1)
      if (ultimo?.tipo === 'texto') {
        blocos[blocos.length - 1] = { tipo: 'texto', texto: ultimo.texto + evento.delta }
      } else {
        blocos.push({ tipo: 'texto', texto: evento.delta })
      }
      continue
    }

    if (evento.tipo === 'ferramenta-inicio') {
      porChamada.set(evento.chamadaId, blocos.length)
      blocos.push({
        tipo: 'ferramenta',
        chamadaId: evento.chamadaId,
        nome: evento.nome,
        resumoDoArgumento: evento.resumoDoArgumento
      })
      continue
    }

    if (evento.tipo === 'ferramenta-fim') {
      const indice = porChamada.get(evento.chamadaId)
      if (indice === undefined) continue

      const aberto = blocos[indice]
      if (aberto?.tipo !== 'ferramenta') continue

      blocos[indice] = {
        ...aberto,
        status: evento.status === 'ok' ? 'ok' : 'erro',
        resumoDoResultado: evento.resumoDoResultado,
        tamanhoOriginal: evento.tamanhoOriginal
      }
      continue
    }

    if (evento.tipo === 'uso') {
      blocos.push({
        tipo: 'uso',
        tokensEntrada: evento.tokensEntrada,
        tokensSaida: evento.tokensSaida,
        duracaoMs: evento.duracaoMs
      })
      continue
    }

    /*
     * `etapa` não vira bloco da trilha: ele alimenta a **barra de progresso**, que é outra
     * superfície. Empilhá-lo aqui produziria dez linhas de "iniciou/terminou" no meio do texto
     * do modelo — ruído entre exatamente o que o painel existe para deixar legível.
     */
    if (evento.tipo === 'etapa') continue

    blocos.push({ tipo: 'erro', mensagem: evento.mensagem })
  }

  return blocos
}

/**
 * O andamento das etapas, na ordem do contrato.
 *
 * Reduz os eventos ao **último estado** de cada etapa: uma etapa que iniciou, falhou e foi
 * retentada aparece pelo que ela é agora, não pela soma do que já foi. É a mesma leitura que a
 * barra faz, e tê-la aqui é o que impede a tela de recontar o histórico a cada render.
 */
export function estadoDasEtapas(
  eventos: readonly GenerationEvent[]
): ReadonlyMap<EtapaDaGeracao, { readonly estado: EstadoDaEtapa; readonly resumo?: string }> {
  const mapa = new Map<EtapaDaGeracao, { estado: EstadoDaEtapa; resumo?: string }>()

  for (const evento of eventos) {
    if (evento.tipo !== 'etapa') continue

    mapa.set(evento.etapa, {
      estado: evento.estado,
      ...(evento.resumo === undefined ? {} : { resumo: evento.resumo })
    })
  }

  return mapa
}
