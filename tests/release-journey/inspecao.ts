import { createHash } from 'node:crypto'
import { expect, type Page } from '@playwright/test'

/**
 * A inspeção funcional de uma URL de release (SPEC-Release-05: "Playwright nas três URLs e após
 * rollback"): a página abre, o frontend publica a configuração de runtime do SEU backend, o
 * backend está saudável e a página não fala com o backend de outro ambiente. A impressão digital
 * da página + configuração é o que prova, depois do rollback, que o ambiente voltou a servir
 * exatamente o que servia antes.
 */

export interface Inspecao {
  readonly frontendUrl: string
  readonly apiUrl: string
  readonly impressao: string
}

const LOCAL = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/

/** Fora de localhost só HTTPS: uma URL de ambiente real sem TLS é erro de configuração. */
function exigirTransportePermitido(url: string): void {
  if (LOCAL.test(url)) return
  expect(new URL(url).protocol, `${url} precisa ser HTTPS`).toBe('https:')
}

export async function inspecionar(
  page: Page,
  frontendUrl: string,
  backendsDosOutros: readonly string[] = []
): Promise<Inspecao> {
  exigirTransportePermitido(frontendUrl)
  const falouCom: string[] = []
  page.on('request', (req) => falouCom.push(req.url()))

  const resposta = await page.goto(frontendUrl)
  expect(resposta?.status(), `${frontendUrl} deve responder 200`).toBe(200)
  const html = await page.content()
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(0)

  const runtime = await page.request.get(new URL('/runtime-config.json', frontendUrl).toString())
  expect(runtime.status(), 'runtime-config.json').toBe(200)
  const configuracao = (await runtime.json()) as { apiUrl?: unknown }
  expect(typeof configuracao.apiUrl).toBe('string')
  const apiUrl = configuracao.apiUrl as string
  exigirTransportePermitido(apiUrl)

  const saude = await page.request.get(new URL('/health', apiUrl).toString())
  expect(saude.status(), `${apiUrl}/health`).toBe(200)

  for (const outro of backendsDosOutros) {
    expect(apiUrl, 'o frontend aponta para o backend de outro ambiente').not.toBe(outro)
    expect(
      falouCom.some((url) => url.startsWith(outro)),
      `a página falou com ${outro}`
    ).toBe(false)
  }
  return {
    frontendUrl,
    apiUrl,
    impressao: createHash('sha256')
      .update(html)
      .update('\n')
      .update(JSON.stringify(configuracao))
      .digest('hex')
  }
}

/** Depois do rollback o ambiente serve a mesma impressão de antes. */
export function voltouAoEstadoConhecido(antes: Inspecao, depois: Inspecao): boolean {
  return antes.apiUrl === depois.apiUrl && antes.impressao === depois.impressao
}
