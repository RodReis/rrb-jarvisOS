"""Gera dataset log-mel de treino com Piper; não grava áudio bruto.

O classificador usa as vozes Piper já previstas na SPEC e, se autorizadas, gravações
reais do PI. A extração de features é o mesmo módulo que roda no sidecar, para
impedir deriva entre treino e inferência.
"""

import argparse
import random
import sys
from pathlib import Path

import numpy as np
from piper import PiperVoice, SynthesisConfig
from scipy.signal import resample, resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "main" / "voz"))
from features_wake import AMOSTRAS, TAXA, extrair_features  # noqa: E402


POSITIVAS = (
    "Ei, amigo!", "Ei amigo.", "Ei, amigo.", "Ei amigo!",
)
NEGATIVAS = (
    "amigo", "meu amigo", "olá, amigo", "aquele amigo", "somos amigos",
    "amigo, venha aqui", "ei", "ei, você", "ei, pessoal", "aí, amigo",
    "amiga", "o amigo chegou", "estou falando com um amigo",
    "ei, amiga", "ei, computador", "ei, pessoal, vamos lá", "o meu melhor amigo",
    "bom dia, amigo", "amigo, que horas são?", "ei, tudo bem?",
    "agora vamos trabalhar", "qual a próxima tarefa?", "bom dia",
    "por favor, abra o projeto", "pode me ajudar com isso?", "vamos revisar o código",
    "preciso falar com meu amigo", "chegou uma mensagem",
)


def sintetizar(voz, texto, rng):
    config = SynthesisConfig(
        length_scale=rng.uniform(0.72, 1.25),
        noise_scale=rng.uniform(0.35, 0.9),
        noise_w_scale=rng.uniform(0.35, 0.9),
    )
    partes = list(voz.synthesize(texto, syn_config=config))
    audio = np.concatenate([parte.audio_float_array for parte in partes])
    return resample_poly(audio, TAXA, partes[0].sample_rate).astype(np.float32)


def ler_gravacao_real(caminho, recortar_silencio=False):
    """Decodifica em memória; as gravações não entram no NPZ nem no repositório."""
    import av

    partes = []
    with av.open(str(caminho)) as conteiner:
        fluxo = conteiner.streams.audio[0]
        conversor = av.AudioResampler(format="s16", layout="mono", rate=TAXA)
        for quadro in conteiner.decode(fluxo):
            partes.extend(saida.to_ndarray().reshape(-1) for saida in conversor.resample(quadro))
        partes.extend(saida.to_ndarray().reshape(-1) for saida in conversor.resample(None))
    if not partes:
        raise ValueError(f"Gravação vazia: {caminho}")
    audio = np.concatenate(partes).astype(np.float32) / 32768.0
    if not recortar_silencio:
        return audio
    # Preserva também exemplos sem recorte: no streaming a janela pode conter silêncio.
    passo = 320
    energia = np.array([
        np.sqrt(np.mean(audio[i : i + passo] ** 2))
        for i in range(0, len(audio), passo)
    ])
    ativos = np.flatnonzero(energia > max(0.003, float(energia.max()) * 0.12))
    if ativos.size:
        inicio = max(0, int(ativos[0]) * passo - 1_600)
        fim = min(len(audio), (int(ativos[-1]) + 1) * passo + 1_600)
        audio = audio[inicio:fim]
    return audio


