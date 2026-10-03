/**
 * F00-bis da M11-F00b (SPEC-Squads-00 § Emenda E1): mede o orquestrador com o instrumento corrigido.
 *
 *   TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/orquestrador-e1.mjs <modelo>
 *
 * `<modelo>` é `hermes3:8b`, `qwen3:8b` (Ollama) ou `fase:<modelo>` (CLI do Claude, por assinatura,
 * o controle: se o modelo da fase também reprova, o defeito é do instrumento).
 *
 * Mede o **produto**, não uma cópia dele: cada fatia passa pelo `planejarSquad` de produção, com o
 * pedido de produção (`montarPedido`), o validador endurecido, o feedback das rejeições e o limite
 * de três tentativas da M9-F04. O que o harness acrescenta é só o bloco da base (árvore de arquivos
 * e stack) no `system`, e o registro de latência, tokens e VRAM de cada chamada. O gerador da fase
 * fica indisponível nas medições do local: o critério é do local sozinho.
 *
 * Grava `reports/squads-prova-e1/orquestrador-<modelo>.json` com tudo que o relatório lê.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERFIL_PADRAO } from '../../src/shared/domain/squad-perfil.ts'
import { planejarSquad } from '../../src/main/squads/squad-planejador.ts'
import { criarSnapshotDoSquad } from '../../src/main/squads/squad-snapshot.ts'
import { blocoDaBase } from '../../src/main/squads/prova/base-do-prompt.ts'
import { chamarClaude, chamarOllama, NUM_CTX } from './orquestrador.mjs'
import { ARQUIVO_DO_SNAPSHOT, hashesDosArquivos } from './snapshot-e1.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PASTA = join(RAIZ, 'reports', 'squads-prova-e1')
const FASE = { provider: 'claude-code', modelo: 'claude-fable-5-1' }

const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1 << 28 })
const AMBIENTE = (modelo) => ({
  skills: ['code-review', 'superpowers:test-driven-development'],
  ferramentas: [],
  ollama: { disponivel: true, modelos: [modelo] },
  optInApiPaga: false
})

export function lerSnapshot() {
  const snapshot = JSON.parse(readFileSync(ARQUIVO_DO_SNAPSHOT, 'utf8'))
  const atuais = hashesDosArquivos()
  const mudados = Object.keys(atuais).filter((a) => atuais[a] !== snapshot.arquivosCongelados[a])
  if (mudados.length > 0)
    throw new Error(
      `O instrumento mudou depois do snapshot: ${mudados.join(', ')}. ` +
        'Regerar o snapshot invalida as medições anteriores — decisão do PI, não do harness.'
    )
  return snapshot
}

const perfilLocal = (modelo) => ({
  ...PERFIL_PADRAO,
  camadas: {
    ...PERFIL_PADRAO.camadas,
    orquestrador: { origem: 'modelo', provider: 'ollama', modelo, validador: 'e1', numCtx: NUM_CTX }
  }
})

/** `GeradorDePlano` sobre as chamadas medidas; cada chamada fica em `registro`. */
function gerador(origem, modeloEscolhido, chamar, bloco, registro) {
  return {
    origem,
    modelo: modeloEscolhido,
    async propor(pedido) {
      const mensagens = [
        { role: 'system', content: `${pedido.system}\n\n${bloco}` },
        { role: 'user', content: pedido.prompt }
      ]
      const r = await chamar(mensagens, JSON.parse(pedido.jsonSchema))
      registro.push({
        tentativa: pedido.tentativa,
        latenciaMs: r.latenciaMs,
        promptTokens: r.promptTokens ?? null,
        saidaTokens: r.saidaTokens ?? null,
        numCtxEfetivo: r.numCtxEfetivo ?? null,
        vramBytes: r.vramBytes ?? null,
        truncado:
          r.promptTokens !== undefined && r.promptTokens !== null && r.promptTokens >= NUM_CTX - 64,
        erro: r.erro ?? null,
        texto: r.texto ?? null
      })
      if (r.erro)
        return {
          ok: false,
          motivo: origem === 'local' ? 'INDISPONIVEL' : 'FALHOU',
          detalhe: r.erro
        }
      return { ok: true, texto: r.texto }
    }
  }
}

const geradorIndisponivel = {
  origem: 'fase',
  modelo: FASE,
  propor: async () => ({
    ok: false,
    motivo: 'INDISPONIVEL',
    detalhe: 'fase fora da medição do local'
  })
}

function resumoDoPlano(plano) {
  const escritores = new Set(
    plano.tarefas.flatMap((t) => (t.escritor === undefined ? [] : [t.escritor]))
  )
  return {
    tarefas: plano.tarefas.length,
    escritores: escritores.size,
    paths: [...new Set(plano.tarefas.flatMap((t) => t.paths))].sort(),
    papeis: Object.fromEntries(
      [...new Set(plano.tarefas.map((t) => t.papel))].map((p) => [
        p,
        plano.tarefas.filter((t) => t.papel === p).length
      ])
    )
  }
}

