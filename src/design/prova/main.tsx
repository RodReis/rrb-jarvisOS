import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GaleriaDeControles } from './GaleriaDeControles'
import type { ModoUi, Modulo } from '../tokens/semantic'
import type { CorAcento } from '../tokens/acento'
import './prova.css'

/**
 * Ponto de entrada da galeria de prova (SPEC-DesignSystem-03a).
 *
 * Serve só ao Playwright. **Não é rota do app** e não entra no bundle do renderer: é um
 * `index.html` próprio, servido pelo Vite em porta separada durante a captura.
 *
 * Modo, módulo e acento vêm da query string para que uma execução gere todas as combinações
 * sem recompilar — `?modo=light&modulo=noa&acento=%232CFF05`.
 */

const params = new URLSearchParams(window.location.search)
const modo = (params.get('modo') === 'light' ? 'light' : 'dark') satisfies ModoUi
const modulo = (params.get('modulo') === 'noa' ? 'noa' : 'jarvis') satisfies Modulo
const acento = params.get('acento') as CorAcento | null

const raiz = document.getElementById('root')
if (raiz === null) throw new Error('Elemento #root não encontrado.')

createRoot(raiz).render(
  <StrictMode>
    <GaleriaDeControles modo={modo} modulo={modulo} acento={acento ?? undefined} />
  </StrictMode>
)
