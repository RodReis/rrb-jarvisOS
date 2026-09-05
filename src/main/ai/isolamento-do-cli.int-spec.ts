/**
 * O isolamento do CLI por fase — #271, #272 e a emenda E1 da SPEC-Fases-03 (M26-F07).
 *
 * O que estes testes protegem é o que o teste do PI em 2026-09-05 não tinha para protegê-lo: o
 * contrato da etapa chegava ao modelo (não chegava), o conteúdo que o CLI injeta ficava fora do
 * documento (não ficava) e o CLI enxergava um diretório neutro (enxergava o repositório do
 * próprio app, com 230.444 tokens de governança).
 *
 * Os três assuntos moram juntos porque são **um** defeito visto de três ângulos: uma geração de
 * documento que se comportava como uma sessão de agente. Separá-los em três arquivos faria cada
 * um provar meia coisa.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter, flagRecusada, VERSAO_MINIMA_DO_CLI } from './claude-code-adapter'
import { CodexAdapter, entradaDoCodex } from './codex-adapter'
import { novoEstadoDoParser, parsearLinha } from './stream-json-parser'
import { runsDeTeste } from './cwd-neutro.test-helper'
import { LIMITE_RESUMO_BYTES, type GenerationEvent } from '@shared/domain/geracao'
import type { AdapterRequest } from './adapter'

/** Um pedido mínimo. Cada teste sobrescreve só o que lhe interessa. */
function pedido(extra: Partial<AdapterRequest> = {}): AdapterRequest {
  return { model: 'claude-opus-5', prompt: 'PEDIDO', maxTokens: 1000, timeoutMs: 5_000, ...extra }
}

describe('#271 — o contrato da etapa chega ao CLI', () => {
  const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir)

  it('com `system`, os args carregam `--system-prompt` e o texto exato', () => {
    const args = adapter.argsDaGeracao(pedido({ system: 'CONTRATO DA ETAPA' }))

    expect(args).toContain('--system-prompt')
    // O índice importa: a flag e o valor têm de ser vizinhos, senão o CLI lê o valor como
    // outra coisa. Conferir só a presença dos dois passaria com eles em pontas opostas.
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('CONTRATO DA ETAPA')
  })

  it('sem `system`, a flag não entra', () => {
    // Passar `--system-prompt ""` substituiria o prompt padrão por nada, que é pior do que não
    // passar: o modelo ficaria sem persona nenhuma numa chamada que não pediu isso.
    expect(adapter.argsDaGeracao(pedido())).not.toContain('--system-prompt')
  })

  it('`system` vazio conta como ausente', () => {
    expect(adapter.argsDaGeracao(pedido({ system: '' }))).not.toContain('--system-prompt')
  })

  it('o contrato chega mesmo fora das fases de documento', () => {
    // Entregar o system é a #271 e não tem relação com ferramentas: na Construção o agente
    // continua sendo agente, e ainda assim precisa receber o contrato da etapa.
    const args = adapter.argsDaGeracao(pedido({ system: 'CONTRATO', fase: 'construcao' }))

    expect(args).toContain('--system-prompt')
    expect(args).not.toContain('--tools')
  })

  it('o Codex recebe o contrato antes do pedido, com cabeçalhos', () => {
    // O `codex exec` não tem flag de system prompt: o contrato entra no stdin. Sem cabeçalho as
    // duas partes viram um texto só e o modelo trata a instrução como conteúdo a descrever.
    const entrada = entradaDoCodex(pedido({ system: 'CONTRATO' }))

    expect(entrada.indexOf('CONTRATO')).toBeLessThan(entrada.indexOf('PEDIDO'))
    expect(entrada).toContain('INSTRUÇÕES:')
  })

  it('o Codex sem `system` recebe o prompt intacto', () => {
    expect(entradaDoCodex(pedido())).toBe('PEDIDO')
  })
})

