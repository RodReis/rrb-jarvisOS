import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GaleriaDeControles } from './GaleriaDeControles'
import { GaleriaDeDados, type Cena } from './GaleriaDeDados'
import type { ModoUi, Modulo } from '../tokens/semantic'
import type { CorAcento } from '../tokens/acento'
import './prova.css'

/**
 * Ponto de entrada das galerias de prova (SPEC-DesignSystem-03a e 03b).
 *
 * Serve só ao Playwright. **Não é rota do app** e não entra no bundle do renderer: é um
 * `index.html` próprio, servido pelo Vite em porta separada durante a captura.
 *
 * Tudo vem da query string para que uma execução gere todas as combinações sem recompilar —
 * `?galeria=dados&modo=light&modulo=noa&cena=alert`.
 *
 * `galeria` escolhe a fatia: `controles` (F03a, default) ou `dados` (F03b). O default preserva
 * as URLs do `controles.prova.ts`, que já existia — a F03b entra somando, sem tocar no que
 * a fatia anterior deixou verde.
 */

const params = new URLSearchParams(window.location.search)
const modo = (params.get('modo') === 'light' ? 'light' : 'dark') satisfies ModoUi
const modulo = (params.get('modulo') === 'noa' ? 'noa' : 'jarvis') satisfies Modulo
const acento = params.get('acento') as CorAcento | null

/** Lista fechada: uma cena desconhecida cairia na estática e a captura mentiria em silêncio. */
const CENAS: readonly Cena[] = ['estatica', 'dialog', 'alert', 'drawer', 'toasts']
const cenaBruta = params.get('cena')
if (cenaBruta !== null && !CENAS.includes(cenaBruta as Cena)) {
  throw new Error(`Cena desconhecida: ${cenaBruta}. Use uma de: ${CENAS.join(', ')}.`)
}
const cena = (cenaBruta ?? 'estatica') as Cena

const raiz = document.getElementById('root')
if (raiz === null) throw new Error('Elemento #root não encontrado.')

const galeria =
  params.get('galeria') === 'dados' ? (
    <GaleriaDeDados modo={modo} modulo={modulo} acento={acento ?? undefined} cena={cena} />
  ) : (
    <GaleriaDeControles modo={modo} modulo={modulo} acento={acento ?? undefined} />
  )

createRoot(raiz).render(<StrictMode>{galeria}</StrictMode>)
