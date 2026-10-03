"""Treina o classificador ONNX sobre features do openWakeWord (SPEC-Escuta-01).

As features entram de `gerar-features-wake.py`; este script não lê nem grava áudio.
O corpus físico de validação fica fora do treino e precisa ser medido à parte.
"""

import argparse
from pathlib import Path

import numpy as np
import torch
from torch import nn


class Classificador(nn.Module):
    def __init__(self):
        super().__init__()
        self.rede = nn.Sequential(
            nn.Flatten(),
            nn.Linear(16 * 96, 128),
            nn.ReLU(),
            nn.Dropout(0.15),
            nn.Linear(128, 1),
        )

    def forward(self, x):
        return torch.sigmoid(self.rede(x / 32.0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--epocas", type=int, default=25)
    args = parser.parse_args()

    torch.manual_seed(356)
    np.random.seed(356)
    bruto = np.load(args.features)
    x = torch.from_numpy(bruto["x"].astype(np.float32))
    y = torch.from_numpy(bruto["y"].astype(np.float32)).reshape(-1, 1)
    ordem = torch.randperm(len(x))
    corte = int(len(x) * 0.8)
    treino, validacao = ordem[:corte], ordem[corte:]

    modelo = Classificador()
    otimizador = torch.optim.AdamW(modelo.parameters(), lr=0.0001)
    perda = nn.BCELoss()
    for epoca in range(args.epocas):
        modelo.train()
        soma = 0.0
        for lote in treino.split(128):
            otimizador.zero_grad()
            erro = perda(modelo(x[lote]), y[lote])
            erro.backward()
            otimizador.step()
            soma += erro.item() * len(lote)
        modelo.eval()
        with torch.no_grad():
            scores = modelo(x[validacao])
            acertos = ((scores >= 0.5) == y[validacao]).float().mean().item()
            falsos = ((scores >= 0.5) & (y[validacao] == 0)).sum().item()
            perdas = ((scores < 0.5) & (y[validacao] == 1)).sum().item()
        print(
            f"epoca={epoca + 1} perda={soma / len(treino):.4f} "
            f"acerto={acertos:.3f} falsos={falsos} perdas={perdas}",
            flush=True,
        )

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        modelo.eval(),
        torch.zeros(1, 16, 96),
        str(args.saida),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    print(f"modelo={args.saida}")


if __name__ == "__main__":
    main()
