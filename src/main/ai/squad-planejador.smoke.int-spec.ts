/**
 * Smoke real do planejador do Squad contra o Ollama (SPEC-Squads-02 § Testes e evidência).
 *
 * Roda **só** com `JARVIS_SMOKE_OLLAMA=1`, o servidor de pé e o modelo baixado — nunca na suíte
 * comum. Ausente é `not_run`, nunca `pass` (`describe.skipIf`, para a ausência ficar registrada
 * como skipped).
 *
 * ## O que este smoke prova, e o que o dublê não provaria
 *
 * Os testes do planejador usam geradores roteirizados: as respostas são as que eu escrevi. Este
 * arquivo roda o `qwen3:8b` de verdade pelo `OllamaAdapter` e verifica o que só o servidor real
 * pode dizer:
 *
 *  - que o Ollama **aceita** `format` + `think: false` + `num_ctx` no corpo que montamos;
 *  - que a saída vem **no esquema** — nenhuma proposta rejeitada por `SCHEMA` (é o `format` valendo,
 *    e não um JSON que "por sorte" parseou);
 *  - que a janela pedida é a que o servidor **carregou** (`/api/ps`), não só a que mandamos.
 *
 * **Não exige que o plano seja aceito.** A M11-F00 mediu 58,8% de aceite para este modelo; afirmar
 * aceite aqui seria uma asserção de latência e de sorte, não de contrato. O que o smoke afirma é
 * o contrato do gerador, e o resultado do ciclo fica impresso para quem for olhar.
 */

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { AuditEventInput } from '@shared/domain/entities'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import { PERFIL_PADRAO } from '@shared/domain/squad-perfil'
import type { PerfilDeSquad } from '@shared/domain/squad-perfil'
import { OllamaAdapter } from './ollama-adapter'
import { GeradorViaPontoUnico } from '../squads/squad-gerador'
import type { ChamadorDeIa } from '../squads/squad-gerador'
import { planejarSquad } from '../squads/squad-planejador'
import { criarSnapshotDoSquad } from '../squads/squad-snapshot'

const MODELO = 'qwen3:8b'
const NUM_CTX = 8192
const habilitado = process.env.JARVIS_SMOKE_OLLAMA === '1'

async function modeloDisponivel(): Promise<boolean> {
  if (!habilitado) return false
  try {
    const resposta = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(2_000)
    })
    const corpo = (await resposta.json()) as { models?: { name?: string }[] }
    return (corpo.models ?? []).some((m) => m.name === MODELO)
  } catch {
    return false
  }
}

const pronto = await modeloDisponivel()

/** O ponto único, reduzido ao Ollama real: o mesmo `AdapterRequest` que o `AiCallService` montaria. */
const viaOllama: ChamadorDeIa = {
  call(request: AiRequest): AsyncIterable<AiStreamEvent> {
    return (async function* () {
      try {
        const stream = new OllamaAdapter().generateStream({
          model: request.model ?? MODELO,
          prompt: request.prompt,
          ...(request.system === undefined ? {} : { system: request.system }),
          maxTokens: request.maxTokens ?? 4096,
          timeoutMs: 240_000,
          ...(request.opcoesLocais === undefined ? {} : { opcoesLocais: request.opcoesLocais })
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

const PERFIL_LOCAL: PerfilDeSquad = {
  ...PERFIL_PADRAO,
  camadas: {
    ...PERFIL_PADRAO.camadas,
    orquestrador: {
      origem: 'modelo',
      provider: 'ollama',
      modelo: MODELO,
      validador: 'e1',
      numCtx: NUM_CTX
    }
  }
}

describe.skipIf(!pronto)('planejador do Squad — smoke real (Ollama + qwen3:8b)', () => {
  it('o servidor aceita formato, think e num_ctx; a saída vem no esquema; a janela é a pedida', async () => {
    const FASE = { provider: 'claude-code', modelo: 'claude-fable-5-1' } as const
    const snapshot = criarSnapshotDoSquad(
      PERFIL_LOCAL,
      {
        skills: [],
        ferramentas: [],
        ollama: { disponivel: true, modelos: [MODELO] },
        optInApiPaga: false
      },
      FASE
    )
    const arquivos = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\n')
      .filter((f) => f !== '')

    const local = new GeradorViaPontoUnico(
      'local',
      { provider: 'ollama', modelo: MODELO },
      viaOllama,
      { userId: 'smoke', workspace: 'jarvis' },
      { contextPackId: 'pack-smoke', runId: 'run-smoke' }
    )
    // A fase fica de fora: este smoke mede o local. Falhar aqui é o que o planejador espera dela.
    const fase = new GeradorViaPontoUnico(
      'fase',
      FASE,
      {
        call: () =>
          (async function* (): AsyncIterable<AiStreamEvent> {
            yield { tipo: 'fim', id: 's', estado: 'falhou', erro: 'fase fora do smoke' }
          })()
      },
      { userId: 'smoke', workspace: 'jarvis' },
      { contextPackId: 'pack-smoke', runId: 'run-smoke' }
    )

    const eventos: AuditEventInput[] = []
    const resultado = await planejarSquad(
      {
        geradorLocal: local,
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

    const ps = (await (await fetch('http://127.0.0.1:11434/api/ps')).json()) as {
      models?: { name?: string; context_length?: number }[]
    }
    const carregado = (ps.models ?? []).find((m) => m.name === MODELO)

    // Fica impresso para quem for olhar: é o que o relatório da fatia cita.
    console.info(
      JSON.stringify({
        ok: resultado.ok,
        motivo: resultado.ok ? undefined : resultado.motivo,
        historico: resultado.historico.map((h) => ({
          gerador: h.gerador,
          tentativa: h.tentativa,
          resultado: h.resultado,
          motivos: h.rejeicoes.map((r) => r.motivo)
        })),
        numCtxCarregado: carregado?.context_length
      })
    )

    const doLocal = resultado.historico.filter((h) => h.gerador === 'local')
    expect(doLocal.length).toBeGreaterThan(0)
    // O local respondeu (não foi `indisponivel`): o corpo que montamos foi aceito pelo servidor.
    expect(doLocal.every((h) => h.resultado !== 'indisponivel')).toBe(true)
    // `format` valendo: nenhuma proposta caiu por esquema.
    expect(doLocal.flatMap((h) => h.rejeicoes).some((r) => r.motivo === 'SCHEMA')).toBe(false)
    // A janela carregada é a pedida.
    expect(carregado?.context_length).toBe(NUM_CTX)
    // Toda proposta ficou auditada por hash.
    expect(eventos.filter((e) => e.type === 'squad-plan-rejeitado').length).toBe(
      doLocal.filter((h) => h.resultado === 'rejeitada').length
    )
  }, 420_000)
})
