import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, X } from 'lucide-react'
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
        <p className="min-w-0 max-w-[58ch] flex-1 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
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
  onAceito
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
  async function aceitar(): Promise<void> {
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
  }

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
  const liberado = podeAceitar(brief)
  const materiais = brief.pendencias.filter((p) => p.material)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('brief.titulo')}
        </h3>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('brief.descricao', { nome: nomeDoProjeto })}
        </p>
      </div>

      {/*
        Pendência material bloqueia o aceite, e o aviso diz **quais** — listar o número sem os
        itens obrigaria o PI a caçar os buracos pelos dez blocos.
      */}
      {!liberado && (
        <InlineAlert tom="warn" titulo={t('brief.pendenciaMaterial')}>
          {materiais.map((p) => p.pergunta).join(' · ')}
        </InlineAlert>
      )}

      {falhaNoAceite && (
        <InlineAlert tom="err" titulo={t('brief.aceiteFalhou')}>
          {t('brief.aceiteDescricao')}
        </InlineAlert>
      )}

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

      {/*
        O aceite (critério 5) — a soleira do documento, e por isso ele fica **no fim**: aceitar
        é o que se faz depois de ler, e um botão no topo convidaria a aceitar sem descer.

        Marcado por uma régua e um bloco recuado, não por um cartão: o brief inteiro já é uma
        pilha de seções, e mais uma caixa faria o aceite competir com os blocos em vez de
        encerrá-los. A régua diz "o documento acabou aqui" com o material mais barato que existe.

        O botão desabilitado vem **com a razão ao lado**, nunca sozinho: um alvo morto sem
        explicação faz o PI procurar o defeito no próprio brief.
      */}
      <section
        data-jos-aceite="brief"
        aria-labelledby="brief-aceite"
        className="mt-1 flex flex-col gap-2 border-t border-[rgba(var(--jos-borda-rgb),0.16)] pt-5"
      >
        <h4
          id="brief-aceite"
          className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]"
        >
          {t('brief.aceiteTitulo')}
        </h4>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('brief.aceiteDescricao')}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Button
            variante="primaria"
            onClick={() => void aceitar()}
            desabilitado={ocupado || !liberado}
            carregando={ocupado}
            iconeInicial={<ShieldCheck aria-hidden="true" className="size-4" />}
          >
            {t('brief.aceitar')}
          </Button>

          {!liberado && (
            <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
              {t('brief.aceiteBloqueado')}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
