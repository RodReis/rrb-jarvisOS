"""Gera features de treino sem salvar áudio (SPEC-Escuta-01).

Execute com o Python do runtime de voz e o openWakeWord instalado em ambiente isolado.
As vozes e os modelos auxiliares são recebidos por caminho; nenhum download ocorre aqui.
"""

import argparse
import random
from pathlib import Path

import numpy as np
from openwakeword.utils import AudioFeatures
from piper import PiperVoice, SynthesisConfig
from scipy.signal import resample_poly


POSITIVAS = ("Ei, amigo!", "Ei amigo.", "Ei, amigo.")
NEGATIVAS = (
    "amigo", "meu amigo", "olá, amigo", "aquele amigo", "somos amigos",
    "amigo, venha aqui", "ei", "ei, você", "ei, pessoal", "aí, amigo",
    "amiga", "o amigo chegou", "estou falando com um amigo",
    "agora vamos trabalhar", "qual a próxima tarefa?", "bom dia",
)


def sintetizar(voz, texto, rng):
    config = SynthesisConfig(
        length_scale=rng.uniform(0.78, 1.28),
        noise_scale=rng.uniform(0.35, 0.9),
        noise_w_scale=rng.uniform(0.35, 0.9),
    )
    partes = list(voz.synthesize(texto, syn_config=config))
    audio = np.concatenate([parte.audio_float_array for parte in partes])
    return resample_poly(audio, 16_000, partes[0].sample_rate).astype(np.float32)


def features_de_audio(audio, extrator, rng):
    # Posição da frase, volume e ruído variam. O final fica dentro da janela de 1,28 s.
    audio = audio * rng.uniform(0.55, 1.0)
    audio = np.clip(audio + rng.normalvariate(0, 0.0015), -1, 1)
    alvo = 24_000
    if len(audio) > alvo:
        audio = audio[-alvo:]
    inicio = max(0, alvo - len(audio) - rng.randrange(0, 3_200))
    quadro = np.zeros(alvo, dtype=np.float32)
    quadro[inicio : inicio + len(audio)] = audio
    pcm = np.clip(quadro * 32_767, -32_768, 32_767).astype(np.int16)
    extrator.reset()
    extrator(pcm)
    return extrator.get_features(16)[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vozes", type=Path, nargs="+", required=True)
    parser.add_argument("--melspec", type=Path, required=True)
    parser.add_argument("--embedding", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--positivos", type=int, default=2_000)
    parser.add_argument("--negativos", type=int, default=4_000)
    args = parser.parse_args()

    rng = random.Random(356)
    np.random.seed(356)
    vozes = [PiperVoice.load(str(caminho)) for caminho in args.vozes]
    extrator = AudioFeatures(
        melspec_model_path=str(args.melspec),
        embedding_model_path=str(args.embedding),
        inference_framework="onnx",
    )
    dados, rotulos = [], []
    for classe, total, textos in (
        (1, args.positivos, POSITIVAS),
        (0, args.negativos, NEGATIVAS),
    ):
        for indice in range(total):
            voz = vozes[indice % len(vozes)]
            texto = textos[indice % len(textos)]
            audio = sintetizar(voz, texto, rng)
            dados.append(features_de_audio(audio, extrator, rng))
            rotulos.append(classe)
            if (indice + 1) % 100 == 0:
                print(f"classe={classe} {indice + 1}/{total}", flush=True)

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.saida, x=np.asarray(dados), y=np.asarray(rotulos))
    print(f"features={args.saida} exemplos={len(rotulos)}")


if __name__ == "__main__":
    main()
