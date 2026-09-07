import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { DocumentoDaArquitetura } from '@shared/domain/arquitetura'
import { DOCUMENTOS_DA_ARQUITETURA, SECOES_DA_ARQUITETURA } from '@shared/domain/arquitetura'
import type {
  AfirmacaoDaArquitetura,
  AjusteProposto,
  ArquiteturaGeradaOutcome,
  ArquiteturaRegistrada,
  OrigemDaArquitetura,
  ResultadoDaArquitetura,
  TipoDeAjuste
} from '@shared/domain/arquitetura-gerada'
import {
  TIPOS_DE_AJUSTE,
  afirmacoesDoDocumentoDaArquitetura,
  ajustesDoTipo,
  propostosDoDocumentoDaArquitetura
} from '@shared/domain/arquitetura-gerada'
import { Button, Dialog, EmptyState, InlineAlert, LoadingState } from '@design/ui'
import { log } from '../lib/log'

/**
 * A arquitetura, as decisões, os testes e a revisão, com o gate do pacote (SPEC-Jornada-04).
 *
 * A tela responde a mesma pergunta que a do PRD, sobre outro material: **o que o app afirma
 * sobre este sistema, e o que sustenta cada afirmação?** O que muda aqui são três coisas, e cada
 * uma vem de um critério:
 *
 *  - **A origem `prototipo` mostra a tela e o hash** (critério 2). Um fluxo só é prometido com
 *    âncora no protótipo que o desenhou, e a linha exibe qual tela e qual conteúdo — não só
 *    "veio do protótipo". Sem isso, a garantia mais dura da fatia ficaria invisível justo para
 *    quem precisa conferi-la.
 *  - **Os ajustes de coerência ficam no topo, e só se descartam** (critério 4). A IA leu os
 *    protótipos contra o PRD e propõe; **nada aqui altera o anexo**. Por isso não existe botão
 *    "aplicar": autorizar um ajuste é o PI reabrir o protótipo e redesenhá-lo, e um botão que
 *    prometesse fazer isso por ele mentiria sobre o que o app faz.
 *  - **As recusas do gate de anexos são conteúdo, não erro.** "Faltam anexos" e "os protótipos
 *    têm problema" chegam com o que fazer a respeito — são estados normais do fluxo, e pintá-los
 *    de vermelho ensinaria a lê-los como falha.
 *
 * A forma segue o precedente do PRD: origem em texto mono maiúsculo (nunca cor sozinha,
 * princípio 2 do `PRODUCT.md`), corte item a item na própria linha, aceite no fim com a razão do
 * bloqueio ao lado do botão.
 */

interface ArquiteturaDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Relê a jornada depois do aceite — sem isto a trilha ficaria pedindo "Aceitar o pacote". */
  readonly onAceito?: () => void
  /**
   * A etapa atual da jornada. Este painel serve duas — `arquitetura` (gerar) e `pacote-aceito`
   * (aceitar) — e o botão da trilha promete uma coisa diferente em cada uma. Sem saber onde a
   * jornada está, o painel não teria como publicar a ação certa.
   */
  readonly etapa?: 'arquitetura' | 'pacote-aceito'
  /**
   * Publica no pai a ação que o botão da trilha dispara (#332, defeito 4).
   *
   * A regra do PI: **avanço e aceite ficam na trilha**; o painel guarda só `Gerar de novo`. Por
   * isso o botão primário de gerar sai daqui quando a etapa é `arquitetura`, e o de aceitar sai
   * quando é `pacote-aceito` — dois botões com o mesmo nome, um do lado do outro, não dá.
   */
  readonly onAcaoDaEtapa?: (acao: (() => void) | null) => void
  /** Avisa o pai enquanto gera ou aceita: é o botão da trilha que mostra o carregando agora. */
  readonly onOcupado?: (ocupado: boolean) => void
}

/** O rótulo de cada origem. **Dado, não lógica** — e o texto é o sinal, não a cor. */
const CHAVE_DA_ORIGEM: Readonly<Record<OrigemDaArquitetura, string>> = {
  prd: 'arquitetura.origem.prd',
  prototipo: 'arquitetura.origem.prototipo',
  decisao: 'arquitetura.origem.decisao',
  proposto: 'arquitetura.origem.proposto'
}

/** O rótulo de cada tipo de ajuste. Mapa fechado: um tipo novo quebra a compilação aqui. */
const CHAVE_DO_AJUSTE: Readonly<Record<TipoDeAjuste, string>> = {
  'tela-sem-requisito': 'arquitetura.ajustes.telaSemRequisito',
  'requisito-sem-tela': 'arquitetura.ajustes.requisitoSemTela',
  'estado-ausente': 'arquitetura.ajustes.estadoAusente'
}

