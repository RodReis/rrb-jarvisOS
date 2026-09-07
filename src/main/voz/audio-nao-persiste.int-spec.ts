import { mkdtempSync, rmSync } from 'node:fs'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FasterWhisperEngine } from './faster-whisper-engine'
import { VozService } from './voz-service'
import { CAMINHO_DA_CONFIGURACAO, escreverConfiguracao, lerConfiguracao } from './configuracao'
import { artefatosFaltando, type DepsDaInstalacao } from './instalacao'
import type { Sidecar } from './sidecar'
import type { Artefato } from './download-de-artefato'

/**
 * **Nenhum áudio em disco** (SPEC-Voz-01, critério 8).
 *
 * Categoria **Banco**: varre o `userData` de verdade, com escrita e leitura reais.
 *
 * ## Por que uma varredura, e não uma asserção sobre o código
 *
 * Os testes de unidade já afirmam que o engine não chama `escrever` durante a transcrição, e o
 * do script afirma que ele não sabe abrir arquivo. As duas são afirmações sobre **o que o código
 * faz** — e o critério é sobre o que **sobra no disco**, que é outra coisa: um temporário do
 * runtime, um cache de biblioteca, um dump de crash. Só olhando o diretório depois de uma sessão
 * é que se responde à pergunta que o critério faz.
 *
 * ## O que conta como áudio
 *
 * Extensão de arquivo de som, e mais: qualquer arquivo cujo conteúdo comece com as assinaturas
 * de WAV, de OGG ou de MP3. Um arquivo de áudio salvo como `.tmp` continua sendo áudio, e mirar
 * só a extensão deixaria passar exatamente o caso que uma retenção acidental produziria.
 */

const EXTENSOES_DE_AUDIO = [
  '.wav',
  '.mp3',
  '.ogg',
  '.flac',
  '.m4a',
  '.aac',
  '.opus',
  '.webm',
  '.pcm',
  '.raw'
]

/** As assinaturas dos formatos que um vazamento acidental produziria. */
const ASSINATURAS: readonly { readonly nome: string; readonly bytes: Buffer }[] = [
  { nome: 'WAV', bytes: Buffer.from('RIFF', 'ascii') },
  { nome: 'OGG', bytes: Buffer.from('OggS', 'ascii') },
  { nome: 'MP3', bytes: Buffer.from('ID3', 'ascii') }
]

/** Todos os arquivos sob um diretório, recursivamente, em caminho relativo a ele. */
async function todosOsArquivos(raiz: string, atual = raiz): Promise<string[]> {
  const entradas = await readdir(atual, { withFileTypes: true })
  const achados: string[] = []

  for (const entrada of entradas) {
    const caminho = join(atual, entrada.name)

    if (entrada.isDirectory()) achados.push(...(await todosOsArquivos(raiz, caminho)))
    else achados.push(relative(raiz, caminho))
  }

  return achados
}

/** Os arquivos que parecem áudio, por extensão ou por conteúdo. */
async function arquivosDeAudio(raiz: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises')
  const suspeitos: string[] = []

  for (const relativo of await todosOsArquivos(raiz)) {
    if (EXTENSOES_DE_AUDIO.some((e) => relativo.toLowerCase().endsWith(e))) {
      suspeitos.push(relativo)
      continue
    }

    const conteudo = await readFile(join(raiz, relativo))
    if (ASSINATURAS.some(({ bytes }) => conteudo.subarray(0, bytes.length).equals(bytes))) {
      suspeitos.push(relativo)
    }
  }

  return suspeitos
}

let userData: string

const CATALOGO: readonly Artefato[] = [
  {
    id: 'runtime-python',
    grupo: 'runtime',
    url: 'https://exemplo.invalido/py.tar.gz',
    sha256: 'a',
    destino: 'voz/runtime/py.tar.gz'
  },
  {
    id: 'modelo-whisper-small-model',
    grupo: 'modelo',
    url: 'https://exemplo.invalido/model.bin',
    sha256: 'b',
    destino: 'voz/models/whisper-small/model.bin'
  }
]

const naVoz = (relativo: string): string => join(userData, relativo)

/** Uma instalação de verdade sobre o diretório temporário — escreve e lê disco. */
function instalacaoReal(): DepsDaInstalacao {
  return {
    existe: async (relativo) =>
      await import('node:fs/promises').then(({ access }) =>
        access(naVoz(relativo)).then(
          () => true,
          () => false
        )
      ),
    extrair: async (_origem, destino) => void (await mkdir(naVoz(destino), { recursive: true })),
    escrever: async (relativo, conteudo) => {
      await mkdir(join(naVoz(relativo), '..'), { recursive: true })
      await writeFile(naVoz(relativo), conteudo, 'utf8')
    },
    rodarPython: async () => undefined,
    absoluto: naVoz
  }
}

/** Um sidecar que responde sem tocar disco — o real também não toca, e é isso que se mede. */
function sidecarFalso(): Sidecar {
  return {
    pedir: vi.fn(async () => ({
      ok: true,
      texto: 'bom dia',
      idioma: 'pt',
      segmentos: [{ inicioMs: 0, fimMs: 900, texto: 'bom dia' }]
    })),
    encerrar: vi.fn(async () => undefined)
  } as unknown as Sidecar
}

