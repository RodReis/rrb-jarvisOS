import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { initI18n } from './i18n'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root não encontrado no index.html.')

// i18n inicializado antes do render, com o padrão do produto: renderizar sem ele exibiria
// as chaves cruas por um instante. O idioma real vem do perfil e é aplicado a quente pelo
// `usePreferences` assim que o main responde.
void initI18n('pt-BR').finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
