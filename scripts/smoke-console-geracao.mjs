/**
 * Smoke do console da geração contra o **Claude Code CLI real** (SPEC-Fases-03).
 *
 * Fora da suíte padrão, como manda o `docs/TESTING.md` §3.2: depende do binário `claude` estar
 * instalado e autenticado, e de uma chamada de verdade ao modelo. Roda à mão, e a saída entra
 * na entrega como evidência.
 *
 * ## Por que existe, se há 29 testes verdes sobre o parser
 *
 * Porque as fixtures são gravadas e o CLI é vivo. Um dublê responde no formato que eu **anotei**;
 * o CLI responde no formato que ele tem hoje — com a versão instalada, os hooks da máquina, a
 * telemetria que a Anthropic acrescentou desde a captura. Três vezes neste projeto o smoke com
 * infraestrutura real achou o que o dublê escondia.
 *
 * ## Uso
 *
 *   TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/smoke-console-geracao.mjs
 *
 * O `TSX_TSCONFIG_PATH` não é enfeite: o parser importa `@shared/domain/geracao`, e o alias mora
 * no `tsconfig.node.json` — o `tsconfig.json` da raiz só referencia os dois projetos, então sem
 * apontar o certo o `tsx` não resolve o import e o smoke morre antes de chamar o CLI.
 *
 * Sai com código 0 quando o console viu o conjunto completo (texto, ferramenta e uso), e 1 com o
 * diagnóstico quando não viu.
 *
 * ## Execução de 2026-09-04 (evidência da entrega)
 *
 *   texto: 1 · ferramenta-inicio: 1 · ferramenta-fim: 1 · uso: 1
 *   ferramenta: Bash · grep -m1 '"name"' ".../package.json" → ok · 25 B
 *   uso: 227690 entrada · 125 saída · 5548 ms
 *   linhas ignoradas: system, rate_limit_event
 *
 * Os 227.690 tokens de entrada são o ponto: a aproximação por caracteres que o adapter usava
 * antes desta fatia daria ~30, porque ela media o prompt e não o contexto que o CLI carrega.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * O prompt precisa **forçar uma ferramenta**, senão o smoke só provaria o caminho de texto — que
 * é justamente o que os adapters antigos já faziam. Ler um arquivo do próprio repo é a chamada
 * mais barata que produz um `tool_use` e um `tool_result` de verdade.
 */
const PROMPT =
  'Leia o arquivo package.json deste diretório e responda apenas com o valor do campo "name". ' +
  'Nada mais.'

/** O modelo mais barato da rota de assinatura. */
const MODELO = 'claude-fable-5-1'

