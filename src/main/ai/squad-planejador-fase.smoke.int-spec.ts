/**
 * Smoke real do planejador do Squad pelo **modelo da fase** (SPEC-Squads-02 § Testes e evidência).
 *
 * Roda **só** com `JARVIS_SMOKE_FASE=1` e o `claude` instalado e autenticado (rota de assinatura,
 * sem custo por chamada) — nunca na suíte comum. Ausente é `not_run`, nunca `pass`.
 *
 * ## O que este smoke prova, e o que o dublê não provaria
 *
 * O gerador da fase é o caminho **padrão** do orquestrador (PI, 2026-10-02). Os testes unitários o
 * exercitam com um ponto único falso. Aqui o `ClaudeCodeAdapter` de verdade recebe o pedido que o
 * gerador monta, e o que só o CLI pode dizer é medido:
 *
 *  - que ele aceita os argumentos do isolamento (`--tools ""`, `--json-schema`) para a fase
 *    declarada — sem a fase, o adapter devolve os args base e o orquestrador rodaria com
 *    ferramentas sobre texto de SPEC e de repositório;
 *  - que o plano volta no esquema (nenhuma proposta rejeitada por `SCHEMA`);
 *  - que o validador **estrito** da F02 (capacidade por papel, schema por capacidade, escritor,
 *    path plausível) é satisfazível pelo modelo da fase com o pedido real.
 *
 * Não afirma aceite — afirma o contrato e imprime o desfecho. A M11-F00 mediu 17/17 para a fase
 * com o validador mínimo; o validador de agora é mais estrito, e o número novo é o que a F00b mede.
 */

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { AuditEventInput } from '@shared/domain/entities'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import { PERFIL_PADRAO } from '@shared/domain/squad-perfil'
import { GeradorViaPontoUnico } from '../squads/squad-gerador'
import type { ChamadorDeIa } from '../squads/squad-gerador'
import { planejarSquad } from '../squads/squad-planejador'
import { criarSnapshotDoSquad } from '../squads/squad-snapshot'
import { BINARIO, ClaudeCodeAdapter } from './claude-code-adapter'
import { runsDeTeste } from './cwd-neutro.test-helper'

const habilitado = process.env.JARVIS_SMOKE_FASE === '1'
const MODELO = 'claude-fable-5-1'

const cliInstalado = ((): boolean => {
  if (!habilitado) return false
  try {
    execFileSync(BINARIO, ['--version'], { stdio: 'ignore', shell: false })
    return true
  } catch {
    return false
  }
})()

/** O ponto único reduzido ao CLI real: o `AdapterRequest` que o `AiCallService` montaria. */
const viaCli: ChamadorDeIa = {
  call(request: AiRequest): AsyncIterable<AiStreamEvent> {
    return (async function* () {
      try {
        const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir)
        const stream = adapter.generateStream({
          model: request.model ?? MODELO,
          prompt: request.prompt,
          ...(request.system === undefined ? {} : { system: request.system }),
          ...(request.fase === undefined ? {} : { fase: request.fase }),
          ...(request.jsonSchema === undefined ? {} : { jsonSchema: request.jsonSchema }),
          maxTokens: request.maxTokens ?? 4096,
          timeoutMs: 280_000
        })
        for await (const chunk of stream) {
          if (chunk.tipo === 'texto') yield { tipo: 'chunk', id: 's', texto: chunk.texto }
        }
        yield { tipo: 'fim', id: 's', estado: 'concluido' }
      } catch (erro) {
        yield {
          tipo: 'fim',
          id: 's',
          estado: 'falhou',
          erro: erro instanceof Error ? erro.message : 'falhou'
        }
      }
    })()
  }
}

describe.skipIf(!cliInstalado)('planejador do Squad — smoke real (modelo da fase pelo CLI)', () => {
  it('o CLI aceita o isolamento, devolve o plano no esquema e o validador estrito o julga', async () => {
    const FASE = { provider: 'claude-code', modelo: MODELO } as const
    const snapshot = criarSnapshotDoSquad(
      PERFIL_PADRAO,
      {
        skills: [],
        ferramentas: [],
        ollama: { disponivel: false, modelos: [] },
        optInApiPaga: false
      },
      FASE
    )
    const arquivos = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\n')
      .filter((f) => f !== '')

    const fase = new GeradorViaPontoUnico(
      'fase',
      FASE,
      viaCli,
      { userId: 'smoke', workspace: 'jarvis' },
      { contextPackId: 'pack-smoke', runId: 'run-smoke' }
    )
    const eventos: AuditEventInput[] = []

    const resultado = await planejarSquad(
      {
        geradorFase: fase,
        auditoria: { append: (e) => void eventos.push(e) },
        escopo: { userId: 'smoke', workspaceId: 'jarvis' }
      },
      {
        runId: 'run-smoke',
        specRevisao: 'smoke',
        spec: {
          titulo: 'SPEC-Squads-01 — Capacidades, perfis e camadas de modelo',
          criterios: [
            {
              numero: 1,
              texto: 'Perfis são versionados, validados e reproduzíveis pela revisão registrada.'
            },
            {
              numero: 2,
              texto: 'A resolução informa implementação, fallback ou motivo de indisponibilidade.'
            },
            {
              numero: 3,
              texto: 'O perfil rejeita mais de 2 escritores e permissão de Git ou GitHub.'
            }
          ]
        },
        snapshot,
        base: {
          pathsPermitidos: ['src/shared/domain', 'src/main/squads'],
          fontesPermitidas: ['docs', 'src'],
          arquivosDaBase: arquivos,
          orcamentoUsd: 1
        }
      }
    )

    console.info(
      JSON.stringify({
        ok: resultado.ok,
        motivo: resultado.ok ? undefined : resultado.motivo,
        planoHash: resultado.ok ? resultado.planoHash : undefined,
        tarefas: resultado.ok ? resultado.plano.tarefas.length : undefined,
        historico: resultado.historico.map((h) => ({
          tentativa: h.tentativa,
          resultado: h.resultado,
          motivos: h.rejeicoes.map((r) => r.motivo)
        }))
      })
    )

    // O CLI respondeu: o isolamento foi aceito (senão a chamada falharia e viria `indisponivel`).
    expect(resultado.historico.some((h) => h.resultado === 'indisponivel')).toBe(false)
    // Esquema imposto pelo CLI: nenhuma proposta caiu por `SCHEMA`.
    expect(resultado.historico.flatMap((h) => h.rejeicoes).some((r) => r.motivo === 'SCHEMA')).toBe(
      false
    )
    // Toda proposta ficou auditada.
    expect(eventos.length).toBeGreaterThan(0)
  }, 900_000)
})
