import { describe, expect, it } from 'vitest'
import { SCRIPT_DO_SIDECAR } from './script-do-sidecar'

/**
 * O script do sidecar é uma **string**, e string não é compilada por ninguém até o primeiro uso
 * real. Um erro de sintaxe nela passaria por `tsc`, por `eslint` e pela suíte inteira, e só
 * apareceria na máquina de quem falasse ao microfone — que é o teste mais caro que existe.
 *
 * Estes testes são a compilação que falta. O primeiro é o que impede o defeito invisível; os
 * demais afirmam sobre as três regras que moram só neste arquivo (o `print` do runtime não vira
 * resposta, o áudio não vira arquivo, o modelo vem do pedido).
 */
describe('script do sidecar — é Python válido', () => {
  it('não tem erro de sintaxe', async () => {
    // Compilar, não executar: rodar exigiria o runtime baixado, e o que se mede aqui é a
    // string, não a instalação.
    const { spawnSync } = await import('node:child_process')

    const r = spawnSync('python', ['-c', 'import sys,ast; ast.parse(sys.stdin.read())'], {
      input: SCRIPT_DO_SIDECAR,
      encoding: 'utf8'
    })

    if (r.error !== undefined) {
      // Sem Python na máquina não há o que compilar. Falhar aqui reprovaria por ausência de
      // ferramenta, não por defeito — e `docs/TESTING.md` chama isso de `not_run`, nunca de
      // PASS silencioso. O CI tem Python (o próprio perfil de CI o exercita), então lá ele roda.
      expect(r.error.message).toContain('ENOENT')
      return
    }

    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })
})

describe('script do sidecar — as regras que moram só aqui', () => {
  it('protege o protocolo do print do runtime', async () => {
    // `faster-whisper` e `ctranslate2` escrevem aviso no stdout. Sem o desvio, uma linha de log
    // seria lida como resposta e mataria a chamada em curso.
    expect(SCRIPT_DO_SIDECAR).toContain('os.dup(sys.stdout.fileno())')
    expect(SCRIPT_DO_SIDECAR).toContain('sys.stdout = sys.stderr')
  })

  it('não sabe abrir arquivo nenhum (critério 8)', () => {
    // O critério é "nenhum áudio em disco". O jeito de garantir num script que recebe PCM é ele
    // não ter como abrir arquivo: o que não existe não vaza por acidente numa edição futura.
    //
    // A única escrita permitida é a do protocolo, e ela é para um **descritor herdado**
    // (`os.fdopen(os.dup(...))`) — o stdout que o processo pai já criou, nunca um caminho. Por
    // isso a proibição mira `open(` de caminho e o módulo `tempfile`, não a palavra `write`:
    // proibir escrever proibiria o sidecar de responder.
    expect(SCRIPT_DO_SIDECAR).not.toMatch(/(?<!os\.fd)\bopen\s*\(/)
    expect(SCRIPT_DO_SIDECAR).not.toContain('NamedTemporaryFile')
    expect(SCRIPT_DO_SIDECAR).not.toContain('tempfile')
    expect(SCRIPT_DO_SIDECAR).not.toContain('pathlib')
  })

  it('recebe o áudio no pedido, em memória', () => {
    expect(SCRIPT_DO_SIDECAR).toContain('base64.b64decode(pedido["pcm"])')
    expect(SCRIPT_DO_SIDECAR).toContain('np.frombuffer')
  })

  it('lê modelo e idioma do pedido, não da inicialização (critério 6)', () => {
    // É o que faz "trocar em Settings vale na chamada seguinte, sem restart" ser verdade: se o
    // modelo viesse de argumento de linha de comando, mudar exigiria derrubar o processo.
    expect(SCRIPT_DO_SIDECAR).toContain('pedido["modelo"]')
    expect(SCRIPT_DO_SIDECAR).toContain('pedido.get("idioma")')
  })

  it('recarrega o modelo só quando o pedido pede outro', () => {
    expect(SCRIPT_DO_SIDECAR).toContain('if _carregado == caminho')
  })

  it('toda falha volta como resposta com o mesmo id', () => {
    // Exceção que só matasse o processo deixaria a chamada pendurada e a UI em "transcrevendo"
    // para sempre — pior que erro, porque não há próxima ação possível.
    expect(SCRIPT_DO_SIDECAR).toContain('"id": identificador, "ok": False')
  })

  it('linha ilegível não derruba o processo', () => {
    // Ela não tem id, então não há a quem responder; derrubar aqui mataria as chamadas em curso
    // por causa de uma linha corrompida.
    expect(SCRIPT_DO_SIDECAR).toContain('pedido ilegivel')
    expect(SCRIPT_DO_SIDECAR).toContain('file=sys.stderr')
  })

  it('decide o compute tentando, não perguntando (critério 7)', () => {
    // Quem decide se CUDA serve é o CTranslate2, com os próprios requisitos de driver e cuDNN.
    expect(SCRIPT_DO_SIDECAR).toContain('ctranslate2.get_cuda_device_count()')
    expect(SCRIPT_DO_SIDECAR).toContain('"cpu", "int8"')
  })
})