describe('#272 — o que o CLI injeta não vira documento', () => {
  /** Uma mensagem `user` com bloco `text`: é assim que o corpo de uma skill chega. */
  const linhaDeUser = (texto: string): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: texto }] } })

  const linhaDeAssistant = (texto: string): string =>
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: texto }] }
    })

  const linhaDeToolUse = (id: string): string =>
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill: 'claude-api' } }] }
    })

  it('texto de `assistant` continua virando `texto`', () => {
    // A metade que não pode quebrar: o documento é o produto, e ele nasce daqui.
    expect(parsearLinha(linhaDeAssistant('a resposta'))).toEqual([
      { tipo: 'texto', delta: 'a resposta' }
    ])
  })

  it('texto de `user` nunca vira `texto`', () => {
    const eventos = parsearLinha(linhaDeUser('CORPO DA SKILL'))

    expect(eventos.some((e) => e.tipo === 'texto')).toBe(false)
  })

  it('o corpo de uma skill de 30 KB não entra no documento e sai truncado no console', () => {
    // O tamanho é o do defeito: a skill `claude-api` que o PI viu despejada na saída.
    const corpo = 'x'.repeat(30 * 1024)
    const estado = novoEstadoDoParser()

    const inicio = parsearLinha(linhaDeToolUse('call-1'), estado)
    const injetado = parsearLinha(linhaDeUser(corpo), estado)

    expect(inicio[0]).toMatchObject({ tipo: 'ferramenta-inicio', chamadaId: 'call-1' })
    expect(injetado).toHaveLength(1)
    expect(injetado[0]).toMatchObject({
      tipo: 'ferramenta-fim',
      // Reusa o `chamadaId` do `tool_use` pendente: é onde o PI procura o resultado da skill.
      chamadaId: 'call-1',
      status: 'ok',
      tamanhoOriginal: 30 * 1024
    })

    const evento = injetado[0]
    if (evento?.tipo !== 'ferramenta-fim') throw new Error('evento inesperado')
    // A régua de 2 KB do `tool_result`, que antes não alcançava este caminho.
    expect(Buffer.byteLength(evento.resumoDoResultado, 'utf8')).toBeLessThanOrEqual(
      LIMITE_RESUMO_BYTES
    )
  })

  it('injeção sem ferramenta pendente vira bloco solto, não erro', () => {
    // Um `system-reminder` fora de qualquer chamada. `erro` mentiria: conteúdo injetado é
    // rotina do CLI, e um painel cheio de "erro" faria o PI ignorar os erros de verdade.
    const eventos = parsearLinha(linhaDeUser('system-reminder'), novoEstadoDoParser())

    expect(eventos[0]).toMatchObject({ tipo: 'ferramenta-fim', chamadaId: '', status: 'ok' })
  })

  it('`tool_result` continua como estava', () => {
    const estado = novoEstadoDoParser()
    parsearLinha(linhaDeToolUse('call-9'), estado)

    const linha = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-9', content: 'saída', is_error: true }]
      }
    })

    expect(parsearLinha(linha, estado)[0]).toMatchObject({
      tipo: 'ferramenta-fim',
      chamadaId: 'call-9',
      status: 'erro',
      resumoDoResultado: 'saída'
    })
  })

  it('o estado é por geração: uma não herda a ferramenta pendente da outra', () => {
    // Estado de módulo faria a injeção de uma geração aparecer pendurada na ferramenta da
    // outra — e as duas rodam ao mesmo tempo quando o PI abre duas etapas.
    const primeira = novoEstadoDoParser()
    parsearLinha(linhaDeToolUse('call-da-primeira'), primeira)

    const segunda = novoEstadoDoParser()
    expect(parsearLinha(linhaDeUser('texto'), segunda)[0]).toMatchObject({ chamadaId: '' })
  })
})

