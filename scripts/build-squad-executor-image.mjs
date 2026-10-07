import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(
  readFileSync(resolve(raiz, 'docker/squad-executor/image-lock.json'), 'utf8')
)

if (
  typeof lock.version !== 'string' ||
  !/^\d+\.\d+\.\d+$/.test(lock.version) ||
  typeof lock.linuxX64Sha256 !== 'string' ||
  !/^[a-f0-9]{64}$/.test(lock.linuxX64Sha256) ||
  lock.image !== `jarvisos/squad-executor:claude-code-${lock.version}`
) {
  process.stderr.write('O lock da imagem do Squad é inválido.\n')
  process.exit(1)
}

const resultado = spawnSync(
  'docker',
  [
    'build',
    '--file',
    resolve(raiz, 'docker/squad-executor/Dockerfile'),
    '--tag',
    lock.image,
    '--build-arg',
    `CLAUDE_CODE_VERSION=${lock.version}`,
    '--build-arg',
    `CLAUDE_CODE_LINUX_X64_SHA256=${lock.linuxX64Sha256}`,
    raiz
  ],
  { stdio: 'inherit', shell: false }
)

if (resultado.error) {
  process.stderr.write(`Não foi possível executar o Docker: ${resultado.error.name}.\n`)
  process.exit(1)
}
process.exit(resultado.status ?? 1)
