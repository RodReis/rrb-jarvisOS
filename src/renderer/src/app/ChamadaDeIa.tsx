import { useEffect, useRef, useState } from 'react'
import type { AiStreamEvent, CostEvent } from '@shared/domain/ai'
import { MODELO_PADRAO } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import { Button, Panel, Textarea } from '@design/ui'
import { StatusOperacional, type EstadoOperacional } from '@design/patterns'
import { log } from '../lib/log'

/**
 * Chamada de IA em streaming (SPEC-Providers-02, critério 2).
 *
 * O painel mínimo que exercita o caminho ponta a ponta: prompt → chunks → custo. A **tela de
 * providers** (status, latência, modelo, troca, editor de rotas) é a F04, explicitamente — o
 * que existe aqui é o necessário para ver o stream funcionando no app real, que é como os
 * defeitos das duas últimas fatias apareceram.
 *
 * O que esta tela **não** faz: não vê a credencial, não escolhe modelo e não decide se a
 * chamada cabe no orçamento. A chave é resolvida no main (F01) no instante da chamada; o gate
 * de custo é a F03. Aqui só se dispara e se mostra o que volta.
 */

interface ChamadaDeIaProps {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

type Estado = 'ocioso' | 'streaming' | 'concluido' | 'falhou'

const ESTADO_OPERACIONAL: Readonly<Record<Estado, EstadoOperacional>> = {
  ocioso: 'inativo',
  streaming: 'executando',
  concluido: 'ativo',
  falhou: 'erro'
}

const ROTULO: Readonly<Record<Estado, string>> = {
  ocioso: 'Pronto',
  streaming: 'Recebendo resposta…',
  concluido: 'Concluída',
  falhou: 'Falhou'
}

/**
 * Formata o custo com casas suficientes para o número não desaparecer no arredondamento.
 *
 * O limiar é `< 1`, e não `< 0.01`: uma chamada típica custa alguns centavos, e duas casas
 * transformariam US$ 0,0175 em "US$ 0,02" — perdendo precisão justamente na faixa em que
 * quase todas as chamadas caem. Acima de um dólar, centavos bastam.
 */
function formatarUsd(valor: number): string {
  return `US$ ${valor.toFixed(valor < 1 ? 5 : 2)}`
}

export function ChamadaDeIa({ workspace, nomeDoEspaco }: ChamadaDeIaProps): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [resposta, setResposta] = useState('')
  const [estado, setEstado] = useState<Estado>('ocioso')
  const [erro, setErro] = useState<string | undefined>(undefined)
  const [custo, setCusto] = useState<CostEvent | undefined>(undefined)

  /**
   * O id da chamada corrente, em ref e não em estado.
   *
   * O listener de eventos precisa ler o valor **atual** para descartar chunks de uma chamada
   * anterior, e um `useState` capturado na closure leria o valor do render em que ela nasceu —
   * o texto de duas chamadas se misturaria na tela.
   */
  const chamadaAtual = useRef<string | undefined>(undefined)

  useEffect(() => {
    // Uma assinatura só, viva enquanto a tela existe. Assinar por chamada deixaria uma janela
    // entre o `invoke` e o `on` em que os primeiros chunks se perderiam.
    const cancelarAssinatura = window.jarvis.onAiStreamEvent((evento: AiStreamEvent) => {
      // Chunk de chamada que não é a corrente (o usuário disparou outra): descarta. Sem isto,
      // a resposta antiga continuaria escrevendo por cima da nova.
      if (evento.id !== chamadaAtual.current) return

      if (evento.tipo === 'chunk') {
        setResposta((atual) => atual + evento.texto)
        return
      }

      setEstado(evento.estado)
      setCusto(evento.custo)
      setErro(evento.erro)
      chamadaAtual.current = undefined
    })

    return cancelarAssinatura
  }, [])

  // Cancela a chamada em voo ao desmontar: uma resposta que continua chegando para uma tela
  // que não existe mais é custo pago por nada.
  useEffect(() => {
    return () => {
      const id = chamadaAtual.current
      if (id !== undefined) void window.jarvis.cancelAi(id)
    }
  }, [])

  async function enviar(): Promise<void> {
    const texto = prompt.trim()
    if (texto.length === 0 || estado === 'streaming') return

    setResposta('')
    setErro(undefined)
    setCusto(undefined)
    setEstado('streaming')

    try {
      const handle = await window.jarvis.callAi({ provider: 'anthropic', prompt: texto }, workspace)
      chamadaAtual.current = handle.id
    } catch (causa) {
      // Falha no próprio IPC (raro): a tela precisa sair de `streaming`, senão fica girando
      // para sempre esperando um evento que nunca virá.
      setEstado('falhou')
      setErro('Não foi possível iniciar a chamada.')
      log.ui.error('Falha ao disparar chamada de IA', {
        stack: causa instanceof Error ? causa.stack : undefined
      })
    }
  }

  return (
    <Panel titulo={`Chamada de IA — ${nomeDoEspaco}`}>
      <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
        Usa a chave configurada acima, no espaço {nomeDoEspaco}. A resposta chega em partes,
        conforme o modelo a gera. Modelo: {MODELO_PADRAO.anthropic}.
      </p>

      <Textarea
        valor={prompt}
        onMudar={setPrompt}
        placeholder="Escreva o que perguntar ao modelo…"
        desabilitado={estado === 'streaming'}
        linhas={3}
        aria-label="Prompt"
      />

      <div className="flex items-center justify-between gap-3">
        <StatusOperacional estado={ESTADO_OPERACIONAL[estado]} rotulo={ROTULO[estado]} />
        <Button
          onClick={() => void enviar()}
          desabilitado={prompt.trim().length === 0 || estado === 'streaming'}
        >
          Enviar
        </Button>
      </div>

      {/* `aria-live="polite"`: quem usa leitor de tela precisa saber que a resposta está
          chegando. Sem isto, o texto aparece em silêncio e a tela parece congelada. */}
      {resposta !== '' && (
        <output
          aria-live="polite"
          className="whitespace-pre-wrap rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] p-3 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]"
        >
          {resposta}
        </output>
      )}

      {erro !== undefined && (
        <p
          role="alert"
          className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-err-leitura)]"
        >
          {erro}
        </p>
      )}

      {custo !== undefined && custo.usage !== undefined && (
        // O custo aparece na tela porque é isso que a fatia mede — e porque a F03 vai bloquear
        // com este número. Ver o valor antes do gate existir é o que torna o gate previsível.
        <p className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {custo.usage.tokensEntrada} tokens de entrada · {custo.usage.tokensSaida} de saída ·{' '}
          {formatarUsd(custo.realUsd ?? 0)} · {custo.latenciaPrimeiroChunkMs ?? 0} ms até o primeiro
          trecho · {custo.latenciaTotalMs} ms no total
        </p>
      )}
    </Panel>
  )
}
