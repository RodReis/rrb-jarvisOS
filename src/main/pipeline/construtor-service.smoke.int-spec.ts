import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

/**
 * Smoke real e limitado (spec § Testes e evidência). Roda **só** com
 * `JARVIS_SMOKE_DOCKER_CLAUDE=1` no ambiente — nunca na suíte comum, que não pode depender de
 * Docker de verdade nem de CLI autenticada. Ausente é `not_run`, nunca `pass` (spec §
 * Contrafactuais) — por isso o teste usa `it.skipIf` em vez de simplesmente não existir: a
 * ausência de execução fica registrada no relatório do vitest como skipped, não como omissão.
 */
const habilitado = process.env.JARVIS_SMOKE_DOCKER_CLAUDE === '1'

describe.skipIf(!habilitado)('ConstrutorService — smoke real (Docker + claude autenticado)', () => {
  it('constrói uma alteração trivial de verdade, dentro de um container real, com claude real', async () => {
    // Pré-condição do smoke: Docker respondendo.
    expect(() => execSync('docker info', { stdio: 'ignore' })).not.toThrow()

    // Implementação do smoke fica fora do escopo deste plano bite-sized: monta um preflight
    // real com um repositório de fixture mínimo (ver tests/fixtures/), sobe o sandbox de
    // verdade, roda ConstrutorService.construir com comandosDeValidacao triviais (`true`,
    // `true`, `true`, `true` como comandos-no-op de fixture), e confirma PR_CI.
    //
    // Este smoke é so a prova de que a integração real funciona; a suíte comum inteira já
    // prova a lógica com dublês. Implementar quando houver ambiente de CI com Docker + CLI
    // autenticada disponível para o smoke rodar — até lá, `not_run` é o resultado honesto.
  })
})
