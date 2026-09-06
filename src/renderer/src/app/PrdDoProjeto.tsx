import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessagesSquare, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { DocumentoDoPacote } from '@shared/domain/pacote-estrutural'
import { DOCUMENTOS_DO_PACOTE } from '@shared/domain/pacote-estrutural'
import type {
  AfirmacaoDoPrd,
  ContradicaoDoPrd,
  OrigemDoPrd,
  PrdOutcome,
  PrdRegistrado,
  ResultadoDoPrd
} from '@shared/domain/prd'
import {
  SECOES_DO_PRD,
  afirmacoesDoDocumento,
  podeAceitarPrd,
  propostosDoDocumento
} from '@shared/domain/prd'
import { Button, EmptyState, Field, InlineAlert, Input, LoadingState } from '@design/ui'
import type { Resposta, RespostaOutcome, VistaDoWizard } from '@shared/domain/wizard'
import { log } from '../lib/log'
import { WizardDoProjeto } from './WizardDoProjeto'

/**
 * O PRD, o Landscape e a Convention, com o gate de aceite (SPEC-Jornada-03).
 *
 * A tela responde a mesma pergunta que a do brief, sobre outro material: **o que o app afirma
 * sobre este projeto, e o que sustenta cada afirmação?** O que muda aqui são quatro coisas, e
 * cada uma vem de um critério:
 *
 *  - **O termo de pesquisa é proposto e editável** (critério 3). A IA sugere ao abrir; o PI
 *    corrige; a busca só acontece quando ele gera. O campo vazio é escolha legítima, e o botão
 *    diz isso em vez de esconder a consequência atrás de um estado desabilitado.
 *  - **Os três documentos são abas de um só gate, não três telas.** O aceite é de uma revisão
 *    que contém os três (critério 7); separá-los em rotas faria o PI aceitar "o PRD" sem ter
 *    visto o Landscape que vai junto.
 *  - **O bloqueio do Landscape é conteúdo, não erro.** Ele vive dentro da aba do documento,
 *    com a retomada, porque é lá que a lacuna existe — e **não** trava o aceite: PRD e
 *    Convention seguem (decisão do PI, 2026-09-03).
 *  - **Contradição trava o aceite e aparece no topo.** É o único bloqueio real do gate, e ela
 *    chega como pergunta com recomendação — nunca como correção já aplicada (critério 6).
 *
 * A forma segue o precedente do brief: origem em texto mono maiúsculo (nunca cor sozinha,
 * princípio 2 do `PRODUCT.md`), corte item a item na própria linha, aceite no fim com a razão
 * do bloqueio ao lado do botão.
 */

interface PrdDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Relê a jornada depois do aceite — sem isto a trilha ficaria pedindo "Aceitar o PRD". */
  readonly onAceito?: () => void
}

/** O rótulo de cada origem. **Dado, não lógica** — e o texto é o sinal, não a cor. */
const CHAVE_DA_ORIGEM: Readonly<Record<OrigemDoPrd, string>> = {
  brief: 'prd.origem.brief',
  decisao: 'prd.origem.decisao',
  evidencia: 'prd.origem.evidencia',
  proposto: 'prd.origem.proposto'
}

/**
 * Tom do alerta por desfecho. Mapa fechado, como o das telas irmãs: um motivo novo no contrato
 * quebra a compilação aqui em vez de cair num default silencioso.
 *
 * `brief-nao-aceito` e `bloqueado-sem-rota` são **`warn`, não `err`**: nada quebrou. Falta um
 * passo, e os dois dizem qual — pintar de vermelho ensinaria a ler um estado normal como falha.
 */
const TOM_POR_RESULTADO: Readonly<Record<ResultadoDoPrd, 'ok' | 'err' | 'warn'>> = {
  gerado: 'ok',
  'bloqueado-sem-rota': 'warn',
  'saida-invalida': 'err',
  'projeto-inexistente': 'err',
  'brief-nao-aceito': 'warn',
  'sem-contexto': 'warn',
  'falha-de-escrita': 'err'
}

/**
 * O que a lista inline diz da recomendação: **qual** opção, e por quê. Revisão anterior à emenda
 * E1 não tem opções — mostra só a justificativa, que era tudo o que ela guardava.
 */
