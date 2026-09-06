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
import { documentoRetido, novoEstadoDoParser, parsearLinha } from './stream-json-parser'
import { runsDeTeste } from './cwd-neutro.test-helper'
import { LIMITE_RESUMO_BYTES, type GenerationEvent } from '@shared/domain/geracao'
import { SCHEMA_DAS_PERGUNTAS } from '@shared/domain/json-schema-da-saida'
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
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: texto }] }
    })

  const linhaDeAssistant = (texto: string): string =>
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: texto }] }
    })

  const linhaDeToolUse = (id: string): string =>
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'Skill', input: { skill: 'claude-api' } }]
      }
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

    const adapter = new ClaudeCodeAdapter(runs.abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) => spawn(process.execPath, ['-e', scriptQueRelata(relato)], opcoes)) as typeof spawn)

    // O consumo é o que faz o stream rodar até o fim; o que se afirma é o relato e a remoção.
    for await (const chunk of adapter.generateStream(pedido({ fase: 'planejamento' }))) {
      expect(chunk.tipo).toBeDefined()
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
    const adapter = new ClaudeCodeAdapter(runs.abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) =>
      // Um processo que nunca termina sozinho: só o `SIGKILL` do timeout o encerra.
      spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], opcoes)) as typeof spawn)

    await expect(async () => {
      // Sem saída: o processo é morto pelo timeout antes de escrever qualquer coisa.
      for await (const chunk of adapter.generateStream(pedido({ timeoutMs: 200 }))) {
        expect(chunk).toBeUndefined()
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
      // Nada a consumir: o processo falha antes de emitir.
      for await (const chunk of adapter.generateStream(pedido({ fase: 'planejamento' }))) {
        expect(chunk).toBeUndefined()
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
    const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) =>
      spawn(
        process.execPath,
        ['-e', scriptQueEmite(TEXTO_ANTES, CHAMADA, TEXTO_DEPOIS)],
        opcoes
      )) as typeof spawn)

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

describe('saída estruturada — `--json-schema` devolve o documento por ferramenta', () => {
  /**
   * O que o CLI 2.1.258 faz de verdade com `--json-schema`, medido no smoke de 2026-09-05.
   *
   * Ele **não** pede JSON em texto: injeta a ferramenta `StructuredOutput` e o modelo responde
   * chamando-a, com o documento inteiro no `input`. Nenhum bloco `text` aparece na geração — daí
   * este bloco de testes, que fixa a descoberta antes que ela se perca.
   */
  const linhaDaSaida = (documento: object): string =>
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'StructuredOutput', input: documento }]
      }
    })

  const linhaDoAceite = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'Structured output provided successfully'
        }
      ]
    }
  })

  it('a saída estruturada vira documento, não chamada de ferramenta', () => {
    const estado = novoEstadoDoParser()
    const eventos = parsearLinha(linhaDaSaida({ perguntas: [{ bloco: 'problema' }] }), estado)

    // Como `ferramenta-inicio`, o documento nasceria vazio — e o critério 3 mataria a geração,
    // porque uma ferramenta teria sido usada numa fase que não tem ferramentas. **Nenhum**
    // evento sai na hora: desde o #284 o documento fica retido até o fim da geração, porque o
    // CLI repete a chamada e dois deltas emitidos se concatenariam num JSON quebrado.
    expect(eventos).toEqual([])
    expect(documentoRetido(estado)).toEqual([
      { tipo: 'texto', delta: '{"perguntas":[{"bloco":"problema"}]}' }
    ])
  })

  it('o aceite do protocolo não vai ao console', () => {
    // "Structured output provided successfully" é confirmação de protocolo, não resultado. Uma
    // linha dessas por geração encheria o painel do PI com o que não lhe diz nada.
    const estado = novoEstadoDoParser()
    parsearLinha(linhaDaSaida({ perguntas: [] }), estado)

    expect(parsearLinha(linhaDoAceite, estado)).toEqual([])
  })

  it('uma ferramenta de verdade continua sendo ferramenta', () => {
    // A exceção é **só** a `StructuredOutput`. `Bash` numa fase de documento continua sendo o
    // desvio que o critério 3 corta.
    const eventos = parsearLinha(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }]
        }
      })
    )

    expect(eventos[0]).toMatchObject({ tipo: 'ferramenta-inicio', nome: 'Bash' })
  })

  it('`--tools ""` e `--json-schema` convivem: a lista fica só com a saída estruturada', () => {
    // Medido no CLI 2.1.258: o `system/init` reporta `"tools":["StructuredOutput"]`. Não há
    // colisão entre as duas flags, e é por isso que a tabela da emenda pede as duas.
    const args = new ClaudeCodeAdapter(runsDeTeste().abrir).argsDaGeracao(
      pedido({ system: 'S', fase: 'planejamento', jsonSchema: SCHEMA_DAS_PERGUNTAS })
    )

    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--json-schema') + 1]).toBe(SCHEMA_DAS_PERGUNTAS)
  })
})

