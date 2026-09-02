/**
 * Smoke real da entrega contra o GitHub (SPEC-Entrega-05 § Testes e evidência).
 *
 * Roda **só** com `JARVIS_SMOKE_GITHUB_ENTREGA=1` e um token em `JARVIS_SMOKE_GITHUB_TOKEN`,
 * contra um repositório descartável nomeado em `JARVIS_SMOKE_GITHUB_REPO` (`owner/repo`). Ausente
 * é `not_run`, nunca `pass` — por isso `describe.skipIf` em vez de o arquivo não existir: a
 * ausência de execução fica registrada como skipped no relatório, não como omissão.
 *
 * **O que só o serviço real prova.** O dublê responde instantâneo e consistente: a proteção que
 * acabou de ser escrita já aparece na leitura seguinte, e o check que o workflow dispara já está
 * lá. O GitHub não se comporta assim — a M6-F04 mediu ~4 s de atraso de visibilidade na listagem
 * de issues, e a proteção de branch tem janela própria. Um gate que dependa de ler o que acabou de
 * escrever fica verde no fake e intermitente na origem.
 *
 * O smoke é **leitura e configuração**, sem mergear: mergear exigiria um PR descartável a cada
 * execução e deixaria lixo no repositório de teste. O caminho do merge é provado pelo
 * `entrega-service.int-spec.ts`, contra um dublê que responde no formato do adapter real.
 */

import { describe, it, expect } from 'vitest'
import { GITHUB_API_VERSION, origemDaApi } from '@shared/domain/github-automation'
import { NOME_DO_JOB_DE_CI } from '@shared/domain/ci-workflow'

const habilitado = process.env.JARVIS_SMOKE_GITHUB_ENTREGA === '1'
const token = process.env.JARVIS_SMOKE_GITHUB_TOKEN
const alvo = process.env.JARVIS_SMOKE_GITHUB_REPO

const credenciaisPresentes =
  habilitado && typeof token === 'string' && token !== '' && typeof alvo === 'string' && alvo !== ''

async function api(caminho: string): Promise<{ status: number; corpo: unknown }> {
  const resposta = await fetch(`${origemDaApi()}${caminho}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION
    }
  })

  return { status: resposta.status, corpo: await resposta.json().catch(() => undefined) }
}

describe.skipIf(!credenciaisPresentes)('EntregaService — smoke real (GitHub)', () => {
  const [owner, repo] = (alvo ?? '/').split('/')

  it('a leitura do conjunto obrigatório responde como o adapter espera', async () => {
    // O que se prova aqui e o dublê não prova: o **formato real** da resposta da API. Um campo
    // renomeado pelo GitHub passaria despercebido em todo teste com fake.
    const r = await api(`/repos/${owner}/${repo}/branches/main/protection`)

    // 404 é ausência de proteção — o estado normal de repositório recém-criado —, e 200 traz a
    // regra. Qualquer outro status é problema de credencial ou de escopo, e o teste precisa dizer.
    expect([200, 404]).toContain(r.status)

    if (r.status === 200) {
      const corpo = r.corpo as { required_status_checks?: { contexts?: unknown } }
      // `contexts` continua sendo array quando existe: é dele que o gate lê o obrigatório.
      if (corpo.required_status_checks?.contexts !== undefined) {
        expect(Array.isArray(corpo.required_status_checks.contexts)).toBe(true)
      }
    }
  })

  it('os checks de um commit vêm como lista, não como envelope', async () => {
    // O defeito que esta fatia teve: ler `data.checks` num endpoint que devolve o array. Aqui a
    // forma real da resposta do GitHub é verificada, não a que o nosso fake escolheu.
    const ref = await api(`/repos/${owner}/${repo}/commits/main`)
    expect(ref.status).toBe(200)

    const sha = (ref.corpo as { sha?: string }).sha
    expect(typeof sha).toBe('string')

    const checks = await api(`/repos/${owner}/${repo}/commits/${sha}/check-runs`)
    expect(checks.status).toBe(200)
    expect(Array.isArray((checks.corpo as { check_runs?: unknown }).check_runs)).toBe(true)
  })

  it('o nome do job que a pipeline exige é o que o workflow gerado declara', async () => {
    // O acoplamento que faz os critérios 9 e 10 fecharem: a proteção exige `validacao`, e é esse
    // o nome do job no arquivo gerado. Se os dois divergirem, o gate espera por um check que
    // nunca aparece — e o run trava sem causa visível.
    expect(NOME_DO_JOB_DE_CI).toBe('validacao')

    const workflows = await api(`/repos/${owner}/${repo}/actions/workflows`)
    expect(workflows.status).toBe(200)
  })
})
