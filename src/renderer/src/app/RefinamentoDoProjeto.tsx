import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, MessagesSquare, Sparkles } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EstadoDoWizard } from '@shared/domain/wizard'
import type { GeracaoOutcome } from '@shared/domain/brief'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { Button, InlineAlert, LoadingState } from '@design/ui'
import { log } from '../lib/log'
import { AvisoDaRotaPaga, SeloDaRota } from './RotaDaGeracao'
import { RecusaDaGeracao } from './RecusaDaGeracao'

/**
 * A etapa do refinamento (SPEC-Jornada-02, § Refinamento).
 *
 * Esta tela **não faz a pergunta** — quem faz é o pop-up, uma decisão por vez, reaproveitando a
 * mesma superfície da M8-F03. O que ela responde é a pergunta anterior a essa: *quantas
 * decisões faltam, e o que acontece quando eu clicar?*
 *
 * Duas decisões de forma:
 *
 *  - **Gerar e responder são atos separados.** Ler o estado não pode ter o efeito colateral de
 *    gerar: reabrir a tela chamaria o modelo a cada F5, e cada chamada custa. Por isso o botão
 *    de gerar só aparece quando não há pergunta pendente.
 *  - **O bloqueio de rota aparece antes do clique**, como na etapa do prompt. Descobrir que não
 *    há rota autorizada depois de pedir a geração é a mesma fricção que o critério 6 evita no
 *    custo, repetida na atenção.
 *  - **O brief nasce aqui, no fim do refinamento** (#281, decisão do PI de 2026-09-05). Antes
 *    ele era gerado na tela do prompt, **antes de qualquer pergunta** — então `decisoesDoRefinamento`
 *    chegava sempre vazio e nenhuma afirmação podia ter origem `decisao`, só `prompt` ou
 *    `proposto`. A spec pede o contrário: o brief cita as decisões do refinamento. Gerar aqui
 *    corrige a origem e dá à jornada a evidência de que o refinamento terminou.
 */

interface RefinamentoDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Abre o pop-up com a pergunta pendente. */
  readonly onResponder: () => void
  /** Relê a jornada — o refinamento concluído move a etapa. */
  readonly onRecarregar: () => void
}

