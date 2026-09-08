import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TtsService } from './tts-service'
import { criarEnginePiper } from './engine-piper'
import type { Sidecar } from './sidecar'

/**
 * Nenhum áudio sintetizado em disco (SPEC-Voz-02, critério 8).
 *
 * Mesma régua da F01, e o risco aqui é **maior**: no STT o áudio chega de fora e é descartado; no
 * TTS ele é *produzido*, e um `.wav` de cache por frase é a otimização mais natural do mundo — e
 * silenciosa. O critério inclui os previews de Settings de propósito: é o caminho em que o usuário
 * gera dezenas de falas curtas em sequência, exatamente onde um cache pareceria justificado.
 *
 * As duas provas do arquivo da F01, pelo mesmo motivo: a varredura mostra que **não aconteceu**, a
 * leitura da fonte mostra que **não pode acontecer**. Uma sozinha seria fraca — a varredura passa
 * num app que nunca falou, e a fonte não pega quem gravar do lado TypeScript.
 */

/** Um sidecar dublê que devolve áudio como o real, sem processo nenhum. */
function sidecarQueFala(): Sidecar {
  return {
    pedir: async (payload: Record<string, unknown>) =>
      payload.op === 'falar'
        ? {
            ok: true,
            sampleRate: 22050,
            pcm: Array.from({ length: 22050 }, (_, i) =>
              Math.round(8000 * Math.sin((i / 22050) * 2 * Math.PI * 220))
            ),
            fonemas: ['b', 'o', 'n'],
            alinhamentos: [
              { fonema: 'b', amostras: 7350 },
              { fonema: 'o', amostras: 7350 },
              { fonema: 'n', amostras: 7350 }
            ]
          }
        : { ok: true },
    encerrar: async () => undefined
  } as unknown as Sidecar
}

/** Todos os arquivos sob um diretório, recursivamente. */
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

function servicoCom(userData: string): TtsService {
  return new TtsService({
    engine: criarEnginePiper({
      sidecar: sidecarQueFala(),
      vozes: () => [
        { id: 'pt_BR-faber-medium', rotulo: 'Faber', caminho: join(userData, 'faber.onnx') }
      ],
      existe: () => true
    }),
    vozesFaltando: () => []
  })
}

describe('nenhuma fala em disco (critério 8)', () => {
  it('uma sessão de uso, previews inclusive, não deixa arquivo nenhum no userData', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'jarvis-tts-'))

    try {
      const tts = servicoCom(userData)

      // A sessão que o critério nomeia: falas de uso e a repetição de preview que Settings
      // provoca quando alguém compara vozes ouvindo a mesma frase várias vezes.
      for (const texto of ['Bom dia', 'A geração terminou', 'Bom dia', 'Bom dia', 'Bom dia']) {
        const desfecho = await tts.falar(texto, 'pt_BR-faber-medium')
        expect(desfecho.estado).toBe('ok')
      }

      expect(varrer(userData)).toEqual([])
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  it('o áudio não sobrevive à chamada — o serviço não guarda a última fala', async () => {
    /*
     * O `TtsService` é vivo entre chamadas, e "guardar a última fala para repetir" é uma feature
     * plausível — seria o modo de o áudio sobreviver sem tocar o disco. Este teste afirma sobre o
     * objeto: nada dentro dele carrega amostras depois da chamada.
     */
    const userData = mkdtempSync(join(tmpdir(), 'jarvis-tts-'))

    try {
      const tts = servicoCom(userData)
      await tts.falar('Bom dia', 'pt_BR-faber-medium')

      const serializado = JSON.stringify(tts, (_chave, valor) =>
        valor instanceof Int16Array ? '<PCM RETIDO>' : valor
      )

      expect(serializado).not.toContain('<PCM RETIDO>')
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})

describe('nenhuma fala em disco — o sidecar não tem caminho de escrita', () => {
  it('o script Python não grava áudio nem pede ao Piper que grave', () => {
    /*
     * Aqui a guarda precisa de uma proibição que o STT não precisava: o Piper tem uma API própria
     * de escrever WAV (`synthesize_wav`), e usá-la seria uma linha só — mais curta que o caminho
     * correto. Proibir o nome no fonte é o que faz o teste reprovar no momento em que alguém a
     * escrever, e não quando um usuário reparar na pasta cheia de arquivos.
     */
    const fonte = readFileSync(join(__dirname, 'sidecar-tts.py'), 'utf8')

    // Docstrings e comentários saem antes de medir: a docstring deste arquivo promete não gravar,
    // e casar com a própria frase que documenta a garantia seria o oposto do que ele existe para
    // pegar — a lição que a F01 já pagou.
    const codigo = fonte
      .replace(/"""[\s\S]*?"""/g, '')
      .split('\n')
      .filter((linha) => !linha.trimStart().startsWith('#'))
      .join('\n')

    expect(codigo).not.toMatch(/\bopen\s*\([^)]*["'][waxb+]+["']/)
    expect(codigo).not.toMatch(/\bimport\s+(wave|soundfile|scipy)\b/)
    expect(codigo).not.toMatch(/\.(writeframes|tofile|savefig|to_wav|synthesize_wav)\s*\(/)
  })

  it('o modelo é patcheado em memória, e não gravado ao lado do original', () => {
    /*
     * O caminho exato de visemes exige patch do grafo ONNX. O Piper oferece as duas formas: em
     * memória (`include_alignments` no `load`) ou gravando um `.onnx` patcheado com
     * `patch_voice_with_alignment`. A segunda deixaria um modelo de 63 MB em `userData` — não é
     * áudio, mas é o mesmo princípio, e o hash pinado no catálogo deixaria de descrever o arquivo
     * que está lá.
     */
    const fonte = readFileSync(join(__dirname, 'sidecar-tts.py'), 'utf8')
    const codigo = fonte
      .replace(/"""[\s\S]*?"""/g, '')
      .split('\n')
      .filter((linha) => !linha.trimStart().startsWith('#'))
      .join('\n')

    expect(codigo).toContain('include_alignments=True')
    expect(codigo).not.toContain('patch_voice_with_alignment')
  })
})
