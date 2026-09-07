/**
 * Smoke real do isolamento do CLI — critério 4 da emenda E1 à SPEC-Fases-03.
 *
 * Roda **só** com `JARVIS_SMOKE_ISOLAMENTO=1` e o `claude` instalado — nunca na suíte comum.
 * Ausente é `not_run`, nunca `pass`: por isso `describe.skipIf`, para a ausência ficar registrada
 * como skipped no relatório em vez de passar despercebida.
 *
 * ## O que este smoke prova, e o que o dublê não provaria
 *
 * O `int-spec` da fatia usa `node` como binário dublê: ele exercita `spawn`, cwd, stdin, timeout e
 * kill de verdade, mas as **flags são aceitas por construção** — o dublê ignora tudo que recebe.
 * O número que a emenda cobra não sai de lá. Aqui o `claude` de verdade recebe os argumentos que
 * o adapter monta e **mede** os tokens de entrada, que é a única forma de responder à pergunta da
 * fatia: o CLI parou de carregar a governança do repositório?
 *
 * O teto é 10.000 tokens, contra os 230.444 medidos em 2026-09-05 com o cwd em `process.cwd()`.
 *
 * **Exige sessão autenticada** do plano Claude MAX — é a rota de assinatura. Sem login, o CLI
 * falha antes de medir e o smoke reporta isso em vez de fingir um número.
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BINARIO, ClaudeCodeAdapter } from './claude-code-adapter'
import { runsDeTeste } from './cwd-neutro.test-helper'
import { BINARIO_CODEX, localizarScriptDoCodex, resolverInvocacao } from './codex-profile-service'
import { SISTEMA_DAS_PERGUNTAS, promptDasPerguntas } from '@shared/domain/brief-schema'
import { SCHEMA_DAS_PERGUNTAS } from '@shared/domain/json-schema-da-saida'
import { IDIOMA_DA_SAIDA } from '@shared/domain/idioma-da-geracao'
import type { GenerationEvent } from '@shared/domain/geracao'

const habilitado = process.env.JARVIS_SMOKE_ISOLAMENTO === '1'

const cliInstalado = ((): boolean => {
  if (!habilitado) return false
  try {
    execFileSync(BINARIO, ['--version'], { stdio: 'ignore', shell: false })
    return true
  } catch {
    return false
  }
})()

/** O teto do critério 4. O número de antes, para comparação, era 230.444. */
const TETO_DE_TOKENS_DE_ENTRADA = 10_000

/** O prompt de até 500 caracteres que o critério 4 nomeia. */
const PROMPT_DO_PI =
  'Um app de lista de compras para casal, que sincroniza entre dois celulares e ' +
  'sugere itens pelo histórico. Precisa funcionar offline no mercado.'

