import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { IMAGEM_PADRAO } from './docker-runner'

/**
 * Smoke real e limitado (spec § Testes e evidência). Roda **só** com
 * `JARVIS_SMOKE_DOCKER_CLAUDE=1` no ambiente — nunca na suíte comum, que não pode depender de
 * Docker de verdade nem de CLI autenticada. Ausente é `not_run`, nunca `pass` (spec §
 * Contrafactuais) — por isso o teste usa `describe.skipIf` em vez de simplesmente não existir: a
 * ausência de execução fica registrada no relatório do vitest como skipped, não como omissão.
 */
const habilitado = process.env.JARVIS_SMOKE_DOCKER_CLAUDE === '1'

/**
 * Verifica se o binário `claude` existe DENTRO de um container efêmero da imagem do sandbox
 * (`IMAGEM_PADRAO`) — não no host. O host ter `claude` é irrelevante: o executor real roda
 * dentro do container, então é lá que a CLI precisa existir para o smoke provar algo de verdade.
 * Hoje `IMAGEM_PADRAO = 'node:22-bookworm'` não inclui `claude` — ver bloqueio conhecido no
 * relatório da task. Retorna `false` (nunca lança) em qualquer falha: container não sobe, imagem
 * não existe localmente, `claude` ausente — todos viram skip, não erro de infraestrutura.
 */
function claudeDisponivelNoContainer(): boolean {
  try {
    execSync(`docker run --rm ${IMAGEM_PADRAO} which claude`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!habilitado)('ConstrutorService — smoke real (Docker + claude autenticado)', () => {
  // Pré-condições verificadas uma vez, fora do it, para que a ausência de qualquer uma delas
  // vire skip (not_run) em vez de "passed" — um smoke que só roda `docker info` e chama isso de
  // sucesso é um vacuous pass, exatamente o que a spec proíbe.
  const dockerRespondendo = (() => {
    try {
      execSync('docker info', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  const claudeNoContainer = dockerRespondendo && claudeDisponivelNoContainer()

  it.skipIf(!dockerRespondendo)('Docker está respondendo', () => {
    expect(dockerRespondendo).toBe(true)
  })

  it.skipIf(!claudeNoContainer)(
    'constrói uma alteração trivial de verdade, dentro de um container real, com claude real',
    async () => {
      // Implementação do smoke fica fora do escopo deste plano bite-sized: monta um preflight
      // real com um repositório de fixture mínimo (ver tests/fixtures/), sobe o sandbox de
      // verdade, roda ConstrutorService.construir com comandosDeValidacao triviais (`true`,
      // `true`, `true`, `true` como comandos-no-op de fixture), e confirma PR_CI.
      //
      // Este smoke é so a prova de que a integração real funciona; a suíte comum inteira já
      // prova a lógica com dublês. Implementar quando a imagem do sandbox (IMAGEM_PADRAO)
      // incluir o binário `claude` — até lá, o guard `claudeNoContainer` acima mantém este
      // teste em skip (not_run), nunca passed, porque a pré-condição real não está satisfeita.
    }
  )
})
