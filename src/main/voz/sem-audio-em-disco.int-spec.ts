import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { VozService } from './voz-service'
import { criarEngineFasterWhisper } from './engine-faster-whisper'
import type { Sidecar } from './sidecar'

/**
 * Nenhum áudio em disco (SPEC-Voz-01, critério 8).
 *
 * A spec cravou que o áudio **nunca** persiste: ele vive em memória, é transcrito e é descartado.
 * Retenção para debug ficou explicitamente de fora (decisão do PI).
 *
 * ## Por que a varredura do diretório não basta sozinha
 *
 * Varrer o `userData` depois de uma sessão prova o **efeito**, e é o que o critério pede. Mas ela
 * passa também num app que nunca gravou porque nunca transcreveu — e é exatamente esse o falso
 * verde que este arquivo evita: a sessão simulada aqui transcreve de verdade (contra um sidecar
 * dublê), e só então varre.
 *
 * O segundo bloco fecha o outro lado, lendo o **código-fonte** do sidecar: a garantia real não é
 * "não encontrei arquivo", é "não existe caminho que escreva". Um dos dois sozinho seria fraco.
 */

/** Um sidecar dublê que responde como o real, sem processo nenhum. */
function sidecarQueResponde(): Sidecar {
  return {
    pedir: async (payload: Record<string, unknown>) =>
      payload.op === 'configurar'
        ? { ok: true }
        : { ok: true, texto: 'uma frase falada', idioma: 'pt', segmentos: [], compute: 'cpu-int8' },
    encerrar: async () => undefined
  } as unknown as Sidecar
}

/** Um PCM com sinal de verdade — zeros poderiam ser descartados antes de chegar ao engine. */
function pcmDeUmaFrase(): Int16Array {
  const amostras = new Int16Array(16_000)
  for (let i = 0; i < amostras.length; i += 1) {
    amostras[i] = Math.round(8000 * Math.sin((i / 16_000) * 2 * Math.PI * 220))
  }
  return amostras
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

describe('nenhum áudio em disco (critério 8)', () => {
  it('uma sessão de uso não deixa arquivo nenhum no userData', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'jarvis-voz-'))

    try {
      const voz = new VozService({
        engine: criarEngineFasterWhisper({
          sidecar: sidecarQueResponde(),
          configuracao: () => ({ modelo: join(userData, 'models'), idioma: 'pt' }),
          artefatosPresentes: () => true
        }),
        artefatosFaltando: () => [],
        computeAtual: () => 'cpu-int8'
      })

      // Uma sessão de verdade: três enunciados transcritos, como o usuário faria.
      for (let i = 0; i < 3; i += 1) {
        const desfecho = await voz.transcrever(pcmDeUmaFrase())
        expect(desfecho.estado).toBe('ok')
      }

      expect(varrer(userData)).toEqual([])
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  it('o buffer não sobrevive à chamada — o serviço não guarda o último enunciado', async () => {
    /*
     * O `VozService` é vivo entre chamadas, então um campo `ultimoPcm` seria exatamente o modo de
     * o áudio sobreviver à transcrição sem tocar o disco. Este teste afirma sobre o objeto: nada
     * dentro dele carrega amostras depois da chamada.
     */
    const voz = new VozService({
      engine: criarEngineFasterWhisper({
        sidecar: sidecarQueResponde(),
        configuracao: () => ({ modelo: 'C:/modelos/small', idioma: 'pt' }),
        artefatosPresentes: () => true
      }),
      artefatosFaltando: () => [],
      computeAtual: () => 'cpu-int8'
    })

    await voz.transcrever(pcmDeUmaFrase())

    const serializado = JSON.stringify(voz, (_chave, valor) =>
      valor instanceof Int16Array ? '<PCM RETIDO>' : valor
    )

    expect(serializado).not.toContain('<PCM RETIDO>')
  })
})

describe('nenhum áudio em disco — o sidecar não tem caminho de escrita', () => {
  it('o script Python não abre arquivo para escrita nem importa módulo de gravação', () => {
    /*
     * A varredura do diretório prova que **não aconteceu**; isto prova que **não pode acontecer**.
     * O sidecar é o único ponto do fluxo que recebe as amostras num processo com acesso a disco,
     * e é lá que uma linha de "salvar para debug" cairia com mais naturalidade.
     *
     * Afirmar sobre a fonte, e não sobre um diretório vazio, é o que faz este teste reprovar no
     * momento em que alguém acrescentar a linha — e não meses depois, quando um usuário reparar
     * numa pasta cheia de WAV.
     */
    const fonte = readFileSync(join(__dirname, 'sidecar-stt.py'), 'utf8')

    /*
     * Comentários **e docstrings** saem antes de medir. A primeira versão deste teste reprovou
     * casando com a própria frase da docstring que promete não gravar — a asserção acusaria o
     * texto que documenta a garantia, o oposto do que ela existe para pegar.
     */
    const codigo = fonte
      .replace(/"""[\s\S]*?"""/g, '')
      .split('\n')
      .filter((linha) => !linha.trimStart().startsWith('#'))
      .join('\n')

    // `open` só interessa em **modo de escrita**: o sidecar hoje não lê arquivo algum, mas
    // proibir toda leitura amarraria a fatia seguinte sem proteger nada.
    expect(codigo).not.toMatch(/\bopen\s*\([^)]*["'][waxb+]+["']/)
    expect(codigo).not.toMatch(/\bimport\s+(wave|soundfile|scipy)\b/)
    /*
     * `sys.stdout.write` é o **protocolo**, não disco — é por ele que a resposta volta ao main,
     * e proibi-lo reprovaria o caminho normal. A guarda mira escrita de áudio em arquivo.
     */
    expect(codigo).not.toMatch(/\.(writeframes|tofile|savefig|to_wav)\s*\(/)
  })
})