describe('o healthcheck não deixa diretório para trás', () => {
  /**
   * O `disponivel()` roda **em laço** na tela de providers, e o caso mais comum dele é o binário
   * não instalado — que chega por `error` e pode nunca emitir `close`. Limpar só no `close`
   * acumularia um diretório por sondagem no `userData` de quem não tem o CLI: justamente quem
   * mais sonda, porque a tela fica perguntando se ele já apareceu.
   */
  it('o binário ausente não acumula diretório', async () => {
    const runs = runsDeTeste()
    const adapter = new ClaudeCodeAdapter(runs.abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) => spawn('binario-que-nao-existe-em-lugar-nenhum', [], opcoes)) as typeof spawn)

    expect(await adapter.disponivel()).toBe(false)
    expect(await adapter.disponivel()).toBe(false)

    expect(runs.caminhos).toHaveLength(2)
    expect(runs.caminhos.filter((caminho) => existsSync(caminho))).toEqual([])
  })

  it('o binário presente também limpa', async () => {
    const runs = runsDeTeste()
    const adapter = new ClaudeCodeAdapter(runs.abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) => spawn(process.execPath, ['-e', 'process.exit(0)'], opcoes)) as typeof spawn)

    expect(await adapter.disponivel()).toBe(true)
    expect(runs.caminhos.filter((caminho) => existsSync(caminho))).toEqual([])
  })

  it('o Codex segue a mesma regra', async () => {
    const runs = runsDeTeste()
    const adapter = new CodexAdapter(runs.abrir, () => 'C:/perfil', ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) => spawn('binario-que-nao-existe-em-lugar-nenhum', [], opcoes)) as typeof spawn)

    expect(await adapter.disponivel()).toBe(false)
    expect(runs.caminhos.filter((caminho) => existsSync(caminho))).toEqual([])
  })
})

