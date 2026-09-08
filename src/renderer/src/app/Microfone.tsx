import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, InlineAlert } from '@design/ui'
import type { WorkspaceId } from '@shared/domain/entities'
import type { DesfechoDaTranscricao, ProntidaoDaVoz } from '@shared/domain/voz'
import { capturarPcm, type CapturaDeAudio } from './captura-de-audio'

/**
 * O microfone do Command Center (SPEC-Voz-01, critérios 4, 5 e 7).
 *
 * ## Três telas, não uma com bandeiras
 *
 * O que aparece depende do que o app **pode fazer agora**, e cada estado tem uma próxima ação
 * diferente. Fundi-los daria à primeira execução do app a ação errada:
 *
 * | estado | o que a tela oferece |
 * |---|---|
 * | runtime ausente | **baixar** o que falta |
 * | pronto | **segurar para falar** |
 * | falhou | **tentar de novo** |
 *
 * ## Segurar, não clicar
 *
 * O gesto é walkie-talkie (decisão do PI): pressionar grava, soltar transcreve. O rótulo diz
 * "segure para falar" porque "gravar" sugere clique — e um clique aqui produziria um enunciado
 * vazio, que o `sem-audio` trata mas o usuário não entenderia.
 *
 * `onPointerUp` **e** `onPointerLeave`: soltar o botão fora dele é comum, e sem o segundo a
 * gravação ficaria aberta até o timeout duro.
 */

type EstadoDoMicrofone = 'ocioso' | 'gravando' | 'transcrevendo'

export function Microfone({
  workspace,
  capturar = capturarPcm
}: {
  readonly workspace: WorkspaceId
  /** Injetada para teste: `getUserMedia` não existe em jsdom, e dublar aqui mede a lógica. */
  readonly capturar?: CapturaDeAudio
}): React.JSX.Element {
  const { t } = useTranslation()
  const [prontidao, setProntidao] = useState<ProntidaoDaVoz | undefined>(undefined)
  const [estado, setEstado] = useState<EstadoDoMicrofone>('ocioso')
  const [texto, setTexto] = useState<string | undefined>(undefined)
  const [erro, setErro] = useState<string | undefined>(undefined)
  const [baixando, setBaixando] = useState(false)
  const encerrarCaptura = useRef<(() => Promise<Int16Array>) | undefined>(undefined)

  const consultar = useCallback(async (): Promise<void> => {
    setProntidao(await window.jarvis.prontidaoDaVoz())
  }, [])

  /*
   * A consulta inicial roda **dentro** da promessa, não no corpo do efeito: `setState` síncrono
   * ali dispara render em cascata, e o lint recusa com razão. O `cancelado` protege a resposta
   * que chega depois de a tela desmontar — trocar de rota no meio da consulta.
   */
  useEffect(() => {
    let cancelado = false

    void window.jarvis.prontidaoDaVoz().then((p) => {
      if (!cancelado) setProntidao(p)
    })

    return () => {
      cancelado = true
    }
  }, [])

  async function baixar(): Promise<void> {
    setBaixando(true)
    setErro(undefined)

    for (const id of prontidao?.faltando ?? []) {
      const r = await window.jarvis.baixarArtefatoDeVoz(id)
      if (r.estado !== 'ok') {
        // Cada recusa tem mensagem própria: "integridade" e "bloqueado" pedem coisas
        // diferentes de quem lê, e um "falhou" genérico esconderia qual das duas foi.
        setErro(t(`voz.download.${r.estado}`))
        setBaixando(false)
        return
      }
    }

    setBaixando(false)
    await consultar()
  }

  async function comecar(): Promise<void> {
    if (estado !== 'ocioso') return
    setErro(undefined)
    setTexto(undefined)

    try {
      encerrarCaptura.current = await capturar()
      setEstado('gravando')
    } catch {
      // Microfone negado ou ausente. Não é falha do runtime — a próxima ação é do sistema
      // operacional, não do app.
      setErro(t('voz.microfoneIndisponivel'))
    }
  }

  async function terminar(): Promise<void> {
    if (estado !== 'gravando') return
    setEstado('transcrevendo')

    const parar = encerrarCaptura.current
    encerrarCaptura.current = undefined

    try {
      // O PCM vive nesta variável e some com a função: a tela guarda o **texto**, nunca o
      // áudio (critério 8).
      const pcm = parar === undefined ? new Int16Array(0) : await parar()
      const d: DesfechoDaTranscricao = await window.jarvis.transcreverAudio(pcm, workspace)

      if (d.estado === 'ok') setTexto(d.resultado.texto)
      else if (d.estado === 'falhou') setErro(t('voz.falhou'))
      else if (d.estado === 'indisponivel') await consultar()
      // `sem-audio` não vira alerta: e clique curto demais, acidente do usuário — e puni-lo
      // com uma tarja vermelha seria tratar engano como erro.
    } finally {
      setEstado('ocioso')
    }
  }

  /*
   * A hotkey global chega como **evento do main** (critério 5): o atalho funciona com a janela
   * minimizada, e é aqui que o microfone vive — `getUserMedia` é Web API do renderer.
   *
   * O efeito lê `comecar`/`terminar` por ref, e não das dependências: as duas são recriadas a
   * cada render (fecham sobre `estado`), e listá-las reassinaria o canal a cada tecla — a
   * assinatura sairia e voltaria no meio da própria gravação que ela conduz.
   */
  const acoes = useRef({ comecar, terminar })

  /*
   * A ref é atualizada **em efeito**, não durante o render: escrever nela no corpo é o
   * antipadrão que o lint recusa com razão (a escrita aconteceria também em render descartado).
   * O efeito sem lista de dependências roda após cada render, que é exatamente o momento em que
   * as duas funções recém-criadas precisam entrar.
   */
  useEffect(() => {
    acoes.current = { comecar, terminar }
  })

  useEffect(() => {
    return window.jarvis.onVozHotkey((gravando) => {
      void (gravando ? acoes.current.comecar() : acoes.current.terminar())
    })
  }, [])

  if (prontidao === undefined) return <Card>{t('voz.verificando')}</Card>

  const rotuloDoCompute = prontidao.compute === 'cuda' ? t('voz.compute.gpu') : t('voz.compute.cpu')

  const rotuloDoBotao =
    estado === 'gravando'
      ? t('voz.gravando')
      : estado === 'transcrevendo'
        ? t('voz.transcrevendo')
        : t('voz.segureParaFalar')

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[length:var(--jos-texto-titulo)]">{t('voz.titulo')}</h2>
          <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {rotuloDoCompute}
          </span>
        </div>

        {erro !== undefined && (
          <InlineAlert tom="err" titulo={t('voz.problema')}>
            {erro}
          </InlineAlert>
        )}

        {prontidao.pronta ? (
          <Button
            onPointerDown={() => void comecar()}
            onPointerUp={() => void terminar()}
            onPointerLeave={() => void terminar()}
            desabilitado={estado === 'transcrevendo'}
          >
            {rotuloDoBotao}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
              {t('voz.runtimeAusente')}
            </p>
            <Button onClick={() => void baixar()} desabilitado={baixando}>
              {baixando ? t('voz.baixando') : t('voz.baixar')}
            </Button>
          </div>
        )}

        {texto !== undefined && (
          <p className="text-[length:var(--jos-texto-corpo)]" aria-live="polite">
            {texto}
          </p>
        )}
      </div>
    </Card>
  )
}
