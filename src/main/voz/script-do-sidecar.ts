/**
 * O programa Python que roda dentro do sidecar (SPEC-Voz-01, critérios 1, 2, 6 e 7).
 *
 * ## Por que ele mora numa string, e não num arquivo `.py`
 *
 * Um `.py` ao lado do `.ts` não chega ao app buildado: o `electron-vite` empacota módulos, não
 * copia assets do main, e o projeto ainda não tem etapa de empacotamento que pudesse copiá-lo.
 * O script seria encontrado em `npm run dev` e sumiria no build — a pior das duas, porque falha
 * só onde ninguém testa.
 *
 * Como string, ele é escrito no `userData` ao lado do runtime que já vive lá, na primeira
 * execução. Sem asset a empacotar, sem divergência entre dev e build, e o mesmo caminho nas
 * duas.
 *
 * ## O que o script garante, e o que ele recusa
 *
 * Ele fala **JSON por linha** no stdin/stdout, correlacionado por `id` — o outro lado é o
 * `Sidecar`, que não sabe nada de Whisper. Três regras moram aqui e em nenhum outro lugar:
 *
 * 1. **O `print` do runtime não pode virar resposta.** `faster-whisper` e `ctranslate2` escrevem
 *    aviso no stdout (o fallback para CPU é um deles), e uma linha solta ali seria lida como
 *    resposta a uma chamada. Por isso o stdout do processo é redirecionado para o stderr logo na
 *    primeira linha, e só o protocolo escreve no descritor original.
 * 2. **O áudio não vira arquivo.** O PCM chega em base64 no próprio pedido e é convertido em
 *    memória (critério 8). Não há `NamedTemporaryFile` nem caminho de escrita em lugar nenhum
 *    deste script — o que ele não sabe fazer, ele não faz por acidente.
 * 3. **Modelo e idioma vêm no pedido, não da inicialização.** É o que faz o critério 6 valer sem
 *    restart: trocar em Settings muda o próximo pedido, e o script recarrega o modelo só quando
 *    o pedido pede um diferente do que está carregado.
 */

/**
 * O programa, literal. Alterar isto muda o `SHA_DO_SCRIPT` abaixo — e é de propósito: o script
 * é verificado como qualquer outro artefato antes de rodar.
 */
export const SCRIPT_DO_SIDECAR = `import base64
import json
import os
import sys

# O runtime escreve aviso no stdout (o fallback para CPU é um deles). Se isso chegasse ao
# protocolo, um log viraria resposta e mataria a chamada em curso. O descritor original é
# guardado para o protocolo, e o stdout do processo passa a ser o stderr.
_protocolo = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
sys.stdout = sys.stderr

_modelo = None
_carregado = None
_compute_efetivo = None


def _responder(payload):
    _protocolo.write(json.dumps(payload) + "\\n")
    _protocolo.flush()


def _tem_gpu():
    """Se existe GPU que o CTranslate2 enxerga. Necessário para CUDA, e longe de suficiente."""
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def _carregar(caminho):
    """Carrega o modelo, caindo para CPU quando CUDA não completa (critério 7).

    Três medições nesta máquina (RTX 5060), cada uma derrubando a anterior:

    1. \`get_cuda_device_count()\` responde 1 — há placa.
    2. \`WhisperModel(device="cuda")\` **carrega sem erro**.
    3. A primeira transcrição morre em \`Library cublas64_12.dll is not found\`.

    cuBLAS e cuDNN não vêm nas wheels pinadas, e o CTranslate2 só as procura quando o encoder
    roda. Uma detecção que pergunta, ou que só carrega, promete um caminho que a transcrição
    desmente — e o efeito é a voz falhar justamente em quem tem placa.

    Por isso a prova é uma **transcrição de verdade**, sobre um décimo de segundo de silêncio: é
    o caminho inteiro que o uso real percorre, e é barato. O que falhar nele vira CPU int8, que
    não depende de biblioteca externa nenhuma.
    """
    import numpy as np
    from faster_whisper import WhisperModel

    if _tem_gpu():
        try:
            modelo = WhisperModel(caminho, device="cuda", compute_type="float16")
            # \`transcribe\` é preguiçoso: devolve um gerador, e o encoder só roda quando alguém
            # o consome. Sem o \`list\`, o teste passaria sem exercitar nada — e o erro voltaria
            # na primeira fala do usuário, que é exatamente o que ele existe para evitar.
            list(modelo.transcribe(np.zeros(1600, dtype=np.float32), language="pt")[0])
            return modelo, "cuda"
        except Exception as erro:
            # Não é falha: é a informação de que esta máquina não tem o CUDA completo. Vai para
            # o log, e a transcrição continua no caminho que sempre funciona.
            print("CUDA indisponivel, usando CPU: " + str(erro), file=sys.stderr)

    return WhisperModel(caminho, device="cpu", compute_type="int8"), "cpu-int8"


def _garantir_modelo(caminho):
    global _modelo, _carregado, _compute_efetivo

    if _carregado == caminho:
        return _modelo

    _modelo, _compute_efetivo = _carregar(caminho)
    _carregado = caminho
    return _modelo


def _transcrever(pedido):
    import numpy as np

    # O PCM chega no pedido e vira array em memória. Nenhum arquivo temporário: o áudio não
    # persiste em disco (critério 8), e o jeito de garantir isso é não haver escrita nenhuma.
    bruto = base64.b64decode(pedido["pcm"])
    amostras = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0

    modelo = _garantir_modelo(pedido["modelo"])
    segmentos, info = modelo.transcribe(
        amostras,
        language=pedido.get("idioma") or None,
        beam_size=5,
        vad_filter=True,
    )

    partes = [
        {
            "inicioMs": int(s.start * 1000),
            "fimMs": int(s.end * 1000),
            "texto": s.text.strip(),
        }
        for s in segmentos
    ]

    return {
        "texto": " ".join(p["texto"] for p in partes).strip(),
        "idioma": info.language,
        "segmentos": partes,
    }


def _tratar(pedido):
    acao = pedido.get("acao")

    if acao == "ping":
        # Carrega de verdade quando o pedido traz o modelo: só o carregamento sabe se CUDA
        # completa. Sem modelo no pedido, responde o que já estiver carregado — e "desconhecido"
        # enquanto nada foi, que é honesto sobre não saber.
        caminho = pedido.get("modelo")
        if caminho:
            _garantir_modelo(caminho)

        return {"compute": _compute_efetivo or "desconhecido"}

    if acao == "transcrever":
        return _transcrever(pedido)

    raise ValueError("Ação desconhecida: " + str(acao))


for linha in sys.stdin:
    linha = linha.strip()
    if not linha:
        continue

    try:
        pedido = json.loads(linha)
    except Exception as erro:
        # Linha ilegível não tem id, então não há a quem responder. Vai para o stderr, que é
        # log, e o loop continua — derrubar o processo aqui mataria as chamadas em curso.
        print("pedido ilegivel: " + str(erro), file=sys.stderr)
        continue

    identificador = pedido.get("id")

    try:
        resultado = _tratar(pedido)
        _responder({"id": identificador, "ok": True, **resultado})
    except Exception as erro:
        # Toda falha volta como resposta com o mesmo id. Exceção que só matasse o processo
        # deixaria a chamada pendurada, e a UI em "transcrevendo" para sempre.
        _responder({"id": identificador, "ok": False, "erro": str(erro)})
`
