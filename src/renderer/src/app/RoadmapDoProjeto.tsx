import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, ShieldCheck, Sparkles } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Approval, AprovacaoOutcome, AprovacaoReason, Gate } from '@shared/domain/aprovacoes'
import { GATES } from '@shared/domain/aprovacoes'
import type {
  MvpGerado,
  OrigemDoRoadmap,
  PerguntaDaSpec,
  ResultadoDoRoadmap,
  RoadmapGeradoOutcome,
  RoadmapRegistrado,
  SpecGerada
} from '@shared/domain/roadmap-gerado'
import { perguntasSemResposta } from '@shared/domain/roadmap-gerado'
import { Badge, Button, EmptyState, InlineAlert, LoadingState, Separator } from '@design/ui'
import { log } from '../lib/log'

/**
 * O roadmap gerado por IA e os dois gates que o fecham (SPEC-Jornada-05).
 *
 * A tela responde a mesma pergunta que as do PRD e da arquitetura, sobre outro material: **o que
 * o app propõe construir, e o que sustenta cada proposta?** O que muda aqui são três coisas, e
 * cada uma vem de um critério:
 *
 *  - **O PI escolhe qual MVP entra na fila** (critério 3, decisão dele em 2026-09-03). A tela
 *    oferece **só os elegíveis** — os sem dependência pendente —, porque oferecer a lista inteira
 *    e recusar depois faria o PI escolher um MVP bloqueado para descobrir que não podia.
 *  - **A SPEC nasce com perguntas abertas, e elas travam o aceite** (critério 4). As perguntas
 *    ficam no topo da SPEC: são o que falta decidir, e lê-las depois do documento inteiro faria o
 *    PI descobrir no fim que não podia aceitar.
 *  - **Gerar e aprovar continuam sendo dois botões**, e a distância entre eles é o desenho. Gerar
 *    propõe; escolher o MVP registra a escolha; aprovar é o aceite. Um botão só — "gerar e
 *    aprovar" — faria a tela oferecer, num clique, a coisa que os critérios separam.
 *
 * Três garantias vivem na fronteira, não aqui:
 *  - **A tela não decide se o DAG é válido.** Ela mostra os problemas que voltaram, nomeados.
 *  - **A tela não sabe quem aprova.** A identidade vem da sessão no main; não há campo de autor.
 *  - **A tela não escreve conteúdo.** Ela manda o ato e o id; o roadmap e a SPEC são produzidos e
 *    validados no main.
 */

interface RoadmapDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Relê a jornada depois do aceite — sem isto a trilha ficaria pedindo "Aceitar o MVP". */
  readonly onAceito?: () => void
  /**
   * A etapa atual. Este painel serve quatro, e só a primeira tem uma ação única para a trilha.
   */
  readonly etapa?: 'roadmap' | 'mvp-aceito' | 'spec-aceita' | 'construcao'
  /**
   * Publica no pai a ação que o botão da trilha dispara (#332, defeito 4), ou `null` quando
   * esta etapa não tem uma.
   *
   * **Aqui a regra do PI se aplica em parte, e o desvio é deliberado.** Na etapa `roadmap` a
   * geração sobe: era o botão duplicado com a trilha. Nas etapas de aceite (`mvp-aceito`,
   * `spec-aceita`) ela publica `null` — os aceites são gates numa **lista**, cada linha com o
   * próprio estado de pendente ou aprovado, e um botão fora dela não diria qual gate está sendo
   * aprovado. Puxar o primeiro gate pendente para a trilha esconderia essa escolha. Registrado
   * na issue para o PI decidir. Em `construcao` não há ato nenhum: acompanhar é ler.
   */
  readonly onAcaoDaEtapa?: (acao: (() => void) | null) => void
  /** Avisa o pai enquanto trabalha: o carregando da geração agora é do botão da trilha. */
  readonly onOcupado?: (ocupado: boolean) => void
}

/** O rótulo de cada origem. **Dado, não lógica** — e o texto é o sinal, não a cor. */
const CHAVE_DA_ORIGEM: Readonly<Record<OrigemDoRoadmap, string>> = {
  prd: 'roadmap.origem.prd',
  arquitetura: 'roadmap.origem.arquitetura',
  proposto: 'roadmap.origem.proposto'
}

