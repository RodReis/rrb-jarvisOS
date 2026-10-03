import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import net from 'node:net'
import dns from 'node:dns'
import { criarEngineOpenWakeWord } from './engine-openwakeword'
import { DetectorDeDuasPalmas } from './detector-de-palmas'
import { EscutaService } from './escuta-service'
import { criarEstadoDaEscutaEmDisco } from './estado-da-escuta-em-disco'
import type { Sidecar } from './sidecar'

/**
 * A escuta não grava e não fala com a rede (SPEC-Escuta-01, critérios 3 e 4).
 *
 * Mesmas duas pernas do `sem-audio-em-disco` da M17-F01, pela mesma razão: varrer o diretório
 * prova o **efeito** e passa também num app que nunca ouviu nada; ler o **código** do sidecar
 * prova que não existe caminho que escreva. Um dos dois sozinho seria fraco — e por isso a sessão
 * simulada aqui roda de verdade, contra um sidecar dublê, antes de qualquer varredura.
 */

/** Um sidecar dublê que responde como o real: sem processo, sem rede, sem disco. */
function sidecarQueResponde(): Sidecar {
  return {
    pedir: async (payload: Record<string, unknown>) =>
      payload.op === 'configurar' ? { ok: true } : { ok: true, confianca: 0.02 },
    encerrar: async () => undefined
  } as unknown as Sidecar
}

/** Cinco segundos de um tom: sinal de verdade, sem nenhuma palavra de ativação. */
function umaSessaoDeSilencioRelativo(): Int16Array[] {
  const blocos: Int16Array[] = []
  for (let b = 0; b < 62; b += 1) {
    const bloco = new Int16Array(1280)
    for (let i = 0; i < bloco.length; i += 1) {
      bloco[i] = Math.round(900 * Math.sin(((b * 1280 + i) / 16_000) * 2 * Math.PI * 180))
    }
    blocos.push(bloco)
  }
  return blocos
}

function varrer(raiz: string): string[] {
  const achados: string[] = []
  const descer = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome)
      if (statSync(caminho).isDirectory()) descer(caminho)
      else achados.push(caminho)
    }
  }
  descer(raiz)
  return achados
}

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-escuta-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function montarSessao() {
  const disparos: unknown[] = []
  const engine = criarEngineOpenWakeWord({
    sidecar: sidecarQueResponde(),
    configuracao: () => ({
      modelo: join(userData, 'm.onnx'),
      melspec: join(userData, 'mel.onnx'),
      embedding: join(userData, 'emb.onnx'),
      artefatosPresentes: () => true
    })
  })
  const servico = new EscutaService({
    engine,
    palmas: new DetectorDeDuasPalmas(),
    estado: criarEstadoDaEscutaEmDisco(join(userData, 'voz', 'escuta.json')),
    modeloPronto: async () => true,
    auditar: () => undefined,
    sessaoBloqueada: () => false,
    turnoAtivo: () => false,
    aoMudarCaptura: () => undefined,
    aoDisparar: (e) => void disparos.push(e)
  })
  return { servico, disparos }
}

describe('nenhum áudio em disco (critério 4)', () => {
  it('uma sessão de escuta não deixa áudio no userData — só o estado do kill switch', async () => {
    const { servico, disparos } = montarSessao()
    await servico.restaurar()

    for (const bloco of umaSessaoDeSilencioRelativo()) await servico.receberPcm(bloco)
    await servico.desligar('interface')

    // A sessão ouviu de verdade (62 blocos) e escreveu o que deve — o estado — e nada além.
    expect(disparos).toEqual([])
    expect(varrer(userData).map((a) => relative(userData, a))).toEqual([join('voz', 'escuta.json')])
  })

  it('o arquivo de estado não carrega amostra nenhuma', async () => {
    const { servico } = montarSessao()
    await servico.restaurar()
    for (const bloco of umaSessaoDeSilencioRelativo()) await servico.receberPcm(bloco)

    const conteudo = JSON.parse(readFileSync(join(userData, 'voz', 'escuta.json'), 'utf8'))

    expect(Object.keys(conteudo).sort()).toEqual([
      'ativa',
      'frase',
      'hotkey',
      'palmas',
      'sensibilidade'
    ])
  })
})

