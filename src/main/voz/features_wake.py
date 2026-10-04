"""Log-mel determinístico do detector próprio; nenhum peso pré-treinado é carregado."""

import numpy as np

TAXA = 16_000
AMOSTRAS = 32_000
FFT = 512
PASSO = 160
MELS = 40
QUADROS = 1 + (AMOSTRAS - FFT) // PASSO


def _banco_mel():
    def para_mel(hz):
        return 2595.0 * np.log10(1.0 + hz / 700.0)

    def para_hz(mel):
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

    pontos = para_hz(np.linspace(para_mel(60.0), para_mel(7_800.0), MELS + 2))
    frequencias = np.linspace(0.0, TAXA / 2.0, FFT // 2 + 1)
    banco = np.zeros((FFT // 2 + 1, MELS), dtype=np.float32)
    for indice in range(MELS):
        esquerda, centro, direita = pontos[indice : indice + 3]
        subida = (frequencias - esquerda) / max(centro - esquerda, 1.0)
        descida = (direita - frequencias) / max(direita - centro, 1.0)
        banco[:, indice] = np.maximum(0.0, np.minimum(subida, descida))
    return banco


BANCO_MEL = _banco_mel()
JANELA_HANN = np.hanning(FFT).astype(np.float32)


def extrair_features(pcm):
    """PCM 16 kHz mono para [197, 40]; áudio curto recebe silêncio à esquerda."""
    audio = np.asarray(pcm, dtype=np.float32)
    if audio.size < AMOSTRAS:
        audio = np.pad(audio, (AMOSTRAS - audio.size, 0))
    elif audio.size > AMOSTRAS:
        audio = audio[-AMOSTRAS:]
    if np.max(np.abs(audio)) > 1.0:
        audio = audio / 32768.0
    quadros = np.lib.stride_tricks.sliding_window_view(audio, FFT)[::PASSO]
    espectro = np.abs(np.fft.rfft(quadros * JANELA_HANN, axis=1)) ** 2
    mel = espectro @ BANCO_MEL
    log_mel = np.log(np.maximum(mel, 1e-8))
    # O piso de ruído e o ganho do microfone variam muito mais que os fonemas.
    # Referenciar cada banda à sua própria base da janela evita aprender a voz
    # sintética ou o silêncio digital como atalho para a classe.
    base = np.percentile(log_mel, 20.0, axis=0)
    return np.clip((log_mel - base) / 6.0, -1.0, 2.0).astype(np.float32)