async function main() {
  // Importa o código **construído do repo**, não uma cópia: o ponto do smoke é exercitar o
  // parser que vai para produção. `tsx` resolve o TypeScript e os aliases.
  const { parsearLinha, extrairLinhas } = await importarDoRepo()

  console.log(`[smoke] Chamando o CLI real com --output-format stream-json --verbose`)
  console.log(`[smoke] modelo: ${MODELO}`)
  console.log(`[smoke] cwd: ${RAIZ}\n`)

  const eventos = []
  const linhasIgnoradas = []
  let resto = ''

  const inicio = Date.now()
  const processo = spawn(
    'claude',
    ['--print', '--model', MODELO, '--output-format', 'stream-json', '--verbose'],
    { cwd: RAIZ, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )

  processo.stdin.write(PROMPT)
  processo.stdin.end()

  processo.stdout.on('data', (pedaco) => {
    const extracao = extrairLinhas(resto + pedaco.toString('utf8'))
    resto = extracao.resto

    for (const linha of extracao.linhas) {
      const produzidos = parsearLinha(linha)
      if (produzidos.length === 0) {
        // Linha que o parser ignorou de propósito (init, hooks, rate limit). Guardo o `type`
        // para o relatório: um tipo novo aparecendo aqui é sinal de que o CLI mudou.
        try {
          linhasIgnoradas.push(JSON.parse(linha).type ?? '(sem type)')
        } catch {
          linhasIgnoradas.push('(nao-json)')
        }
      }
      eventos.push(...produzidos)
    }
  })

  let stderr = ''
  processo.stderr.on('data', (pedaco) => {
    stderr += pedaco.toString('utf8')
  })

  const codigo = await new Promise((resolve) => {
    processo.on('close', resolve)
    processo.on('error', (erro) => {
      console.error(`[smoke] Falha ao executar o CLI: ${erro.message}`)
      console.error('[smoke] O binário `claude` está no PATH?')
      process.exit(1)
    })
  })

  // A última linha pode não ter '\n' — é onde mora o `result` com o `usage`.
  if (resto.trim() !== '') eventos.push(...parsearLinha(resto))

  relatar({ eventos, linhasIgnoradas, codigo, stderr, duracaoMs: Date.now() - inicio })
}

function relatar({ eventos, linhasIgnoradas, codigo, stderr, duracaoMs }) {
  const porTipo = new Map()
  for (const evento of eventos) porTipo.set(evento.tipo, (porTipo.get(evento.tipo) ?? 0) + 1)

  console.log('[smoke] --- eventos que o console recebeu ---')
  for (const [tipo, quantidade] of porTipo) console.log(`[smoke]   ${tipo}: ${quantidade}`)

  const ignoradasUnicas = [...new Set(linhasIgnoradas)]
  console.log(`\n[smoke] tipos de linha ignorados: ${ignoradasUnicas.join(', ') || '(nenhum)'}`)
  console.log(`[smoke] saída do processo: ${codigo} · ${(duracaoMs / 1000).toFixed(1)}s`)

  const texto = eventos
    .filter((e) => e.tipo === 'texto')
    .map((e) => e.delta)
    .join('')
  console.log(`\n[smoke] texto montado: ${JSON.stringify(texto.slice(0, 200))}`)

  for (const evento of eventos.filter((e) => e.tipo === 'ferramenta-inicio')) {
    console.log(`[smoke] ferramenta: ${evento.nome} · ${evento.resumoDoArgumento}`)
  }
  for (const evento of eventos.filter((e) => e.tipo === 'ferramenta-fim')) {
    console.log(
      `[smoke]   → ${evento.status} · ${evento.tamanhoOriginal} B ` +
        `(resumo com ${evento.resumoDoResultado.length} caracteres)`
    )
  }
  for (const evento of eventos.filter((e) => e.tipo === 'uso')) {
    console.log(
      `[smoke] uso: ${evento.tokensEntrada} entrada · ${evento.tokensSaida} saída · ` +
        `${evento.duracaoMs} ms`
    )
  }
  for (const evento of eventos.filter((e) => e.tipo === 'erro')) {
    console.log(`[smoke] ERRO DE PARSER: ${evento.mensagem}`)
  }

  if (stderr.trim() !== '')
    console.log(`\n[smoke] stderr do CLI (não vai para a tela): ${stderr.slice(0, 300)}`)

  // O que o smoke afirma. Cada falha aponta um defeito diferente:
  const faltando = []
  if ((porTipo.get('texto') ?? 0) === 0) faltando.push('texto (o documento não sairia)')
  if ((porTipo.get('ferramenta-inicio') ?? 0) === 0)
    faltando.push('ferramenta-inicio (o console não veria as ferramentas)')
  if ((porTipo.get('ferramenta-fim') ?? 0) === 0)
    faltando.push('ferramenta-fim (a linha ficaria sem status para sempre)')
  if ((porTipo.get('uso') ?? 0) === 0) faltando.push('uso (o ledger cairia na aproximação)')
  if ((porTipo.get('erro') ?? 0) > 0)
    faltando.push('o parser reportou erro numa linha — o formato do CLI pode ter mudado')

  console.log('')
  if (faltando.length > 0) {
    console.error('[smoke] FALHOU. Não veio:')
    for (const item of faltando) console.error(`[smoke]   - ${item}`)
    process.exit(1)
  }

  console.log('[smoke] OK — o console viu o conjunto completo contra o CLI real.')
}

async function importarDoRepo() {
  try {
    return await import('../src/main/ai/stream-json-parser.ts')
  } catch (erro) {
    console.error('[smoke] Não consegui importar o parser. Rode com `npx tsx`:')
    console.error('[smoke]   npx tsx scripts/smoke-console-geracao.mjs')
    console.error(`[smoke] Causa: ${erro.message}`)
    process.exit(1)
  }
}

await main()
