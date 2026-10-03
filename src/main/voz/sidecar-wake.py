"""Inferência local pela API real do openWakeWord, com JSON por linha."""

import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

_modelo = None
_nome = None


def _responder(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _configurar(pedido):
    global _modelo, _nome
    from pathlib import Path
    from openwakeword.model import Model

    caminho = Path(pedido["modelo"])
    melspec = Path(pedido["melspec"])
    embedding = Path(pedido["embedding"])
    for artefato in (caminho, melspec, embedding):
        if not artefato.is_file():
            raise FileNotFoundError(f"Artefato de wake word ausente: {artefato}")

    _modelo = Model(
        wakeword_models=[str(caminho)],
        inference_framework="onnx",
        melspec_model_path=str(melspec),
        embedding_model_path=str(embedding),
    )
    _nome = caminho.stem
    return {"ok": True}


def _detectar(pedido):
    import numpy as np

    if _modelo is None or _nome is None:
        return {"ok": False, "erro": "O detector ainda não foi configurado."}
    amostras = pedido.get("amostras")
    if not isinstance(amostras, list) or len(amostras) != 1280:
        return {"ok": False, "erro": "O bloco PCM precisa conter 1280 amostras."}
    score = float(_modelo.predict(np.asarray(amostras, dtype=np.int16))[_nome])
    if not np.isfinite(score):
        return {"ok": False, "erro": "Confiança não finita."}
    return {"ok": True, "confianca": score}


def _reiniciar(_pedido):
    if _modelo is not None:
        _modelo.reset()
    return {"ok": True}


_ops = {"configurar": _configurar, "detectar": _detectar, "reiniciar": _reiniciar}


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