describe('emenda E1 — flags de isolamento por fase (critério 2)', () => {
  const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir)

  const FLAGS_DE_ISOLAMENTO = [
    '--tools',
    '--setting-sources',
    '--strict-mcp-config',
    '--no-session-persistence'
  ]

  it.each(['planejamento', 'especificacao'] as const)(
    'na fase %s, todas as flags da tabela entram',
    (fase) => {
      const args = adapter.argsDaGeracao(pedido({ system: 'S', fase, jsonSchema: '{}' }))

      for (const flag of FLAGS_DE_ISOLAMENTO) expect(args).toContain(flag)
      // `--tools ""` e `--setting-sources ""`: a string vazia é o valor, não a ausência dele.
      expect(args[args.indexOf('--tools') + 1]).toBe('')
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
      expect(args[args.indexOf('--json-schema') + 1]).toBe('{}')
    }
  )

  it('na Construção, nenhuma flag de isolamento entra', () => {
    // O agente da Construção lê arquivos e roda comandos: `--tools ""` o quebraria. A emenda
    // registra a assimetria justamente para que ela não seja aplicada onde não deve.
    const args = adapter.argsDaGeracao(pedido({ system: 'S', fase: 'construcao' }))

    for (const flag of FLAGS_DE_ISOLAMENTO) expect(args).not.toContain(flag)
  })

  it('sem fase declarada, nenhuma flag de isolamento entra', () => {
    // É o painel de teste do Settings: uma chamada de diagnóstico, que não gera documento.
    const args = adapter.argsDaGeracao(pedido({ system: 'S' }))

    for (const flag of FLAGS_DE_ISOLAMENTO) expect(args).not.toContain(flag)
  })

  it('sem schema, a flag não entra', () => {
    // O termo de pesquisa pede texto puro — "sem aspas, sem explicação". Impor JSON ali
    // quebraria a etapa em vez de protegê-la.
    const args = adapter.argsDaGeracao(pedido({ system: 'S', fase: 'planejamento' }))

    expect(args).not.toContain('--json-schema')
  })

  it('em nenhuma fase os args contêm `--dangerously-skip-permissions`', () => {
    for (const fase of ['planejamento', 'especificacao', 'construcao', undefined] as const) {
      const args = adapter.argsDaGeracao(pedido({ system: 'S', ...(fase && { fase }) }))
      expect(args).not.toContain('--dangerously-skip-permissions')
      expect(args).not.toContain('--allow-dangerously-skip-permissions')
    }
  })

  it('o Codex restringe por sandbox e roda fora de repositório (critério 5)', () => {
    const codex = new CodexAdapter(runsDeTeste().abrir, () => 'C:/perfil')

    const documento = codex.argsDaGeracao(pedido({ fase: 'planejamento' }))
    expect(documento).toContain('--sandbox')
    expect(documento[documento.indexOf('--sandbox') + 1]).toBe('read-only')

    // O cwd neutro não é repositório Git, e o `codex exec` recusa rodar fora de um sem esta
    // flag. Vale em **toda** fase: é consequência do cwd, não da política de fase.
    for (const fase of ['planejamento', 'construcao'] as const) {
      expect(codex.argsDaGeracao(pedido({ fase }))).toContain('--skip-git-repo-check')
    }

    expect(codex.argsDaGeracao(pedido({ fase: 'construcao' }))).not.toContain('--sandbox')
  })
})

