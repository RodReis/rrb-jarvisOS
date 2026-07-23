import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GaleriaDeControles } from './GaleriaDeControles'
import { GaleriaDeDados, type Cena } from './GaleriaDeDados'
import { GaleriaDeIdentidades } from './GaleriaDeIdentidades'
import { GaleriaDeShell } from './GaleriaDeShell'
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

/**
 * As galerias, por nome de query.
 *
 * Mapa e não cadeia de ternários: com quatro fatias tendo galeria, o encadeamento já tinha três
 * níveis e o próximo `else if` seria onde o default se perde de vista. O `controles` continua
 * sendo o default por compatibilidade — as URLs do `controles.prova.ts` foram escritas sem o
 * parâmetro `galeria`.
 *
 * A galeria de **identidades** ignora `modulo` de propósito: ela monta as duas colunas ao mesmo
 * tempo, e um parâmetro de módulo ali sugeriria uma captura por identidade, que é justamente o
 * que ela não é.
 */
const GALERIAS = {
  dados: () => (
    <GaleriaDeDados modo={modo} modulo={modulo} acento={acento ?? undefined} cena={cena} />
  ),
  identidades: () => <GaleriaDeIdentidades modo={modo} acento={acento ?? undefined} />,
  shell: () => <GaleriaDeShell modo={modo} modulo={modulo} acento={acento ?? undefined} />,
  controles: () => <GaleriaDeControles modo={modo} modulo={modulo} acento={acento ?? undefined} />
} as const

const qual = params.get('galeria') ?? 'controles'
if (!(qual in GALERIAS)) {
  // Mesma disciplina da `cena`: galeria desconhecida cairia no default e a captura mentiria em
  // silêncio — o arquivo teria o nome da galeria pedida e o conteúdo de outra.
  throw new Error(`Galeria desconhecida: ${qual}. Use uma de: ${Object.keys(GALERIAS).join(', ')}.`)
}

const galeria = GALERIAS[qual as keyof typeof GALERIAS]()

createRoot(raiz).render(<StrictMode>{galeria}</StrictMode>)
