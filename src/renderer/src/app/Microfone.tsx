import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, InlineAlert, VoiceMascot, type EstadoDoMascote } from '@design/ui'
import type { WorkspaceId } from '@shared/domain/entities'
import type { VisemeEvent } from '@shared/domain/visemes'
import type { DesfechoDaTranscricao, FaseDaVoz, ProntidaoDaVoz } from '@shared/domain/voz'
import { capturarPcm, type CapturaDeAudio } from './captura-de-audio'
import type { CapturaContinua, CapturaDoTurno } from './captura-continua'
import { criarReprodutor } from './reproducao-de-fala'
import { criarMedidorDeEntrada, type MedidorDeEntrada } from './medidor-de-audio'
import { criarDetectorDeFimDaFala } from './fim-da-fala'
import type { DisparoRecebido } from './EscutaDaVoz'
import { log } from '../lib/log'
import { iniciarReferenciaDaFala } from './referencia-da-fala'
import type { TrocaDaConversa } from '@shared/domain/voz'

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

/**
 * Os estados do loop, em ordem: segurar → soltar → transcrever → pensar → falar.
 *
 * `pensando` e `falando` são **estados próprios**, não uma variação de `transcrevendo`: cada um
 * dura por conta diferente (o modelo local leva segundos; a fala dura o áudio) e a F04 vai
 * animar o mascote a partir deles. Fundi-los obrigaria o mascote a adivinhar o que está
 * acontecendo a partir de um rótulo.
 */
type EstadoDoMicrofone = 'ocioso' | 'gravando' | 'transcrevendo' | 'pensando' | 'falando'