describe('emenda E1 — o cwd é neutro e some no fim (critério 1)', () => {
  /** Um binário dublê que grava o cwd que recebeu e o conteúdo que enxergou dali. */
  const scriptQueRelata = (destino: string): string =>
    `const fs=require("fs");process.stdin.on("data",()=>{});` +
    `fs.writeFileSync(${JSON.stringify(destino)},JSON.stringify({cwd:process.cwd(),itens:fs.readdirSync(process.cwd())}));` +
    `process.stdout.write(${JSON.stringify(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
      }) + '\n'
    )});process.exit(0)`

  it('o CLI roda num diretório vazio, fora do repositório, e ele é removido depois', async () => {
    const runs = runsDeTeste()
    // Fora da árvore dos runs: um relato **dentro** de um run seria apagado com ele, e criar um
    // run só para hospedá-lo deixaria um caminho que nenhum `finally` remove — a asserção de
    // remoção reprovaria por artefato do teste, não por defeito do código.
    const relato = join(mkdtempSync(`${tmpdir()}/jarvis-relato-`), 'relato.json')

    const adapter = new ClaudeCodeAdapter(
      runs.abrir,
      ((_b: string, _a: readonly string[], opcoes: object) =>
        spawn(process.execPath, ['-e', scriptQueRelata(relato)], opcoes)) as typeof spawn
    )

    for await (const _ of adapter.generateStream(pedido({ fase: 'planejamento' }))) {
      // O consumo é o que faz o stream rodar até o fim; o que importa é o relato e a remoção.
    }

    const visto = JSON.parse(readFileSync(relato, 'utf8')) as { cwd: string; itens: string[] }

    // Vazio no spawn: sem `CLAUDE.md`, sem `.claude/`, sem `.git`.
    expect(visto.itens).toEqual([])
    // E fora do repositório do app, que é o defeito que a emenda corrige.
    expect(visto.cwd).not.toBe(process.cwd())
    // Removido ao fim — o `finally` roda em todos os desfechos.
    expect(runs.caminhos.filter((c) => existsSync(c))).toEqual([])
  })

  it('o diretório some também quando o processo é morto no meio', async () => {
    const runs = runsDeTeste()
    const adapter = new ClaudeCodeAdapter(
      runs.abrir,
      ((_b: string, _a: readonly string[], opcoes: object) =>
        // Um processo que nunca termina sozinho: só o `SIGKILL` do timeout o encerra.
        spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], opcoes)) as typeof spawn
    )

    await expect(async () => {
      for await (const _ of adapter.generateStream(pedido({ timeoutMs: 200 }))) {
        // Sem saída: o processo é morto antes de escrever qualquer coisa.
      }
    }).rejects.toThrow()

    expect(runs.caminhos.filter((c) => existsSync(c))).toEqual([])
  })

  it('um diretório com governança dentro não é o que o CLI recebe', () => {
    // A prova pelo avesso: o `abrirRunNeutro` cria diretório novo, então plantar um arquivo no
    // anterior não alcança o próximo. É o que impede o `.claude/` de um run vazar para o outro.
    const runs = runsDeTeste()
    const primeiro = runs.abrir()
    writeFileSync(join(primeiro.caminho, 'CLAUDE.md'), '# governança')

    const segundo = runs.abrir()

    expect(readdirSync(segundo.caminho)).toEqual([])
    expect(segundo.caminho).not.toBe(primeiro.caminho)
  })
})

describe('emenda E1 — flag recusada é falha declarada (critério 6)', () => {
  it('a mensagem nomeia a flag e a versão mínima', async () => {
    const runs = runsDeTeste()
    const adapter = new ClaudeCodeAdapter(
      runs.abrir,
      // É o que um CLI antigo faz: escreve no stderr e sai com código 1.
      ((_b: string, _a: readonly string[], opcoes: object) =>
        spawn(
          process.execPath,
          ['-e', `process.stderr.write("error: unknown option '--json-schema'");process.exit(1)`],
          opcoes
        )) as typeof spawn
    )

    await expect(async () => {
      for await (const _ of adapter.generateStream(pedido({ fase: 'planejamento' }))) {
        // Nada a consumir: o processo falha antes de emitir.
      }
    }).rejects.toThrow(/--json-schema/)
  })

  it('nunca cai para a invocação sem isolamento', () => {
    // O ponto do critério 6: a alternativa proibida é tentar de novo sem as flags. Não existe
    // caminho de repetição no adapter — a falha sobe, e é isso que este teste fixa.
    const args = new ClaudeCodeAdapter(runsDeTeste().abrir).argsDaGeracao(
      pedido({ system: 'S', fase: 'planejamento', jsonSchema: '{}' })
    )

    expect(args).toContain('--tools')
  })

  it('o stderr não vaza na mensagem — só o nome da flag', () => {
    // O stderr do CLI pode carregar caminho de sessão. O nome da flag é dado nosso.
    expect(flagRecusada("error: unknown option '--tools'\nsessão: C:/Users/rodri/segredo")).toBe(
      '--tools'
    )
    expect(flagRecusada('qualquer outra falha do CLI')).toBeUndefined()
  })

  it('a versão mínima registrada é a instalada no PC do PI', () => {
    // Confirmada em `claude --version` em 2026-09-05 (emenda E1 § Decisão 5). O número também
    // vive no ARCHITECTURE.md § Providers; aqui ele é o que a mensagem de erro mostra.
    expect(VERSAO_MINIMA_DO_CLI).toBe('2.1.258')
  })
})