/**
 * Tom por desfecho da geração. Mapa fechado, como nas telas irmãs: um motivo novo no contrato
 * quebra a compilação aqui em vez de cair num default silencioso.
 *
 * `pacote-ausente`, `bloqueado-sem-rota`, `sem-contexto`, `mvp-nao-escolhido` e `mvp-inelegivel`
 * são **`warn`, não `err`**: nada quebrou, falta um passo — e os cinco dizem qual.
 */
const TOM_DA_GERACAO: Readonly<Record<ResultadoDoRoadmap, 'ok' | 'err' | 'warn'>> = {
  gerado: 'ok',
  'projeto-inexistente': 'err',
  'pacote-ausente': 'warn',
  'bloqueado-sem-rota': 'warn',
  'sem-contexto': 'warn',
  'saida-invalida': 'err',
  'mvp-nao-escolhido': 'warn',
  'mvp-inelegivel': 'warn',
  'falha-de-escrita': 'err'
}

/**
 * Tom por desfecho da aprovação.
 *
 * `ja-aprovado` é **`ok`, não `warn`**: nada deu errado — a revisão já tem o aceite, que é
 * exatamente o estado desejado. Pintar de aviso ensinaria o PI a ler o critério 5 como problema.
 */
const TOM_DA_APROVACAO: Readonly<Record<AprovacaoReason, 'ok' | 'err' | 'warn'>> = {
  aprovado: 'ok',
  'projeto-inexistente': 'err',
  'ja-aprovado': 'ok',
  'sem-identidade': 'warn',
  'sem-revisoes': 'warn',
  'dag-invalido': 'err',
  // `warn`, e não `err`: nada quebrou — falta commitar o que já foi aceito, e cada pendência vem
  // com a ação que a resolve. `err` diria ao PI que o app falhou, quando o que falta é um passo.
  'marcos-pendentes': 'warn'
}

