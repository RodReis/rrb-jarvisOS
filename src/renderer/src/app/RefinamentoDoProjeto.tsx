import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessagesSquare, Sparkles } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EstadoDoWizard } from '@shared/domain/wizard'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { Button, InlineAlert, LoadingState } from '@design/ui'
import { log } from '../lib/log'

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

      {erro !== null && (
        <InlineAlert tom="err" titulo={t('refinamento.naoGerou')}>
          {erro}
        </InlineAlert>
      )}

      {/*
        O estado em texto, antes do botão: quantas decisões faltam é o que o PI precisa saber
        para decidir se começa agora ou depois. Um botão sem essa conta pediria um compromisso
        de duração desconhecida.
      */}
      {temPergunta && estado.tipo === 'pergunta' && (
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
          {t('refinamento.restantes', { count: estado.restantes })}
        </p>
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
          <Button
            variante="primaria"
            onClick={() => void gerar()}
            desabilitado={ocupado || bloqueado}
            carregando={ocupado}
            iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
          >
            {concluido ? t('refinamento.gerarMais') : t('refinamento.gerar')}
          </Button>
        )}
      </div>
    </div>
  )
}