describe('emenda E1 — ferramenta em fase sem ferramentas (critério 3)', () => {
  const linha = (payload: object): string => JSON.stringify(payload)

  const TEXTO_ANTES = linha({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ANTES' }] }
  })
  const CHAMADA = linha({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }]
    }
  })
  const TEXTO_DEPOIS = linha({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'DEPOIS' }] }
  })

  /**
   * Um dublê que despeja as linhas e termina.
   *
   * Termina sozinho de propósito: o que o critério 3 mede é o **corte do texto posterior**, e um
   * dublê que ficasse vivo faria o caso da Construção — onde ninguém o mata — reprovar por
   * timeout, sobre um comportamento que está correto.
   */
  const scriptQueEmite = (...linhas: readonly string[]): string =>
    `process.stdin.on("data",()=>{});` +
    linhas.map((l) => `process.stdout.write(${JSON.stringify(l + '\n')});`).join('') +
    `process.exit(0)`

  async function gerar(fase: 'planejamento' | 'construcao'): Promise<{
    texto: string
    eventos: GenerationEvent[]
  }> {
    const eventos: GenerationEvent[] = []
    const adapter = new ClaudeCodeAdapter(
      runsDeTeste().abrir,
      ((_b: string, _a: readonly string[], opcoes: object) =>
        spawn(
          process.execPath,
          ['-e', scriptQueEmite(TEXTO_ANTES, CHAMADA, TEXTO_DEPOIS)],
          opcoes
        )) as typeof spawn
    )

    let texto = ''
    for await (const chunk of adapter.generateStream(
      pedido({ fase, timeoutMs: 3_000, onEvento: (e) => eventos.push(e) })
    )) {
      if (chunk.tipo === 'texto') texto += chunk.texto
    }

    return { texto, eventos }
  }

  it('o console recebe o erro e o documento perde o texto posterior', async () => {
    const { texto, eventos } = await gerar('planejamento')

    // O que veio antes do desvio é honesto e fica.
    expect(texto).toContain('ANTES')
    // O que veio depois nasceu de uma sessão fora do contrato.
    expect(texto).not.toContain('DEPOIS')

    const erro = eventos.find((e) => e.tipo === 'erro')
    expect(erro).toBeDefined()
    if (erro?.tipo !== 'erro') throw new Error('evento inesperado')
    // A mensagem nomeia a ferramenta: sem isso o PI não sabe o que o modelo tentou fazer.
    expect(erro.mensagem).toContain('Bash')
  })

  it('a geração termina, não falha', async () => {
    // O `SIGKILL` é nosso. Reportar falha descartaria o texto válido e diria que o CLI travou.
    await expect(gerar('planejamento')).resolves.toBeDefined()
  })

  it('na Construção a ferramenta é legítima e o documento continua', async () => {
    const { texto, eventos } = await gerar('construcao')

    expect(texto).toContain('DEPOIS')
    expect(eventos.some((e) => e.tipo === 'erro')).toBe(false)
  })
})
