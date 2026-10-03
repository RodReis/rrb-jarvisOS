/**
 * O ponto único de IA reduzido ao `claude` CLI real, para os smokes opt-in dos Squads.
 *
 * É o `AdapterRequest` que o `AiCallService` montaria: a fase, o `jsonSchema` e o prompt chegam ao
 * `ClaudeCodeAdapter` como no produto, e o que só o CLI pode dizer — que aceita os argumentos do
 * isolamento (`--tools ""`, `--json-schema`) e que o JSON volta no esquema — é medido.
 */

import { execFileSync } from 'node:child_process'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import { BINARIO, ClaudeCodeAdapter } from '../ai/claude-code-adapter'
import { runsDeTeste } from '../ai/cwd-neutro.test-helper'
import type { ChamadorDeIa } from './squad-gerador'

export const MODELO_DO_SMOKE = 'claude-fable-5-1'

/** `true` quando o smoke da fase foi pedido e o CLI responde. Ausente é `not_run`, nunca `pass`. */
export function cliDisponivelParaOSmoke(): boolean {
  if (process.env.JARVIS_SMOKE_FASE !== '1') return false
  try {
    execFileSync(BINARIO, ['--version'], { stdio: 'ignore', shell: false })
    return true
  } catch {
    return false
  }
}

export const chamadorViaCli: ChamadorDeIa = {
  call(request: AiRequest): AsyncIterable<AiStreamEvent> {
    return (async function* () {
      try {
        const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir)
        const stream = adapter.generateStream({
          model: request.model ?? MODELO_DO_SMOKE,
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
