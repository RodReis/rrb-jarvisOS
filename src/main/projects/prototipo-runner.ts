/**
 * O carregamento dos protótipos anexados, para validá-los (SPEC-Planejamento-05 § Validação).
 *
 * A spec pede *"parser/servidor local para HTML; Playwright nos protótipos"*. O que este arquivo
 * faz é a substância disso, com o navegador que o app já tem: **um `BrowserWindow` oculto**
 * carrega o protótipo de `file://` dentro do diretório do projeto e devolve o que só o render
 * responde — se a página abriu, se produziu conteúdo, quais telas declarou e o que o console
 * reclamou. Trazer o Chromium do Playwright para o runtime empacotaria um segundo navegador no
 * Electron para observar o que o primeiro já observa (decisão do PI, 2026-08-30).
 *
 * **Este é o único lugar do app que carrega HTML de terceiro**, e a janela reflete isso: ela é
 * mais restrita que a do renderer, não igual.
 *
 *  - **Sem preload.** A ponte `window.jarvis` não existe nesta janela; um protótipo não tem por
 *    onde chamar IPC. Reusar `RENDERER_SECURITY` daria a ele o mesmo preload da nossa tela.
 *  - **`javascript: true`, e é deliberado.** Protótipo de design costuma depender de script para
 *    montar a tela, e desligá-lo faria toda página dinâmica ser reportada como "abriu em branco"
 *    — um achado falso sobre um protótipo correto. O script roda sandboxado, sem Node e sem
 *    ponte, que é o que o torna aceitável.
 *  - **Rede negada.** `webRequest` bloqueia tudo que não seja `file:` e `devtools:`: um
 *    protótipo não vaza o que quer que ele referencie, e a validação não depende de rede para
 *    dar o mesmo resultado duas vezes.
 *  - **Timeout duro.** Um protótipo com laço infinito não pode segurar a validação para sempre.
 *
 * O carregamento é serial de propósito: cada protótipo é uma janela por vez. Paralelizar daria
 * N janelas ocultas competindo, e a validação não é caminho quente — ela roda quando o PI pede
 * a arquitetura.
 */

import { BrowserWindow, session } from 'electron'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ReferenciaDoPrototipo,
  RenderDoPrototipo
} from '@shared/domain/validacao-de-prototipo'
import { log } from '../logging/logger'

/** Quanto tempo um protótipo tem para carregar. */
const TIMEOUT_DO_PROTOTIPO_MS = 10_000

/** Partição efêmera: nada que o protótipo grave sobrevive à validação. */
const PARTICAO_DO_PROTOTIPO = 'prototipo-validacao'

/**
 * O script que extrai o que interessa da página carregada.
 *
 * Roda no contexto do protótipo, então só pode usar DOM. Devolve JSON serializável — o que
 * atravessa `executeJavaScript` é estruturado, e uma referência a `Element` não atravessaria.
 *
 * As jornadas saem de headings e de `[data-jornada]`: são as duas formas em que um protótipo
 * declara "esta é a tela X". Ler todo o texto da página traria rótulo de botão como se fosse
 * tela, e o critério 4 passaria a prometer fluxo que ninguém desenhou.
 */
const SCRIPT_DE_EXTRACAO = `(() => {
  const texto = (el) => (el.textContent || '').trim()
  const jornadas = [
    ...document.querySelectorAll('h1, h2, h3, [data-jornada], [data-estado]')
  ].map(texto).filter((t) => t !== '')

  const visiveis = [...document.body.querySelectorAll('*')].filter((el) => {
    const t = (el.textContent || '').trim()
    if (t === '') return false
    const estilo = getComputedStyle(el)
    return estilo.display !== 'none' && estilo.visibility !== 'hidden'
  })

  return JSON.stringify({ jornadas, elementosVisiveis: visiveis.length })
})()`

/**
 * As referências que o HTML faz a outros arquivos.
 *
 * Extraídas do **texto** do arquivo, e não do DOM carregado, de propósito: o DOM já perdeu o que
 * falhou ao carregar — uma `<img src>` quebrada vira um elemento sem informação do alvo
 * original. É o parser estático que responde "o que este arquivo pede?", e o render responde "o
 * que aconteceu quando pediu".
 */