/**
 * Tom do alerta por desfecho. Mapa fechado, como o das telas irmãs: um motivo novo no contrato
 * quebra a compilação aqui em vez de cair num default silencioso.
 *
 * `anexos-pendentes`, `prd-ausente`, `prototipos-invalidos` e `bloqueado-sem-rota` são **`warn`,
 * não `err`**: nada quebrou, falta um passo — e os quatro dizem qual.
 */
const TOM_POR_RESULTADO: Readonly<Record<ResultadoDaArquitetura, 'ok' | 'err' | 'warn'>> = {
  gerada: 'ok',
  'projeto-inexistente': 'err',
  'anexos-pendentes': 'warn',
  'prd-ausente': 'warn',
  'prototipos-invalidos': 'warn',
  'bloqueado-sem-rota': 'warn',
  'saida-invalida': 'err',
  'sem-contexto': 'warn',
  'falha-de-escrita': 'err'
}

function LinhaDaAfirmacao({
  afirmacao,
  onCortar,
  ocupado
}: {
  readonly afirmacao: AfirmacaoDaArquitetura
  /** Presente só para `proposto` — as outras origens não são cortáveis. */
  readonly onCortar?: () => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const ancora = afirmacao.ancora

  return (
    <li
      data-jos-afirmacao={afirmacao.id}
      data-jos-origem={afirmacao.origem}
      /* `gap-0.5` no par e `py-3.5` entre itens: a afirmação e sua origem são **um** grupo, e a
         separação entre grupos é maior que a distância interna — mesma medida do PRD. */
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
            aria-label={t('arquitetura.cortarEsta', { texto: afirmacao.texto })}
            iconeInicial={<X aria-hidden="true" className="size-4" />}
          >
            {t('arquitetura.cortar')}
          </Button>
        )}
      </div>

      <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
        {t(CHAVE_DA_ORIGEM[afirmacao.origem])}
      </span>

      {/*
        A âncora do protótipo, abaixo da origem: **qual tela** e **qual conteúdo**. É o critério 2
        visível — sem a jornada, "veio do protótipo" seria uma etiqueta; sem o hash, o PI não teria
        como saber se o desenho que sustenta esta linha ainda é o que está no repositório.
      */}
      {ancora !== undefined && (
        <span className="flex flex-wrap gap-x-3 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          <span className="truncate">{ancora.jornada}</span>
          <span className="truncate">{ancora.anexo}</span>
          <span>{`sha256:${ancora.hash.slice(0, 16)}`}</span>
        </span>
      )}
    </li>
  )
}

