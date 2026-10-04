# Detector local de “Ei, amigo”

`ei_amigo.onnx` é um classificador treinado para este projeto, com entrada log-mel
`[batch, 1, 197, 40]` de janelas de 2 s a 16 kHz. SHA-256:
`28b6ad9a7e4e747697fa6a315882211f530697235bc5b767fe53efd0e512a6f3`.
O runtime usa `src/main/voz/features_wake.py` e `src/main/voz/sidecar-wake.py`;
não distribui pesos auxiliares do openWakeWord.

O treino combinou três conjuntos de características temporários: 4.000 exemplos
positivos e 8.000 negativos gerados por Piper, mais 300 variações sem recorte de
cada uma das sete gravações de referência; 500 variações com silêncio de borda
recortado de cada referência; e 1.800 negativos sintéticos difíceis. O
classificador foi treinado por 25 épocas com semente 356. Os scripts
`scripts/gerar-features-wake.py`, `scripts/treinar-classificador-wake.py` e
`scripts/verificar-modelo-wake.py` documentam a geração, o treino e a inferência.
As características e os áudios brutos não são distribuídos.

As referências são os quatro WAV em `tests/fixtures/audio` e três M4A fornecidos
pelo PI em 2026-10-03, respectivamente “Ei, amigo”, “Amigo” e “Ei, você”. O PI
autorizou o ajuste e a publicação dos pesos, mas os M4A não entram no Git.
Como essas gravações participaram do treino, sua classificação posterior é
regressão, não validação independente. O teste físico com uma nova fala, duas
palmas e a máquina bloqueada permanece obrigatório pela SPEC.

As vozes sintéticas vieram de `pt_BR-faber-medium` ([cartão do modelo](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/pt/pt_BR/faber/medium/MODEL_CARD),
dataset CC0) e `pt_BR-edresson-low` ([cartão do modelo](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/pt/pt_BR/edresson/low/MODEL_CARD),
dataset CC BY 4.0). O código e os pesos do Piper não são incluídos neste arquivo.
