import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll } from 'vitest'
import { initI18n } from '../src/i18n'

// O i18n é global e assíncrono: sem inicializá-lo antes da suíte, os componentes
// renderizariam as chaves cruas (`settings.titulo`) e todo teste de texto falharia por
// um motivo que não é o que ele investiga.
beforeAll(async () => {
  await initI18n('pt-BR')
})

afterEach(() => {
  cleanup()
})
