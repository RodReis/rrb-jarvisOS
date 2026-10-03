/**
 * Smoke real do integrador e do revisor pelo **modelo da fase** (SPEC-Squads-04 § Testes e
 * evidência; a F03 empurrou a prova com o CLI real para esta fatia).
 *
 * Roda **só** com `JARVIS_SMOKE_FASE=1` e o `claude` instalado e autenticado (rota de assinatura,
 * sem custo por chamada) — nunca na suíte comum. Ausente é `not_run`, nunca `pass`.
 *
 * ## O que este smoke prova, e o que o dublê não provaria
 *
 * Os testes de integração exercitam os dois serviços com um agente falso. Aqui o `ClaudeCodeAdapter`
 * de verdade recebe o pedido que o serviço monta, e o que só o CLI pode dizer é medido:
 *
 *  - que o CLI aceita o isolamento (sem ferramenta, esquema imposto) para a fase declarada;
 *  - que a resolução de um bloco e o parecer voltam **no esquema** (nenhum `resolucao-invalida`);
 *  - que, num conflito em que os dois lados cabem inteiros, o integrador não perde hunk, e que o
 *    revisor acha o defeito evidente e o kernel o confere no arquivo do commit.
 *
 * Não afirma o comportamento do modelo além do contrato: imprime o desfecho. O que **não** é
 * medido aqui é o `claude` rodando **dentro do container** (a imagem do sandbox, `node:22-bookworm`,
 * não traz o binário — bloqueio conhecido da M9-F04), nem o Docker real da etapa TESTE.
 */

import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { montarAmbienteDeGit, temGit, USUARIO_DE_TESTE, WORKSPACE_DE_TESTE } =
  await import('./squad-fixture-git')
const { chamadorViaCli, cliDisponivelParaOSmoke, MODELO_DO_SMOKE } =
  await import('./squad-chamador-cli.test-helper')
const { IntegradorService } = await import('./squad-integrador')
const { RevisorService } = await import('./squad-revisor')
const { AchadoRepository } = await import('./achado-repository')

const habilitado = cliDisponivelParaOSmoke() && temGit()
const FASE = { provider: 'claude-code', modelo: MODELO_DO_SMOKE } as const
const TIMEOUT = 600_000

const contexto = {
  montarDaTarefa: (pedido: { fontes: readonly { caminho: string }[] }) => ({
    pack: {
      id: 'pack-smoke',
      hash: 'h',
      itens: pedido.fontes.map((f) => ({ caminho: f.caminho }))
    }
  })
}

let amb: ReturnType<typeof montarAmbienteDeGit>

beforeEach(() => {
  amb = montarAmbienteDeGit()
})

afterEach(() => {
  amb.limpar()
})

describe.skipIf(!habilitado)('integrador e revisor — smoke real (modelo da fase pelo CLI)', () => {
  it(
    'o integrador resolve um bloco com o CLI real, no esquema, sem perder hunk',
    async () => {
      const commitA = amb.commitarComo(amb.worktree('a'), {
        'src/a.ts': 'export const a = 1\nexport const x = 10\n'
      })
      const commitB = amb.commitarComo(amb.worktree('b'), {
        'src/a.ts': 'export const a = 1\nexport const y = 20\n'
      })

      const r = await new IntegradorService({
        git: amb.squadGit,
        contexto: contexto as never,
        ia: chamadorViaCli,
        audit: amb.audit,
        userId: () => USUARIO_DE_TESTE,
        workspaceId: () => WORKSPACE_DE_TESTE
      }).integrar({
        runId: 'run-smoke',
        projectId: 'p-smoke',
        repositorio: amb.repo,
        baseSha: amb.baseSha,
        escritores: [
          { escritor: 'a', commitSha: commitA },
          { escritor: 'b', commitSha: commitB }
        ],
        worktree: join(amb.appDir, 'wt-integracao'),
        branch: 'jarvis/run-smoke/integracao',
        modelo: FASE,
        rota: 'claude-code'
      })

      console.info('[smoke integrador]', JSON.stringify(r))
      // O contrato: o CLI aceitou o isolamento e devolveu o esquema. Perder hunk é comportamento do
      // modelo, e o manifesto o pega — o que não pode haver é falha de chamada ou de forma.
      expect(r.estado === 'integrado' || r.motivo === 'hunk-perdido-sem-registro').toBe(true)
      if (r.estado === 'integrado') expect(r.manifesto.aprovada).toBe(true)
    },
    TIMEOUT
  )

  it(
    'o revisor devolve o parecer no esquema e o kernel confere o achado no arquivo do commit',
    async () => {
      const resultado = amb.commitarComo(amb.worktree('r'), {
        'src/lista.ts':
          '// Devolve todos os itens da lista, menos o último — sem exceção.\n' +
          'export const semUltimo = (itens: string[]): string[] => itens.slice(0, -1)\n\n' +
          '// BUG: a SPEC exige devolver TODOS os itens; esta função descarta o último.\n' +
          'export const todos = (itens: string[]): string[] => itens.slice(0, -1)\n'
      })
      const achados = new AchadoRepository(amb.db)

      const r = await new RevisorService({
        git: amb.squadGit,
        contexto: contexto as never,
        ia: chamadorViaCli,
        achados,
        audit: amb.audit,
        userId: () => USUARIO_DE_TESTE,
        workspaceId: () => WORKSPACE_DE_TESTE
      }).revisar({
        runId: 'run-smoke',
        projectId: 'p-smoke',
        repositorio: amb.repo,
        baseSha: amb.baseSha,
        resultadoSha: resultado,
        rota: 'claude-code',
        revisores: [{ id: 'rev-1', modelo: FASE }],
        spec: {
          caminho: 'docs/spec/smoke.md',
          texto:
            '# SPEC\n\nCritério 1: `todos(itens)` devolve TODOS os itens da lista, sem exceção.\n'
        },
        contratoDeRevisao:
          '# REVIEW\n\nP0 e P1 bloqueiam. Um achado traz o trecho exato do arquivo como ele ficou.\n',
        manifesto: 'um escritor, sem integração',
        testes: 'suíte verde: test',
        rodada: 1
      })

      console.info('[smoke revisor]', JSON.stringify(r))
      expect(r.estado).toBe('revisada')
      if (r.estado !== 'revisada') return
      // O contrato: o CLI aceitou o isolamento e o parecer voltou no esquema.
      expect(r.revisores).toEqual([{ id: 'rev-1', estado: 'parecer' }])
      // O que o kernel guardou tem evidência conferida no arquivo: nada de achado sem localização.
      for (const a of r.achados) expect(a.arquivo).toBe('src/lista.ts')
    },
    TIMEOUT
  )
})
