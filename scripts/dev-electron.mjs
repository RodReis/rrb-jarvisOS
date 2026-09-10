import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const cli = resolve('node_modules/electron-vite/bin/electron-vite.js')
const child = spawn(process.execPath, [cli, 'dev'], {
  env,
  stdio: 'inherit',
  shell: false
})

child.on('error', (error) => {
  console.error(`[dev-electron] falhou ao iniciar electron-vite: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
