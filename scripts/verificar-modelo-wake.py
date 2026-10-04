"""Valida o detector próprio em WAVs dirigidos e, opcionalmente, M4A reais do PI.

Os M4A são lidos em memória e nunca entram no treino nem no repositório.
"""

import argparse
import sys
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "main" / "voz"))
from features_wake import AMOSTRAS, extrair_features  # noqa: E402


def ler_pcm(caminho):
    if caminho.suffix.lower() == ".m4a":
        import av

        partes = []
        with av.open(str(caminho)) as conteiner:
            fluxo = conteiner.streams.audio[0]
            conversor = av.AudioResampler(format="s16", layout="mono", rate=16_000)
            for quadro in conteiner.decode(fluxo):
                partes.extend(saida.to_ndarray().reshape(-1) for saida in conversor.resample(quadro))
            partes.extend(saida.to_ndarray().reshape(-1) for saida in conversor.resample(None))
        if not partes:
            raise ValueError(f"Áudio vazio: {caminho}")
        return np.concatenate(partes).astype(np.int16)

    with wave.open(str(caminho), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f"WAV incompatível: {caminho}")
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        taxa = wav.getframerate()
    if taxa != 16_000:
        pcm = resample_poly(pcm.astype(np.float32), 16_000, taxa)
    return np.clip(pcm, -32_768, 32_767).astype(np.int16)


def pontuacao(sessao, pcm):
    # O stream analisa a cada 250 ms. Silêncio final permite medir clips curtos também.
    audio = np.pad(pcm, (0, AMOSTRAS))
    valores = []
    for fim in range(AMOSTRAS, len(audio) + 1, 4_000):
        features = extrair_features(audio[fim - AMOSTRAS : fim])[None, None, :, :]
        valores.append(float(sessao.run(["output"], {"input": features})[0].ravel()[0]))
    return max(valores, default=0.0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--modelo", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--limiar", type=float, default=0.95)
    parser.add_argument("--positivo-real", type=Path, action="append", default=[])
    parser.add_argument("--negativo-real", type=Path, action="append", default=[])
    args = parser.parse_args()

    sessao = ort.InferenceSession(str(args.modelo), providers=["CPUExecutionProvider"])
    casos = {
        "ei_amigo_ref.wav": True,
        "amigo_isolado_ref.wav": False,
        "meu_amigo_ref.wav": False,
        "ei_voce_ref.wav": False,
    }
    avaliacao = [(args.fixtures / nome, esperado) for nome, esperado in casos.items()]
    avaliacao += [(item, True) for item in args.positivo_real]
    avaliacao += [(item, False) for item in args.negativo_real]
    erros = 0
    for caminho, esperado in avaliacao:
        score = pontuacao(sessao, ler_pcm(caminho))
        disparou = score >= args.limiar
        correto = disparou == esperado
        erros += not correto
        print(
            f"{caminho.name}: score={score:.4f} disparou={disparou} "
            f"esperado={esperado} ok={correto}",
            flush=True,
        )
    if erros:
        raise SystemExit(f"Falha em {erros} contrafactual(is).")


if __name__ == "__main__":
    main()