/** Um PCM de meio segundo, como o que a captura entrega. */
function pcmDeMeioSegundo(): Int16Array {
  const amostras = new Int16Array(8_000)
  for (let i = 0; i < amostras.length; i += 1) amostras[i] = Math.round(Math.sin(i / 8) * 12_000)

  return amostras
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'voz-userdata-'))

  // O estado de quem já baixou tudo: é o único em que a transcrição roda, e por isso o único
  // em que um vazamento de áudio poderia acontecer.
  for (const artefato of CATALOGO) {
    await mkdir(join(naVoz(artefato.destino), '..'), { recursive: true })
    await writeFile(naVoz(artefato.destino), 'conteudo do artefato')
  }
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('nenhum áudio em disco — a sessão de uso (critério 8)', () => {
  it('depois de transcrever, o userData não tem arquivo de áudio', async () => {
    const engine = new FasterWhisperEngine({
      artefatos: CATALOGO,
      instalacao: instalacaoReal(),
      criarSidecar: sidecarFalso,
      lerConfiguracaoBruta: async () => undefined,
      absoluto: naVoz,
      registrarCompute: vi.fn()
    })

    const voz = new VozService({
      engine,
      artefatosFaltando: () => artefatosFaltando(CATALOGO, instalacaoReal().existe),
      computeAtual: () => 'cpu-int8',
      configuracaoAtual: async () => lerConfiguracao(undefined),
      gravarConfiguracao: async (pedida) => lerConfiguracao(escreverConfiguracao(pedida))
    })

    // Uma sessão de uso inteira: prontidão, três enunciados, e o encerramento.
    await voz.prontidao()
    await voz.transcrever(pcmDeMeioSegundo())
    await voz.transcrever(pcmDeMeioSegundo())
    await voz.transcrever(pcmDeMeioSegundo())
    await engine.encerrar()

    expect(await arquivosDeAudio(userData)).toEqual([])
  })

  it('a instalação escreve no disco — a varredura está olhando um diretório vivo', async () => {
    // Sem isto, um `userData` vazio por acidente (caminho errado, escrita que nunca aconteceu)
    // passaria no teste acima e ele afirmaria ausência de áudio sobre um diretório onde nada
    // jamais foi gravado.
    const engine = new FasterWhisperEngine({
      artefatos: CATALOGO,
      instalacao: instalacaoReal(),
      criarSidecar: sidecarFalso,
      lerConfiguracaoBruta: async () => undefined,
      absoluto: naVoz,
      registrarCompute: vi.fn()
    })

    await engine.disponivel()

    const arquivos = await todosOsArquivos(userData)
    expect(arquivos.length).toBeGreaterThan(CATALOGO.length)
    expect(arquivos.some((a) => a.includes('sidecar.py'))).toBe(true)
  })

  it('gravar a configuração também não deixa áudio para trás', async () => {
    const voz = new VozService({
      engine: {
        transcribe: vi.fn(async () => ({ texto: '', idioma: 'pt', segmentos: [] })),
        disponivel: async () => true,
        encerrar: async () => undefined
      },
      artefatosFaltando: async () => [],
      computeAtual: () => 'cpu-int8',
      configuracaoAtual: async () => lerConfiguracao(undefined),
      gravarConfiguracao: async (pedida) => {
        const texto = escreverConfiguracao(pedida)
        await mkdir(join(naVoz(CAMINHO_DA_CONFIGURACAO), '..'), { recursive: true })
        await writeFile(naVoz(CAMINHO_DA_CONFIGURACAO), texto, 'utf8')

        return lerConfiguracao(texto)
      }
    })

    await voz.configurar({ modelo: 'base', idioma: 'en' })
    await voz.transcrever(pcmDeMeioSegundo())

    expect(await arquivosDeAudio(userData)).toEqual([])
  })
})

describe('nenhum áudio em disco — a varredura acha o que deveria achar', () => {
  it('acusa um WAV plantado, para provar que ela não passa vazia', async () => {
    // Contrafactual da própria ferramenta: uma varredura que nunca acusa nada passaria em
    // qualquer implementação, inclusive numa que gravasse o áudio inteiro.
    await mkdir(naVoz('voz/temporario'), { recursive: true })
    await writeFile(naVoz('voz/temporario/captura.wav'), Buffer.from('RIFF....WAVEfmt '))

    expect(await arquivosDeAudio(userData)).toContain(join('voz', 'temporario', 'captura.wav'))
  })

  it('acusa áudio escondido atrás de outra extensão', async () => {
    // Mirar só a extensão deixaria passar exatamente o caso que uma retenção acidental produz:
    // um arquivo temporário com conteúdo de som.
    await mkdir(naVoz('voz/runtime'), { recursive: true })
    await writeFile(naVoz('voz/runtime/buffer.tmp'), Buffer.from('RIFF....WAVEfmt '))

    expect(await arquivosDeAudio(userData)).toContain(join('voz', 'runtime', 'buffer.tmp'))
  })

  it('não confunde arquivo de texto com áudio', async () => {
    await writeFile(naVoz('config.json'), '{"modelo":"small"}')

    expect(await arquivosDeAudio(userData)).toEqual([])
  })
})