export function RefinamentoDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onResponder,
  onRecarregar
}: RefinamentoDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [estado, setEstado] = useState<EstadoDoWizard | null>(null)
  const [rota, setRota] = useState<ResultadoDaRota | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoBrief, setGerandoBrief] = useState(false)
  /*
   * O desfecho **inteiro** da geração do brief, não uma string concatenada.
   *
   * Mesma postura da tela do prompt, de onde esta geração veio: o main devolve mensagem, ação,
   * problemas e — quando o modelo respondeu em prosa — o que ele escreveu. Guardar só a
   * mensagem faria o PI ler "a saída não passou no validador" enquanto o console, logo abaixo,
   * mostra o modelo explicando o que houve.
   */
  const [recusaDoBrief, setRecusaDoBrief] = useState<GeracaoOutcome | null>(null)

  const carregar = useCallback(async (): Promise<void> => {
    try {
      const [atual, rotaAtual] = await Promise.all([
        window.jarvis.estadoDoRefinamento(projectId, workspace),
        window.jarvis.rotaDaGeracao(projectId, workspace)
      ])
      setEstado(atual)
      setRota(rotaAtual)
    } catch (error: unknown) {
      log.ui.error('Falha ao carregar o refinamento', { error })
    } finally {
      setCarregando(false)
    }
  }, [projectId, workspace])

  useEffect(() => {
    let ativo = true

    Promise.all([
      window.jarvis.estadoDoRefinamento(projectId, workspace),
      window.jarvis.rotaDaGeracao(projectId, workspace)
    ])
      .then(([atual, rotaAtual]) => {
        if (!ativo) return
        setEstado(atual)
        setRota(rotaAtual)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o refinamento', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  async function gerar(): Promise<void> {
    setOcupado(true)
    setErro(null)

    try {
      const desfecho = await window.jarvis.gerarPerguntasDeRefinamento(projectId, workspace)

      if (desfecho.resultado === 'geradas' || desfecho.resultado === 'nada-a-perguntar') {
        await carregar()
        onRecarregar()
        return
      }

      // Recusa é desfecho, não exceção: a mensagem vem do main com a ação junto quando existe.
      setErro([desfecho.mensagem, desfecho.acao].filter(Boolean).join(' '))
    } catch (error: unknown) {
      log.ui.error('Falha ao gerar as perguntas', { error })
      setErro(t('refinamento.falha'))
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Gera o brief a partir do prompt e das decisões (#281).
   *
   * Diferente de `gerar`: aquele produz perguntas e mantém o PI nesta etapa; este produz o
   * documento e **move a jornada**. Por isso só o sucesso chama `onRecarregar` — uma recusa
   * deixaria a trilha piscando para uma etapa que não avançou.
   */
  async function gerarBrief(): Promise<void> {
    setGerandoBrief(true)
    setRecusaDoBrief(null)

    try {
      const desfecho = await window.jarvis.gerarBrief(projectId, workspace)

      if (desfecho.resultado === 'gerado') {
        onRecarregar()
        return
      }

      setRecusaDoBrief(desfecho)
    } catch (error: unknown) {
      log.ui.error('Falha ao gerar o brief', { error })
      setRecusaDoBrief({ resultado: 'saida-invalida', mensagem: t('refinamento.briefFalhou') })
    } finally {
      setGerandoBrief(false)
    }
  }

  if (carregando) return <LoadingState rotulo={t('refinamento.carregando')} />

  const bloqueado = rota?.decisao === 'bloqueado'
  const temPergunta = estado?.tipo === 'pergunta'
  const concluido = estado?.tipo === 'concluido'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('refinamento.titulo')}
        </h3>
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('refinamento.descricao', { nome: nomeDoProjeto })}
        </p>
      </div>

      {bloqueado && rota?.acao !== undefined && (
        <InlineAlert tom="warn" titulo={t('refinamento.semRota')}>
          {rota.acao}
        </InlineAlert>
      )}

      <AvisoDaRotaPaga rota={rota} />

      {erro !== null && (
        <InlineAlert tom="err" titulo={t('refinamento.naoGerou')}>
          {erro}
        </InlineAlert>
      )}

      {/* A recusa do brief tem bloco próprio: o modelo pode ter respondido em prosa, e o que ele
          disse é o conteúdo do erro, não um anexo dele. Mesmo componente da tela do prompt. */}
      {recusaDoBrief !== null && <RecusaDaGeracao desfecho={recusaDoBrief} />}

      {/*
        O estado em texto, antes do botão: quantas decisões faltam é o que o PI precisa saber
        para decidir se começa agora ou depois. Um botão sem essa conta pediria um compromisso
        de duração desconhecida.
      */}
      {temPergunta && estado.tipo === 'pergunta' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
            {t('refinamento.restantes', { count: estado.restantes })}
          </p>

          {/*
            **Qual** é a próxima decisão, e não só quantas faltam. O número sozinho pede um
            compromisso às cegas: o PI clicava sem saber se o pop-up ia perguntar sobre stack,
            prazo ou público. O estado já carregava a pergunta inteira — a tela só não a usava.

            O enunciado fica de fora de propósito: quem pergunta é o pop-up, uma decisão por vez.
            Aqui vai o assunto, que é o que decide entre "começo agora" e "começo depois".
          */}
          <p className="flex flex-wrap items-baseline gap-x-2 text-[length:var(--jos-texto-micro)]">
            <span className="font-[family-name:var(--jos-fonte-mono)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
              {t('refinamento.aSeguir')}
            </span>
            <span className="text-[var(--jos-cor-texto-secundario)]">{estado.pergunta.titulo}</span>
          </p>
        </div>
      )}

      {concluido && (
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
          {t('refinamento.concluido')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {temPergunta ? (
          <Button
            variante="primaria"
            onClick={onResponder}
            iconeInicial={<MessagesSquare aria-hidden="true" className="size-4" />}
          >
            {t('refinamento.responder')}
          </Button>
        ) : (
          /* Gerar só quando não há pergunta pendente: com uma na fila, o próximo passo é
             respondê-la, e oferecer "gerar mais" convidaria a acumular perguntas sem responder
             nenhuma. */
          <>
            {/*
              Com o refinamento concluído, o **acento vai para o brief** — ele é o que avança a
              jornada, e "procurar o que ainda falta" passa a ser a ação de manutenção. Manter
              os dois primários faria a tela oferecer duas saídas com o mesmo peso, e a que
              termina a etapa é uma só.
            */}
            {concluido && (
              <Button
                variante="primaria"
                onClick={() => void gerarBrief()}
                desabilitado={ocupado || gerandoBrief || bloqueado}
                carregando={gerandoBrief}
                iconeInicial={<FileText aria-hidden="true" className="size-4" />}
              >
                {t('refinamento.gerarBrief')}
              </Button>
            )}

            <Button
              variante={concluido ? 'secundaria' : 'primaria'}
              onClick={() => void gerar()}
              desabilitado={ocupado || gerandoBrief || bloqueado}
              carregando={ocupado}
              iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
            >
              {concluido ? t('refinamento.gerarMais') : t('refinamento.gerar')}
            </Button>

            {/* Por onde a geração sai. Só acompanha o botão que gera — "responder a próxima"
                não chama o modelo, e um selo ali anunciaria um custo que não existe. */}
            <SeloDaRota rota={rota} />
          </>
        )}
      </div>
    </div>
  )
}
