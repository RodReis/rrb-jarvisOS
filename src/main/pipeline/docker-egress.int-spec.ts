/**
 * O egress do sandbox contra o Docker real (SPEC-Entrega-03, critério 12; issue #222).
 *
 * A prova que só este nível alcança: que `api.github.com` está **genuinamente** inalcançável de
 * dentro do container do executor, e que o proxy (via sidecar) está. Um teste que só inspecionasse
 * os argumentos do `docker run` provaria a intenção, não a garantia — foi medindo com Docker real
 * que a tentativa original (`--network none`/`--internal` sozinha) foi descartada: as duas também
 * cortavam o proxy, e só um container de verdade revela isso.
 *
 * Segue o padrão do RLS do Supabase (`tests/supabase/rls.int-spec.ts`): no CI, Docker é obrigatório
 * e a ausência vira falha alta, não `skip` silencioso — senão o relatório contaria o critério 12
 * como coberto sem tê-lo exercitado. Localmente, sem Docker, os testes pulam com motivo.
 */

import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  nomeDaRedeDeEgress,
  nomeDoProxyDeEgress,
  PORTA_DO_PROXY_DE_EGRESS
} from '@shared/domain/preflight'

function docker(args: readonly string[]): { readonly ok: boolean; readonly saida: string } {
  try {
    return { ok: true, saida: execFileSync('docker', [...args], { encoding: 'utf8' }) }
  } catch (erro) {
    return { ok: false, saida: erro instanceof Error ? erro.message : String(erro) }
  }
}

let dockerNoAr = false

beforeAll(() => {
  dockerNoAr = docker(['info', '--format', '{{.ServerVersion}}']).ok

  // No CI a garantia é obrigatória — sem Docker, `skip` esconderia que o critério 12 nunca foi
  // exercitado, e o relatório contaria "egress restrito" como provado sem tê-lo medido.
  if (!dockerNoAr && process.env.CI) {
    throw new Error(
      'Docker não respondeu. No CI o daemon é obrigatório — verifique o runner e o step do job.'
    )
  }
}, 30_000)

describe('egress do sandbox (critério 12)', () => {
  it('api.github.com é inalcançável e o sidecar de proxy é alcançável, de dentro da rede de egress', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar — rode `docker info` para confirmar')

    const runId = `test-${randomUUID().slice(0, 8)}`
    const rede = nomeDaRedeDeEgress(runId)
    const sidecar = nomeDoProxyDeEgress(runId)
    // Um "proxy do host" de mentira: um container comum na rede padrão, que o sidecar deve
    // alcançar via `host.docker.internal` — mas o teste não depende do host de verdade, só do
    // sidecar encaminhar para algo que existe na rede que ele tem rota até.
    const alvoFalso = `test-alvo-${randomUUID().slice(0, 8)}`

    try {
      // A rede `--internal`: sem ela não há isolamento nenhum a medir.
      expect(docker(['network', 'create', '--internal', rede]).ok).toBe(true)

      // O alvo: um container comum, alcançável pela bridge padrão — fica no papel do
      // "host.docker.internal" real sem depender do host desta máquina de CI.
      expect(
        docker([
          'run',
          '--detach',
          '--name',
          alvoFalso,
          'alpine/socat:1.8.0.1',
          'TCP-LISTEN:9000,fork,reuseaddr',
          'EXEC:cat'
        ]).ok
      ).toBe(true)
      const alvoIp = docker([
        'inspect',
        '--format',
        '{{.NetworkSettings.Networks.bridge.IPAddress}}',
        alvoFalso
      ]).saida.trim()

      // O sidecar: nasce na rede de egress, depois ganha pé na bridge — o padrão dual-homed
      // que fecha o circuito sem dar ao executor rota nenhuma para fora da rede `--internal`.
      expect(
        docker([
          'run',
          '--detach',
          '--name',
          sidecar,
          '--network',
          rede,
          'alpine/socat:1.8.0.1',
          `TCP-LISTEN:${PORTA_DO_PROXY_DE_EGRESS},fork,reuseaddr`,
          `TCP:${alvoIp}:9000`
        ]).ok
      ).toBe(true)
      expect(docker(['network', 'connect', 'bridge', sidecar]).ok).toBe(true)

      // O DNS embutido do Docker (127.0.0.11) não resolve nome de container dentro de uma rede
      // `--internal` — medido: toda consulta volta SERVFAIL, mesmo entre dois membros da mesma
      // rede. Por isso o executor real recebe o **IP** do sidecar, nunca o nome — e é o que este
      // teste mede também.
      const parsed = JSON.parse(docker(['inspect', sidecar]).saida) as ReadonlyArray<{
        readonly NetworkSettings: {
          readonly Networks: Record<string, { readonly IPAddress: string }>
        }
      }>
      const sidecarIpNaRede = parsed[0]?.NetworkSettings.Networks[rede]?.IPAddress
      expect(sidecarIpNaRede).toBeTruthy()

      // O executor: só na rede de egress, como `DockerRunner.subir` monta de verdade. A sonda é
      // o próprio `socat` como cliente (`-T2 ...,connect-timeout=2 -`): conecta e fecha sozinho,
      // sem depender de `/dev/tcp` — que não existe no `sh` desta imagem (medido: toda tentativa
      // com ele falha por "nonexistent directory", conectividade real ou não, e mascararia os
      // dois casos como iguais).
      //
      // `api.github.com` precisa estar genuinamente inalcançável — não recusado por falta de
      // credencial, mas por não haver rota nenhuma até ele: nem o DNS resolve (medido) dentro da
      // rede `--internal`, e é essa falha de resolução que o código de saída != 0 aqui mede.
      const semGithub = docker([
        'run',
        '--rm',
        '--network',
        rede,
        'alpine/socat:1.8.0.1',
        '-T2',
        'TCP:api.github.com:443,connect-timeout=2',
        '-'
      ])
      expect(semGithub.ok).toBe(false)

      // O sidecar, por outro lado, é alcançável por IP — é o único destino que a rede de egress
      // dá, e a única forma de o alcançar: o DNS interno do Docker não resolve nome de container
      // dentro de uma rede `--internal` (medido: SERVFAIL mesmo entre dois membros dela).
      const comSidecar = docker([
        'run',
        '--rm',
        '--network',
        rede,
        'alpine/socat:1.8.0.1',
        '-T2',
        `TCP:${sidecarIpNaRede}:${PORTA_DO_PROXY_DE_EGRESS},connect-timeout=2`,
        '-'
      ])
      expect(comSidecar.ok).toBe(true)
    } finally {
      docker(['rm', '-f', sidecar])
      docker(['rm', '-f', alvoFalso])
      docker(['network', 'rm', rede])
    }
  }, 60_000)
})