export function Microfone({
  workspace,
  vozDaFala,
  entradaId,
  entradaRotulo,
  saidaId,
  capturar = capturarPcm,
  criarFala = criarReprodutor,
  criarMedidor = criarMedidorDeEntrada,
  capturaCompartilhada,
  escutaAtiva = false,
  vozTimeoutMs = 60_000,
  disparo,
  aoTratarDisparo
}: {
  readonly workspace: WorkspaceId
  /**
   * Um gatilho da escuta (frase ou palmas) pediu um turno (SPEC-Escuta-01). A tela grava sem
   * botão e decide o fim pelo silêncio. É **consumido uma vez** por `aoTratarDisparo`: um
   * disparo que ficasse guardado abriria o microfone sozinho na próxima vez que a tela montasse.
   */
  readonly disparo?: DisparoRecebido
  readonly aoTratarDisparo?: (id: number) => void
  /**
   * A voz com que a resposta é falada (SPEC-Voz-02). Vem do AppShell, que já tem as
   * preferências resolvidas — consultá-las aqui daria à tela um segundo dono do mesmo valor.
   */
  readonly vozDaFala: string
  readonly entradaId?: string | null
  readonly entradaRotulo?: string | null
  readonly saidaId?: string | null
  /** Injetada para teste: `getUserMedia` não existe em jsdom, e dublar aqui mede a lógica. */
  readonly capturar?: CapturaDeAudio
  /** Injetado pela mesma razão: Web Audio também não existe em jsdom. */
  readonly criarFala?: typeof criarReprodutor
  readonly criarMedidor?: typeof criarMedidorDeEntrada
  readonly capturaCompartilhada?: CapturaContinua
  readonly escutaAtiva?: boolean | null
  readonly vozTimeoutMs?: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const [prontidao, setProntidao] = useState<ProntidaoDaVoz | undefined>(undefined)
  const [estado, setEstado] = useState<EstadoDoMicrofone>('ocioso')
  const [faseDoMain, setFaseDoMain] = useState<FaseDaVoz | undefined>()
  const [texto, setTexto] = useState<string | undefined>(undefined)
  const [erro, setErro] = useState<string | undefined>(undefined)
  /*
   * Aviso, separado de erro: "não ouvi nada" não é falha do app, é próxima ação para o usuário
   * (falar mais perto, conferir o microfone). Uma tarja vermelha aqui diria "quebrou" para o que
   * é "não te ouvi" — e o PI passou três tentativas sem saber qual dos dois era.
   */
  const [aviso, setAviso] = useState<string | undefined>(undefined)
  const [baixando, setBaixando] = useState(false)
  const [trocas, setTrocas] = useState<readonly TrocaDaConversa[]>([])
  const [falaAtual, setFalaAtual] =
    useState<ReturnType<ReturnType<typeof criarReprodutor>['tocar']>>()
  const [visemesDaFala, setVisemesDaFala] = useState<readonly VisemeEvent[]>([])
  const [permissaoConcedida, setPermissaoConcedida] = useState(Boolean(entradaId))
  const [entradaEfetivaId, setEntradaEfetivaId] = useState(entradaId ?? '')
  const encerrarCaptura = useRef<(() => Promise<Int16Array>) | undefined>(undefined)
  const medidor = useRef<MedidorDeEntrada | undefined>(undefined)
  const nivelEntrada = useRef(0)
  const ondas = useRef<HTMLDivElement | null>(null)
  const barraDoMedidor = useRef<HTMLSpanElement | null>(null)
  const legenda = useRef<HTMLSpanElement | null>(null)

  /*
   * O estado **corrente**, para as guardas de `comecar`/`terminar`.
   *
   * As duas nascem a cada render e fecham sobre o `estado` daquele render. Isso quebra o gesto
   * de segurar: `comecar` só marca `gravando` depois do `await capturar()` — que espera a
   * permissão do microfone —, e um `pointerup` nesse meio-tempo executa a `terminar` do render
   * anterior, que ainda vê `ocioso`, sai pela guarda e **deixa a captura aberta**. A tela trava
   * em "Ouvindo..." sem erro em lugar nenhum. Medido no app real pelo PI.
   */
  const estadoAtual = useRef<EstadoDoMicrofone>('ocioso')
  const soltouCedo = useRef(false)
  /** O relógio que decide o fim do turno aberto pela escuta; nunca existe no push-to-talk. */
  const monitorDoTurno = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const tetoDaGravacao = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const origemDoTurno = useRef<'voz' | 'push-to-talk' | undefined>(undefined)
  const geracaoDoTurno = useRef(0)
  const ultimoDisparoTratado = useRef<number | undefined>(undefined)
  /** O último valor avisado ao main; `undefined` até a primeira transição real. */
  const turnoRelatado = useRef<boolean | undefined>(undefined)

  function pararMonitorDoTurno(): void {
    if (monitorDoTurno.current === undefined) return
    clearInterval(monitorDoTurno.current)
    monitorDoTurno.current = undefined
  }

  /*
   * O reprodutor vive num ref, e não em estado: trocá-lo não redesenha nada, e recriá-lo a cada
   * render abriria um `AudioContext` por render — o navegador limita quantos existem.
   */
  const reprodutor = useRef<ReturnType<typeof criarReprodutor> | undefined>(undefined)
  reprodutor.current ??= criarFala()

  /**
   * Muda o estado **e** o ref, sempre juntos.
   *
   * Duas escritas separadas divergem no dia em que alguém esquecer uma delas — e a que fica para
   * trás é justamente a que as guardas leem, então o sintoma seria o travamento silencioso de
   * novo. Uma função só é o que torna isso impossível por construção.
   */
  const marcar = useCallback(
    (novo: EstadoDoMicrofone): void => {
      estadoAtual.current = novo
      setEstado(novo)
      window.jarvis.informarFaseDaVoz?.(novo === 'ocioso' && escutaAtiva ? 'escutando' : novo)
    },
    [escutaAtiva]
  )

  const consultar = useCallback(async (): Promise<void> => {
    setProntidao(await window.jarvis.prontidaoDaVoz())
  }, [])

  const listarDispositivos = useCallback(async (): Promise<void> => {
    const lista = await navigator.mediaDevices.enumerateDevices()
    const entradasDisponiveis = lista.filter((d) => d.kind === 'audioinput')
    if (entradaId && !entradasDisponiveis.some((d) => d.deviceId === entradaId)) {
      const fallback = entradasDisponiveis[0]
      if (fallback) {
        setEntradaEfetivaId(fallback.deviceId)
        setAviso(
          t('voz.dispositivoAusente', {
            ausente: entradaRotulo || t('voz.dispositivoSemNome'),
            atual: fallback.label
          })
        )
      }
    } else if (entradaId) {
      setEntradaEfetivaId(entradaId)
      setAviso(undefined)
    }
  }, [entradaId, entradaRotulo, t])

  async function pedirPermissao(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((trilha) => trilha.stop())
      setPermissaoConcedida(true)
      await listarDispositivos()
    } catch {
      setErro(t('voz.microfoneIndisponivel'))
    }
  }

  useEffect(() => {
    if (!entradaId || !navigator.mediaDevices || escutaAtiva !== false) return
    void Promise.resolve().then(pedirPermissao)
    // A preferência existente autoriza validar dispositivos no boot da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entradaId, escutaAtiva])

  useEffect(() => {
    if (escutaAtiva !== false || !permissaoConcedida || !entradaEfetivaId || estado !== 'ocioso')
      return
    let ativo = true
    void criarMedidor(entradaEfetivaId)
      .then((novoMedidor) => {
        if (!ativo) {
          void novoMedidor.parar()
          return
        }
        medidor.current = novoMedidor
      })
      .catch(() => setErro(t('voz.microfoneIndisponivel')))

    return () => {
      ativo = false
      const atual = medidor.current
      medidor.current = undefined
      void atual?.parar()
    }
  }, [criarMedidor, entradaEfetivaId, escutaAtiva, estado, permissaoConcedida, t])

  useEffect(() => {
    let quadro = 0
    const atualizar = (): void => {
      const nivel =
        estado === 'falando'
          ? (falaAtual?.nivelRms() ?? 0)
          : (capturaCompartilhada?.nivelRms() ??
            medidor.current?.nivelRms() ??
            nivelEntrada.current)
      barraDoMedidor.current?.style.setProperty('width', `${Math.min(100, nivel / 32.767)}%`)
      barraDoMedidor.current?.parentElement?.setAttribute('aria-valuenow', String(nivel))
      const ativo = estado === 'gravando' || estado === 'falando'
      ondas.current?.querySelectorAll<HTMLElement>('[data-barra-da-onda]').forEach((barra, i) => {
        const altura = ativo ? Math.max(8, Math.min(54, nivel / 80 + ((i * 7) % 10))) : 4
        barra.style.height = `${altura}px`
      })
      quadro = requestAnimationFrame(atualizar)
    }
    quadro = requestAnimationFrame(atualizar)
    return () => cancelAnimationFrame(quadro)
  }, [capturaCompartilhada, estado, falaAtual])

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

  useEffect(() => {
    if (!window.jarvis.estadoDaEscuta || !window.jarvis.onEscutaMudou) return
    let ativo = true
    void window.jarvis.estadoDaEscuta().then((e) => {
      if (ativo) setFaseDoMain(e.fase)
    })
    const cancelar = window.jarvis.onEscutaMudou((e) => setFaseDoMain(e.fase))
    return () => {
      ativo = false
      cancelar()
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

  async function comecar(
    porEscuta = false,
    capturaDoTurno?: CapturaDoTurno,
    fimDoGatilhoMs?: number
  ): Promise<void> {
    const interrompendoFala = estadoAtual.current === 'falando'
    const assumindoTurnoDaVoz =
      !porEscuta && estadoAtual.current === 'gravando' && origemDoTurno.current === 'voz'
    if (estadoAtual.current !== 'ocioso' && !interrompendoFala && !assumindoTurnoDaVoz) {
      capturaDoTurno?.cancelar()
      return
    }
    const geracao = ++geracaoDoTurno.current
    if (interrompendoFala) {
      reprodutor.current?.cancelar()
      if (porEscuta && fimDoGatilhoMs !== undefined) {
        log.ui.info('Fala interrompida por barge-in', {
          latenciaBargeInMs: Math.max(0, Date.now() - fimDoGatilhoMs)
        })
      }
    }
    if (assumindoTurnoDaVoz) {
      pararMonitorDoTurno()
      const anterior = encerrarCaptura.current
      encerrarCaptura.current = undefined
      if (anterior) void anterior().then(() => undefined)
    }
    origemDoTurno.current = porEscuta ? 'voz' : 'push-to-talk'
    if (!porEscuta) window.jarvis.informarPosseDoMicrofone?.('push-to-talk')
    setErro(undefined)
    setAviso(
      assumindoTurnoDaVoz
        ? t('escuta.turnoCanceladoPeloBotao')
        : interrompendoFala
          ? t('escuta.falaInterrompida')
          : undefined
    )
    setTexto(undefined)
    soltouCedo.current = false
    marcar('gravando')
    if (!porEscuta) window.jarvis.informarTurnoDaEscuta(true)

    try {
      const medidorAtual = medidor.current
      medidor.current = undefined
      await medidorAtual?.parar()
      nivelEntrada.current = 0
      if (porEscuta && capturaDoTurno === undefined) {
        throw new Error('Captura contínua indisponível para o turno da escuta.')
      }
      if (!porEscuta && escutaAtiva && !capturaCompartilhada) {
        throw new Error('A captura compartilhada ainda não abriu o microfone.')
      }
      const capturaDoPush =
        !porEscuta && escutaAtiva ? capturaCompartilhada?.iniciarTurno(false) : undefined
      const encerrar = await (capturaDoTurno?.capturar ?? capturaDoPush?.capturar ?? capturar)(
        entradaEfetivaId || undefined,
        (valor) => {
          nivelEntrada.current = valor
        }
      )
      if (geracao !== geracaoDoTurno.current) {
        void encerrar()
        return
      }
      encerrarCaptura.current = encerrar
      if (porEscuta) armarMonitorDoTurno()
      else tetoDaGravacao.current = setTimeout(() => void acoes.current.terminar(), vozTimeoutMs)
    } catch {
      // Microfone negado ou ausente. Não é falha do runtime — a próxima ação é do sistema
      // operacional, não do app.
      marcar('ocioso')
      capturaDoTurno?.cancelar()
      if (!porEscuta) window.jarvis.informarPosseDoMicrofone?.(escutaAtiva ? 'wake-word' : 'nenhum')
      window.jarvis.informarTurnoDaEscuta(false)
      setErro(t('voz.microfoneIndisponivel'))
      return
    }

    /*
     * O dedo já subiu enquanto a permissão era pedida.
     *
     * O `pointerup` chegou com a captura ainda abrindo, então `terminar` não tinha o que
     * encerrar. Encerrar aqui é o que impede a captura de ficar aberta — o microfone seguiria
     * gravando com a tela parada em "Ouvindo...", que é pior que um erro: parece escuta.
     */
    if (soltouCedo.current) await terminar()
  }

  /**
   * O turno aberto pela escuta não tem botão para soltar: o silêncio decide (critério 13).
   * `cancelar` descarta a gravação **sem transcrever** — é isso que garante que disparo sem fala
   * não custa uma chamada de IA.
   */
  function armarMonitorDoTurno(): void {
    pararMonitorDoTurno()
    const detector = criarDetectorDeFimDaFala({ tetoMs: vozTimeoutMs })
    const inicio = Date.now()
    monitorDoTurno.current = setInterval(() => {
      const veredito = detector.alimentar(nivelEntrada.current, Date.now() - inicio)
      if (veredito === 'continua') return
      pararMonitorDoTurno()
      void (veredito === 'fim' ? acoes.current.terminar() : acoes.current.cancelarTurno())
    }, 100)
  }

  async function cancelarTurno(): Promise<void> {
    if (estadoAtual.current !== 'gravando' || origemDoTurno.current !== 'voz') return
    const parar = encerrarCaptura.current
    encerrarCaptura.current = undefined
    // Fecha o microfone e joga o áudio fora: ninguém falou, não há o que transcrever.
    await parar?.()
    marcar('ocioso')
    setAviso(t('escuta.semPerguntaAposGatilho'))
  }

  async function terminar(): Promise<void> {
    pararMonitorDoTurno()
    if (tetoDaGravacao.current) clearTimeout(tetoDaGravacao.current)
    tetoDaGravacao.current = undefined
    if (estadoAtual.current !== 'gravando') return

    // A captura ainda não abriu: registra a intenção e deixa `comecar` encerrar quando puder.
    if (encerrarCaptura.current === undefined) {
      soltouCedo.current = true
      return
    }

    marcar('transcrevendo')
    if (origemDoTurno.current === 'push-to-talk') {
      window.jarvis.informarPosseDoMicrofone?.(escutaAtiva ? 'wake-word' : 'nenhum')
    }

    const parar = encerrarCaptura.current
    encerrarCaptura.current = undefined

    /*
     * Uma flag local, e **não** ler `estado` no `finally`: aquela variável é a do render em que
     * esta função nasceu, e continuaria valendo `gravando` mesmo depois de a conversa ter
     * mudado o estado — o `finally` devolveria a tela a `ocioso` no meio de `pensando`, e o
     * botão ficaria liberado enquanto o modelo ainda responde.
     */
    let seguiuParaConversa = false

    try {
      // O PCM vive nesta variável e some com a função: a tela guarda o **texto**, nunca o
      // áudio (critério 8).
      const pcm = parar === undefined ? new Int16Array(0) : await parar()

      /*
       * O **nível** do áudio vai para o log, nunca o áudio (critério 8). Três tentativas reais
       * do PI passaram por aqui sem deixar uma linha, e a pergunta que ninguém conseguia
       * responder era "o microfone entregou fala ou silêncio?" — o RMS responde isso sem guardar
       * uma amostra sequer.
       */
      log.ui.info('Áudio capturado', {
        amostras: pcm.length,
        ms: Math.round((pcm.length / 16_000) * 1000),
        rms: nivelRms(pcm)
      })

      const d: DesfechoDaTranscricao = await window.jarvis.transcreverAudio(pcm, workspace)
      log.ui.info('Transcrição respondeu', {
        estado: d.estado,
        caracteres: d.estado === 'ok' ? d.resultado.texto.length : 0
      })

      if (d.estado === 'ok') {
        /*
         * Texto vazio com `ok` é o sidecar dizendo "gravou, mas não achei fala" — o VAD não
         * detectou voz e o modelo nem rodou. Tratar como sucesso mandava a pergunta vazia para a
         * conversa, que respondia `sem-pergunta` e a tela voltava ao normal **sem dizer nada**.
         * O usuário não tinha como distinguir "não te ouvi" de "quebrou".
         */
        if (d.resultado.texto.trim() === '') {
          setAviso(t('voz.semFala'))
          return
        }

        setTexto(d.resultado.texto)
        seguiuParaConversa = true
        await conversar(d.resultado.texto)
        return
      }

      if (d.estado === 'falhou') setErro(t('voz.falhou'))
      else if (d.estado === 'indisponivel') await consultar()
      // `sem-audio` não vira alerta: e clique curto demais, acidente do usuário — e puni-lo
      // com uma tarja vermelha seria tratar engano como erro.
    } finally {
      // A conversa tem `finally` próprio e é ela quem devolve a tela a `ocioso`.
      if (!seguiuParaConversa) marcar('ocioso')
    }
  }

  /**
   * A transcrição vira pergunta, a persona responde, e a resposta vira fala (critério 1).
   *
   * O loop fecha aqui e **não sai da máquina**: a pergunta vai ao main, que chama a rota local
   * pelo ponto único; a resposta volta como texto e é falada pela F02, com o Piper local. Não há
   * caminho para a nuvem em nenhum dos três passos.
   */
  async function conversar(pergunta: string): Promise<void> {
    const geracao = geracaoDoTurno.current
    marcar('pensando')

    try {
      const desfecho = await window.jarvis.perguntarAoJarvis(pergunta, workspace)
      if (geracao !== geracaoDoTurno.current) return
      log.ui.info('Conversa respondeu', {
        estado: desfecho.estado,
        caracteres: desfecho.estado === 'ok' ? desfecho.resposta.length : 0
      })

      if (desfecho.estado === 'indisponivel') {
        /*
         * A recusa é **visual e falada** (critério 4), e o texto vem do main já escolhido: ele
         * sabe se o Ollama está fora ou se o modelo não foi baixado, que pedem ações diferentes.
         *
         * A fala usa o TTS sobre um texto estático — nunca o modelo que acabou de não responder.
         */
        setErro(desfecho.proximaAcao)
        await falar(desfecho.proximaAcao)
        return
      }

      if (desfecho.estado === 'falhou') {
        setErro(t('voz.conversa.falhou'))
        return
      }

      // `sem-pergunta` não vira alerta, pela mesma razão de `sem-audio`: transcrição vazia é
      // acidente do usuário, não erro do app.
      if (desfecho.estado !== 'ok') return

      const historico = await window.jarvis.historicoDaConversa()
      if (geracao !== geracaoDoTurno.current) return
      setTrocas(historico)
      await falar(desfecho.resposta)
    } finally {
      if (geracao === geracaoDoTurno.current) marcar('ocioso')
    }
  }

  /**
   * Fala um texto e espera o áudio terminar.
   *
   * Falha de fala **não vira alerta**: a resposta já está na tela, e uma tarja vermelha sobre
   * uma conversa que funcionou diria que algo deu errado quando o que faltou foi o som. O
   * estado volta a `ocioso` no `finally` de quem chamou.
   */
  async function falar(texto: string): Promise<void> {
    const geracao = geracaoDoTurno.current
    marcar('falando')
    setVisemesDaFala([])
    setFalaAtual(undefined)
    if (legenda.current) legenda.current.textContent = ''

    const fala = await window.jarvis.falar(texto, vozDaFala)
    if (geracao !== geracaoDoTurno.current) return
    if (fala.estado !== 'ok') return

    const emCurso = reprodutor.current?.tocar(fala.fala, saidaId || undefined)
    if (emCurso === undefined) return
    const limparReferencia = iniciarReferenciaDaFala(
      fala.fala.pcm,
      fala.fala.sampleRate,
      emCurso.posicaoMs
    )
    void emCurso.saidaAplicada.then((aplicada) => {
      if (!aplicada) setAviso(t('voz.saidaSemSuporte'))
    })

    setVisemesDaFala(fala.fala.visemes)
    setFalaAtual(emCurso)
    const duracaoMs = (fala.fala.pcm.length / fala.fala.sampleRate) * 1000
    const revelar = (): void => {
      const proporcao = Math.min(1, emCurso.posicaoMs() / Math.max(1, duracaoMs))
      if (legenda.current) {
        legenda.current.textContent = texto.slice(0, Math.ceil(texto.length * proporcao))
      }
      if (proporcao < 1) requestAnimationFrame(revelar)
    }
    requestAnimationFrame(revelar)
    try {
      await emCurso.terminou
    } finally {
      limparReferencia()
    }
    if (geracao !== geracaoDoTurno.current) return
    if (legenda.current) legenda.current.textContent = texto
    setVisemesDaFala([])
    setFalaAtual(undefined)
  }

  /*
   * A hotkey global chega como **evento do main** (critério 5): o atalho funciona com a janela
   * minimizada, e é aqui que o microfone vive — `getUserMedia` é Web API do renderer.
   *
   * O efeito lê `comecar`/`terminar` por ref, e não das dependências: as duas são recriadas a
   * cada render (fecham sobre `estado`), e listá-las reassinaria o canal a cada tecla — a
   * assinatura sairia e voltaria no meio da própria gravação que ela conduz.
   */
  const acoes = useRef({ comecar, terminar, cancelarTurno })

  /*
   * A ref é atualizada **em efeito**, não durante o render: escrever nela no corpo é o
   * antipadrão que o lint recusa com razão (a escrita aconteceria também em render descartado).
   * O efeito sem lista de dependências roda após cada render, que é exatamente o momento em que
   * as duas funções recém-criadas precisam entrar.
   */
  useEffect(() => {
    acoes.current = { comecar, terminar, cancelarTurno }
  })

  /*
   * Um disparo da escuta começa o turno. Só age com a prontidão conhecida: antes dela a tela nem
   * sabe se há como transcrever. Sem runtime pronto o turno não pode correr, e o main precisa
   * saber — senão ficaria ignorando gatilhos até o teto.
   */
  useEffect(() => {
    if (disparo === undefined || prontidao === undefined) return
    if (ultimoDisparoTratado.current === disparo.id) return
    ultimoDisparoTratado.current = disparo.id
    aoTratarDisparo?.(disparo.id)

    if (!prontidao.pronta) {
      disparo.capturaDoTurno.cancelar()
      // Dentro da promessa, e não no corpo do efeito: `setState` síncrono ali cascateia render.
      void Promise.resolve().then(() => setAviso(t('escuta.naoPronta')))
      window.jarvis.informarTurnoDaEscuta(false)
      return
    }
    void acoes.current.comecar(true, disparo.capturaDoTurno, disparo.fimDoGatilhoMs)
  }, [disparo, prontidao, aoTratarDisparo, t])

  // O main só impede um segundo turno se souber que este começou e quando terminou. Só transições
  // contam: montar em `ocioso` não é o fim de turno nenhum, e avisá-lo liberaria o que o disparo
  // acabou de abrir.
  useEffect(() => {
    const emTurno = estado !== 'ocioso'
    if (turnoRelatado.current === undefined && !emTurno) return
    if (turnoRelatado.current === emTurno) return
    turnoRelatado.current = emTurno
    window.jarvis.informarTurnoDaEscuta(emTurno)
  }, [estado])

  useEffect(
    () => () => {
      pararMonitorDoTurno()
      if (tetoDaGravacao.current) clearTimeout(tetoDaGravacao.current)
      if (turnoRelatado.current === true) window.jarvis.informarTurnoDaEscuta(false)
    },
    []
  )

  useEffect(() => {
    return window.jarvis.onVozHotkey((gravando) => {
      void (gravando ? acoes.current.comecar() : acoes.current.terminar())
    })
  }, [])

  if (prontidao === undefined) return <Card>{t('voz.verificando')}</Card>

  const rotuloDoCompute = prontidao.compute === 'cuda' ? t('voz.compute.gpu') : t('voz.compute.cpu')

  const ROTULO_DO_ESTADO: Partial<Record<EstadoDoMicrofone, string>> = {
    gravando: t('voz.gravando'),
    transcrevendo: t('voz.transcrevendo'),
    pensando: t('voz.conversa.pensando'),
    falando: t('voz.conversa.falando')
  }

  const rotuloDoBotao = ROTULO_DO_ESTADO[estado] ?? t('voz.segureParaFalar')
  const faseVisivel =
    faseDoMain === 'escutando' && !capturaCompartilhada
      ? 'ocioso'
      : (faseDoMain ??
        (estado === 'ocioso' && escutaAtiva && capturaCompartilhada ? 'escutando' : estado))
  const estadoDoMascote: EstadoDoMascote =
    faseVisivel === 'gravando'
      ? 'ouvindo'
      : faseVisivel === 'transcrevendo' || faseVisivel === 'pensando'
        ? 'pensando'
        : faseVisivel === 'falando'
          ? 'falando'
          : faseVisivel === 'escutando'
            ? 'escutando'
            : 'idle'

  // Segurar para falar só vale de `ocioso`: durante transcrição, resposta ou fala, um novo
  // aperto abriria uma segunda conversa por cima da primeira.
  const ocupado = estado !== 'ocioso' && estado !== 'gravando' && estado !== 'falando'
  const escolhaPendente = !entradaEfetivaId || (escutaAtiva !== false && !capturaCompartilhada)

  return (
    <div
      className="mx-auto flex min-h-[min(720px,calc(100vh-12rem))] w-full max-w-5xl flex-col items-center gap-6 py-4"
      data-testid="command-center"
    >
      <header className="w-full">
        <h2 className="text-[length:var(--jos-texto-titulo)]">{t('shell.commandCenter')}</h2>
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          J.A.R.V.I.S · JUST A RATHER VERY INTELLIGENT SYSTEM
        </p>
      </header>
      <div className="flex w-full max-w-3xl flex-col items-center gap-5">
        <div className="flex items-center justify-between gap-3">
          <VoiceMascot
            modulo="jarvis"
            tamanho="grande"
            estado={estadoDoMascote}
            visemes={visemesDaFala}
            relogioDaFala={falaAtual?.posicaoMs}
          />
          <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {rotuloDoCompute}
          </span>
        </div>

        <div
          ref={ondas}
          className="flex h-14 w-full items-end justify-center gap-1"
          data-fonte-da-onda={
            faseVisivel === 'gravando' ? 'entrada' : faseVisivel === 'falando' ? 'saida' : 'repouso'
          }
          aria-label={t('voz.ondas')}
        >
          {Array.from({ length: 21 }, (_, i) => (
            <span
              key={i}
              data-barra-da-onda
              className="w-1 bg-[var(--jos-cor-acento)] transition-[height] motion-reduce:transition-none"
              style={{ height: '4px' }}
            />
          ))}
        </div>

        <p aria-live="polite" className="min-h-7 text-center text-[length:var(--jos-texto-corpo)]">
          {faseVisivel === 'escutando' ? t('escuta.escutando') : null}
          <span ref={legenda} />
          {estado === 'falando' ? <span aria-hidden> |</span> : null}
        </p>

        {erro !== undefined && (
          <InlineAlert tom="err" titulo={t('voz.problema')}>
            {erro}
          </InlineAlert>
        )}

        {aviso !== undefined && (
          <InlineAlert tom="info" titulo={t('voz.semFalaTitulo')}>
            {aviso}
          </InlineAlert>
        )}

        {prontidao.pronta && (permissaoConcedida || capturaCompartilhada) ? (
          <Button
            /*
             * **O ponteiro é capturado no `pointerdown`**, e é isso que faz o gesto sobreviver
             * à mão se mexendo.
             *
             * Sem a captura, atravessar a borda do botão com o dedo ainda pressionado dispara
             * `pointerleave` — e como ele também encerra (soltar fora do botão é comum), a
             * gravação era **descartada no meio da frase**, sem erro em lugar nenhum. Falar
             * segurando move o mouse; o PI perdeu três enunciados assim.
             *
             * Com `setPointerCapture` o navegador entrega todos os eventos deste ponteiro ao
             * botão, mesmo fora dele: `pointerup` sempre chega, e `pointerleave` deixa de ser o
             * caminho de encerramento em vez de continuar disputando com ele.
             */
            onPointerDown={(evento) => {
              // `?.` porque jsdom não implementa a API: sem ele, o teste da tela quebraria numa
              // chamada que no navegador real sempre existe.
              evento.currentTarget.setPointerCapture?.(evento.pointerId)
              void comecar()
            }}
            onPointerUp={() => void terminar()}
            /*
             * `pointerCancel` continua encerrando: é o que o SO dispara quando toma o ponteiro
             * (gesto do sistema, janela perdendo foco). Sem ele a captura ficaria aberta com o
             * microfone gravando — o cenário que o `pointerleave` existia para cobrir.
             */
            onPointerCancel={() => void terminar()}
            /*
             * **`onPointerLeave` não encerra mais.**
             *
             * Ele existia para cobrir "soltar fora do botão", mas dispara também ao atravessar a
             * borda com o dedo pressionado — e falar segurando move a mão. Era ele que descartava
             * o enunciado no meio, calado. Com a captura, `pointerup` chega mesmo fora do botão,
             * então o caso que ele cobria já está coberto pelo par certo.
             */
            desabilitado={ocupado || escolhaPendente}
          >
            {rotuloDoBotao}
          </Button>
        ) : prontidao.pronta ? (
          <Button onClick={() => void pedirPermissao()}>{t('voz.escolherMicrofone')}</Button>
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

        {prontidao.pronta && permissaoConcedida && escolhaPendente && (
          <p
            role="status"
            className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]"
          >
            {t('voz.escolhaEmSettings')}
          </p>
        )}

        {permissaoConcedida && (
          <div
            role="meter"
            aria-label={t('voz.nivelEntrada')}
            aria-valuemin={0}
            aria-valuemax={32767}
            aria-valuenow={0}
            className="h-2 w-full max-w-sm overflow-hidden bg-[rgba(var(--jos-borda-rgb),0.12)]"
          >
            <span
              ref={barraDoMedidor}
              className="block h-full bg-[var(--jos-cor-acento)]"
              style={{ width: '0%' }}
            />
          </div>
        )}

        {texto !== undefined && trocas.length === 0 && (
          <p className="text-[length:var(--jos-texto-corpo)]" aria-live="polite">
            {texto}
          </p>
        )}

        {/*
         * A conversa, com quem falou em cada linha.
         *
         * `aria-live="polite"` na lista e não em cada troca: o leitor de tela anuncia o que
         * **entrou**, e marcar cada item faria toda a conversa ser relida a cada resposta.
         */}
        {trocas.length > 0 && (
          <ol className="flex flex-col gap-3" aria-live="polite">
            {trocas.map((troca, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p className="text-[length:var(--jos-texto-corpo)]">
                  <span className="text-[var(--jos-cor-texto-suave)]">
                    {t('voz.conversa.voce')}:{' '}
                  </span>
                  {troca.pergunta}
                </p>
                <p className="text-[length:var(--jos-texto-corpo)]">
                  <span className="text-[var(--jos-cor-texto-suave)]">
                    {t('voz.conversa.jarvis')}:{' '}
                  </span>
                  {troca.resposta}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

/**
 * A energia média do trecho, em unidades Int16.
 *
 * Silêncio de microfone fica na casa de dezenas; fala próxima passa de mil. É o número que
 * distingue "o dispositivo padrão não é o que o usuário fala" de "o VAD errou" — e ele sai do
 * áudio sem que o áudio saia daqui.
 */
function nivelRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0
  let soma = 0
  for (const a of pcm) soma += a * a
  return Math.round(Math.sqrt(soma / pcm.length))
}