describe('critério 3 — o corte deixa passar o que já estava no buffer', () => {
  /**
   * O dublê despeja tudo de uma vez, e é assim que o CLI real se comporta numa geração curta: o
   * `SIGKILL` chega **depois** de o buffer já ter sido lido. O laço termina de processar as linhas
   * que já estão em mãos, então o `tool_result` da ferramenta cortada ainda vira `ferramenta-fim`
   * no console.
   *
   * Isso é correto e importa: o PI precisa ver **o que** a ferramenta devolveu para entender por
   * que a geração parou. O que o corte impede é o **texto posterior** virar documento.
   *
   * **Uma escrita só, e não uma por linha.** A versão anterior fazia um `write` por linha e
   * passava em máquina de dev, onde as três saem no mesmo `data`; no runner do CI, mais lento,
   * o `SIGKILL` do corte chegava entre o primeiro `write` e o segundo, e o `tool_result` nunca
   * era escrito — o teste reprovava com dois eventos em vez de três, intermitentemente. A
   * intenção sempre foi "o buffer já tinha tudo", e agora o dublê a cumpre por construção em vez
   * de por sorte de escalonamento.
   */
  it('o resultado da ferramenta cortada ainda chega ao console', async () => {
    const linhas = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }]
        }
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'saída da ferramenta' }]
        }
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'DEPOIS' }] }
      })
    ]

    const eventos: GenerationEvent[] = []
    const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) =>
      spawn(
        process.execPath,
        [
          '-e',
          `process.stdin.on("data",()=>{});` +
            // Uma escrita só: as três linhas chegam no mesmo evento `data`, então o corte não
            // tem como acontecer no meio delas. Ver o comentário do `describe`.
            `process.stdout.write(${JSON.stringify(linhas.join('\n') + '\n')});` +
            `process.exit(0)`
        ],
        opcoes
      )) as typeof spawn)

    let texto = ''
    for await (const chunk of adapter.generateStream(
      pedido({ fase: 'planejamento', onEvento: (e) => eventos.push(e) })
    )) {
      if (chunk.tipo === 'texto') texto += chunk.texto
    }

    const tipos = eventos.map((e) => e.tipo)
    expect(tipos.slice(0, 3)).toEqual(['ferramenta-inicio', 'erro', 'ferramenta-fim'])
    expect(eventos[2]).toMatchObject({ resumoDoResultado: 'saída da ferramenta' })
    expect(texto).not.toContain('DEPOIS')
  })
})

/**
 * A saída estruturada repetida, atravessando o adapter inteiro (#284, segundo caso).
 *
 * A sequência abaixo é a da geração real de 2026-09-05T21:32:39.604Z, lida do
 * `generation_trace_event`: o modelo chamou `StructuredOutput` com o documento, o CLI **não
 * reconheceu** a chamada e injetou `[structured-output-enforce] You MUST call the StructuredOutput
 * tool`, e o modelo repetiu o **mesmo** documento. Os dois deltas de 3641 bytes se concatenavam e
 * o `JSON.parse` quebrava na posição 3641.
 *
 * O teste vive no int-spec e não no spec do parser porque o defeito só aparece **montado**: o
 * parser pode reter corretamente e o documento nunca sair se o adapter não o entregar no
 * fechamento. É a lição do E2E que roda contra o bundle — a peça certa sozinha não prova a
 * entrega.
 */
describe('#284 — o CLI repete a saída estruturada e o documento sai uma vez só', () => {
  const linha = (payload: unknown): string => JSON.stringify(payload)

  const DOCUMENTO = { contradicoes: [{ id: 'c-1', pergunta: 'a mesma dos dois deltas' }] }

  const chamadaEstruturada = (id: string): string =>
    linha({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'StructuredOutput', input: DOCUMENTO }]
      }
    })

  /** O lembrete que o CLI injeta como mensagem `user` quando não reconhece a chamada. */
  const ENFORCE = linha({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request. Call this tool now.'
        }
      ]
    }
  })

  const scriptQueEmite = (...linhas: readonly string[]): string =>
    `process.stdin.on("data",()=>{});` +
    linhas.map((l) => `process.stdout.write(${JSON.stringify(l + '\n')});`).join('') +
    `process.exit(0)`

  async function gerar(): Promise<string> {
    const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) =>
      spawn(
        process.execPath,
        [
          '-e',
          scriptQueEmite(chamadaEstruturada('toolu_1'), ENFORCE, chamadaEstruturada('toolu_2'))
        ],
        opcoes
      )) as typeof spawn)

    let texto = ''
    for await (const chunk of adapter.generateStream(
      pedido({ fase: 'planejamento', timeoutMs: 3_000, jsonSchema: '{"type":"object"}' })
    )) {
      if (chunk.tipo === 'texto') texto += chunk.texto
    }

    return texto
  }

  it('o documento que chega ao leitor é um JSON só, e é o da última chamada', async () => {
    const texto = await gerar()

    // A asserção que falha com o defeito: `{…}{…}` quebra aqui, na posição do fim do primeiro.
    expect(() => JSON.parse(texto)).not.toThrow()
    expect(JSON.parse(texto)).toEqual(DOCUMENTO)
  })

  it('o lembrete do CLI não entra no documento — é mensagem `user`', async () => {
    expect(await gerar()).not.toContain('structured-output-enforce')
  })
})

