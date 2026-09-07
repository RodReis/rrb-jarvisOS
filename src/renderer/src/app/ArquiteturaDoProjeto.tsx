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
  pendenciasDeRevisao,
  propostosPorDocumento
} from '@shared/domain/arquitetura-gerada'
import {
  Button,
  Dialog,
  Disclosure,
  EmptyState,
  InlineAlert,
  LoadingState,
  TabPanel,
  Tabs
} from '@design/ui'
import type { AprovacaoOutcome } from '@shared/domain/aprovacoes'
import type { AndamentoDaEtapa, EtapaDaGeracao } from '@shared/domain/geracao'
import { ETAPAS_DA_ARQUITETURA, aplicarEtapa } from '@shared/domain/geracao'
import { log } from '../lib/log'
import { DesfechoDaAprovacao } from './aprovacao-recusada'
import { AndamentoDaGeracao } from './AndamentoDaGeracao'

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
/**
 * O valor da aba que reúne o que pede decisão (#333).
 *
 * Constante e não literal solto: ela é comparada em três lugares (o default, o gatilho e o
 * painel), e um erro de digitação num deles abriria a tela numa aba que não existe.
 * `__revisar__` com sublinhados para nunca colidir com um nome de documento.
 */
const ABA_REVISAR = '__revisar__'

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
        {/*
          Sem teto próprio de medida: quem limita agora é a **coluna** — mesma correção que o
          brief já tinha (`BriefDoProjeto`), e que este painel não recebeu na época.

          O `max-w-[58ch]` fazia sentido quando o documento ocupava a tela inteira. Dentro da
          coluna de conteúdo ele sufoca duas vezes: medido, o texto usava 438px de uma coluna de
          ~880px, com metade vazia à direita. Duas medidas empilhadas cortam pelo menor, e o
          menor aqui era o teto que a coluna já garante.
        */}
        <p className="min-w-0 flex-1 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
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
        **O bloco de propostos saiu daqui** (#333). Ele repetia, acima das seções, as mesmas
        afirmações que apareciam abaixo no corpo do documento — a mesma frase duas vezes na
        mesma tela, com o botão `Cortar` nas duas. Era metade da altura desta etapa.

        As propostas continuam **no corpo**, onde se leem no contexto da seção que as gerou, e
        agora também na aba "A revisar", que as reúne para o PI julgar sem procurar documento por
        documento. Lá elas são as mesmas linhas, com o mesmo corte: um lugar para ler, um para
        decidir, e a mesma verdade nos dois.
      */}

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

/**
 * A aba **A revisar**: tudo o que pede decisão do PI, num lugar só (issue #333).
 *
 * **Por que ela existe.** As propostas da IA nasciam espalhadas pelos quatro documentos e os
 * ajustes de coerência ficavam no topo da página. Para saber se havia algo a cortar, o PI rolava
 * a etapa inteira — 4.941px medidos numa janela de 900 — e rolava de volta para agir.
 *
 * **Reunir não é misturar.** Os ajustes ficam separados das propostas porque são coisas
 * diferentes: ajuste fala do protótipo que o PI desenhou e só se descarta; proposta é inferência
 * dentro do documento e se corta. E as propostas seguem **agrupadas por documento**, porque uma
 * inferência sobre a estratégia de teste se julga com outra cabeça que uma sobre os módulos.
 *
 * O que ela **não** faz é substituir a leitura: cada proposta continua no corpo do documento, na
 * seção que a gerou. Aqui é onde se decide; lá é onde se entende.
 */
