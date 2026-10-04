"""Detector próprio de "Ei, amigo". JSON por linha, áudio somente em memória."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

_sessao = None


def _responder(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _configurar(pedido):
    global _sessao
    import onnxruntime as ort

    caminho = Path(pedido["modelo"])
    if not caminho.is_file():
        raise FileNotFoundError(f"Modelo de ativação ausente: {caminho}")
    sessao = ort.InferenceSession(str(caminho), providers=["CPUExecutionProvider"])
    entrada = sessao.get_inputs()[0]
    if entrada.name != "input" or entrada.shape[-3:] != [1, 197, 40]:
        raise ValueError("Modelo de ativação com entrada incompatível.")
    _sessao = sessao
    return {"ok": True}


def _detectar(pedido):
    import numpy as np
    from features_wake import AMOSTRAS, extrair_features

    if _sessao is None:
        return {"ok": False, "erro": "O detector ainda não foi configurado."}
    amostras = pedido.get("amostras")
    if not isinstance(amostras, list) or len(amostras) != AMOSTRAS:
        return {"ok": False, "erro": f"O bloco PCM precisa conter {AMOSTRAS} amostras."}
    pcm = np.asarray(amostras, dtype=np.int16)
    features = extrair_features(pcm)[None, None, :, :]
    score = float(_sessao.run(["output"], {"input": features})[0].ravel()[0])
    if not np.isfinite(score) or score < 0.0 or score > 1.0:
        return {"ok": False, "erro": "Confiança inválida do modelo."}
    return {"ok": True, "confianca": score}


_ops = {"configurar": _configurar, "detectar": _detectar}


def main():
    for linha in sys.stdin:
        pedido = None
        if not linha.strip():
            continue
        try:
            pedido = json.loads(linha)
            acao = _ops.get(pedido.get("op"))
            if acao is None:
                raise ValueError(f"Operação desconhecida: {pedido.get('op')}")
            resposta = acao(pedido)
        except Exception as exc:  # noqa: BLE001 - erro vira resposta, não mata o processo
            resposta = {"ok": False, "erro": str(exc)}
        _responder({"id": pedido.get("id") if isinstance(pedido, dict) else None, **resposta})


if __name__ == "__main__":
    main()