/**
 * O `SIGKILL` do corte por ferramenta (#283) — a **segunda** defesa do critério 3.
 *
 * O critério pede duas coisas: *"evento `erro` no console e **a geração termina**; o documento não
 * recebe o texto posterior"*. A flag `ferramentaProibida` cobre a segunda metade e já é medida; o
 * `processo.kill('SIGKILL')` cobre a primeira e **não era medido por nada** — em 2026-09-05,
 * trocá-lo por um no-op deixava os 39 testes deste arquivo verdes.
 *
 * As duas defesas protegem coisas diferentes. A flag protege o **documento**; o kill protege
 * **custo e tempo**: sem ele a sessão que saiu do contrato segue rodando, consumindo a assinatura
 * e segurando a geração até o timeout, com toda a saída sendo descartada no fim.
 *
 * O dublê daqui **não** termina sozinho — o de cima termina, e é por isso que ele não enxerga o
 * kill. Sem alguém que fique vivo depois do desvio, não há encerramento a observar.
 */
describe('#283 — o corte por ferramenta encerra a sessão, não só o documento', () => {
  const linha = (payload: object): string => JSON.stringify(payload)

  const CHAMADA = linha({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }]
    }
  })

  /**
   * Quanto o dublê fica vivo se ninguém o matar.
   *
   * Folgado o bastante para separar "morto pelo corte" de "terminou sozinho" numa máquina
   * carregada, e curto o bastante para o caso da Construção — onde ninguém o mata — esperar essa
   * vida inteira sem estourar o tempo do teste.
   */
  const VIDA_DO_DUBLE_MS = 4_000

  /**
   * Um dublê que emite a chamada proibida e **continua vivo**, como o CLI real continuaria.
   *
   * O `setTimeout` segura o event loop: sem `SIGKILL` o processo só termina quando ele vence, e a
   * asserção de duração separa "foi morto" de "terminou sozinho" sem espiar o sinal.
   */
  const scriptQueFicaVivo = (): string =>
    `process.stdin.on("data",()=>{});` +
    `process.stdout.write(${JSON.stringify(CHAMADA + '\n')});` +
    `setTimeout(()=>process.exit(0),${VIDA_DO_DUBLE_MS})`

  async function gerar(fase: 'planejamento' | 'construcao'): Promise<number> {
    const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) => spawn(process.execPath, ['-e', scriptQueFicaVivo()], opcoes)) as typeof spawn)

    const comecou = Date.now()

    // O timeout é maior que a vida do dublê: assim, uma geração que termina cedo só pode ter
    // sido **morta pelo corte** — se fosse o relógio do adapter, ela duraria mais, não menos.
    // O documento não interessa aqui — o que se mede é o encerramento —, mas o stream precisa
    // ser drenado até o fim: é o `for await` que espera o processo morrer.
    for await (const chunk of adapter.generateStream(
      pedido({ fase, timeoutMs: VIDA_DO_DUBLE_MS * 2 })
    )) {
      void chunk
    }

    return Date.now() - comecou
  }

  it('a geração termina antes do fim natural do roteiro', async () => {
    // Com o kill, encerra assim que a chamada proibida chega. Sem ele, esperaria os 30s do dublê.
    expect(await gerar('planejamento')).toBeLessThan(VIDA_DO_DUBLE_MS / 2)
  }, 20_000)

  it('na Construção a ferramenta é legítima e a sessão não é morta', async () => {
    // O contrapeso do teste acima, e a razão de ele não poder ser "mata sempre": um adapter que
    // matasse **toda** geração com ferramenta passaria no primeiro e quebraria a Construção, onde
    // o agente é legítimo. Aqui a geração dura a vida inteira do dublê, porque ninguém a corta.
    expect(await gerar('construcao')).toBeGreaterThanOrEqual(VIDA_DO_DUBLE_MS * 0.8)
  }, 20_000)
})

