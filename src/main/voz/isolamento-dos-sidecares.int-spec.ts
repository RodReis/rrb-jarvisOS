import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { Sidecar } from './sidecar'

/**
 * Os sidecares são processos independentes (SPEC-Voz-02, critério 4).
 *
 * O critério pede que matar o TTS no meio de uma fala não derrube o app **nem o STT**, e
 * vice-versa. Isso é uma afirmação sobre **processos**, não sobre objetos — um dublê que "finge
 * morrer" provaria só que o código trata um erro, e continuaria passando no dia em que os dois
 * voltassem a compartilhar o mesmo processo. Por isso aqui roda `node` de verdade: dois processos
 * reais, um morto de verdade com `SIGKILL`.
 *
 * Node no lugar do Python porque o que se mede é o **isolamento**, não a síntese: o runtime Python
 * mora em `userData` e só existe depois do download, e amarrar esta prova a ele a tornaria
 * impossível de rodar no CI. O `Sidecar` não sabe o que executa — é o mesmo objeto nos dois casos.
 */

/**
 * Um sidecar falso em Node que fala o mesmo protocolo: JSON por linha, correlação por `id`.
 *
 * `--eval` em vez de arquivo temporário porque o processo é o objeto do teste; um `.js` no disco
 * seria estado a limpar depois, e este arquivo existe justamente para provar que nada fica.
 *
 * **A operação `demorar` existe para o kill ter o que interromper.** Um dublê que responde
 * instantâneo termina a chamada antes de o `SIGKILL` chegar, e o teste passaria medindo uma
 * corrida em vez do isolamento — exatamente o falso verde que ele existe para evitar. A síntese
 * real leva ~80 ms; `demorar` fica vivo até ser morto.
 */
const PROGRAMA = `
let resto = ''
process.stdin.on('data', (pedaco) => {
  const partes = (resto + pedaco).split('\\n')
  resto = partes.pop() ?? ''
  for (const linha of partes) {
    if (!linha.trim()) continue
    const pedido = JSON.parse(linha)
    const responder = () =>
      process.stdout.write(JSON.stringify({ id: pedido.id, ok: true, quem: process.argv[1] }) + '\\n')
    if (pedido.op === 'demorar') setTimeout(responder, 60000)
    else responder()
  }
})
`

function sidecarDeVerdade(nome: string): Sidecar {
  return new Sidecar({
    spawn: (comando, args) => spawn(comando, [...args], { stdio: 'pipe' }),
    comando: process.execPath,
    args: ['--eval', PROGRAMA, nome],
    timeoutMs: 10_000
  })
}

/** O PID do processo que o sidecar subiu. Só o teste precisa disto — o app nunca vê PID. */
function pidDe(sidecar: Sidecar): number {
  const processo = (sidecar as unknown as { processo?: { pid?: number } }).processo
  const pid = processo?.pid
  if (pid === undefined) throw new Error('O sidecar não subiu processo nenhum.')
  return pid
}

describe('isolamento entre os sidecares (critério 4)', () => {
  it('matar o TTS não impede o STT de responder, e a tentativa seguinte funciona', async () => {
    const stt = sidecarDeVerdade('stt')
    const tts = sidecarDeVerdade('tts')

    try {
      // Os dois no ar e respondendo: sem isto, "o STT sobreviveu" passaria com um STT que nunca
      // chegou a subir.
      expect((await stt.pedir({ op: 'ping' })).ok).toBe(true)
      expect((await tts.pedir({ op: 'ping' })).ok).toBe(true)

      // São processos diferentes — a premissa do critério, e não uma consequência do código de
      // tratamento de erro.
      expect(pidDe(stt)).not.toBe(pidDe(tts))

      // Uma fala **em curso** quando o processo morre: é o cenário que o critério nomeia, e sem
      // ela o kill não teria o que interromper.
      const falaEmCurso = tts.pedir({ op: 'demorar' })
      process.kill(pidDe(tts), 'SIGKILL')
      await expect(falaEmCurso).rejects.toThrow()

      // O STT continua respondendo **depois** da morte do vizinho.
      expect((await stt.pedir({ op: 'ping' })).ok).toBe(true)

      // E o TTS se recupera sozinho na tentativa seguinte, que é o restart que a F01 já garantia.
      expect((await tts.pedir({ op: 'ping' })).ok).toBe(true)
    } finally {
      await stt.encerrar()
      await tts.encerrar()
    }
  })

  it('matar o STT não impede o TTS de falar — o inverso, que o critério também pede', async () => {
    const stt = sidecarDeVerdade('stt')
    const tts = sidecarDeVerdade('tts')

    try {
      expect((await stt.pedir({ op: 'ping' })).ok).toBe(true)
      expect((await tts.pedir({ op: 'ping' })).ok).toBe(true)

      process.kill(pidDe(stt), 'SIGKILL')

      expect((await tts.pedir({ op: 'falar' })).ok).toBe(true)
    } finally {
      await stt.encerrar()
      await tts.encerrar()
    }
  })

  it('a chamada em curso no processo morto falha com erro, em vez de ficar pendurada', async () => {
    /*
     * O modo de falha que importa não é o erro — é a promessa que nunca resolve. A tela ficaria em
     * "falando" para sempre, e não há próxima ação possível a partir daí. Este teste mede que a
     * morte **rejeita** a chamada em curso.
     */
    const tts = sidecarDeVerdade('tts')

    try {
      await tts.pedir({ op: 'ping' })
      const pid = pidDe(tts)

      const emCurso = tts.pedir({ op: 'demorar' })
      process.kill(pid, 'SIGKILL')

      await expect(emCurso).rejects.toThrow()
    } finally {
      await tts.encerrar()
    }
  })
})