function DocumentoDaArquiteturaGerada({
  documento,
  arquitetura,
  onCortar,
  ocupado
}: {
  readonly documento: DocumentoDaArquitetura
  readonly arquitetura: ArquiteturaRegistrada
  readonly onCortar: (afirmacaoId: string) => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const afirmacoes = afirmacoesDoDocumentoDaArquitetura(arquitetura, documento)
  const inferidos = propostosDoDocumentoDaArquitetura(arquitetura, documento)

  return (
    <section data-jos-documento={documento} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t(
            `arquitetura.documentos.${documento}` as `arquitetura.documentos.${DocumentoDaArquitetura}`
          )}
        </h4>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t(
            `arquitetura.descricoes.${documento}` as `arquitetura.descricoes.${DocumentoDaArquitetura}`
          )}
        </p>
      </div>

      {/*
        Os propostos do documento, como conjunto. Fica **acima** das seções porque é o que o PI
        precisa julgar antes de aceitar — descobri-los lendo o documento inteiro seria pedir que
        ele fizesse a varredura que esta lista faz por ele.
      */}
      {inferidos.length > 0 && (
        <section
          data-jos-propostos={documento}
          className="flex flex-col gap-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)] p-4"
        >
          <h5 className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
            {t('arquitetura.propostosTitulo', { count: inferidos.length })}
          </h5>
          <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t('arquitetura.propostosDescricao')}
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
      {SECOES_DA_ARQUITETURA[documento].map((secao) => {
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

      {afirmacoes.length === 0 && (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('arquitetura.documentoVazio')}
        </p>
      )}
    </section>
  )
}

/**
 * Um ajuste da análise de coerência (critério 4).
 *
 * **Descartar é a única ação.** O botão diz "descartar", e não "aplicar", porque é literalmente o
 * que o app pode fazer: o protótipo é do PI, e mudá-lo é ato dele no arquivo — o histórico e a
 * autoria permanecem intactos porque nada aqui escreve neles.
 */
function LinhaDoAjuste({
  ajuste,
  onDescartar,
  ocupado
}: {
  readonly ajuste: AjusteProposto
  readonly onDescartar: () => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const alvo = ajuste.jornada ?? ajuste.requisito

  return (
    <li
      data-jos-ajuste={ajuste.id}
      data-jos-ajuste-tipo={ajuste.tipo}
      className="flex flex-col gap-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.16)] p-4"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
            {t(CHAVE_DO_AJUSTE[ajuste.tipo])}
            {alvo !== undefined && ` · ${alvo}`}
          </span>
          <p className="max-w-[58ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
            {ajuste.observacao}
          </p>
          <p className="max-w-[58ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t('arquitetura.recomendacao', { texto: ajuste.recomendacao })}
          </p>
        </div>

        <Button
          variante="secundaria"
          onClick={onDescartar}
          desabilitado={ocupado}
          aria-label={t('arquitetura.descartarEste', { texto: ajuste.observacao })}
          iconeInicial={<X aria-hidden="true" className="size-4" />}
        >
          {t('arquitetura.descartar')}
        </Button>
      </div>
    </li>
  )
}

export function ArquiteturaDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAceito,
  etapa = 'arquitetura',
  onAcaoDaEtapa,
  onOcupado
}: ArquiteturaDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [arquitetura, setArquitetura] = useState<ArquiteturaRegistrada | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [desfecho, setDesfecho] = useState<ArquiteturaGeradaOutcome | null>(null)
  const [falhaNoAceite, setFalhaNoAceite] = useState(false)
  /**
   * O aviso de que a IA propôs ajustes, aberto **na chegada** deles (#332, defeito 5).
   *
   * A geração termina, o PI continua olhando o topo da tela, e a lista dos ajustes fica abaixo da
   * dobra. Ele descobriu os oito rolando a página por conta própria — o que só aconteceu porque
   * ele estava procurando. O aviso é o que transforma "estava lá" em "eu soube".
   *
   * **Só abre quando a geração acabou de trazê-los.** Uma revisão já lida que volta à tela (o PI
   * trocou de menu e voltou) não abre nada: um pop-up a cada montagem viraria ruído, e ruído se
   * fecha sem ler.
   */
  const [ajustesChegaram, setAjustesChegaram] = useState<number | null>(null)

  const carregar = useCallback(async (): Promise<ArquiteturaRegistrada | null> => {
    try {
      const atual = await window.jarvis.carregarArquitetura(projectId, workspace)
      setArquitetura(atual)
      return atual
    } catch (error: unknown) {
      log.ui.error('Falha ao carregar a arquitetura', { error })
      return null
    } finally {
      setCarregando(false)
    }
  }, [projectId, workspace])

  useEffect(() => {
    let ativo = true

    window.jarvis
      .carregarArquitetura(projectId, workspace)
      .then((atual) => {
        if (ativo) setArquitetura(atual)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar a arquitetura', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  const gerar = useCallback(async (): Promise<void> => {
    setOcupado(true)
    try {
      const resultado = await window.jarvis.gerarArquiteturaPorIa(projectId, workspace)
      setDesfecho(resultado)
      if (resultado.resultado === 'gerada') {
        const nova = await carregar()
        // O aviso só nasce aqui, do resultado da geração que **este** clique disparou.
        if (nova !== null && nova.ajustes.length > 0) setAjustesChegaram(nova.ajustes.length)
      }
    } catch (error: unknown) {
      log.ui.error('Falha ao gerar a arquitetura', { error })
    } finally {
      setOcupado(false)
    }
  }, [projectId, workspace, carregar])

  /**
   * O aceite do pacote (gate `PROJECT_PACKAGE`).
   *
   * Vai pelo **mesmo canal de evento** que move toda a jornada, e não por um canal próprio:
   * `aplicarEventoDaJornada` é a única via de escrita da etapa, e uma segunda entrada só para a
   * arquitetura criaria um caminho que escapa da checagem de ordem que ela faz.
   */
  const aceitar = useCallback(async (): Promise<void> => {
    setOcupado(true)
    setFalhaNoAceite(false)

    try {
      await window.jarvis.aplicarEventoDaJornada(projectId, 'pacote-aceito', workspace)
      await carregar()
      onAceito?.()
    } catch (error: unknown) {
      log.ui.error('Falha ao aceitar o pacote', { error })
      setFalhaNoAceite(true)
    } finally {
      setOcupado(false)
    }
  }, [projectId, workspace, carregar, onAceito])

  /*
   * A ação da etapa vai para a trilha (#332, defeito 4).
   *
   * Na etapa `arquitetura` o botão da trilha diz "Gerar a arquitetura" e agora **gera**; na
   * `pacote-aceito` ele diz "Aceitar o pacote" e aceita. Antes ele só rolava a página até um
   * segundo botão de mesmo nome — e quem clicava no primeiro não via nada acontecer.
   *
   * A limpeza no retorno é o que impede a ação desta etapa de sobreviver à troca de painel.
   */
  useEffect(() => {
    const acao = etapa === 'pacote-aceito' ? aceitar : gerar
    onAcaoDaEtapa?.(() => void acao())
    return () => onAcaoDaEtapa?.(null)
  }, [etapa, gerar, aceitar, onAcaoDaEtapa])

  useEffect(() => {
    onOcupado?.(ocupado)
  }, [ocupado, onOcupado])

  async function cortar(afirmacaoId: string): Promise<void> {
    setOcupado(true)
    try {
      // Manda **um id**, e o main devolve a revisão nova. Mandar a lista do que sobra faria a
      // tela decidir o conteúdo final, e um erro dela apagaria afirmação ancorada no protótipo.
      const novo = await window.jarvis.cortarPropostoDaArquitetura(
        projectId,
        afirmacaoId,
        workspace
      )
      if (novo !== null) setArquitetura(novo)
      else await carregar()
    } catch (error: unknown) {
      log.ui.error('Falha ao cortar o proposto', { error })
    } finally {
      setOcupado(false)
    }
  }

  async function descartar(ajusteId: string): Promise<void> {
    setOcupado(true)
    try {
      const novo = await window.jarvis.descartarAjusteDaArquitetura(projectId, ajusteId, workspace)
      if (novo !== null) setArquitetura(novo)
      else await carregar()
    } catch (error: unknown) {
      log.ui.error('Falha ao descartar o ajuste', { error })
    } finally {
      setOcupado(false)
    }
  }

  if (carregando) return <LoadingState rotulo={t('arquitetura.carregando')} />

  return (
    <div className="flex flex-col gap-5" aria-labelledby={`arquitetura-${projectId}`}>
      <div className="flex flex-col gap-1">
        <h3
          id={`arquitetura-${projectId}`}
          className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
        >
          {t('arquitetura.titulo')}
        </h3>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('arquitetura.descricao', { nome: nomeDoProjeto })}
        </p>
      </div>

      {/*
        **Só o "gerar de novo" fica aqui** (regra do PI, #332).

        A primeira geração é o avanço da jornada e mora na trilha: dois botões com o mesmo nome,
        um do lado do outro, é o defeito que esta correção fecha. Refazer é outra coisa — não
        avança nada, desfaz um resultado que o PI leu e não gostou, e por isso pertence ao lado
        do documento, em `secundaria`.
      */}
      {arquitetura !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variante="secundaria"
            onClick={() => void gerar()}
            desabilitado={ocupado}
            carregando={ocupado}
            iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
          >
            {t('arquitetura.regerar')}
          </Button>
        </div>
      )}

      {desfecho !== null && desfecho.resultado !== 'gerada' && (
        <InlineAlert
          tom={TOM_POR_RESULTADO[desfecho.resultado]}
          titulo={t(
            `arquitetura.resultados.${desfecho.resultado}` as `arquitetura.resultados.${ResultadoDaArquitetura}`
          )}
        >
          <span className="flex flex-col gap-1">
            <span>{desfecho.mensagem}</span>
            {desfecho.acao !== undefined && (
              <span className="text-[var(--jos-cor-texto)]">{desfecho.acao}</span>
            )}

            {/* O que falta anexar, nomeado: "faltam anexos" sozinho mandaria o PI adivinhar. */}
            {desfecho.pendencias?.map((p) => (
              <span key={p} className="text-[length:var(--jos-texto-micro)]">
                {t(`anexos.tipo.${p}` as 'anexos.tipo.design-system')}
              </span>
            ))}

            {/* Os achados que impedem chegam como pergunta com recomendação, nunca veredito. */}
            {desfecho.achados?.map((a) => (
              <span key={a.id} className="text-[length:var(--jos-texto-micro)]">
                {`${a.pergunta} — ${a.recomendacao}`}
              </span>
            ))}

            {/* Os problemas do validador, um por linha: juntá-los num parágrafo esconderia
                quantos são, e é a contagem que diz se vale regerar ou revisar os protótipos. */}
            {desfecho.problemas?.map((p) => (
              <span key={p} className="text-[length:var(--jos-texto-micro)]">
                {p}
              </span>
            ))}
          </span>
        </InlineAlert>
      )}

      {arquitetura === null ? (
        <EmptyState titulo={t('arquitetura.vazio')} descricao={t('arquitetura.vazioDescricao')} />
      ) : (
        <>
          {/*
            Os ajustes de coerência (critério 4). Ficam no **topo** dos documentos porque falam do
            material que os originou — e **não travam o aceite**: são propostas de mudança no
            desenho do PI, não conflitos internos do documento. Travá-las obrigaria o PI a
            redesenhar o protótipo antes de aceitar uma arquitetura que já está coerente com o que
            ele desenhou.
          */}
          {arquitetura.ajustes.length > 0 && (
            <section data-jos-ajustes id="arquitetura-ajustes" className="flex flex-col gap-2">
              <InlineAlert
                tom="warn"
                titulo={t('arquitetura.ajustesTitulo', { count: arquitetura.ajustes.length })}
              >
                {t('arquitetura.ajustesDescricao')}
              </InlineAlert>

              {/* Agrupados por tipo: uma tela sem requisito se julga com outra cabeça que um
                  requisito sem tela, e misturá-los faria o PI reclassificar item a item. */}
              {TIPOS_DE_AJUSTE.map((tipo) => {
                const doTipo = ajustesDoTipo(arquitetura, tipo)
                if (doTipo.length === 0) return null

                return (
                  <ul key={tipo} className="flex flex-col gap-3">
                    {doTipo.map((a) => (
                      <LinhaDoAjuste
                        key={a.id}
                        ajuste={a}
                        onDescartar={() => void descartar(a.id)}
                        ocupado={ocupado}
                      />
                    ))}
                  </ul>
                )
              })}
            </section>
          )}

          {DOCUMENTOS_DA_ARQUITETURA.map((documento) => (
            <DocumentoDaArquiteturaGerada
              key={documento}
              documento={documento}
              arquitetura={arquitetura}
              onCortar={(id) => void cortar(id)}
              ocupado={ocupado}
            />
          ))}

          {falhaNoAceite && (
            <InlineAlert tom="err" titulo={t('arquitetura.aceiteFalhou')}>
              {t('arquitetura.aceiteDescricao')}
            </InlineAlert>
          )}

          {/*
            O aceite — a soleira do documento, e por isso no fim: aceitar é o que se faz depois de
            ler. Régua e bloco recuado em vez de mais um cartão, mesma medida do PRD.
          */}
          <section
            data-jos-aceite="arquitetura"
            aria-labelledby="arquitetura-aceite"
            className="mt-1 flex flex-col gap-2 border-t border-[rgba(var(--jos-borda-rgb),0.16)] pt-5"
          >
            <h4
              id="arquitetura-aceite"
              className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
            >
              {t('arquitetura.aceiteTitulo')}
            </h4>
            <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
              {t('arquitetura.aceiteDescricao')}
            </p>

            {/*
              O botão de aceitar saiu daqui e foi para a trilha (regra do PI, #332): aceite é
              avanço da jornada. O texto acima continua sendo o que o PI precisa ler **antes** de
              apertar — a soleira permanece, só a maçaneta mudou de lugar.
            */}
          </section>
        </>
      )}

      {/*
        O aviso de chegada dos ajustes (#332, defeito 5).
        
        **Pop-up por decisão do PI.** A ressalva técnica está registrada na issue: os ajustes se
        julgam com o documento ao lado, um a um, e um modal que os listasse tiraria justamente
        esse contexto. Então este pop-up **não decide nada** — ele anuncia, responde a pergunta
        que o PI fez ("ajuste é DISCARTE?") e leva até a lista, onde cada item vive com o
        documento que o originou.

        `Depois` fecha sem levar: o aviso é uma notícia, não um bloqueio. O que ele não pode é
        deixar o PI descobrir oito ajustes rolando a página por conta própria.
      */}
      <Dialog
        aberto={ajustesChegaram !== null}
        onFechar={() => setAjustesChegaram(null)}
        titulo={t('arquitetura.chegadaTitulo', { count: ajustesChegaram ?? 0 })}
        descricao={t('arquitetura.chegadaDescricao')}
        rodape={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variante="primaria"
              onClick={() => {
                setAjustesChegaram(null)
                document
                  .getElementById('arquitetura-ajustes')
                  ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }}
            >
              {t('arquitetura.chegadaVer')}
            </Button>
            <Button variante="secundaria" onClick={() => setAjustesChegaram(null)}>
              {t('arquitetura.chegadaDepois')}
            </Button>
          </div>
        }
      >
        <p className="max-w-[58ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('arquitetura.chegadaOQueE')}
        </p>
      </Dialog>
    </div>
  )
}