/**
 * O bloco `text` do modelo numa geração com schema (#304).
 *
 * A sequência é a da geração real de 2026-09-06T14:10:31.138Z, lida do `generation_trace_event`:
 * o modelo escreveu o JSON **em texto** (o system pede "responda somente com JSON", e ele
 * obedece), o CLI não reconheceu texto como saída estruturada e injetou o `enforce`, e o modelo
 * repetiu o documento chamando `StructuredOutput`. O texto saiu na hora e o documento retido no
 * `close`: 3735 + 3735 bytes, e o `JSON.parse` quebrava na posição 3735.
 *
 * A retenção do #289 só segura `tool_use`; a premissa de que "nenhum bloco `text` aparece" numa
 * geração com schema era **falsa**. Com schema, o documento é o `input` da última chamada e texto
 * do modelo não é documento — mas, sem nenhuma chamada, o texto continua sendo a saída, senão o
 * caminho antigo regrediria.
 */
describe('#304 — com schema, o texto do modelo não cola no documento estruturado', () => {
  const linha = (payload: unknown): string => JSON.stringify(payload)

  const DOCUMENTO = { contradicoes: [{ id: 'c-1', pergunta: 'a mesma nos dois' }] }

  const TEXTO_DO_MODELO = linha({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(DOCUMENTO) }] }
  })

  const ENFORCE = linha({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request. Call this tool now.'
        }
      ]
    }
  })

  const CHAMADA = linha({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'StructuredOutput', input: DOCUMENTO }]
    }
  })

  const scriptQueEmite = (linhas: readonly string[]): string =>
    `process.stdin.on("data",()=>{});` +
    linhas.map((l) => `process.stdout.write(${JSON.stringify(l + '\n')});`).join('') +
    `process.exit(0)`

  async function gerar(linhas: readonly string[], jsonSchema?: string): Promise<string> {
    const adapter = new ClaudeCodeAdapter(runsDeTeste().abrir, ((
      _b: string,
      _a: readonly string[],
      opcoes: object
    ) => spawn(process.execPath, ['-e', scriptQueEmite(linhas)], opcoes)) as typeof spawn)

    let texto = ''
    for await (const chunk of adapter.generateStream(
      pedido({
        fase: 'planejamento',
        timeoutMs: 3_000,
        ...(jsonSchema === undefined ? {} : { jsonSchema })
      })
    )) {
      if (chunk.tipo === 'texto') texto += chunk.texto
    }

    return texto
  }

  it('o documento é o da chamada de StructuredOutput, e o texto anterior não cola nele', async () => {
    const texto = await gerar([TEXTO_DO_MODELO, ENFORCE, CHAMADA], '{"type":"object"}')

    // A asserção que falha com o defeito: `{…}{…}` quebra aqui, no fim do primeiro.
    expect(JSON.parse(texto)).toEqual(DOCUMENTO)
  })

  it('sem nenhuma chamada de StructuredOutput, o texto do modelo continua sendo o documento', async () => {
    const texto = await gerar([TEXTO_DO_MODELO], '{"type":"object"}')

    expect(JSON.parse(texto)).toEqual(DOCUMENTO)
  })

  it('sem schema, o texto do modelo sai como sempre', async () => {
    expect(JSON.parse(await gerar([TEXTO_DO_MODELO]))).toEqual(DOCUMENTO)
  })
})
