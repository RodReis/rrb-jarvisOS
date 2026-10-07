import lock from '../../../docker/squad-executor/image-lock.json' with { type: 'json' }

const VERSAO_FIXADA = '2.1.278'
const IMAGEM_FIXADA = 'jarvisos/squad-executor:claude-code-2.1.278'

if (lock.version !== VERSAO_FIXADA || lock.image !== IMAGEM_FIXADA) {
  throw new Error('O lock da imagem do Squad diverge da versão de produção fixada.')
}

/** Imagem construída localmente para os escritores do Squad (SPEC-Squads-03). */
export const CLAUDE_CODE_VERSION = VERSAO_FIXADA
export const CLAUDE_CODE_LINUX_X64_SHA256 = lock.linuxX64Sha256
export const IMAGEM_DO_SQUAD = IMAGEM_FIXADA
export type ImagemDoSquad = typeof IMAGEM_DO_SQUAD
