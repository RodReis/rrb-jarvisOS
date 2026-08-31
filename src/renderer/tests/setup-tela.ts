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

/*
 * Lacunas do jsdom que os primitivos Radix exigem (SPEC-DesignSystem-03a).
 *
 * `ResizeObserver` e `scrollIntoView` existem em todo navegador real, mas não no jsdom. Sem
 * eles, `Slider` e `Select` quebram na montagem — falha de **ambiente**, não do componente.
 *
 * Os stubs são deliberadamente inertes: eles destravam a montagem sem simular comportamento
 * que não existe. Um `ResizeObserver` que inventasse medidas faria o teste afirmar sobre
 * dimensões que o jsdom não calcula — daria confiança falsa. Layout e rolagem se verificam no
 * screenshot do Playwright, que roda num navegador de verdade.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

if (typeof Element !== 'undefined' && Element.prototype.scrollIntoView === undefined) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

/*
 * A API de pointer capture, pela mesma razão e com o mesmo cuidado.
 *
 * O `Select` do Radix a consulta ao **abrir a lista** — antes disso a montagem passa, e é por
 * isso que a lacuna só apareceu na F04 do MVP-005, quando um teste precisou abrir o seletor de
 * modelo em vez de só renderizá-lo.
 *
 * `hasPointerCapture` devolve `false` (nada capturado) em vez de `true`: `false` é o estado de
 * um elemento que ninguém capturou, que é a verdade num ambiente sem pointer. Devolver `true`
 * faria o Radix acreditar numa captura que não existe.
 */
if (typeof Element !== 'undefined' && Element.prototype.hasPointerCapture === undefined) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
}

afterEach(() => {
  cleanup()
})