function OQuePedeDecisao({
  arquitetura,
  onCortar,
  onDescartar,
  ocupado
}: {
  readonly arquitetura: ArquiteturaRegistrada
  readonly onCortar: (afirmacaoId: string) => void
  readonly onDescartar: (ajusteId: string) => void
  readonly ocupado: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const grupos = propostosPorDocumento(arquitetura)

  if (arquitetura.ajustes.length === 0 && grupos.length === 0) {
    return (
      <EmptyState
        titulo={t('arquitetura.revisarVazio')}
        descricao={t('arquitetura.revisarVazioDescricao')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h4 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('arquitetura.revisarTitulo')}
        </h4>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('arquitetura.revisarDescricao')}
        </p>
      </div>

      {/*
        Os ajustes primeiro: eles falam do material que o PI **fez**, e decidir sobre o próprio
        desenho vem antes de decidir sobre o que a IA inferiu a partir dele.
      */}
      {arquitetura.ajustes.length > 0 && (
        <section data-jos-ajustes id="arquitetura-ajustes" className="flex flex-col gap-2">
          <InlineAlert
            tom="warn"
            titulo={t('arquitetura.ajustesTitulo', { count: arquitetura.ajustes.length })}
          >
            {t('arquitetura.ajustesDescricao')}
          </InlineAlert>

          {/*
            Agrupados por tipo: uma tela sem requisito se julga com outra cabeça que um requisito
            sem tela, e misturá-los faria o PI reclassificar item a item.

            **Colapsados, só o primeiro aberto** (#333) — pela mesma razão das propostas: oito
            ajustes abertos somavam 921px e devolviam a rolagem que as abas tinham acabado de
            tirar. A contagem no `resumo` diz de quantos é cada grupo com o bloco fechado.
          */}
          {TIPOS_DE_AJUSTE.filter((tipo) => ajustesDoTipo(arquitetura, tipo).length > 0).map(
            (tipo, indice) => {
              const doTipo = ajustesDoTipo(arquitetura, tipo)

              return (
                <div key={tipo} data-jos-ajuste-grupo={tipo}>
                  <Disclosure
                    abertoPorPadrao={indice === 0}
                    rotulo={t(CHAVE_DO_AJUSTE[tipo])}
                    resumo={
                      <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                        {doTipo.length}
                      </span>
                    }
                  >
                    <ul className="flex flex-col gap-3">
                      {doTipo.map((a) => (
                        <LinhaDoAjuste
                          key={a.id}
                          ajuste={a}
                          onDescartar={() => onDescartar(a.id)}
                          ocupado={ocupado}
                        />
                      ))}
                    </ul>
                  </Disclosure>
                </div>
              )
            }
          )}
        </section>
      )}

      {grupos.length > 0 && (
        <section data-jos-propostos-do-pacote className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h5 className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
              {t('arquitetura.revisarPropostosTitulo')}
            </h5>
            {/* O aviso que não pode sumir do redesenho: sem ele, uma inferência da IA se lê
                como fato apurado. É a garantia inteira desta tela. */}
            <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
              {t('arquitetura.propostosDescricao')}
            </p>
          </div>

          {/*
            **Um bloco por documento, e só o primeiro aberto.**

            Reunir as propostas resolveu a procura e criou uma pilha nova: com 18 itens medidos, a
            aba sozinha dava 2.654px — quase três telas, e é a aba que abre primeiro. Colapsar
            devolve a visão de conjunto que a reunião prometia.

            A contagem vai no `resumo`, que o DS mantém **visível com o bloco fechado**: é ela que
            justifica abrir, e escondê-la faria o PI abrir os quatro para descobrir onde há o quê.
          */}
          {grupos.map(({ documento, propostos }, indice) => (
            <div key={documento} data-jos-propostos={documento}>
              <Disclosure
                abertoPorPadrao={indice === 0}
                rotulo={t(
                  `arquitetura.documentos.${documento}` as `arquitetura.documentos.${DocumentoDaArquitetura}`
                )}
                resumo={
                  <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
                    {propostos.length}
                  </span>
                }
              >
                <ul className="divide-y divide-[rgba(var(--jos-borda-rgb),0.10)]">
                  {propostos.map((a) => (
                    <LinhaDaAfirmacao
                      key={a.id}
                      afirmacao={a}
                      onCortar={() => onCortar(a.id)}
                      ocupado={ocupado}
                    />
                  ))}
                </ul>
              </Disclosure>
            </div>
          ))}
        </section>
      )}
    </div>
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
   * Por que o gate recusou o aceite, quando recusou.
   *
   * Estado próprio e não booleano: os motivos são nomeados no contrato (`sem-revisoes`,
   * `sem-identidade`, `marcos-pendentes`) e cada um pede uma ação diferente do PI. Um "falhou"
   * genérico o mandaria adivinhar qual.
   */
  const [recusaDoAceite, setRecusaDoAceite] = useState<AprovacaoOutcome | null>(null)
  /**
   * O andamento da geração **desta rodada** (issue #337).
   *
   * A barra existia só no PRD desde a #287, e o PI gerou a arquitetura vendo o botão girar sem
   * nada dizer o que acontecia. A regra é da tela da etapa (SPEC-Jornada-03 § Emenda E2, item 1).
   */
  const [etapas, setEtapas] = useState<ReadonlyMap<EtapaDaGeracao, AndamentoDaEtapa>>(new Map())
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

  /*
   * A tela acompanha a geração que corre no **main**, inclusive a que começou antes de ela montar
   * (SPEC-Jornada-03 § Emenda E2, item 4).
   *
   * `ETAPAS_DA_ARQUITETURA` e não a lista do PRD: o denominador tem de ser o desta geração, senão
   * a barra pararia em 60% numa rodada que terminou.
   */
  useEffect(() => {
    return window.jarvis.onGenerationEvent(({ evento }) => {
      if (evento.tipo !== 'etapa') return

      setEtapas((atuais) => aplicarEtapa(atuais, evento, [...ETAPAS_DA_ARQUITETURA]))
      if (evento.etapa === 'gravacao' && evento.estado === 'concluida') void carregar()
    })
  }, [carregar])

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
   * O aceite do pacote — **aprovar o gate `PROJECT_PACKAGE` e então mover a etapa**.
   *
   * **O defeito que isto conserta.** A tela chamava só `aplicarEventoDaJornada`, e o main recusava
   * toda vez com `aceite-ausente`: `pacote-aceito` está em `GATE_DA_ETAPA`, e o serviço da jornada
   * confere se existe um `Approval` do gate antes de avançar. O `PROJECT_PACKAGE` só era aprovável
   * na tela do **roadmap** — que aparece depois desta etapa. O aceite estava atrás da porta que ele
   * mesmo destranca, e o PI clicava sem nada acontecer (medido: oito recusas seguidas na
   * auditoria do projeto dele, uma por clique).
   *
   * **A ordem é gate primeiro, evento depois.** Aprovar grava a evidência que o evento vai
   * conferir; inverter faria o evento recusar a si mesmo. É a mesma sequência que o roadmap já
   * usa nos gates dele.
   *
   * **A recusa vira mensagem, não silêncio.** `aprovar` devolve motivos nomeados — sem revisões,
   * sem identidade, já aprovado —, e engoli-los foi metade do defeito: o PI não tinha como saber
   * se clicou, se falhou, ou o que fazer a seguir.
   */
  const aceitar = useCallback(async (): Promise<void> => {
    setOcupado(true)
    setFalhaNoAceite(false)
    setRecusaDoAceite(null)

    try {
      const aprovacao = await window.jarvis.aprovarGate(projectId, 'PROJECT_PACKAGE', workspace)

      // `ja-aprovado` não é recusa do ponto de vista do PI: o gate já tem a evidência que o
      // evento precisa, e travar aqui o deixaria preso numa etapa que pode avançar.
      if (aprovacao.reason !== 'aprovado' && aprovacao.reason !== 'ja-aprovado') {
        setRecusaDoAceite(aprovacao)
        return
      }

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

  /*
   * Quantos itens pedem decisão: propostos mais ajustes (#333).
   *
   * É o número no rótulo da aba, e é ele que decide qual aba abre primeiro — com pendência, a
   * tela abre no que precisa ser decidido; sem nenhuma, abre no primeiro documento, porque aí só
   * resta ler.
   */
  const pendencias = arquitetura === null ? 0 : pendenciasDeRevisao(arquitetura)

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

      {/*
        **A barra de andamento, no topo da etapa** (SPEC-Jornada-03 § Emenda E2, item 1; #337).
        
        Fora do bloco do "gerar de novo" de propósito: na **primeira** geração não há botão aqui —
        ele mora na trilha (#332) —, e prendê-la ao botão deixaria justamente a primeira rodada
        sem sinal nenhum, que é quando o PI mais precisa saber o que está acontecendo.
      */}
      <AndamentoDaGeracao
        etapas={etapas}
        gerando={ocupado}
        contrato={[...ETAPAS_DA_ARQUITETURA]}
      />

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
            **As abas** (#333). A etapa media 4.941px numa janela de 900 — cinco telas e meia de
            rolagem para um projeto pequeno — porque os quatro documentos, as propostas repetidas
            e os ajustes viviam empilhados na mesma coluna.

            O componente do DS **desmonta** o painel inativo (sem `forceMount`), então a altura
            cai de verdade: não é conteúdo escondido com altura zero, é conteúdo que não existe no
            documento enquanto a aba está fechada.

            **"A revisar" vem primeiro** porque decidir precede ler: é ela que responde "há algo a
            cortar aqui?", a pergunta que fazia o PI rolar a etapa inteira. O contador no próprio
            rótulo é o que torna a resposta visível **sem** entrar na aba.
          */}
          <Tabs
            padrao={pendencias > 0 ? ABA_REVISAR : DOCUMENTOS_DA_ARQUITETURA[0]}
            rotulo={t('arquitetura.abasRotulo')}
            abas={[
              {
                valor: ABA_REVISAR,
                // O número entra no **rótulo**, e não num badge ao lado: um badge é forma, e
                // forma sozinha não atravessa leitor de tela nem escala de cinza. Sem pendência
                // o rótulo muda de texto em vez de mostrar "(0)" — zero anunciado é ruído.
                rotulo:
                  pendencias > 0
                    ? `${t('arquitetura.abaRevisar')} (${pendencias})`
                    : t('arquitetura.abaRevisarVazia')
              },
              ...DOCUMENTOS_DA_ARQUITETURA.map((documento) => ({
                valor: documento,
                rotulo: t(
                  `arquitetura.documentos.${documento}` as `arquitetura.documentos.${DocumentoDaArquitetura}`
                )
              }))
            ]}
          >
            <TabPanel valor={ABA_REVISAR}>
              <OQuePedeDecisao
                arquitetura={arquitetura}
                onCortar={(id) => void cortar(id)}
                onDescartar={(id) => void descartar(id)}
                ocupado={ocupado}
              />
            </TabPanel>

            {DOCUMENTOS_DA_ARQUITETURA.map((documento) => (
              <TabPanel key={documento} valor={documento}>
                <DocumentoDaArquiteturaGerada
                  documento={documento}
                  arquitetura={arquitetura}
                  onCortar={(id) => void cortar(id)}
                  ocupado={ocupado}
                />
              </TabPanel>
            ))}
          </Tabs>

          {falhaNoAceite && (
            <InlineAlert tom="err" titulo={t('arquitetura.aceiteFalhou')}>
              {t('arquitetura.aceiteDescricao')}
            </InlineAlert>
          )}

          {/*
            A recusa do gate, com o motivo e a ação (#333).
            
            **Fora das abas e acima do aceite**: é a resposta ao clique que o PI acabou de dar na
            trilha, e escondê-la atrás de uma aba faria o botão parecer inerte — que foi
            exatamente o defeito relatado, oito cliques sem nada na tela.
          */}
          {recusaDoAceite !== null && <DesfechoDaAprovacao aprovacao={recusaDoAceite} />}

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
