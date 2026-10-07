import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, expect, test } from '@playwright/test'
import type { JarvisBridge } from '../../src/shared/contracts/ipc'

test('a ponte real recusa play múltiplo fora do projeto e não cria runs', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-quadro-'))
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...ambiente, NODE_ENV: 'development', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }
  })

  try {
    const janela = await app.firstWindow()
    await janela.waitForLoadState('domcontentloaded')
    const resultado = await janela.evaluate(async () => {
      const ponte = (window as unknown as { jarvis: JarvisBridge }).jarvis
      const antes = await ponte.quadroDeExecucao('inexistente', 'jarvis')
      const play = await ponte.playNoQuadro(
        { projectId: 'inexistente', sliceIds: ['f1', 'f2', 'f3'] },
        'jarvis'
      )
      const depois = await ponte.quadroDeExecucao('inexistente', 'jarvis')
      return { antes, play, depois }
    })

    expect(resultado.antes.colunas).toHaveLength(7)
    expect(resultado.play).toHaveLength(3)
    expect(resultado.play.every((item) => item.estado === 'recusado')).toBe(true)
    expect(resultado.depois.colunas.every((coluna) => coluna.cartoes.length === 0)).toBe(true)
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
  }
})