describe('nada sai antes do disparo (critério 3)', () => {
  it('uma sessão sem palavra de ativação não faz requisição nem abre conexão', async () => {
    const fetchEspiado = vi.spyOn(globalThis, 'fetch')
    const conexao = vi.spyOn(net.Socket.prototype, 'connect')
    const resolucao = vi.spyOn(dns, 'lookup')
    const { servico } = montarSessao()
    await servico.restaurar()

    for (const bloco of umaSessaoDeSilencioRelativo()) await servico.receberPcm(bloco)

    expect(fetchEspiado).not.toHaveBeenCalled()
    expect(conexao).not.toHaveBeenCalled()
    expect(resolucao).not.toHaveBeenCalled()
  })

  it('controle: o espião enxerga uma requisição de verdade — o teste acima não passa vazio', async () => {
    const fetchEspiado = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await fetch('http://127.0.0.1:1/ping')

    expect(fetchEspiado).toHaveBeenCalledTimes(1)
  })
})

/** Tira comentários e docstrings: a garantia não pode reprovar contra o texto que a documenta. */
function codigoPython(fonte: string): string {
  return fonte
    .replace(/"""[\s\S]*?"""/g, '')
    .split('\n')
    .filter((linha) => !linha.trimStart().startsWith('#'))
    .join('\n')
}

const ESCRITA_EM_ARQUIVO = /\bopen\s*\([^)]*["'][waxb+]+["']/
const MODULO_DE_AUDIO = /\bimport\s+(wave|soundfile|scipy)\b/
const GRAVA_AMOSTRA = /\.(writeframes|tofile|savefig|to_wav)\s*\(/
const MODULO_DE_REDE = /\b(import|from)\s+(socket|urllib|requests|http|httpx|aiohttp|websockets?)\b/

describe('o sidecar não tem caminho de escrita nem de rede', () => {
  const fonte = codigoPython(readFileSync(join(__dirname, 'sidecar-wake.py'), 'utf8'))

  it('o script não abre arquivo para escrita nem importa módulo de gravação', () => {
    expect(fonte).not.toMatch(ESCRITA_EM_ARQUIVO)
    expect(fonte).not.toMatch(MODULO_DE_AUDIO)
    expect(fonte).not.toMatch(GRAVA_AMOSTRA)
  })

  it('o script não importa módulo de rede', () => {
    expect(fonte).not.toMatch(MODULO_DE_REDE)
  })

  it('controle: as expressões reprovam o código que existem para pegar', () => {
    expect('open("x.wav", "wb")').toMatch(ESCRITA_EM_ARQUIVO)
    expect('import wave').toMatch(MODULO_DE_AUDIO)
    expect('buffer.tofile("a.raw")').toMatch(GRAVA_AMOSTRA)
    expect('import urllib.request').toMatch(MODULO_DE_REDE)
    expect('from requests import get').toMatch(MODULO_DE_REDE)
  })
})

describe('o lado TypeScript da escuta também não escreve nem sai para a rede', () => {
  it.each(['engine-openwakeword.ts', 'escuta-service.ts', 'buffer-circular-audio.ts'])(
    '%s não importa fs de escrita nem faz requisição',
    (arquivo) => {
      const fonte = readFileSync(join(__dirname, arquivo), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((linha) => !linha.trimStart().startsWith('//'))
        .join('\n')

      expect(fonte).not.toMatch(/\b(writeFile|writeFileSync|appendFile|createWriteStream)\b/)
      expect(fonte).not.toMatch(/\bfetch\s*\(|from\s+['"]node:(http|https|net|dgram)['"]/)
    }
  )
})
