/**
 * Contexto, skills e orçamento pela ponte real (SPEC-Planejamento-02).
 *
 * O que este teste prova e nenhum teste de componente consegue: **o gate do critério 1 está
 * ligado no app que roda**. Num teste de componente a ponte é dublada, e um dublê aceita
 * qualquer coisa — ele diria que a tela pede o pack sem nunca provar que uma chamada de IA sem
 * manifesto é de fato recusada pelo ponto único, com o Policy Engine, o orçamento e a auditoria
 * reais no caminho.
 *
 * Os três fatos que só existem aqui:
 *  1. **Sem `contextPackId`, a geração não sai** — e o desfecho é `falhou`, não exceção.
 *  2. O arquivo com credencial é lido **do disco de verdade** e recusa o pack inteiro.
 *  3. O manifesto atravessa a persistência com os hashes, e a cadeia de auditoria continua
 *     íntegra depois de tudo isso.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta, então a navegação pela sidebar fica fora do alcance —
 * a mesma razão registrada em `projetos-locais.e2e.ts`. O que se exercita aqui é a ponte real e
 * o efeito no disco e no banco; a renderização tem suíte própria em `contexto.test.tsx`.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string

interface OutcomeDaPonte {
  readonly reason: string
  readonly mensagem: string
  readonly project?: { readonly id: string; readonly nome: string; readonly diretorio: string }
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-contexto-'))

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: ''
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam pelo tray e pelos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`).
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
})

/** Cria um projeto real pela ponte, com o `git` permitido. Devolve o desfecho. */
async function criarProjeto(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<OutcomeDaPonte> {
  return await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    return await bridge.createProject('Projeto Contexto', workspace)
  })
}

test('o manifesto registra a revisão enviada, e a auditoria continua íntegra', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await criarProjeto(janela)
  expect(projeto.reason).toBe('criado')
  const diretorio = projeto.project?.diretorio ?? ''

  // Escrito **do lado do teste**, no disco real: o serviço vai lê-lo e hasheá-lo. Um conteúdo
  // injetado pela ponte provaria só que o hash de uma string é estável.
  writeFileSync(join(diretorio, 'docs', 'PRD.md'), '# PRD\n\nO produto faz X.\n', 'utf8')

  const resultado = await janela.evaluate(async (projectId: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          buildContextPack: (
            pedido: unknown,
            w: string
          ) => Promise<{
            reason: string
            mensagem: string
            pack?: {
              id: string
              hash: string
              itens: readonly { caminho: string; hash: string; bytes: number }[]
              orcamento: { unmetered: boolean; estimadoUsd: number | null; tetoDeTokens: number }
            }
          }>
          listContextPacks: (p: string) => Promise<readonly { id: string; hash: string }[]>
          verifyAuditChain: () => Promise<{ ok: boolean }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    const montado = await bridge.buildContextPack(
      {
        projectId,
        tarefa: 'SPEC-Planejamento-02',
        etapa: 'contexto',
        rota: 'anthropic',
        candidatos: [{ caminho: 'docs/PRD.md', origem: 'explicito', motivo: 'anexado' }]
      },
      workspace
    )

    return {
      montado,
      listados: await bridge.listContextPacks(projectId),
      auditoria: await bridge.verifyAuditChain()
    }
  }, projeto.project?.id ?? '')

  expect(resultado.montado.reason).toBe('montado')
  // O hash existe por item e é SHA-256 do conteúdo que o main leu do disco — é ele que torna
  // "esta geração viu esta revisão?" respondível depois.
  expect(resultado.montado.pack?.itens).toHaveLength(1)
  expect(resultado.montado.pack?.itens[0]?.caminho).toBe('docs/PRD.md')
  expect(resultado.montado.pack?.itens[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(resultado.montado.pack?.itens[0]?.bytes).toBeGreaterThan(0)
  // Rota paga: estimativa em USD, e não `null`.
  expect(resultado.montado.pack?.orcamento.unmetered).toBe(false)
  expect(resultado.montado.pack?.orcamento.estimadoUsd).not.toBeNull()
  // O manifesto atravessou a persistência.
  expect(resultado.listados).toHaveLength(1)
  expect(resultado.listados[0]?.hash).toBe(resultado.montado.pack?.hash)
  expect(resultado.auditoria.ok).toBe(true)
})

test('arquivo com credencial recusa o pack inteiro e nada é gravado (critério 7)', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await criarProjeto(janela)
  const diretorio = projeto.project?.diretorio ?? ''

  writeFileSync(join(diretorio, 'docs', 'PRD.md'), '# PRD\n', 'utf8')
  // O arquivo que não pode entrar. Escrito no disco real, com formato de chave reconhecível.
  writeFileSync(
    join(diretorio, '.env'),
    'ANTHROPIC_API_KEY=sk-ant-api03-chave-que-nao-pode-vazar\n',
    'utf8'
  )

  const resultado = await janela.evaluate(async (projectId: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          buildContextPack: (
            pedido: unknown,
            w: string
          ) => Promise<{ reason: string; mensagem: string; caminhosComSegredo?: readonly string[] }>
          listContextPacks: (p: string) => Promise<readonly unknown[]>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    const recusa = await bridge.buildContextPack(
      {
        projectId,
        tarefa: 'SPEC-Planejamento-02',
        etapa: 'contexto',
        rota: 'anthropic',
        candidatos: [
          { caminho: 'docs/PRD.md', origem: 'explicito', motivo: 'anexado' },
          { caminho: '.env', origem: 'explicito', motivo: 'anexado por engano' }
        ]
      },
      workspace
    )

    return { recusa, listados: await bridge.listContextPacks(projectId) }
  }, projeto.project?.id ?? '')

  expect(resultado.recusa.reason).toBe('segredo-no-contexto')
  expect(resultado.recusa.caminhosComSegredo).toEqual(['.env'])
  // O segredo **não** atravessa o IPC: nem na mensagem, nem na lista de caminhos.
  expect(JSON.stringify(resultado.recusa)).not.toContain('sk-ant')
  // E o pack limpo também não foi montado: a recusa é do pack inteiro, não do item.
  expect(resultado.listados).toHaveLength(0)
})