async function medirFatia(modelo, fatia, snapshotDaProva) {
  const ehFase = modelo.startsWith('fase:')
  const arquivosDaBase = git('ls-tree', '-r', '--name-only', fatia.base).split('\n').filter(Boolean)
  const packageJson = git('show', `${fatia.base}:package.json`)
  const bloco = blocoDaBase({
    arquivosDaBase,
    pathsPermitidos: fatia.pathsPermitidos,
    packageJson
  })

  const registro = []
  const escolhido = ehFase ? FASE : { provider: 'ollama', modelo }
  const snapshotDoSquad = criarSnapshotDoSquad(
    ehFase ? PERFIL_PADRAO : perfilLocal(modelo),
    ehFase ? { ...AMBIENTE(modelo), ollama: { disponivel: false, modelos: [] } } : AMBIENTE(modelo),
    FASE
  )
  const chamar = ehFase
    ? (m, esquema) => chamarClaude(modelo.slice(5), m, esquema)
    : (m, esquema) => chamarOllama(modelo, m, esquema)
  const ativo = gerador(ehFase ? 'fase' : 'local', escolhido, chamar, bloco, registro)

  const eventos = []
  const resultado = await planejarSquad(
    {
      ...(ehFase ? {} : { geradorLocal: ativo }),
      geradorFase: ehFase ? ativo : geradorIndisponivel,
      auditoria: { append: (e) => void eventos.push(e) },
      escopo: { userId: 'prova', workspaceId: 'prova' }
    },
    {
      runId: `f00b-${fatia.id}-${modelo}`,
      specRevisao: fatia.specSha256,
      spec: {
        titulo: fatia.titulo,
        criterios: fatia.criterios.map((c) => ({ numero: c.n, texto: c.texto }))
      },
      snapshot: snapshotDoSquad,
      base: {
        pathsPermitidos: fatia.pathsPermitidos,
        fontesPermitidas: snapshotDaProva.fontesPermitidas,
        arquivosDaBase,
        orcamentoUsd: snapshotDaProva.orcamentoUsd
      }
    }
  )

  const doGerador = resultado.historico.filter((h) => h.gerador === (ehFase ? 'fase' : 'local'))
  const aceita = doGerador.find((h) => h.resultado === 'aceita')
  return {
    fatia: fatia.id,
    criterios: fatia.criterios.length,
    tamanhoDoBloco: bloco.length,
    primeiraTentativa: doGerador[0]?.resultado ?? 'nenhuma',
    aceitoNoLimite: aceita !== undefined,
    tentativasAteAceitar: aceita?.tentativa ?? null,
    historico: doGerador.map((h) => ({
      tentativa: h.tentativa,
      resultado: h.resultado,
      motivos: h.rejeicoes.map((r) => ({
        motivo: r.motivo,
        tarefa: r.tarefa ?? null,
        detalhe: r.detalhe
      }))
    })),
    plano: resultado.ok ? resumoDoPlano(resultado.plano) : null,
    planoCompleto: resultado.ok ? resultado.plano : null,
    chamadas: registro
  }
}

async function principal() {
  const modelo = process.argv[2]
  if (!modelo) throw new Error('uso: orquestrador-e1.mjs <hermes3:8b|qwen3:8b|fase:<modelo>>')
  const so = process.argv[3]
  const snapshot = lerSnapshot()
  const ehFase = modelo.startsWith('fase:')

  if (!ehFase) {
    // Carrega o modelo antes de medir: a latência do plano não deve incluir o load do disco.
    const t = performance.now()
    await chamarOllama(modelo, [{ role: 'user', content: 'ok' }])
    console.log(`${modelo} carregado em ${Math.round(performance.now() - t)} ms`)
  }

  const resultados = []
  mkdirSync(PASTA, { recursive: true })
  for (const fatia of snapshot.fatias.filter((f) => so === undefined || f.id === so)) {
    const r = await medirFatia(modelo, fatia, snapshot)
    resultados.push(r)
    const linha =
      `${fatia.id.padEnd(8)} 1ª=${r.primeiraTentativa.padEnd(9)} limite=${r.aceitoNoLimite ? `aceito(t${r.tentativasAteAceitar})` : 'REJEITADO'} ` +
      `tentativas=${r.historico.length} ${r.chamadas.reduce((s, c) => s + c.latenciaMs, 0)}ms`
    console.log(linha)
    appendFileSync(join(PASTA, '.progresso.log'), `${modelo} ${linha}\n`)
  }

  const primeira = resultados.filter((r) => r.primeiraTentativa === 'aceita').length
  const noLimite = resultados.filter((r) => r.aceitoNoLimite).length
  const saida = {
    modelo,
    executadoEm: new Date().toISOString(),
    snapshotCommit: snapshot.commit,
    numCtxPedido: NUM_CTX,
    temperatura: 0,
    semente: 42,
    total: resultados.length,
    aceitosNaPrimeira: primeira,
    aceitosNoLimite: noLimite,
    taxaNaPrimeira: primeira / resultados.length,
    taxaNoLimite: noLimite / resultados.length,
    resultados
  }
  // Rodada de uma fatia só é diagnóstico: nunca sobrescreve a medição inteira.
  const nome = so === undefined ? 'orquestrador' : `.diagnostico-${so}`
  writeFileSync(
    join(PASTA, `${nome}-${modelo.replace(/[:/]/g, '_')}.json`),
    `${JSON.stringify(saida, null, 2)}\n`
  )
  console.log(
    `\n${modelo}: 1ª tentativa ${primeira}/${resultados.length}, no limite ${noLimite}/${resultados.length} (${(saida.taxaNoLimite * 100).toFixed(1)}%)`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