export function referenciasDoHtml(
  html: string,
  arquivoDoPrototipo: string,
  raizDoProjeto: string
): readonly ReferenciaDoPrototipo[] {
  const encontradas = new Map<string, ReferenciaDoPrototipo>()
  const base = dirname(arquivoDoPrototipo)

  // `src` e `href` cobrem img/script/link/a — as quatro formas em que um protótipo aponta para
  // outro arquivo. Atributo com aspas simples ou dupla; sem aspas é HTML inválido e o parser do
  // Chromium também não o trataria de forma previsível.
  const padrao = /\b(src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi

  for (const m of html.matchAll(padrao)) {
    const alvo = (m[3] ?? m[4] ?? '').trim()
    if (alvo === '' || alvo.startsWith('#')) continue

    const remota = /^(https?:|data:|mailto:|tel:|\/\/)/i.test(alvo)
    const tipo: ReferenciaDoPrototipo['tipo'] = /\.html?($|[?#])/i.test(alvo)
      ? 'navegacao'
      : 'asset'

    if (remota) {
      encontradas.set(alvo, { alvo, tipo, resolvido: false, remota: true })
      continue
    }

    // Resolve relativo ao protótipo, e confirma que o resultado continua sob o projeto. Um
    // `../../..` que escape não é "asset faltando": é referência que o projeto não contém, e
    // tratá-la como resolvida faria o gate aceitar dependência de fora da pasta.
    const semQuery = alvo.split(/[?#]/)[0] ?? alvo
    const absoluto = isAbsolute(semQuery) ? semQuery : resolve(join(base, semQuery))
    const dentro = !relative(raizDoProjeto, absoluto).startsWith('..')
    encontradas.set(alvo, {
      alvo,
      tipo,
      resolvido: dentro && existsSync(absoluto),
      remota: false
    })
  }

  return [...encontradas.values()]
}

/**
 * Carrega um protótipo numa janela oculta e devolve o que o render mostrou.
 *
 * Nunca rejeita: um protótipo que quebra é **dado da validação**, não falha da operação — quem
 * lê o resultado é o PI, e uma promise rejeitada faria "o protótipo está quebrado" chegar
 * indistinguível de "o app não conseguiu validar".
 */
export async function carregarPrototipo(caminhoAbsoluto: string): Promise<RenderDoPrototipo> {
  const errosDeConsole: string[] = []
  const particao = session.fromPartition(`memory:${PARTICAO_DO_PROTOTIPO}`)

  // Rede negada. `file:` para o próprio protótipo e seus assets; `devtools:` porque o Chromium
  // o usa internamente e bloqueá-lo produz ruído de console que não é do protótipo.
  particao.webRequest.onBeforeRequest((detalhes, callback) => {
    const permitido = /^(file|devtools):/i.test(detalhes.url)
    if (!permitido) errosDeConsole.push(`Rede bloqueada na validação: ${detalhes.url}`)
    callback({ cancel: !permitido })
  })

  const janela = new BrowserWindow({
    show: false,
    webPreferences: {
      // **Sem preload**: a ponte não existe aqui. Este é HTML de terceiro.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Ligado de propósito — ver o cabeçalho: protótipo dinâmico sem script seria reportado
      // como tela em branco, e o achado falso é pior que o risco, que a sandbox já contém.
      javascript: true,
      session: particao
    }
  })

  try {
    /*
     * A evidência do achado é o que o PI lê para decidir se o protótipo está certo, então ela
     * carrega só o que **é** do protótipo. Três filtros, cada um por um motivo que o E2E mostrou:
     *
     *  - **Só `warning` e `error`.** Um protótipo com `console.log` de depuração não deve encher
     *    a evidência com ruído que não é problema.
     *  - **Sem os avisos do próprio Electron.** Ele emite "Electron Security Warning
     *    (Insecure Content-Security-Policy)" no console de toda página sem CSP — o que descreve
     *    o protótipo do PI como problemático por uma decisão nossa de como o carregamos.
     *  - **Sem repetição.** O Electron entrega o mesmo evento pelo caminho legado e pelo novo,
     *    e a mensagem chegava duplicada em toda evidência.
     */
    const vistas = new Set<string>()
    janela.webContents.on('console-message', (evento) => {
      if (evento.level !== 'warning' && evento.level !== 'error') return
      if (evento.message.includes('Electron Security Warning')) return
      if (vistas.has(evento.message)) return
      vistas.add(evento.message)
      errosDeConsole.push(evento.message)
    })

    const carregou = await comTimeout(
      janela.loadURL(pathToFileURL(caminhoAbsoluto).toString()).then(() => true),
      TIMEOUT_DO_PROTOTIPO_MS
    ).catch((causa: unknown) => {
      errosDeConsole.push(causa instanceof Error ? causa.message : String(causa))
      return false
    })

    if (carregou !== true) {
      return { carregou: false, errosDeConsole, elementosVisiveis: 0, jornadas: [] }
    }

    const bruto = await comTimeout(
      janela.webContents.executeJavaScript(SCRIPT_DE_EXTRACAO, true),
      TIMEOUT_DO_PROTOTIPO_MS
    ).catch(() => '')

    const extraido = interpretarExtracao(typeof bruto === 'string' ? bruto : '')

    return {
      carregou: true,
      errosDeConsole,
      elementosVisiveis: extraido.elementosVisiveis,
      jornadas: extraido.jornadas
    }
  } finally {
    // A janela some sempre, inclusive quando o protótipo trava: uma janela oculta vazada
    // seguraria o processo e o app não encerraria.
    if (!janela.isDestroyed()) janela.destroy()
    particao.webRequest.onBeforeRequest(null)
  }
}

/** Lê o HTML do protótipo. Ilegível devolve vazio: o render dirá que não carregou. */
export function lerHtml(caminhoAbsoluto: string): string {
  try {
    return readFileSync(caminhoAbsoluto, 'utf8')
  } catch (causa) {
    log.agent.warn('Protótipo ilegível na validação', {
      stack: causa instanceof Error ? causa.stack : undefined
    })
    return ''
  }
}

interface Extracao {
  readonly jornadas: readonly string[]
  readonly elementosVisiveis: number
}

/**
 * Interpreta o JSON do script. Qualquer coisa fora do formato vira extração vazia — o script
 * roda no contexto do protótipo, e um protótipo pode ter sobrescrito `JSON` ou `querySelectorAll`.
 */
function interpretarExtracao(bruto: string): Extracao {
  try {
    const parsed: unknown = JSON.parse(bruto)
    if (typeof parsed !== 'object' || parsed === null) return { jornadas: [], elementosVisiveis: 0 }
    const obj = parsed as Record<string, unknown>
    return {
      jornadas: Array.isArray(obj.jornadas)
        ? obj.jornadas.filter((j) => typeof j === 'string')
        : [],
      elementosVisiveis: typeof obj.elementosVisiveis === 'number' ? obj.elementosVisiveis : 0
    }
  } catch {
    return { jornadas: [], elementosVisiveis: 0 }
  }
}

/** Corre a promise contra o relógio. Protótipo com laço infinito não segura a validação. */
function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tempo esgotado ao carregar o protótipo (${ms}ms).`)), ms)
    )
  ])
}