export function RoadmapDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAceito,
  etapa = 'roadmap',
  onAcaoDaEtapa,
  onOcupado
}: RoadmapDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [roadmap, setRoadmap] = useState<RoadmapRegistrado | null>(null)
  const [elegiveis, setElegiveis] = useState<readonly MvpGerado[]>([])
  const [aprovacoes, setAprovacoes] = useState<readonly Approval[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState<'nao' | 'gerando' | 'escolhendo' | 'aprovando'>('nao')
  const [desfecho, setDesfecho] = useState<RoadmapGeradoOutcome | null>(null)
  const [aprovacao, setAprovacao] = useState<AprovacaoOutcome | null>(null)

  /**
   * As três leituras da tela, em paralelo. Devolve em vez de gravar: quem grava é o chamador, e
   * é isso que permite ao efeito de montagem descartar o resultado quando o componente já saiu.
   */
  const buscar = useCallback(
    () =>
      Promise.all([
        window.jarvis.carregarRoadmapGerado(projectId, workspace),
        window.jarvis.mvpsElegiveis(projectId, workspace),
        window.jarvis.listarAprovacoes(projectId, workspace)
      ]),
    [projectId, workspace]
  )

  const aplicar = useCallback(
    ([gerado, lista, aceites]: Awaited<ReturnType<typeof buscar>>): void => {
      setRoadmap(gerado)
      setElegiveis(lista)
      setAprovacoes(aceites)
    },
    []
  )

  const recarregar = useCallback(async (): Promise<void> => {
    aplicar(await buscar())
  }, [buscar, aplicar])

  useEffect(() => {
    let ativo = true

    buscar()
      .then((r) => {
        if (ativo) aplicar(r)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao carregar o roadmap', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, buscar, aplicar])

  const gerar = useCallback(async (): Promise<void> => {
    setOcupado('gerando')
    try {
      const resultado = await window.jarvis.gerarRoadmapPorIa(projectId, workspace)
      setDesfecho(resultado)
      // A geração muda o que os gates cobrem: a aprovação anterior descreve outro conteúdo.
      setAprovacao(null)
      if (resultado.resultado === 'gerado') await recarregar()
    } catch (causa: unknown) {
      log.ui.error('Falha ao gerar o roadmap', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }, [projectId, workspace, recarregar])

  /* A geração vai para a trilha (#332, defeito 4). Só ela — ver a nota em `onAcaoDaEtapa`. */
  useEffect(() => {
    if (etapa !== 'roadmap') {
      onAcaoDaEtapa?.(null)
      return
    }
    onAcaoDaEtapa?.(() => void gerar())
    return () => onAcaoDaEtapa?.(null)
  }, [etapa, gerar, onAcaoDaEtapa])

  useEffect(() => {
    onOcupado?.(ocupado !== 'nao')
  }, [ocupado, onOcupado])

  /**
   * A escolha do MVP que entra na fila (critério 3).
   *
   * **Escolher não é aprovar.** Este ato grava qual MVP o PI escolheu e produz a SPEC da primeira
   * fatia dele; o aceite continua sendo o botão do gate `MVP_ENTRY`, logo abaixo.
   */
  async function escolher(mvpId: string): Promise<void> {
    setOcupado('escolhendo')
    try {
      const resultado = await window.jarvis.escolherMvpDoRoadmap(projectId, mvpId, workspace)
      setDesfecho(resultado)
      setAprovacao(null)
      if (resultado.resultado === 'gerado') await recarregar()
    } catch (causa: unknown) {
      log.ui.error('Falha ao escolher o MVP', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  async function responder(perguntaId: string, resposta: string): Promise<void> {
    setOcupado('escolhendo')
    try {
      const resultado = await window.jarvis.responderPerguntaDaSpec(
        projectId,
        perguntaId,
        resposta,
        workspace
      )
      // Responder muda a SPEC, e o `SLICE_ENTRY` aprova a SPEC com as respostas: o aceite
      // anterior descreve outro conteúdo.
      setAprovacao(null)
      if (resultado.resultado === 'gerado') await recarregar()
      else setDesfecho(resultado)
    } catch (causa: unknown) {
      log.ui.error('Falha ao responder a pergunta da SPEC', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  async function aprovar(gate: Gate): Promise<void> {
    setOcupado('aprovando')
    try {
      const resultado = await window.jarvis.aprovarGate(projectId, gate, workspace)
      setAprovacao(resultado)

      if (resultado.reason === 'aprovado') {
        // O gate move a jornada pelo **mesmo canal de evento** que move todas as etapas: uma
        // segunda entrada só para o roadmap criaria um caminho que escapa da checagem de ordem.
        await window.jarvis.aplicarEventoDaJornada(
          projectId,
          gate === 'MVP_ENTRY' ? 'mvp-aceito' : 'spec-aceita',
          workspace
        )
        await recarregar()
        onAceito?.()
      }
    } catch (causa: unknown) {
      log.ui.error('Falha ao aprovar o gate', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  const trabalhando = ocupado !== 'nao'

  if (carregando) return <LoadingState rotulo={t('roadmap.carregando')} />

  const escolhido = roadmap?.mvps.find((m) => m.id === roadmap.mvpEscolhido)

  return (
    <section className="flex flex-col gap-5" aria-labelledby={`roadmap-${projectId}`}>
      <header className="flex flex-col gap-1">
        <h3
          id={`roadmap-${projectId}`}
          className="flex items-center gap-2 text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
        >
          <GitBranch aria-hidden="true" className="size-4" />
          {t('roadmap.titulo')}
        </h3>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('roadmap.descricao', { nome: nomeDoProjeto })}
        </p>
      </header>

      {/*
        **Só o "gerar de novo" fica aqui** (regra do PI, #332). A primeira geração é o avanço da
        jornada e mora na trilha; refazer não avança nada e pertence ao lado do documento.
      */}
      {roadmap !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variante="secundaria"
            onClick={() => void gerar()}
            carregando={ocupado === 'gerando'}
            desabilitado={trabalhando}
            iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
          >
            {t('roadmap.regerar')}
          </Button>
        </div>
      )}

      {desfecho !== null && desfecho.resultado !== 'gerado' && (
        <InlineAlert
          tom={TOM_DA_GERACAO[desfecho.resultado]}
          titulo={t(
            `roadmap.resultados.${desfecho.resultado}` as `roadmap.resultados.${ResultadoDoRoadmap}`
          )}
        >
          <span className="flex flex-col gap-1">
            <span>{desfecho.mensagem}</span>
            {desfecho.acao !== undefined && (
              <span className="text-[var(--jos-cor-texto)]">{desfecho.acao}</span>
            )}

            {/* Os problemas do validador, um por linha: juntá-los num parágrafo esconderia
                quantos são, e é a contagem que diz se vale regerar ou revisar o pacote. */}
            {desfecho.problemas?.map((p) => (
              <span key={p} className="text-[length:var(--jos-texto-micro)]">
                {p}
              </span>
            ))}
          </span>
        </InlineAlert>
      )}

      {roadmap === null ? (
        <EmptyState titulo={t('roadmap.vazio')} descricao={t('roadmap.vazioDescricao')} />
      ) : (
        <>
          <MapaDosMvps
            roadmap={roadmap}
            elegiveis={elegiveis}
            ocupado={trabalhando}
            escolhendo={ocupado === 'escolhendo'}
            onEscolher={(id) => void escolher(id)}
          />

          {roadmap.spec !== undefined && (
            <SpecDaFatia
              spec={roadmap.spec}
              mvp={escolhido}
              ocupado={trabalhando}
              onResponder={(perguntaId, resposta) => void responder(perguntaId, resposta)}
            />
          )}

          <Separator />

          <CentroDeAprovacoes
            projectId={projectId}
            workspace={workspace}
            aprovacoes={aprovacoes}
            desabilitado={trabalhando}
            aprovando={ocupado === 'aprovando'}
            onAprovar={(gate) => void aprovar(gate)}
          />

          {aprovacao !== null && (
            <InlineAlert tom={TOM_DA_APROVACAO[aprovacao.reason]} titulo={aprovacao.mensagem}>
              {/*
                As pendências de marco, uma por linha, **com a ação** (SPEC-Fases-04, critério 4).
                Sem a ação o bloqueio seria um beco: a spec proíbe o "aceitar mesmo assim"
                justamente porque o caminho de saída é o remédio, não um botão de contornar.
              */}
              {aprovacao.problemas !== undefined && aprovacao.problemas.length > 0 && (
                <span className="flex flex-col gap-1">
                  {aprovacao.problemas.map((problema) => (
                    <span key={problema.mensagem} className="flex flex-col">
                      <span>{problema.mensagem}</span>
                      {problema.acao !== undefined && (
                        <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto)]">
                          {problema.acao}
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              )}
            </InlineAlert>
          )}
        </>
      )}
    </section>
  )
}

/**
 * Os MVPs propostos, com origem, checklist e o botão de escolha (critérios 2 e 3).
 *
 * **A origem aparece em cada MVP, em texto mono maiúsculo** (nunca cor sozinha, princípio 2 do
 * `PRODUCT.md`): um MVP `proposto` é uma inferência do modelo, e colocá-lo na fila é aceitar essa
 * inferência — o PI precisa ver a diferença antes de escolher.
 *
 * **Só os elegíveis oferecem o botão.** Os demais aparecem, porque o roadmap inteiro é o mapa,
 * mas dizem por que não podem ser escolhidos ainda.
 */
function MapaDosMvps({
  roadmap,
  elegiveis,
  ocupado,
  escolhendo,
  onEscolher
}: {
  readonly roadmap: RoadmapRegistrado
  readonly elegiveis: readonly MvpGerado[]
  readonly ocupado: boolean
  readonly escolhendo: boolean
  readonly onEscolher: (mvpId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const idsElegiveis = new Set(elegiveis.map((m) => m.id))

  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
        {t('roadmap.mvps', { count: roadmap.mvps.length })}
      </h4>

      <ul className="flex flex-col gap-2">
        {[...roadmap.mvps]
          .sort((a, b) => a.numero - b.numero)
          .map((mvp) => {
            const dependencias = mvp.dependeDe
              .map((d) => roadmap.mvps.find((m) => m.id === d)?.titulo ?? d)
              .join(', ')
            const naFila = mvp.id === roadmap.mvpEscolhido
            const elegivel = idsElegiveis.has(mvp.id)

            return (
              <li
                key={mvp.id}
                data-jos-mvp={mvp.id}
                data-jos-origem={mvp.origem}
                className="flex flex-col gap-2 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <span className="min-w-0 flex-1">
                    <span className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
                      {mvp.numero}. {mvp.titulo}
                    </span>
                    <span className="block max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                      {mvp.tese}
                    </span>
                    <span className="block max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                      {t('roadmap.resultado', { texto: mvp.resultado })}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {naFila && <Badge tom="ok">{t('roadmap.naFila')}</Badge>}

                    {/*
                      O botão de escolha só existe onde a escolha é possível, e só antes de haver
                      uma: trocar o MVP aceito por outro não é escolher — é desfazer um aceite, e
                      isso não é ato de um clique.
                    */}
                    {roadmap.mvpEscolhido === null && elegivel && (
                      <Button
                        variante="primaria"
                        onClick={() => onEscolher(mvp.id)}
                        carregando={escolhendo}
                        desabilitado={ocupado}
                        aria-label={t('roadmap.escolherEste', { titulo: mvp.titulo })}
                      >
                        {t('roadmap.escolher')}
                      </Button>
                    )}
                  </span>
                </div>

                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                  {t(CHAVE_DA_ORIGEM[mvp.origem])}
                  {mvp.referencia !== undefined && ` · ${mvp.referencia}`}
                </span>

                {mvp.dependeDe.length > 0 && (
                  <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                    {t('roadmap.dependeDe', { lista: dependencias })}
                  </p>
                )}

                {/* Por que este MVP não pode ser escolhido — dito, não deduzido da ausência do
                    botão. Um card sem botão e sem explicação faria o PI procurar o que fazer. */}
                {roadmap.mvpEscolhido === null && !elegivel && (
                  <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                    {t('roadmap.inelegivel')}
                  </p>
                )}

                <ul className="flex flex-col gap-1">
                  {[...mvp.fatias]
                    .sort((a, b) => a.numero - b.numero)
                    .map((fatia) => (
                      <li
                        key={fatia.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{fatia.titulo}</span>
                        <span className="shrink-0 font-[family-name:var(--jos-fonte-mono)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                          {t(CHAVE_DA_ORIGEM[fatia.origem])}
                        </span>
                      </li>
                    ))}
                </ul>
              </li>
            )
          })}
      </ul>
    </div>
  )
}

/**
 * A SPEC da primeira fatia, com as perguntas abertas no topo (critérios 4 e 5).
 *
 * **As perguntas vêm antes do documento** porque são o que trava o aceite: lê-las depois faria o
 * PI descobrir no fim que não podia aceitar. E a recomendada é destacada com a justificativa ao
 * lado — recomendação sem o porquê é só um default.
 */
function SpecDaFatia({
  spec,
  mvp,
  ocupado,
  onResponder
}: {
  readonly spec: SpecGerada
  readonly mvp: MvpGerado | undefined
  readonly ocupado: boolean
  readonly onResponder: (perguntaId: string, resposta: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const abertas = perguntasSemResposta(spec)

  return (
    <section data-jos-spec={spec.fatiaId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('roadmap.specTitulo', { titulo: spec.titulo })}
        </h4>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('roadmap.specDescricao', { mvp: mvp?.titulo ?? '—' })}
        </p>
      </div>

      {abertas.length > 0 ? (
        <InlineAlert tom="warn" titulo={t('roadmap.perguntasTitulo', { count: abertas.length })}>
          {t('roadmap.perguntasDescricao')}
        </InlineAlert>
      ) : (
        <InlineAlert tom="ok" titulo={t('roadmap.perguntasRespondidas')}>
          {t('roadmap.perguntasRespondidasDescricao')}
        </InlineAlert>
      )}

      <ul className="flex flex-col gap-3">
        {spec.perguntas.map((pergunta) => (
          <PerguntaAberta
            key={pergunta.id}
            pergunta={pergunta}
            ocupado={ocupado}
            onResponder={(resposta) => onResponder(pergunta.id, resposta)}
          />
        ))}
      </ul>

      <SecaoDaSpec titulo={t('roadmap.spec.objetivo')} itens={[spec.objetivo]} />
      <SecaoDaSpec titulo={t('roadmap.spec.fluxo')} itens={spec.fluxo} />
      <SecaoDaSpec titulo={t('roadmap.spec.regras')} itens={spec.regras} />
      <SecaoDaSpec titulo={t('roadmap.spec.criterios')} itens={spec.criteriosDeAceite} />
      <SecaoDaSpec titulo={t('roadmap.spec.testes')} itens={spec.testes} />
    </section>
  )
}

/** Uma seção da SPEC. Seção vazia não vira cabeçalho: o documento mostra o que tem. */
function SecaoDaSpec({
  titulo,
  itens
}: {
  readonly titulo: string
  readonly itens: readonly string[]
}): React.JSX.Element | null {
  if (itens.length === 0) return null

  return (
    <section className="flex flex-col gap-1">
      <h5 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
        {titulo}
      </h5>
      <ul className="flex flex-col gap-1">
        {itens.map((item) => (
          <li
            key={item}
            className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Uma pergunta aberta da SPEC, com as opções como botões.
 *
 * **Uma pergunta, opções excludentes, impacto declarado** — o contrato da M8-F03 aplicado ao que
 * a SPEC deixou em aberto. A recomendada vem primeiro e marcada, com a justificativa: o PI decide
 * vendo o trade-off, não escolhendo no escuro.
 */
function PerguntaAberta({
  pergunta,
  ocupado,
  onResponder
}: {
  readonly pergunta: PerguntaDaSpec
  readonly ocupado: boolean
  readonly onResponder: (resposta: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const respondida = pergunta.resposta !== undefined && pergunta.resposta.trim().length > 0

  // A recomendada primeiro, e as demais na ordem em que vieram: é a mesma disciplina do wizard.
  const opcoes = [...pergunta.opcoes].sort((a, b) =>
    a.id === pergunta.recomendada ? -1 : b.id === pergunta.recomendada ? 1 : 0
  )

  return (
    <li
      data-jos-pergunta={pergunta.id}
      data-jos-respondida={respondida ? 'sim' : 'nao'}
      className="flex flex-col gap-2 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] p-4"
    >
      <p className="max-w-[58ch] text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
        {pergunta.enunciado}
      </p>

      <ul className="flex flex-col gap-2">
        {opcoes.map((opcao) => {
          const escolhida = pergunta.resposta === opcao.id
          const recomendada = opcao.id === pergunta.recomendada

          return (
            <li key={opcao.id} className="flex flex-wrap items-start gap-x-4 gap-y-1">
              <span className="min-w-0 flex-1">
                <span className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
                  {opcao.rotulo}
                </span>
                {recomendada && (
                  <span className="ml-2 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                    {t('roadmap.recomendada')}
                  </span>
                )}
                <span className="block max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                  {opcao.impacto}
                </span>
              </span>

              {escolhida ? (
                <Badge tom="ok">{t('roadmap.escolhida')}</Badge>
              ) : (
                <Button
                  variante={recomendada ? 'primaria' : 'secundaria'}
                  onClick={() => onResponder(opcao.id)}
                  desabilitado={ocupado}
                  aria-label={t('roadmap.responderCom', { rotulo: opcao.rotulo })}
                >
                  {t('roadmap.responder')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <p className="max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
        {t('roadmap.justificativa', { texto: pergunta.justificativa })}
      </p>
    </li>
  )
}

/**
 * O centro de aprovações: um gate por linha, com o que ele cobre e o estado do aceite.
 *
 * **As revisões aparecem antes do botão, não atrás dele.** Aprovar sem ver o que se aprova é o
 * clique automático que o critério 5 existe para não ensinar — e o hash truncado com o completo
 * no rótulo acessível é a mesma postura das telas irmãs.
 */
function CentroDeAprovacoes({
  projectId,
  workspace,
  aprovacoes,
  desabilitado,
  aprovando,
  onAprovar
}: {
  readonly projectId: string
  readonly workspace: WorkspaceId
  readonly aprovacoes: readonly Approval[]
  readonly desabilitado: boolean
  readonly aprovando: boolean
  readonly onAprovar: (gate: Gate) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <h4 className="flex items-center gap-2 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {t('roadmap.gates')}
      </h4>

      <ul className="flex flex-col gap-2">
        {GATES.map((gate) => (
          <LinhaDoGate
            key={gate}
            gate={gate}
            projectId={projectId}
            workspace={workspace}
            aprovacoes={aprovacoes}
            desabilitado={desabilitado}
            aprovando={aprovando}
            onAprovar={onAprovar}
          />
        ))}
      </ul>
    </div>
  )
}

/** Uma linha do centro de aprovações: o gate, o que ele cobre e o aceite. */
function LinhaDoGate({
  gate,
  projectId,
  workspace,
  aprovacoes,
  desabilitado,
  aprovando,
  onAprovar
}: {
  readonly gate: Gate
  readonly projectId: string
  readonly workspace: WorkspaceId
  readonly aprovacoes: readonly Approval[]
  readonly desabilitado: boolean
  readonly aprovando: boolean
  readonly onAprovar: (gate: Gate) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [revisoes, setRevisoes] = useState<readonly { artefato: string; hash: string }[]>([])

  useEffect(() => {
    let ativo = true

    window.jarvis
      .revisoesDoGate(projectId, gate, workspace)
      .then((r) => {
        if (ativo) setRevisoes(r)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao carregar as revisões do gate', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
      })

    return () => {
      ativo = false
    }
    // `aprovacoes` entra nas dependências de propósito: aprovar muda o que o gate mostra, e sem
    // ela a linha seguiria exibindo o estado anterior.
  }, [projectId, gate, workspace, aprovacoes])

  // A aprovação vigente é a que cobre **exatamente** estas revisões (critério 5). A comparação
  // é do conjunto, como no domínio — a tela não pode ser mais permissiva que o serviço.
  const vigente = aprovacoes.find(
    (a) =>
      a.gate === gate &&
      a.revisoes.length === revisoes.length &&
      a.revisoes.every((r) =>
        revisoes.some((atual) => atual.artefato === r.artefato && atual.hash === r.hash)
      )
  )

  return (
    <li
      data-jos-gate={gate}
      className="flex flex-col gap-2 rounded-[var(--jos-raio-chip)] border border-[var(--jos-cor-borda)] px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]">
            {gate}
          </span>
          <span className="block text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t(`roadmap.gate.${gate}`)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {vigente !== undefined ? (
            <Badge tom="ok">{t('roadmap.aprovado')}</Badge>
          ) : (
            <Badge tom="warn">{t('roadmap.pendente')}</Badge>
          )}
          {/*
            Aprovar é **o aceite do PI** — o ato mais consequente da linha, e o único que move
            a jornada. A variante segue o estado em vez de ser fixa: um gate já aprovado não pede
            novo aceite, e destacar o que não pode ser clicado gastaria o acento à toa.
          */}
          <Button
            variante={vigente === undefined && revisoes.length > 0 ? 'primaria' : 'secundaria'}
            onClick={() => onAprovar(gate)}
            carregando={aprovando}
            // Um gate sem revisões não tem o que aprovar, e um já aprovado não pede novo aceite:
            // o botão que não pode dar certo não deve convidar ao clique. A recusa continua no
            // serviço — a tela não é a garantia.
            desabilitado={desabilitado || revisoes.length === 0 || vigente !== undefined}
          >
            {t('roadmap.aprovar')}
          </Button>
        </span>
      </div>

      {revisoes.length === 0 ? (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {t('roadmap.semRevisoes')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {revisoes.map((revisao) => (
            <li key={revisao.artefato} className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {revisao.artefato}
              </span>
              <span
                className="shrink-0 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
                aria-label={t('roadmap.hashCompleto', { hash: revisao.hash })}
              >
                {revisao.hash.slice(0, 12)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {vigente !== undefined && (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {t('roadmap.aprovadoPor', { identidade: vigente.identidade })}
        </p>
      )}
    </li>
  )
}
