"""Valida o classificador da frase com áudio positivo e negativos dirigidos.

Usa o caminho real de inferência do openWakeWord, incluindo os dois modelos auxiliares.
Nenhum áudio é persistido; os WAVs de referência são lidos em memória.
"""

import argparse
import wave
from pathlib import Path

import numpy as np
from openwakeword.model import Model
from scipy.signal import resample_poly


def ler_pcm(caminho):
    with wave.open(str(caminho), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f"WAV incompatível: {caminho}")
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        taxa = wav.getframerate()
    if taxa != 16_000:
        pcm = resample_poly(pcm.astype(np.float32), 16_000, taxa)
    return np.clip(pcm, -32_768, 32_767).astype(np.int16)


def pontuacao(modelo, pcm, nome):
    modelo.reset()
    valores = []
    for inicio in range(0, len(pcm), 1_280):
        quadro = pcm[inicio : inicio + 1_280]
        if len(quadro) < 1_280:
            quadro = np.pad(quadro, (0, 1_280 - len(quadro)))
        valores.append(float(modelo.predict(quadro)[nome]))
    return max(valores, default=0.0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--modelo", type=Path, required=True)
    parser.add_argument("--melspec", type=Path, required=True)
    parser.add_argument("--embedding", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--limiar", type=float, default=0.5)
    args = parser.parse_args()

    modelo = Model(
        wakeword_models=[str(args.modelo)],
        inference_framework="onnx",
        melspec_model_path=str(args.melspec),
        embedding_model_path=str(args.embedding),
    )
    nome = args.modelo.stem
    casos = {
        "ei_amigo_ref.wav": True,
        "amigo_isolado_ref.wav": False,
        "meu_amigo_ref.wav": False,
        "ei_voce_ref.wav": False,
    }
    erros = 0
    for arquivo, esperado in casos.items():
        score = pontuacao(modelo, ler_pcm(args.fixtures / arquivo), nome)
        disparou = score >= args.limiar
        correto = disparou == esperado
        erros += not correto
        print(f"{arquivo}: score={score:.4f} disparou={disparou} esperado={esperado} ok={correto}")
    if erros:
        raise SystemExit(f"Falha em {erros} contrafactual(is).")


if __name__ == "__main__":
    main()
