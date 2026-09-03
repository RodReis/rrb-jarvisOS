import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { Button, Field, InlineAlert, LoadingState, Textarea } from '@design/ui'
import { log } from '../lib/log'

/**
 * A etapa do prompt (SPEC-Jornada-02, critério 1).
 *
 * A tela que faltava no MVP-008: **em nenhum momento o PI dizia o que o projeto é**. O wizard
 * perguntava sobre escopo e público, mas ninguém nunca escrevia a frase que originou tudo.
 *
 * Três decisões de forma:
 *
 *  - **Um campo, e nada mais.** Sem contador de caracteres, sem sugestão de estrutura, sem
 *    exemplo pré-preenchido. A página inteira é a pergunta, e qualquer moldura ao redor dela
 *    empurraria o PI a preencher um formulário em vez de descrever o que quer.
 *  - **O bloqueio de rota aparece antes do botão**, não depois do clique. Descobrir que não há
 *    rota autorizada só ao tentar gerar é a mesma fricção que o critério 6 evita no custo — e
 *    o aviso traz a ação, porque bloqueio sem saída é beco.
 *  - **Salvar e gerar são um ato só.** Dois botões fariam o PI escolher entre guardar e
 *    avançar, quando o que ele quer é seguir; o texto é salvo no caminho para a geração.
 */

interface PromptDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Chamado quando o prompt foi salvo e a geração pediu para avançar a jornada. */
  readonly onAvancar: () => void
}

export function PromptDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAvancar
}: PromptDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [rota, setRota] = useState<ResultadoDaRota | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    Promise.all([
      window.jarvis.lerPromptDoProjeto(projectId, workspace),
      window.jarvis.rotaDaGeracao(projectId, workspace)
    ])
      .then(([prompt, rotaAtual]) => {
        if (!ativo) return
        // O texto já escrito volta para o campo: reabrir o projeto não pode custar o rascunho.
        if (prompt !== null) setTexto(prompt.texto)
        setRota(rotaAtual)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o prompt', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  async function salvarEGerar(): Promise<void> {
    setOcupado(true)
    setErro(null)

    try {
      await window.jarvis.salvarPromptDoProjeto(projectId, texto, workspace)
      const desfecho = await window.jarvis.gerarBrief(projectId, workspace)

      if (desfecho.resultado === 'gerado') {
        onAvancar()
        return
      }

      // Recusa é desfecho, não exceção: a mensagem vem do main com a ação junto quando existe.
      setErro([desfecho.mensagem, desfecho.acao].filter(Boolean).join(' '))
    } catch (error: unknown) {
      log.ui.error('Falha ao salvar o prompt e gerar o brief', { error })
      setErro(t('prompt.falha'))
    } finally {
      setOcupado(false)
    }
  }

  if (carregando) return <LoadingState rotulo={t('prompt.carregando')} />

  const bloqueado = rota?.decisao === 'bloqueado'
  const vazio = texto.trim().length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('prompt.titulo')}
        </h3>
        {/* Medida de leitura: prosa larga demais cansa o retorno de linha. */}
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('prompt.descricao', { nome: nomeDoProjeto })}
        </p>
      </div>

      {/*
        O bloqueio vem **acima** do campo, não junto ao botão: se não há rota, escrever o prompt
        ainda vale (o texto é salvo), mas o PI merece saber antes de esperar por uma geração que
        não vai acontecer.
      */}
      {bloqueado && rota?.acao !== undefined && (
        <InlineAlert tom="warn" titulo={t('prompt.semRota')}>
          {rota.acao}
        </InlineAlert>
      )}

      {erro !== null && (
        <InlineAlert tom="err" titulo={t('prompt.naoGerou')}>
          {erro}
        </InlineAlert>
      )}

      <Field rotulo={t('prompt.rotulo')} descricao={t('prompt.ajuda')}>
        {(atributos) => (
          <Textarea
            {...atributos}
            valor={texto}
            onMudar={setTexto}
            placeholder={t('prompt.placeholder')}
            desabilitado={ocupado}
            linhas={10}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variante="primaria"
          onClick={() => void salvarEGerar()}
          desabilitado={ocupado || vazio || bloqueado}
          carregando={ocupado}
          iconeInicial={<Sparkles aria-hidden="true" className="size-4" />}
        >
          {t('prompt.gerar')}
        </Button>

        {/* Diz **por que** o botão está desabilitado. Um alvo morto sem explicação faz o PI
            procurar o defeito na própria escrita. */}
        {vazio && !bloqueado && (
          <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {t('prompt.escrevaAlgo')}
          </span>
        )}
      </div>
    </div>
  )
}
