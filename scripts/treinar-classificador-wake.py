"""Treina o detector próprio em log-mel do Piper, sem backbone pré-treinado.

O arquivo NPZ contém features, não áudio. As três gravações do PI podem entrar
no treino após autorização explícita; os arquivos não são copiados para o repositório.
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
            nn.Conv2d(1, 16, 5, padding=2),
            nn.BatchNorm2d(16),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.AdaptiveAvgPool2d((8, 5)),
            nn.Flatten(),
            nn.Linear(64 * 8 * 5, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 1),
        )

    def forward(self, x):
        return self.rede(x)


class ClassificadorExportado(nn.Module):
    def __init__(self, classificador):
        super().__init__()
        self.classificador = classificador

    def forward(self, x):
        return torch.sigmoid(self.classificador(x))


def exportar(modelo, caminho):
    exportado = ClassificadorExportado(modelo.eval()).cpu()
    torch.onnx.export(
        exportado,
        torch.zeros(1, 1, 197, 40),
        str(caminho),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    modelo.to("cuda" if torch.cuda.is_available() else "cpu")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, nargs="+", required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--epocas", type=int, default=25)
    parser.add_argument("--salvar-epocas", type=int, nargs="*", default=[])
    args = parser.parse_args()
    args.saida.parent.mkdir(parents=True, exist_ok=True)

    torch.manual_seed(356)
    np.random.seed(356)
    blocos = [np.load(caminho) for caminho in args.features]
    x = torch.from_numpy(np.concatenate([bloco["x"] for bloco in blocos]))
    y = torch.from_numpy(
        np.concatenate([bloco["y"] for bloco in blocos]).astype(np.float32)
    ).reshape(-1, 1)
    if x.ndim != 3 or x.shape[1:] != (197, 40):
        raise ValueError(f"Features incompatíveis: {tuple(x.shape)}")
    ordem = torch.randperm(len(x))
    corte = int(len(x) * 0.8)
    treino, validacao = ordem[:corte], ordem[corte:]
    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"

    modelo = Classificador().to(dispositivo)
    otimizador = torch.optim.AdamW(modelo.parameters(), lr=0.0003)
    perda = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([2.0], device=dispositivo))
    for epoca in range(args.epocas):
        modelo.train()
        soma = 0.0
        for lote in treino.split(128):
            entrada = x[lote].to(device=dispositivo, dtype=torch.float32).unsqueeze(1)
            esperado = y[lote].to(dispositivo)
            otimizador.zero_grad()
            erro = perda(modelo(entrada), esperado)
            erro.backward()
            otimizador.step()
            soma += erro.item() * len(lote)
        modelo.eval()
        falsos, perdas, total = 0, 0, 0
        with torch.no_grad():
            for lote in validacao.split(256):
                entrada = x[lote].to(device=dispositivo, dtype=torch.float32).unsqueeze(1)
                score = torch.sigmoid(modelo(entrada)).cpu()
                falsos += int(((score >= 0.5) & (y[lote] == 0)).sum())
                perdas += int(((score < 0.5) & (y[lote] == 1)).sum())
                total += len(lote)
        print(
            f"epoca={epoca + 1} perda={soma / len(treino):.4f} "
            f"validacao={total} falsos={falsos} perdas={perdas}",
            flush=True,
        )
        if epoca + 1 in args.salvar_epocas:
            caminho = args.saida.with_name(f"{args.saida.stem}-epoca{epoca + 1}.onnx")
            exportar(modelo, caminho)

    exportar(modelo, args.saida)
    print(f"modelo={args.saida}")


if __name__ == "__main__":
    main()
