import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Project } from '@shared/domain/projects'
import type { EstadoDaJornada } from '@shared/domain/jornada'
import { Button, ErrorState, LoadingState } from '@design/ui'
import { log } from '../lib/log'
import { TrilhaDaJornada } from './TrilhaDaJornada'
import { ConsoleDaGeracao } from './ConsoleDaGeracao'
import { MarcosDoProjeto } from './MarcosDoProjeto'
import { ExecutoresDoProjeto } from './ExecutoresDoProjeto'
import { WizardDoProjeto } from './WizardDoProjeto'
import { AnexosDeDesign } from './AnexosDeDesign'
import { ArquiteturaDoProjeto } from './ArquiteturaDoProjeto'
import { RoadmapDoProjeto } from './RoadmapDoProjeto'
import { PromptDoProjeto } from './PromptDoProjeto'
import { BriefDoProjeto } from './BriefDoProjeto'
import { PrdDoProjeto } from './PrdDoProjeto'
import { RefinamentoDoProjeto } from './RefinamentoDoProjeto'

/**
 * Um projeto aberto: a trilha da jornada e o conteúdo da etapa atual (SPEC-Jornada-01).
 *
 * **A lista virou índice e o projeto ganhou tela própria** — pergunta resolvida pelo PI em
 * 2026-09-03. Expandir dentro da lista foi descartado: a trilha tem doze posições e o conteúdo
 * da etapa é alto, e os dois espremidos num item empurrariam a coluna que o PI veio varrer para
 * fora da dobra.
 *
 * **Os painéis do MVP-008 viraram conteúdo de etapa.** Eles não sumiram nem ganharam botão
 * próprio: cada um aparece **só** na etapa a que pertence. É a diferença entre um menu de
 * quatro portas — que obrigava a adivinhar por onde começar — e uma jornada com um próximo
 * passo por vez.
 *
 * A composição é de duas colunas em tela larga: a trilha à esquerda fixa o "onde estou", o
 * conteúdo à direita responde "o que faço agora". Em tela estreita elas empilham, com a trilha
 * primeiro — a orientação vem antes da ação.
 */

interface ProjetoAbertoProps {
  readonly workspace: WorkspaceId
  readonly projeto: Project
  readonly onVoltar: () => void
}