test('leitura ampla sem exceção é recusada; com exceção registrada, passa (critério 3)', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await criarProjeto(janela)
  const diretorio = projeto.project?.diretorio ?? ''
  writeFileSync(join(diretorio, 'docs', 'PRD.md'), '# PRD\n', 'utf8')

  const resultado = await janela.evaluate(async (projectId: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          buildContextPack: (
            pedido: unknown,
            w: string
          ) => Promise<{
            reason: string
            pack?: { excecaoDeLeituraAmpla?: { motivo: string; tetoDeBytes: number } }
          }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    const candidatos = [{ caminho: 'docs/PRD.md', origem: 'leitura-ampla', motivo: 'varredura' }]

    const sem = await bridge.buildContextPack(
      { projectId, tarefa: 't', etapa: 'contexto', rota: 'anthropic', candidatos },
      workspace
    )

    const com = await bridge.buildContextPack(
      {
        projectId,
        tarefa: 't',
        etapa: 'contexto',
        rota: 'anthropic',
        candidatos,
        excecaoDeLeituraAmpla: {
          motivo: 'regressão sem localização conhecida',
          tetoDeBytes: 524_288
        }
      },
      workspace
    )

    return { sem, com }
  }, projeto.project?.id ?? '')

  expect(resultado.sem.reason).toBe('leitura-ampla-sem-excecao')
  // O contrafactual do mesmo teste: com a exceção registrada, o mesmo pedido passa — e o motivo
  // fica **no manifesto**, que é o que "exceção visível" significa.
  expect(resultado.com.reason).toBe('montado')
  expect(resultado.com.pack?.excecaoDeLeituraAmpla?.motivo).toContain('regressão')
})

test('nenhuma geração sem ContextPack — o gate do critério 1, no app real', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const resultado = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          callAi: (request: unknown, w: string) => Promise<{ id: string } | undefined>
          onAiStreamEvent: (
            listener: (evento: { tipo: string; id: string; estado?: string; erro?: string }) => void
          ) => () => void
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    // **Assina antes de chamar**, como a tela real faz — e a primeira versão deste teste, que
    // assinava depois do `await callAi`, expirou por isso. Quando a chamada é recusada pelo
    // gate, o **único** evento é o `fim`: o handler o consome para descobrir o id e o reemite
    // imediatamente, e quem assina depois do `invoke` já perdeu a janela. O comentário do
    // `ChamadaDeIa` nomeia exatamente essa corrida; o teste tinha de respeitá-la.
    const eventos: { tipo: string; id: string; estado?: string; erro?: string }[] = []
    const parar = bridge.onAiStreamEvent((evento) => {
      eventos.push(evento)
    })

    const handle = await bridge.callAi(
      { provider: 'anthropic', prompt: 'qual a capital da Franca' },
      workspace
    )

    if (handle === undefined) {
      parar()
      return { semHandle: true }
    }

    const fim = await new Promise<{ estado?: string; erro?: string } | undefined>((resolver) => {
      const achar = (): { estado?: string; erro?: string } | undefined => {
        const evento = eventos.find((e) => e.tipo === 'fim' && e.id === handle.id)
        return evento === undefined ? undefined : { estado: evento.estado, erro: evento.erro }
      }

      const jaChegou = achar()
      if (jaChegou !== undefined) {
        resolver(jaChegou)
        return
      }

      const relogio = setInterval(() => {
        const agora = achar()
        if (agora !== undefined) {
          clearInterval(relogio)
          clearTimeout(prazo)
          resolver(agora)
        }
      }, 50)

      // Sem prazo, um gate quebrado penduraria o teste em vez de reprovar.
      const prazo = setTimeout(() => {
        clearInterval(relogio)
        resolver(undefined)
      }, 15_000)
    })

    parar()
    return { semHandle: false, ...fim }
  })

  // A chamada **não sai**: sem manifesto, o ponto único recusa antes de tocar o provider — e o
  // desfecho é o evento `fim` com `falhou`, não uma exceção que a tela teria de traduzir.
  expect(resultado?.estado).toBe('falhou')
  expect(resultado?.erro).toContain('contexto')
})
