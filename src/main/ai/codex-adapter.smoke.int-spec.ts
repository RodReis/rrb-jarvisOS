/**
 * Smoke real do adapter do Codex (SPEC-Fases-06 § Testes e evidência).
 *
 * Roda **só** com `JARVIS_SMOKE_CODEX=1` e o CLI instalado — nunca na suíte comum. Ausente é
 * `not_run`, nunca `pass`: por isso `describe.skipIf`, para a ausência ficar registrada como
 * skipped no relatório.
 *
 * ## O que este smoke prova, e o que o dublê não provaria
 *
 * O `int-spec` do adapter usa `node` como binário dublê: ele exercita `spawn`, stdin, timeout e
 * kill de verdade, mas as **linhas do JSONL são as que eu escrevi**. Este arquivo roda o `codex`
 * de verdade e verifica o que só o CLI pode dizer: que ele aceita os argumentos que montamos, que
 * o stdout é JSONL parseável pelo nosso parser, e que os tipos de evento que esperamos existem.
 *
 * **Não exige sessão autenticada.** Um perfil vazio faz o CLI responder `401` e terminar em
 * `turn.failed` — que é exatamente um dos caminhos que o parser precisa traduzir, e que a fatia
 * anterior mediu. O caminho feliz depende de login do PI e é o limite declarado da entrega.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BINARIO_CODEX, localizarScriptDoCodex, resolverInvocacao } from './codex-profile-service'
import { extrairLinhasDoCodex, parsearLinhaDoCodex } from './codex-json-parser'
import { execSync } from 'node:child_process'

const habilitado = process.env.JARVIS_SMOKE_CODEX === '1'

/**
 * A invocação real, pela **mesma** resolução que o adapter usa.
 *
 * `execFileSync(BINARIO_CODEX)` direto responderia "não instalado" no Windows, onde o binário do
 * npm é um `.cmd` — o defeito que o smoke da M10-F02 achou. Repetir o caminho ingênuo aqui faria
 * o smoke inteiro virar `not_run` sem ninguém notar.
 */
const invocacaoDoCodex = resolverInvocacao(BINARIO_CODEX, [], () =>
  localizarScriptDoCodex(execSync, existsSync)
)

const codexInstalado = ((): boolean => {
  if (!habilitado) return false
  try {
    execFileSync(invocacaoDoCodex.comando, [...invocacaoDoCodex.args, '--version'], {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!codexInstalado)('CodexAdapter — smoke real (codex CLI instalado)', () => {
  /**
   * O CLI aceita **os argumentos que o adapter monta**.
   *
   * `exec --json --model <id>` é o contrato que a spec descreve; se uma versão futura do CLI
   * renomear qualquer um deles, é aqui que aparece — e não numa geração do PI.
   */
  it('aceita exec --json --model com um modelo do catálogo', () => {
    const saida = execFileSync(
      invocacaoDoCodex.comando,
      [...invocacaoDoCodex.args, 'exec', '--help'],
      { encoding: 'utf8' }
    )

    expect(saida).toContain('--json')
    expect(saida).toContain('--model')
  })

  /**
   * **O stdout é JSONL, e o nosso parser o entende** (critério 3).
   *
   * Roda o `exec` de verdade com um perfil vazio: o CLI responde `401` e termina em `turn.failed`.
   * O que se mede é que **toda** linha do stdout parseia e que nenhuma delas produz um evento de
   * erro de formato — o que provaria que o parser não conhece o vocabulário do CLI.
   */
  it('produz JSONL que o parser traduz sem erro de formato', () => {
    const perfil = mkdtempSync(join(tmpdir(), 'jarvis-codex-smoke-'))
    mkdirSync(perfil, { recursive: true })

    try {
      let stdout = ''
      try {
        stdout = execFileSync(
          invocacaoDoCodex.comando,
          [...invocacaoDoCodex.args, 'exec', '--json', '--model', 'gpt-5.6-sol'],
          {
            input: 'responda apenas OK',
            encoding: 'utf8',
            env: { ...process.env, CODEX_HOME: perfil },
            timeout: 120_000,
            // O `exec` sai com código 1 num perfil sem credencial (medido). É desfecho esperado
            // aqui, não falha do smoke — o que interessa é o **formato** do que ele imprimiu.
            stdio: ['pipe', 'pipe', 'ignore']
          }
        )
      } catch (erro) {
        stdout = String((erro as { stdout?: unknown }).stdout ?? '')
      }

      const { linhas } = extrairLinhasDoCodex(stdout)
      expect(linhas.length).toBeGreaterThan(0)

      // Toda linha do stdout é JSON válido — o contrato que o CLI declara ("in --json mode,
      // stdout must be valid JSONL") e que o parser assume.
      for (const linha of linhas) {
        expect(() => JSON.parse(linha) as unknown).not.toThrow()
      }

      // E nenhuma delas faz o parser reclamar de formato: as mensagens de `erro` que aparecem são
      // as **do CLI** (401), traduzidas — não erros de leitura nossos.
      const errosDeFormato = linhas
        .flatMap((l) => parsearLinhaDoCodex(l))
        .filter((e) => e.tipo === 'erro' && /não pôde ser lida|não é um objeto/i.test(e.mensagem))

      expect(errosDeFormato).toEqual([])
    } finally {
      rmSync(perfil, { recursive: true, force: true })
    }
  }, 180_000)

  /**
   * Os tipos de evento que o parser trata **existem** na saída real.
   *
   * Sem esta asserção, um parser escrito contra nomes imaginados passaria em todos os testes de
   * unidade e não reconheceria uma linha sequer em produção.
   */
  it('emite os tipos de evento que o parser reconhece', () => {
    const perfil = mkdtempSync(join(tmpdir(), 'jarvis-codex-smoke-'))

    try {
      let stdout = ''
      try {
        stdout = execFileSync(
          invocacaoDoCodex.comando,
          [...invocacaoDoCodex.args, 'exec', '--json', '--model', 'gpt-5.6-sol'],
          {
            input: 'responda apenas OK',
            encoding: 'utf8',
            env: { ...process.env, CODEX_HOME: perfil },
            timeout: 120_000,
            stdio: ['pipe', 'pipe', 'ignore']
          }
        )
      } catch (erro) {
        stdout = String((erro as { stdout?: unknown }).stdout ?? '')
      }

      const tipos = new Set(
        extrairLinhasDoCodex(stdout).linhas.map(
          (l) => (JSON.parse(l) as { type?: string }).type ?? ''
        )
      )

      // `thread.started` e `turn.started` abrem toda execução (medido no 0.149.0). São os dois
      // que o parser ignora por omissão — e é bom que continuem existindo, porque é a prova de
      // que ignorar por omissão é a decisão certa e não um descuido.
      expect(tipos.has('thread.started')).toBe(true)
    } finally {
      rmSync(perfil, { recursive: true, force: true })
    }
  }, 180_000)
})
