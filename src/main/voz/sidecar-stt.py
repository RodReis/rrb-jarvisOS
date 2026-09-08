"""O sidecar de transcrição (SPEC-Voz-01, critérios 1, 2, 7 e 8).

Protocolo: **JSON por linha** no stdin, JSON por linha no stdout. Cada pedido traz um `id`, e a
resposta o devolve — o main correlaciona por ele, nunca por ordem de chegada.

    <- {"op": "transcrever", "id": 3, "amostras": [...], "idioma": "pt"}
    -> {"id": 3, "ok": true, "texto": "...", "idioma": "pt", "segmentos": [...]}

O áudio chega como lista de inteiros de 16 bits, é convertido, transcrito e sai de escopo. **Nada
é gravado em disco** (critério 8): não há `open(..., "w")` neste arquivo, e é de propósito.

Erro vira `{"ok": false, "erro": ...}` em vez de traceback no stderr: o main traduz cada desfecho
numa próxima ação na tela, e um processo que morre calado deixaria a UI sem o que oferecer.
"""

import json
import sys

# **UTF-8 explícito nos dois canais.** No Windows o stdout do Python assume a code page do
# console (cp1252 aqui), e a primeira palavra acentuada em português — "não", "operações" —
# sairia com byte que o lado de lá não consegue decodificar, matando a linha JSON inteira.
# Medido: sem isto, uma transcrição em pt-BR quebra o protocolo com `UnicodeDecodeError`.
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

# O modelo é carregado uma vez e reusado. Carregar por enunciado custaria segundos a cada frase —
# é exatamente o que o processo de vida longa existe para evitar.
_modelo = None
_config = {}


def _responder(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _carregar(forcar_cpu=False):
    """Sobe o modelo, preferindo CUDA e caindo em CPU int8 (critério 7).

    A queda é silenciosa para o usuário mas **não** para o log: o modo escolhido volta em toda
    resposta de transcrição, porque a UI precisa indicar como está calculando.
    """
    global _modelo
    if _modelo is not None:
        return _modelo

    from faster_whisper import WhisperModel

    caminho = _config["modelo"]

    if not forcar_cpu:
        try:
            _modelo = WhisperModel(caminho, device="cuda", compute_type="float16")
            _config["compute"] = "cuda"
            return _modelo
        except Exception:
            # Sem GPU, driver ausente ou VRAM insuficiente — todos levam ao mesmo lugar, e
            # distinguir aqui não muda o que a tela faz.
            pass

    _modelo = WhisperModel(caminho, device="cpu", compute_type="int8")
    _config["compute"] = "cpu-int8"
    return _modelo


def _rodar(modelo, pcm):
    """Transcreve e **materializa** os segmentos.

    O `transcribe` do faster-whisper devolve um gerador preguiçoso: a inferência só roda quando
    alguém itera. Deixar isso para o chamador poria o erro de CUDA fora do `try` que existe para
    pegá-lo — foi assim que a falha virou texto vazio na primeira medição.
    """
    segmentos, info = modelo.transcribe(pcm, language=_config.get("idioma", "pt"), vad_filter=True)
    return list(segmentos), info


def _transcrever(pedido):
    global _modelo

    import numpy as np

    amostras = pedido.get("amostras") or []
    if len(amostras) == 0:
        return {"ok": True, "texto": "", "idioma": _config.get("idioma", "pt"), "segmentos": []}

    # Int16 para float32 em [-1, 1], que é o que o Whisper espera. A divisão é por 32768 e não
    # por 32767: é o valor absoluto do mínimo do Int16, e usar o máximo positivo estouraria a
    # faixa na amostra mais negativa.
    pcm = np.asarray(amostras, dtype=np.int16).astype(np.float32) / 32768.0

    modelo = _carregar()

    try:
        segmentos, info = _rodar(modelo, pcm)
    except Exception:
        """
        **A queda para CPU acontece aqui, e não só no carregamento.**

        Medido nesta máquina: com o runtime baixado mas sem o CUDA Toolkit, `WhisperModel(...)`
        **constrói com sucesso** em `device="cuda"` e só estoura na primeira inferência —
        `RuntimeError: Library cublas64_12.dll is not found`. Um `try` que envolve apenas a
        construção nunca vê esse erro, então o critério 7 ficaria furado exatamente na máquina
        que ele existe para atender: a que tem GPU mas não tem as bibliotecas.

        Pior, o erro chegava como transcrição **vazia** — desfecho `ok` com texto em branco, que
        a tela não tem como distinguir de silêncio.
        """
        _modelo = None
        modelo = _carregar(forcar_cpu=True)
        segmentos, info = _rodar(modelo, pcm)

    lista = [
        {"inicioMs": int(s.start * 1000), "fimMs": int(s.end * 1000), "texto": s.text.strip()}
        for s in segmentos
    ]

    return {
        "ok": True,
        "texto": " ".join(s["texto"] for s in lista).strip(),
        "idioma": info.language,
        "segmentos": lista,
        "compute": _config.get("compute"),
    }


def _tratar(pedido):
    op = pedido.get("op")

    if op == "configurar":
        _config.update(
            {k: v for k, v in pedido.items() if k in ("modelo", "idioma")}
        )
        # Trocar de modelo descarta o carregado: manter o antigo faria a mudança em Settings
        # valer só depois de reiniciar, e o critério 6 pede que valha na chamada seguinte.
        global _modelo
        _modelo = None
        return {"ok": True}

    if op == "prontidao":
        return {"ok": True, "compute": _config.get("compute")}

    if op == "transcrever":
        return _transcrever(pedido)

    return {"ok": False, "erro": f"Operação desconhecida: {op}"}


def main():
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue

        try:
            pedido = json.loads(linha)
        except json.JSONDecodeError:
            continue

        try:
            resposta = _tratar(pedido)
        except Exception as erro:  # noqa: BLE001 — todo erro vira desfecho tratado, nunca crash.
            resposta = {"ok": False, "erro": str(erro)}

        resposta["id"] = pedido.get("id")
        _responder(resposta)


if __name__ == "__main__":
    main()