describe.skipIf(!cliInstalado)('isolamento do CLI — smoke real (critério 4)', () => {
  it('o refinamento com prompt pequeno cabe no teto de tokens e devolve o contrato', async () => {
    expect(PROMPT_DO_PI.length).toBeLessThanOrEqual(500)

    const runs = runsDeTeste()
    const adapter = new ClaudeCodeAdapter(runs.abrir)
    const eventos: GenerationEvent[] = []

    let texto = ''
    for await (const chunk of adapter.generateStream({
      model: 'claude-sonnet-5',
      // O par exato que a etapa de refinamento monta em produção. Um prompt inventado aqui
      // mediria outra coisa: é o contrato real que decide o tamanho do system.
      system: SISTEMA_DAS_PERGUNTAS,
      prompt: promptDasPerguntas(PROMPT_DO_PI, ['problema', 'publico']),
      jsonSchema: SCHEMA_DAS_PERGUNTAS,
      fase: 'planejamento',
      maxTokens: 4_000,
      timeoutMs: 180_000,
      onEvento: (evento) => eventos.push(evento)
    })) {
      if (chunk.tipo === 'texto') texto += chunk.texto
    }

    const uso = eventos.find((evento) => evento.tipo === 'uso')
    // O número tem de vir **medido pelo CLI**. A aproximação por caracteres do adapter passaria
    // no teto sem provar nada — ela conta o nosso prompt, não o contexto que o CLI carregou.
    expect(uso, 'o CLI não reportou `usage`: sem número medido, não há critério 4').toBeDefined()
    if (uso?.tipo !== 'uso') throw new Error('evento inesperado')

    // O número **medido** vai ao stdout do teste: é o que a emenda manda entrar no relatório da
    // fatia, e uma asserção sozinha diria "abaixo de 10.000" sem dizer de quanto.
    console.log(`[critério 4] tokensEntrada medido pelo CLI: ${uso.tokensEntrada}`)

    expect(uso.tokensEntrada).toBeLessThan(TETO_DE_TOKENS_DE_ENTRADA)

    // O outro lado do #271: com o contrato entregue, a saída é o JSON das perguntas — e não
    // "vou montar o projeto e entregar o código", que foi o que o PI recebeu.
    const saida = JSON.parse(texto) as { perguntas?: unknown[] }
    expect(Array.isArray(saida.perguntas)).toBe(true)

    // A linha de idioma chegou ao modelo pelo `--system-prompt` (complemento do PI na #271):
    // sem ela, "responda em pt-BR" seria imitação do português do prompt, não contrato.
    expect(SISTEMA_DAS_PERGUNTAS).toContain(IDIOMA_DA_SAIDA)

    // E o #272: nenhum corpo de skill no documento. Sem ferramentas, não há skill a invocar.
    expect(texto).not.toContain('claude-api')
    expect(eventos.some((evento) => evento.tipo === 'ferramenta-inicio')).toBe(false)

    // O diretório do run sumiu — critério 1, agora contra o CLI de verdade.
    expect(runs.caminhos.filter((caminho) => existsSync(caminho))).toEqual([])
  }, 200_000)
})

/**
 * O Codex tem **duas** fontes de contexto, e só uma é o cwd.
 *
 * Medido em 2026-09-05 com o `codex-cli` 0.149.0: rodando no cwd neutro mas com o `CODEX_HOME`
 * pessoal do PI, a sessão ainda carregou plugins e hooks de `~/.codex/plugins/` — o mesmo tipo de
 * contexto do ambiente que a emenda E1 corta no Claude Code pelo cwd. O `--sandbox read-only` não
 * os desliga: ele restringe o que as ferramentas alcançam, não o que a sessão carrega.
 *
 * O que fecha essa segunda porta é o `CODEX_HOME` da pipeline, que a M10-F02 já entrega e o boot
 * já passa ao adapter. Com um `CODEX_HOME` isolado, plugins e hooks somem da sessão.
 *
 * Este bloco existe para que a descoberta não se perca: quem mexer no `CODEX_HOME` amanhã
 * precisa saber que ele é metade do isolamento do Codex, não só a escolha de perfil.
 */
/**
 * A invocação real do Codex, pela **mesma** resolução que o adapter usa.
 *
 * `execFileSync('codex')` direto responderia "não instalado" no Windows, onde o binário do npm é
 * um `.cmd` que o Node recusa com `shell: false` — o defeito que o smoke da M10-F02 achou.
 * Repetir o caminho ingênuo aqui faria este bloco virar `skipped` sem ninguém notar.
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

describe.skipIf(!codexInstalado)('Codex — o cwd neutro é metade do isolamento', () => {
  it('as flags da emenda são aceitas pela versão instalada', () => {
    // O que este teste prova é que `codex exec` conhece as duas flags: uma versão que não as
    // conhecesse falharia aqui, e não numa geração do PI.
    const ajuda = execFileSync(
      invocacaoDoCodex.comando,
      [...invocacaoDoCodex.args, 'exec', '--help'],
      { encoding: 'utf8' }
    )

    expect(ajuda).toContain('--skip-git-repo-check')
    expect(ajuda).toContain('--sandbox')
  })
})
