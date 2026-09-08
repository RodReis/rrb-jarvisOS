"""O sidecar de síntese de fala (SPEC-Voz-02, critérios 1, 2, 3, 4 e 8).

Mesmo protocolo do `sidecar-stt.py`: **JSON por linha** nos dois sentidos, correlação por `id`.

    <- {"op": "falar", "id": 3, "texto": "Bom dia.", "voz": "pt_BR-faber-medium"}
    -> {"id": 3, "ok": true, "sampleRate": 22050, "pcm": [...], "fonemas": [...],
        "alinhamentos": [{"fonema": "b", "amostras": 512}, ...]}

**Processo separado do STT** (decisão 3 do PI): crash de um não interrompe o outro, e o TTS roda
em CPU sem disputar a GPU do Whisper.

O áudio sai como lista de inteiros de 16 bits pelo stdout e **nunca toca o disco** (critério 8):
não há `open(..., "w")` neste arquivo, e é de propósito.
"""

import json
import sys

# **UTF-8 explícito**, e aqui pesa mais que no STT. O sidecar de transcrição emite português, onde
# a primeira palavra acentuada quebra a linha JSON; este emite **IPA**, onde praticamente todo
# símbolo é não-ASCII — `ˈ`, `ɐ`, `ʒ`, o til combinante. Medido no spike: sem esta linha, a
# primeira resposta com fonemas estoura `UnicodeEncodeError: 'charmap' codec can't encode
# character 'ˈ'` e mata o protocolo.
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

# Uma voz carregada por vez, reusada. Medido no spike: `load` custa ~1,2 s e a síntese, ~80 ms —
# carregar por frase multiplicaria a latência por quinze.
_voz = None
_voz_id = None
_config = {}


def _responder(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _carregar(voz_id):
    """Sobe a voz pedida, pedindo o alinhamento por fonema.

    `include_alignments=True` faz o Piper aplicar o patch do grafo ONNX **em memória** — sem
    gravar modelo patcheado em disco, que violaria o critério 8. Falha de patch não é fatal: o
    Piper cai para o modelo original e o alinhamento volta vazio, que é o caminho estimado.
    """
    global _voz, _voz_id
    if _voz is not None and _voz_id == voz_id:
        return _voz

    from piper import PiperVoice

    _voz = PiperVoice.load(_config["vozes"][voz_id], include_alignments=True)
    _voz_id = voz_id
    return _voz


def _falar(pedido):
    import numpy as np
    from piper import SynthesisConfig

    texto = (pedido.get("texto") or "").strip()
    voz_id = pedido.get("voz")

    if not texto:
        # String vazia devolve **zero chunks** no Piper (medido no spike), e o `concatenate`
        # abaixo estouraria. O main já barra isto antes, mas o sidecar não confia no chamador.
        return {"ok": True, "sampleRate": 0, "pcm": [], "fonemas": [], "alinhamentos": []}

    if voz_id not in _config.get("vozes", {}):
        return {"ok": False, "erro": f"Voz não instalada: {voz_id}"}

    voz = _carregar(voz_id)

    # **O segundo `include_alignments`.** Ele existe no `load` e aqui, ambos com default `False`,
    # e passar só no primeiro devolve lista vazia **sem erro** — foi o primeiro resultado do
    # spike, e por alguns minutos ele concluiu que o caminho exato não existia. Os dois são
    # obrigatórios.
    chunks = list(
        voz.synthesize(texto, syn_config=SynthesisConfig(), include_alignments=True)
    )

    if not chunks:
        return {"ok": True, "sampleRate": 0, "pcm": [], "fonemas": [], "alinhamentos": []}

    audio = np.concatenate([c.audio_float_array for c in chunks])
    pcm = np.clip(audio * 32767.0, -32768.0, 32767.0).astype(np.int16)

    fonemas = []
    alinhamentos = []
    for chunk in chunks:
        fonemas.extend(chunk.phonemes or [])
        # `phoneme_alignments` volta `None` quando o Piper desiste do alinhamento — um fonema fora
        # do `phoneme_id_map` zera a lista inteira com um log de debug. É o caso medido da
        # `pt_BR-edresson-low`, e é por isso que o main decide o caminho olhando o **retorno**.
        for a in chunk.phoneme_alignments or []:
            alinhamentos.append({"fonema": a.phoneme, "amostras": int(a.num_samples)})

    return {
        "ok": True,
        "sampleRate": chunks[0].sample_rate,
        "pcm": pcm.tolist(),
        "fonemas": fonemas,
        "alinhamentos": alinhamentos,
    }


def _tratar(pedido):
    op = pedido.get("op")

    if op == "configurar":
        # `vozes` é um mapa id → caminho do .onnx, montado pelo main a partir do catálogo de
        # artefatos. O sidecar nunca descobre caminho sozinho: o que ele não pode inventar, ele
        # não pode vazar.
        _config.update({k: v for k, v in pedido.items() if k in ("vozes",)})
        global _voz, _voz_id
        _voz = None
        _voz_id = None
        return {"ok": True}

    if op == "prontidao":
        return {"ok": True, "vozes": sorted(_config.get("vozes", {}).keys())}

    if op == "falar":
        return _falar(pedido)

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