export function ProjetoAberto({
  workspace,
  projeto,
  onVoltar
}: ProjetoAbertoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [estado, setEstado] = useState<EstadoDaJornada | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [falhou, setFalhou] = useState(false)
  /**
   * O wizard abre em pop-up, como no MVP-008: a spec pede uma pergunta por vez, e um painel
   * inline mostraria a pergunta ao lado de tudo que compete por atenção.
   */
  const [respondendo, setRespondendo] = useState(false)
  /**
   * Por que o CTA da etapa atual não pode agir, quando não pode (#318).
   *
   * Quem sabe é o painel da etapa — o gate do PRD trava com contradição pendente. O pai é só o
   * carteiro entre o painel e a trilha; ele não deriva nada, para não haver duas contas do mesmo
   * gate divergindo.
   */
  const [bloqueioDoCta, setBloqueioDoCta] = useState<string | undefined>(undefined)
  /**
   * A ação da etapa atual, publicada pelo painel que sabe executá-la (#332, defeito 4).
   *
   * O botão da trilha prometia "Gerar a arquitetura" e só rolava a página até um segundo botão
   * com o mesmo nome — dois alvos para o mesmo ato, e o primeiro não fazia nada. A regra do PI é
   * uma só: **avanço e aceite ficam na trilha**; `Gerar de novo` e `Verificar de novo` ficam no
   * painel. Para isso a trilha precisa da própria ação, e quem a tem é o painel.
   *
   * Em `ref` e não em `state`: publicar a ação não muda nada na tela, e guardá-la em estado
   * re-renderizaria a árvore inteira a cada render do painel — que republica a cada uma.
   */
  const acaoDaEtapa = useRef<(() => void) | null>(null)
  /**
   * O painel está ocupado executando a própria ação.
   *
   * Este **é** estado: enquanto o painel gera, o botão da trilha tem de aparecer carregando e
   * recusar o segundo clique. É o mesmo `ocupado` que o painel já usava no botão que saiu.
   */
  const [ocupadoNaEtapa, setOcupadoNaEtapa] = useState(false)

  const carregar = useCallback(async (): Promise<void> => {
    try {
      const atual = await window.jarvis.estadoDaJornada(projeto.id, workspace)
      setEstado(atual)
      setFalhou(atual === null)
    } catch (error: unknown) {
      log.ui.error('Falha ao carregar a jornada', { error })
      setFalhou(true)
    } finally {
      setCarregando(false)
    }
  }, [projeto.id, workspace])

  useEffect(() => {
    let ativo = true

    window.jarvis
      .estadoDaJornada(projeto.id, workspace)
      .then((atual) => {
        if (!ativo) return
        setEstado(atual)
        setFalhou(atual === null)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao carregar a jornada', { error })
        setFalhou(true)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projeto.id, workspace])

  /**
   * O CTA da etapa atual. Cada etapa tem uma ação e só uma; o que ela faz depende de onde a
   * jornada está, e é por isso que o mapa mora aqui e não no componente da trilha — a trilha
   * desenha, esta tela decide.
   *
   * As etapas de geração por IA (`prd`, `arquitetura`, `roadmap`) e os aceites são das fatias
   * F02–F05: aqui elas mostram o painel correspondente, que já sabe gerar e aprovar. Esta fatia
   * dá a **ordem**, não a geração.
   */
  function agir(): void {
    if (estado === null) return

    if (estado.etapa === 'prompt' || estado.etapa === 'refinamento') {
      setRespondendo(true)
      return
    }

    // O botão da trilha **executa**. Antes ele rolava a tela até um segundo botão com o mesmo
    // rótulo, e quem clicava no primeiro não via nada acontecer (#332, defeito 4).
    const acao = acaoDaEtapa.current
    if (acao !== null) {
      acao()
      return
    }

    // Etapa cujo painel não publica ação — o conteúdo já está na tela e o CTA leva até ele.
    document.querySelector('[data-jos-conteudo-da-etapa]')?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          {/* O voltar vem **antes** do título e alinhado à esquerda: é a saída da tela, e
              escondê-lo à direita faria o PI procurar por onde sair de um lugar em que ele
              acabou de entrar. */}
          <Button
            variante="secundaria"
            onClick={onVoltar}
            iconeInicial={<ArrowLeft aria-hidden="true" className="size-4" />}
          >
            {t('projetos.voltar')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] tracking-[var(--jos-tracking-display)] text-[var(--jos-cor-texto)]">
            {projeto.nome}
          </h2>
          {/* O caminho em mono, mesma convenção do índice: é endereço de disco, e fonte
              proporcional esconde a diferença entre `l`/`1` e `O`/`0`. */}
          <span className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {projeto.diretorio}
          </span>
        </div>
      </div>

      {carregando ? (
        <LoadingState rotulo={t('jornada.carregando')} />
      ) : falhou || estado === null ? (
        <ErrorState
          titulo={t('jornada.titulo')}
          descricao={t('jornada.carregando')}
          onTentarNovamente={() => {
            setCarregando(true)
            setFalhou(false)
            void carregar()
          }}
        />
      ) : (
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
          {/* A trilha não estica: ela é uma coluna de leitura, e alargá-la afastaria o marcador
              do rótulo até a linha deixar de se ler como uma unidade. */}
          <div className="lg:w-[19rem] lg:shrink-0">
            <TrilhaDaJornada
              estado={estado}
              onAgir={agir}
              ocupado={ocupadoNaEtapa}
              {...(bloqueioDoCta === undefined ? {} : { bloqueio: bloqueioDoCta })}
            />
          </div>

          <div
            data-jos-conteudo-da-etapa
            className="flex min-w-0 flex-1 flex-col gap-4 border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0"
          >
            <ConteudoDaEtapa
              workspace={workspace}
              projeto={projeto}
              estado={estado}
              onRecarregar={() => void carregar()}
              onAbrirPerguntas={() => setRespondendo(true)}
              onBloqueioDoCta={setBloqueioDoCta}
              onAcaoDaEtapa={(acao) => {
                acaoDaEtapa.current = acao
              }}
              onOcupadoNaEtapa={setOcupadoNaEtapa}
            />

            {/*
              O console da geração (SPEC-Fases-03), **abaixo do documento e dentro da etapa**.
              Um ponto só, e não uma inserção em cada um dos sete painéis: o que ele mostra é a
              geração da etapa corrente, que é justamente o que este contêiner delimita. Sete
              cópias divergiriam na primeira correção feita só numa delas.
            */}
            <ConsoleDaGeracao projectId={projeto.id} workspace={workspace} etapa={estado.etapa} />

            {/*
              O painel de marcos (SPEC-Fases-04), no mesmo contêiner e pela mesma razão do
              console: o que ele mostra é do **projeto**, não da etapa — e uma cópia em cada um
              dos sete painéis divergiria na primeira correção feita só numa delas.
            */}
            <MarcosDoProjeto projectId={projeto.id} workspace={workspace} />

            <ExecutoresDoProjeto projectId={projeto.id} workspace={workspace} />
          </div>
        </div>
      )}

      {respondendo && (
        <WizardDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          aberto
          /*
           * O refinamento tem fonte própria (M25-F02): as perguntas são geradas por projeto, não
           * lidas do catálogo estático. A tela é a mesma de propósito — a decisão que ela conduz
           * é idêntica, e duplicá-la criaria duas superfícies que divergiriam na primeira
           * correção feita só numa delas.
           */
          fonte={{
            ler: async () => {
              const [estadoDoRefinamento, historico] = await Promise.all([
                window.jarvis.estadoDoRefinamento(projeto.id, workspace),
                window.jarvis.historicoDoRefinamento(projeto.id, workspace)
              ])
              return estadoDoRefinamento === null
                ? null
                : { estado: estadoDoRefinamento, historico }
            },
            responder: (resposta) =>
              window.jarvis.responderRefinamento(projeto.id, resposta, workspace)
          }}
          onFechar={() => {
            setRespondendo(false)
            // Reler ao fechar: responder o refinamento é o que sustenta os eventos da jornada,
            // e a trilha ficaria mostrando a etapa velha até um F5.
            void carregar()
          }}
        />
      )}
    </div>
  )
}

/**
 * O painel da etapa atual — e **só** dele (critério 4).
 *
 * Um `switch` sobre a etapa, e não quatro painéis empilhados com um deles destacado: mostrar
 * todos de uma vez é exatamente o que o MVP-008 fazia, e é o que fazia o PI não saber por onde
 * começar. Etapa futura não tem painel porque não tem ação.
 */
function ConteudoDaEtapa({
  workspace,
  projeto,
  estado,
  onRecarregar,
  onAbrirPerguntas,
  onBloqueioDoCta,
  onAcaoDaEtapa,
  onOcupadoNaEtapa
}: {
  readonly workspace: WorkspaceId
  readonly projeto: Project
  readonly estado: EstadoDaJornada
  /** Relê a jornada depois de um ato que a move — sem isso a trilha ficaria na etapa velha. */
  readonly onRecarregar: () => void
  /** Abre o pop-up de perguntas. A tela de refinamento pede; quem monta o pop-up é o pai. */
  readonly onAbrirPerguntas: () => void
  /** O painel diz por que o CTA da trilha não pode agir — ou `undefined` quando pode (#318). */
  readonly onBloqueioDoCta: (motivo: string | undefined) => void
  /**
   * O painel entrega ao pai a ação que o botão da trilha dispara (#332, defeito 4), ou `null`
   * quando esta etapa não tem uma — aí o CTA volta a apenas levar o PI até o conteúdo.
   */
  readonly onAcaoDaEtapa: (acao: (() => void) | null) => void
  /** O painel está executando a própria ação: a trilha mostra carregando e recusa o clique. */
  readonly onOcupadoNaEtapa: (ocupado: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  switch (estado.etapa) {
    // O prompt é a etapa que faltava: em nenhum momento do MVP-008 o PI dizia o que o projeto
    // é (SPEC-Jornada-02, critério 1).
    case 'prompt':
      return (
        <PromptDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          onAvancar={onRecarregar}
        />
      )

    // O refinamento: a IA pergunta o que o prompt não respondeu, uma decisão por vez.
    case 'refinamento':
      return (
        <RefinamentoDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          onResponder={onAbrirPerguntas}
          onRecarregar={onRecarregar}
        />
      )

    // O gate do brief: é aqui que o PI vê o que a IA inferiu e corta item a item.
    case 'brief-aceito':
      return (
        <BriefDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          onAceito={onRecarregar}
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupadoNaEtapa}
          onBloqueioDoAceite={onBloqueioDoCta}
        />
      )

    // O PRD, o Landscape e a Convention gerados por IA, com o gate (SPEC-Jornada-03). Substitui
    // o painel do pacote composto da M8-F04: os três documentos são os mesmos, mas agora nascem
    // do brief aceito com origem por afirmação — e o aceite deles é o que abre a etapa `design`.
    case 'prd':
    case 'prd-aceito':
      return (
        <PrdDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          onAceito={onRecarregar}
          onBloqueioDoAceite={onBloqueioDoCta}
          etapa={estado.etapa}
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupadoNaEtapa}
        />
      )

    // Os anexos do PI: o gate que a arquitetura espera. Continua sendo a tela desta etapa, sem
    // o botão de gerar — a geração migrou para a etapa seguinte, que tem tela própria.
    case 'design':
      return (
        <AnexosDeDesign
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          onEtapaMudou={onRecarregar}
        />
      )

    // A arquitetura, as decisões, os testes e a revisão gerados por IA, com o gate do pacote
    // (SPEC-Jornada-04). Substitui a composição da M8-F05: os quatro documentos são os mesmos,
    // mas agora nascem do PRD aceito e dos protótipos, com origem por afirmação.
    case 'arquitetura':
    case 'pacote-aceito':
      return (
        <ArquiteturaDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          onAceito={onRecarregar}
          etapa={estado.etapa}
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupadoNaEtapa}
        />
      )

    case 'roadmap':
    case 'mvp-aceito':
    case 'spec-aceita':
    case 'construcao':
      return (
        <RoadmapDoProjeto
          workspace={workspace}
          projectId={projeto.id}
          nomeDoProjeto={projeto.nome}
          etapa={estado.etapa}
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupadoNaEtapa}
        />
      )

    // `prompt` e `refinamento`: o conteúdo é o wizard, que abre em pop-up pelo CTA. Aqui fica
    // só a orientação — um painel vazio seria pior que o texto que diz o que o botão faz.
    default:
      return (
        <div className="flex flex-col gap-2">
          <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
            {t('jornada.titulo')}
          </h3>
          <p className="max-w-[60ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            {t('jornada.descricao')}
          </p>
        </div>
      )
  }
}