def preparar_janela(audio, positiva, rng, np_rng):
    # Variação de altura/velocidade reduz dependência das duas vozes sintetizadas.
    audio = resample(audio, max(1, round(len(audio) * rng.uniform(0.82, 1.18)))).astype(np.float32)
    # Frase positiva sempre inteira; cortar "Ei" faria o classificador aprender só "amigo".
    maximo = AMOSTRAS - 1_600
    if positiva and len(audio) > maximo:
        audio = resample(audio, maximo).astype(np.float32)
    elif len(audio) > maximo:
        inicio = rng.randrange(len(audio) - maximo + 1)
        audio = audio[inicio : inicio + maximo]
    if not positiva and rng.random() < 0.7:
        # Uma janela deslizante também vê só caudas e fragmentos de frases negativas.
        # Sem eles, o classificador aceita "ei, você" quando a palavra sai da janela.
        trecho = rng.randrange(min(3_200, len(audio)), len(audio) + 1)
        inicio = rng.randrange(len(audio) - trecho + 1)
        audio = audio[inicio : inicio + trecho]

    if rng.random() < 0.55:
        atraso = rng.randrange(320, 1_920)
        ganho = rng.uniform(0.08, 0.32)
        eco = np.zeros_like(audio)
        eco[atraso:] = audio[:-atraso] * ganho
        audio = audio + eco

    volume = rng.uniform(0.28, 1.0)
    audio = audio * volume
    rms = max(float(np.sqrt(np.mean(audio * audio))), 0.001)
    ruido = rms * 10.0 ** (-rng.uniform(12.0, 35.0) / 20.0)
    # O ruído precisa cobrir a janela toda: silêncio digital nas bordas ensinaria
    # o modelo a distinguir estúdio sintético de microfone real, não as palavras.
    branco = np_rng.normal(0.0, 1.0, AMOSTRAS).astype(np.float32)
    lento = np.cumsum(branco).astype(np.float32)
    lento = lento / max(float(np.std(lento)), 1e-6)
    fundo = branco * rng.uniform(0.35, 1.0) + lento * rng.uniform(0.0, 0.3)
    quadro = (fundo * ruido).astype(np.float32)
    inicio = rng.randrange(0, AMOSTRAS - len(audio) + 1)
    quadro[inicio : inicio + len(audio)] = audio
    return extrair_features(np.clip(quadro, -1.0, 1.0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vozes", type=Path, nargs="+", required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--positivos", type=int, default=8_000)
    parser.add_argument("--negativos", type=int, default=16_000)
    parser.add_argument("--positivo-real", type=Path, action="append", default=[])
    parser.add_argument("--negativo-real", type=Path, action="append", default=[])
    parser.add_argument("--variacoes-reais", type=int, default=500)
    parser.add_argument("--semente", type=int, default=356)
    parser.add_argument("--frase-negativa", action="append", default=[])
    parser.add_argument("--recortar-silencio", action="store_true")
    args = parser.parse_args()

    rng = random.Random(args.semente)
    np_rng = np.random.default_rng(args.semente)
    vozes = [PiperVoice.load(str(caminho)) for caminho in args.vozes]
    dados, rotulos = [], []
    negativas = tuple(args.frase_negativa) if args.frase_negativa else NEGATIVAS
    for classe, total, textos in (
        (1, args.positivos, POSITIVAS),
        (0, args.negativos, negativas),
    ):
        for indice in range(total):
            voz = vozes[indice % len(vozes)]
            texto = textos[indice % len(textos)]
            audio = sintetizar(voz, texto, rng)
            dados.append(preparar_janela(audio, classe == 1, rng, np_rng).astype(np.float16))
            rotulos.append(classe)
            if (indice + 1) % 200 == 0:
                print(f"classe={classe} {indice + 1}/{total}", flush=True)

    for classe, caminhos in ((1, args.positivo_real), (0, args.negativo_real)):
        for caminho in caminhos:
            audio = ler_gravacao_real(caminho, args.recortar_silencio)
            for _ in range(args.variacoes_reais):
                dados.append(preparar_janela(audio, classe == 1, rng, np_rng).astype(np.float16))
                rotulos.append(classe)
            print(f"gravacao_real={caminho.name} variacoes={args.variacoes_reais}", flush=True)

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.saida, x=np.asarray(dados), y=np.asarray(rotulos))
    print(f"features={args.saida} exemplos={len(rotulos)}")


if __name__ == "__main__":
    main()
