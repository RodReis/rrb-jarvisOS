import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { iniciarAmbiente, type AmbienteDeProva } from './ambientes-de-prova'
import { inspecionar, voltouAoEstadoConhecido, type Inspecao } from './inspecao'

/**
 * Jornada funcional da release (SPEC-Release-05, critério 10), Playwright nas três URLs e depois
 * do rollback. Dois modos, escolhidos pelo ambiente:
 *
 * - **Prova local** (padrão, e o que o CI roda): sobe três ambientes locais, promove uma versão
 *   nova, faz o rollback e confere que a inspeção percebe cada passo — inclusive que reprova
 *   quando o rollback NÃO restaura o estado anterior.
 * - **Projeto de prova real** (`RELEASE_JOURNEY_URLS` + `RELEASE_JOURNEY_PHASE`): inspeciona as
 *   URLs reais de Preview, Staging e Produção. O operador roda a fase `baseline` antes da
 *   mudança, `urls` com a release nos três ambientes e `after-rollback` depois do rollback;
 *   a impressão de Produção fica em `RELEASE_JOURNEY_STATE`. Sem essas variáveis, esse modo
 *   NÃO roda e nunca é contado como passou (`not_run`, ver docs/TESTING.md).
 */

type Url = Record<'preview' | 'staging' | 'production', string>

const REAL = process.env.RELEASE_JOURNEY_URLS
const FASE = process.env.RELEASE_JOURNEY_PHASE
const ESTADO = process.env.RELEASE_JOURNEY_STATE

test.describe('prova local da jornada', () => {
  test.skip(Boolean(REAL), 'modo real em uso')
  test.describe.configure({ mode: 'serial' })

  let ambientes: Record<'preview' | 'staging' | 'production', AmbienteDeProva>

  test.beforeAll(async () => {
    ambientes = {
      preview: await iniciarAmbiente('preview', 'v1'),
      staging: await iniciarAmbiente('staging', 'v1'),
      production: await iniciarAmbiente('production', 'v1')
    }
  })

  test.afterAll(async () => {
    await Promise.all(Object.values(ambientes).map((a) => a.fechar()))
  })

  const outros = (nome: keyof typeof ambientes): string[] =>
    Object.entries(ambientes)
      .filter(([n]) => n !== nome)
      .map(([, a]) => a.backendUrl)

  test('Preview, Staging e Produção abrem, falam só com o próprio backend e estão saudáveis', async ({
    page
  }) => {
    for (const nome of ['preview', 'staging', 'production'] as const) {
      const inspecao = await inspecionar(page, ambientes[nome].frontendUrl, outros(nome))
      expect(inspecao.apiUrl).toBe(ambientes[nome].backendUrl)
    }
  })

  test('promover uma versão nova muda a impressão; o rollback devolve exatamente a anterior', async ({
    page
  }) => {
    const baseline: Inspecao = await inspecionar(
      page,
      ambientes.production.frontendUrl,
      outros('production')
    )

    ambientes.production.servir('v2')
    const promovida = await inspecionar(
      page,
      ambientes.production.frontendUrl,
      outros('production')
    )
    expect(voltouAoEstadoConhecido(baseline, promovida)).toBe(false)

    ambientes.production.servir('v1') // rollback
    const aposRollback = await inspecionar(
      page,
      ambientes.production.frontendUrl,
      outros('production')
    )
    expect(voltouAoEstadoConhecido(baseline, aposRollback)).toBe(true)
  })

  test('contrafactual: rollback que não restaura é percebido pela inspeção', async ({ page }) => {
    const baseline = await inspecionar(page, ambientes.staging.frontendUrl, outros('staging'))
    ambientes.staging.servir('v2')
    const sem = await inspecionar(page, ambientes.staging.frontendUrl, outros('staging'))
    expect(voltouAoEstadoConhecido(baseline, sem)).toBe(false)
    ambientes.staging.servir('v1')
  })

  test('contrafactual: frontend ligado ao backend de outro ambiente é reprovado', async ({
    page
  }) => {
    // O backend "dos outros" inclui o da própria produção: a inspeção deve acusar a fiação cruzada.
    await expect(
      inspecionar(page, ambientes.production.frontendUrl, [ambientes.production.backendUrl])
    ).rejects.toThrow()
  })
})

test.describe('projeto de prova real', () => {
  test.skip(!REAL || !FASE, 'RELEASE_JOURNEY_URLS e RELEASE_JOURNEY_PHASE não definidos: not_run')

  const urls = (): Url => JSON.parse(REAL ?? '{}') as Url

  test('fase: impressão de Produção antes da mudança', async ({ page }) => {
    test.skip(FASE !== 'baseline')
    expect(ESTADO, 'defina RELEASE_JOURNEY_STATE').toBeTruthy()
    const base = await inspecionar(page, urls().production)
    writeFileSync(ESTADO!, JSON.stringify(base), 'utf8')
  })

  test('fase: as três URLs da release', async ({ page }) => {
    test.skip(FASE !== 'urls')
    const u = urls()
    const backends: Partial<Record<keyof Url, string>> = {}
    for (const nome of ['preview', 'staging', 'production'] as const)
      backends[nome] = (await inspecionar(page, u[nome])).apiUrl
    for (const nome of ['preview', 'staging', 'production'] as const) {
      const demais = Object.entries(backends)
        .filter(([n]) => n !== nome)
        .map(([, b]) => b!)
      await inspecionar(page, u[nome], demais)
    }
  })

  test('fase: Produção depois do rollback é idêntica à de antes', async ({ page }) => {
    test.skip(FASE !== 'after-rollback')
    expect(existsSync(ESTADO ?? ''), 'rode a fase baseline antes').toBe(true)
    const antes = JSON.parse(readFileSync(ESTADO!, 'utf8')) as Inspecao
    const depois = await inspecionar(page, urls().production)
    expect(voltouAoEstadoConhecido(antes, depois)).toBe(true)
  })
})