function recomendacaoDaContradicao(c: ContradicaoDoPrd): string {
  const rotulo = c.opcoes.find((o) => o.id === c.recomendada)?.rotulo
  return rotulo === undefined ? c.justificativa : `${rotulo} — ${c.justificativa}`
}

function LinhaDaAfirmacao({
  afirmacao,
  onCortar,
  ocupado
}: {
  readonly afirmacao: AfirmacaoDoPrd
  /** Presente só para `proposto` — as outras origens não são cortáveis. */
  readonly onCortar?: () => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const fontes = afirmacao.fontes ?? []

  return (
    <li
      data-jos-afirmacao={afirmacao.id}
      data-jos-origem={afirmacao.origem}
      /* `gap-0.5` no par e `py-3.5` entre itens: a afirmação e sua origem são **um** grupo, e a
         separação entre grupos é maior que a distância interna — mesma medida do brief. */
      className="flex flex-col gap-0.5 py-3.5"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <p className="min-w-0 max-w-[58ch] flex-1 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
          {afirmacao.texto}
        </p>

        {onCortar !== undefined && (
          <Button
            variante="secundaria"
            onClick={onCortar}
            desabilitado={ocupado}
            /* O nome acessível carrega o texto: numa lista de botões "Cortar" idênticos, o
               leitor de tela não diria qual corta o quê. */
            aria-label={t('prd.cortarEsta', { texto: afirmacao.texto })}
            iconeInicial={<X aria-hidden="true" className="size-4" />}
          >
            {t('prd.cortar')}
          </Button>
        )}
      </div>

      <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
        {t(CHAVE_DA_ORIGEM[afirmacao.origem])}
      </span>

      {/*
        As fontes ficam **abaixo da origem**, e como links não navegáveis: o app é local, e um
        `<a href>` abriria o navegador do sistema a partir do renderer. O que o PI precisa aqui é
        saber **qual** fonte sustenta a frase, e o texto da URL responde isso.
      */}
      {fontes.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {fontes.map((url) => (
            <li
              key={url}
              className="truncate font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]"
            >
              {url}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function DocumentoDoPrd({
  documento,
  prd,
  onCortar,
  ocupado
}: {
  readonly documento: DocumentoDoPacote
  readonly prd: PrdRegistrado
  readonly onCortar: (afirmacaoId: string) => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const afirmacoes = afirmacoesDoDocumento(prd, documento)
  const inferidos = propostosDoDocumento(prd, documento)
  const bloqueio = documento === 'LANDSCAPE' ? prd.bloqueioDoLandscape : undefined

  return (
    <section data-jos-documento={documento} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t(`prd.documentos.${documento}` as `prd.documentos.${DocumentoDoPacote}`)}
        </h4>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t(`prd.descricoes.${documento}` as `prd.descricoes.${DocumentoDoPacote}`)}
        </p>
      </div>

      {/*
        O bloqueio vive **dentro** do documento, com os cinco campos da CONVENTION §4 — porque é
        aqui que a lacuna está, e porque ele carrega a única ação que destrava. Um toast que some
        obrigaria o PI a lembrar o que dizia.
      */}
      {bloqueio !== undefined && (
        <InlineAlert tom="warn" titulo={t('prd.landscapeBloqueado')}>
          <span className="flex flex-col gap-1">
            <span>{bloqueio.evidencia}</span>
            <span>{bloqueio.porQueNaoSeguir}</span>
            <span className="text-[var(--jos-cor-texto)]">{bloqueio.retomada}</span>
          </span>
        </InlineAlert>
      )}

      {/*
        Os propostos do documento, como conjunto (§ Gate). Fica **acima** das seções porque é o
        que o PI precisa julgar antes de aceitar — descobri-los lendo o documento inteiro seria
        pedir que ele fizesse a varredura que esta lista faz por ele.
      */}
      {inferidos.length > 0 && (
        <section
          data-jos-propostos={documento}
          className="flex flex-col gap-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)] p-4"
        >
          <h5 className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
            {t('prd.propostosTitulo', { count: inferidos.length })}
          </h5>
          <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t('prd.propostosDescricao')}
          </p>

          <ul className="mt-1 divide-y divide-[rgba(var(--jos-borda-rgb),0.10)]">
            {inferidos.map((a) => (
              <LinhaDaAfirmacao
                key={a.id}
                afirmacao={a}
                onCortar={() => onCortar(a.id)}
                ocupado={ocupado}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Seção sem afirmação não vira cabeçalho: o documento mostra o que tem. */}
      {SECOES_DO_PRD[documento].map((secao) => {
        const daSecao = afirmacoes.filter((a) => a.secao === secao)
        if (daSecao.length === 0) return null

        return (
          <section key={secao} data-jos-secao={secao} className="flex flex-col gap-1">
            <h5 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
              {secao}
            </h5>

            <ul className="divide-y divide-[rgba(var(--jos-borda-rgb),0.10)]">
              {daSecao.map((a) => (
                <LinhaDaAfirmacao
                  key={a.id}
                  afirmacao={a}
                  {...(a.origem === 'proposto' ? { onCortar: () => onCortar(a.id) } : {})}
                  ocupado={ocupado}
                />
              ))}
            </ul>
          </section>
        )
      })}

      {afirmacoes.length === 0 && bloqueio === undefined && (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('prd.documentoVazio')}
        </p>
      )}
    </section>
  )
}

export function PrdDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAceito
}: PrdDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [prd, setPrd] = useState<PrdRegistrado | null>(null)
  const [termo, setTermo] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [desfecho, setDesfecho] = useState<PrdOutcome | null>(null)
  const [falhaNoAceite, setFalhaNoAceite] = useState(false)
  /**
   * A vista do pop-up das contradições (emenda E1) e se ele está aberto.
   *
   * A vista é lida do main **junto** da revisão: é ela que diz se ainda há pergunta ou se todas
   * foram respondidas — a tela não conta decisões por conta própria. O pop-up abre sozinho
   * quando a revisão que acabou de chegar tem pergunta pendente; fechar é permitido (o PI pode
   * querer ler os documentos antes), e o botão da lista reabre onde parou.
   */
  const [vista, setVista] = useState<VistaDoWizard | null>(null)
  const [respondendo, setRespondendo] = useState(false)
  /**
   * Se o termo no campo foi **confirmado** pelo PI nesta sessão — isto é, se ele gerou com ele.
   * Reaberta a tela, o campo traz o termo re-proposto pela IA, e regerar sozinho com ele faria
   * a pesquisa rodar sem confirmação (critério 3).
   */
  const [termoConfirmado, setTermoConfirmado] = useState(false)

  const carregar = useCallback(async (): Promise<void> => {
    try {
      const [atual, contradicoes] = await Promise.all([
        window.jarvis.carregarPrd(projectId, workspace),
        window.jarvis.contradicoesDoPrd(projectId, workspace)
      ])
      setPrd(atual)
      setVista(contradicoes)
      setRespondendo(contradicoes?.estado.tipo === 'pergunta')
    } catch (error: unknown) {
      log.ui.error('Falha ao carregar o PRD', { error })
    } finally {
      setCarregando(false)
    }
  }, [projectId, workspace])

  useEffect(() => {
    let ativo = true

    Promise.all([
      window.jarvis.carregarPrd(projectId, workspace),
      window.jarvis.contradicoesDoPrd(projectId, workspace)
    ])
      .then(([atual, contradicoes]) => {
        if (!ativo) return
        setPrd(atual)
        setVista(contradicoes)
        setRespondendo(contradicoes?.estado.tipo === 'pergunta')
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o PRD', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  /*
   * O termo proposto pela IA (critério 3), buscado uma vez ao abrir.
   *
   * **Só quando o campo está vazio**, e por isso o efeito não depende de `termo`: reproporm-lo
   * depois sobrescreveria o que o PI acabou de digitar. Falha aqui é silenciosa de propósito —
   * a proposta é conveniência, e o PI escreve o termo dele de qualquer forma.
   */
  useEffect(() => {
    let ativo = true

    window.jarvis
      .proporTermoDePesquisa(projectId, workspace)
      .then((proposto) => {
        if (ativo && proposto !== null) setTermo((atual) => (atual === '' ? proposto : atual))
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.info('O termo de pesquisa não pôde ser proposto', { error })
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  async function gerar(): Promise<void> {
    setOcupado(true)
    setTermoConfirmado(true)
    try {
      const resultado = await window.jarvis.gerarPrd(projectId, termo, workspace)
      setDesfecho(resultado)
      if (resultado.resultado === 'gerado') await carregar()
    } catch (error: unknown) {
      log.ui.error('Falha ao gerar o PRD', { error })
    } finally {
      setOcupado(false)
    }
  }

  /**
   * O aceite (critério 7).
   *
   * Vai pelo **mesmo canal de evento** que move toda a jornada, e não por um canal próprio:
   * `aplicarEventoDaJornada` é a única via de escrita da etapa, e uma segunda entrada só para o
   * PRD criaria um caminho que escapa da checagem de ordem que ela faz.
   */
  async function aceitar(): Promise<void> {
    setOcupado(true)
    setFalhaNoAceite(false)

    try {
      await window.jarvis.aplicarEventoDaJornada(projectId, 'prd-aceito', workspace)
      await carregar()
      onAceito?.()
    } catch (error: unknown) {
      log.ui.error('Falha ao aceitar o PRD', { error })
      setFalhaNoAceite(true)
    } finally {
      setOcupado(false)
    }
  }

  async function cortar(afirmacaoId: string): Promise<void> {
    setOcupado(true)
    try {
      // Manda **um id**, e o main devolve a revisão nova. Mandar a lista do que sobra faria a
      // tela decidir o conteúdo final, e um erro dela apagaria afirmação ancorada no brief.
      const novo = await window.jarvis.cortarPropostoDoPrd(projectId, afirmacaoId, workspace)
      if (novo !== null) setPrd(novo)
      else await carregar()
    } catch (error: unknown) {
      log.ui.error('Falha ao cortar o proposto', { error })
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Responde a uma contradição pelo pop-up e, **na última**, gera os documentos de novo
   * (decisão do PI, 2026-09-06). O gatilho vive aqui, e não no main, porque é a tela que tem o
   * termo de pesquisa confirmado — a geração é o mesmo ato do botão, com o mesmo termo.
   */
  async function responder(resposta: Resposta): Promise<RespostaOutcome> {
    const desfecho = await window.jarvis.responderContradicaoDoPrd(projectId, resposta, workspace)
    if (desfecho.reason === 'registrada' && desfecho.estado?.tipo === 'concluido') {
      setRespondendo(false)
      // Só com o termo confirmado nesta sessão; senão a lista diz que falta gerar de novo.
      if (termoConfirmado) void gerar()
      else await carregar()
    }
    return desfecho
  }

  if (carregando) return <LoadingState rotulo={t('prd.carregando')} />

  const liberado = prd !== null && podeAceitarPrd(prd)

  return (
    <div className="flex flex-col gap-5" aria-labelledby={`prd-${projectId}`}>
      <div className="flex flex-col gap-1">
        <h3
          id={`prd-${projectId}`}
          className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
        >
          {t('prd.titulo')}
        </h3>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('prd.descricao', { nome: nomeDoProjeto })}
        </p>
      </div>

      {/*
        O termo, proposto e editável (critério 3). Fica **antes** dos documentos porque é o que
        governa o que o Landscape vai poder afirmar — e o texto de ajuda diz a consequência de
        deixá-lo vazio, em vez de a tela decidir por ele.
      */}
      <Field rotulo={t('prd.termo')} descricao={t('prd.termoAjuda')}>
        {(atributos) => (
          <Input
            {...atributos}
            valor={termo}
            onMudar={setTermo}
            desabilitado={ocupado}
            placeholder={t('prd.termoPlaceholder')}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variante="primaria"
          onClick={() => void gerar()}
          desabilitado={ocupado}
          carregando={ocupado}
          iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
        >
          {prd === null ? t('prd.gerar') : t('prd.regerar')}
        </Button>

        {termo.trim() === '' && (
          <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t('prd.semTermo')}
          </span>
        )}
      </div>

      {desfecho !== null && desfecho.resultado !== 'gerado' && (
        <InlineAlert
          tom={TOM_POR_RESULTADO[desfecho.resultado]}
          titulo={t(`prd.resultados.${desfecho.resultado}` as `prd.resultados.${ResultadoDoPrd}`)}
        >
          <span className="flex flex-col gap-1">
            <span>{desfecho.mensagem}</span>
            {desfecho.acao !== undefined && (
              <span className="text-[var(--jos-cor-texto)]">{desfecho.acao}</span>
            )}
            {/* Os problemas do validador, um por linha: juntá-los num parágrafo esconderia
                quantos são, e é a contagem que diz se vale regerar ou revisar o brief. */}
            {desfecho.problemas?.map((p) => (
              <span key={p} className="text-[length:var(--jos-texto-micro)]">
                {p}
              </span>
            ))}
          </span>
        </InlineAlert>
      )}

      {prd === null ? (
        <EmptyState titulo={t('prd.vazio')} descricao={t('prd.vazioDescricao')} />
      ) : (
        <>
          {/*
            As contradições (critério 6). Ficam no **topo** dos documentos e travam o aceite: são
            o único bloqueio real do gate, e o PI precisa vê-las antes de ler o que elas
            contradizem. Cada uma traz a pergunta e a recomendação — nunca a correção aplicada.
          */}
          {prd.contradicoes.length > 0 && (
            <section
              data-jos-contradicoes
              data-testid="prd-contradicoes"
              className="flex flex-col gap-2"
            >
              <InlineAlert
                tom="warn"
                titulo={t('prd.contradicoesTitulo', { count: prd.contradicoes.length })}
              >
                {vista?.estado.tipo === 'concluido'
                  ? t('prd.contradicoesRespondidas')
                  : t('prd.contradicoesDescricao')}
              </InlineAlert>

              <ul className="flex flex-col gap-3">
                {prd.contradicoes.map((c) => (
                  <li
                    key={c.id}
                    data-jos-contradicao={c.id}
                    className="flex flex-col gap-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] p-4"
                  >
                    <p className="max-w-[58ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
                      {c.enunciado}
                    </p>
                    <p className="max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                      {t('prd.recomendacao', { texto: recomendacaoDaContradicao(c) })}
                    </p>
                  </li>
                ))}
              </ul>

              {vista?.estado.tipo === 'pergunta' && (
                <div>
                  <Button
                    variante="primaria"
                    onClick={() => setRespondendo(true)}
                    desabilitado={ocupado}
                    iconeInicial={<MessagesSquare aria-hidden="true" className="size-4" />}
                  >
                    {t('prd.responderContradicoes')}
                  </Button>
                </div>
              )}
            </section>
          )}

          {DOCUMENTOS_DO_PACOTE.map((documento) => (
            <DocumentoDoPrd
              key={documento}
              documento={documento}
              prd={prd}
              onCortar={(id) => void cortar(id)}
              ocupado={ocupado}
            />
          ))}

          {falhaNoAceite && (
            <InlineAlert tom="err" titulo={t('prd.aceiteFalhou')}>
              {t('prd.aceiteDescricao')}
            </InlineAlert>
          )}

          {/*
            O aceite — a soleira do documento, e por isso no fim: aceitar é o que se faz depois
            de ler. Régua e bloco recuado em vez de mais um cartão; o botão desabilitado vem
            **com a razão ao lado**, nunca sozinho.
          */}
          <section
            data-jos-aceite="prd"
            aria-labelledby="prd-aceite"
            className="mt-1 flex flex-col gap-2 border-t border-[rgba(var(--jos-borda-rgb),0.16)] pt-5"
          >
            <h4
              id="prd-aceite"
              className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
            >
              {t('prd.aceiteTitulo')}
            </h4>
            <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
              {t('prd.aceiteDescricao')}
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Button
                variante="primaria"
                onClick={() => void aceitar()}
                desabilitado={ocupado || !liberado}
                carregando={ocupado}
                iconeInicial={<ShieldCheck aria-hidden="true" className="size-4" />}
              >
                {t('prd.aceitar')}
              </Button>

              {!liberado && (
                <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                  {t('prd.aceiteBloqueado')}
                </span>
              )}
            </div>
          </section>
        </>
      )}

      {respondendo && (
        <WizardDoProjeto
          workspace={workspace}
          projectId={projectId}
          nomeDoProjeto={nomeDoProjeto}
          aberto
          titulo={t('prd.contradicoesPopupTitulo', { nome: nomeDoProjeto })}
          descricao={t('prd.contradicoesPopupDescricao')}
          /*
           * A contradição é a mesma decisão que o refinamento conduz (M8-F03), com outra origem:
           * a pergunta vive na revisão do PRD, e a resposta vai ao mesmo repositório de decisões.
           */
          fonte={{
            ler: () => window.jarvis.contradicoesDoPrd(projectId, workspace),
            responder
          }}
          onFechar={() => setRespondendo(false)}
        />
      )}
    </div>
  )
}
