# Prova M11-F00b — integrador reprovado e F00-bis do orquestrador local

> Gerado por `scripts/prova-squads/relatorio-e1.mjs` a partir de `reports/squads-prova-e1/*.json`.
> SPEC: [SPEC-Squads-00 § Emenda E1](../docs/spec/spec-squads-00-prova-orquestrador-integrador.md) · issue #373. Substitui a conclusão do [relatório da F00](squads-prova-m11-f00.md), que fica como histórico.

## Veredito

| Critério do PI | Resultado | Número |
|---|---|---|
| Orquestrador `hermes3:8b` ≥ 80% de planos aceitos dentro do limite (3 tentativas) | **REPROVADO** | 0/17 = 0.0% (1ª tentativa: 0/17) |
| Orquestrador `qwen3:8b` ≥ 80% de planos aceitos dentro do limite (3 tentativas) | **REPROVADO** | 3/17 = 17.6% (1ª tentativa: 0/17) |
| Integrador `fase:claude-fable-5-1`: zero hunk perdido sem registro **e** 100% de suítes verdes, nos casos de código | **APROVADO** | 6/6 casos aprovados |
| Integrador `hermes3:8b`: zero hunk perdido sem registro **e** 100% de suítes verdes, nos casos de código | **REPROVADO** | 0/6 casos aprovados |
| Integrador `qwen3:8b`: zero hunk perdido sem registro **e** 100% de suítes verdes, nos casos de código | **REPROVADO** | 1/6 casos aprovados |

**Orquestrador:** nenhum modelo local atingiu o critério. O padrão segue sendo o **modelo da fase**, e o local fica como opção (SPEC-Squads-00, regra 2).

**Integrador:** `fase:claude-fable-5-1` atingiu o critério nos 6 casos de código com suíte.

## Ambiente (regra 4 da SPEC)

- GPU: NVIDIA GeForce RTX 5060, 8151 MiB, 616.92
- Node v24.15.0 · win32 x64
- Modelos Ollama: hermes3:8b · 4f6b83f30b62; qwen3:8b · 500a1f067a9f
- `num_ctx` pedido: 8192 · temperatura 0 · semente 42 · `think: false`
- Snapshot: 2026-10-03T04:50:41.720Z · commit `ef14b079`
- Arquivos congelados por hash (o orquestrador e o integrador recusam rodar se algum mudou):
  - `95df42dcdb3e` src/shared/domain/squad-plano.ts
  - `5dc16eefc207` src/shared/domain/squad-plano-esquema.ts
  - `a1fc2c934e11` src/shared/domain/squad-perfil.ts
  - `bbb06efc7a1c` src/shared/domain/squad-capacidades.ts
  - `bfc10945cd25` src/shared/domain/squad-resolucao.ts
  - `41e35ff0b92a` src/shared/domain/attempt.ts
  - `a24066b4db9f` src/main/squads/squad-prompt.ts
  - `eccc98adfc5c` src/main/squads/squad-planejador.ts
  - `d9964c5923d8` src/main/squads/squad-snapshot.ts
  - `409f9b38da9a` src/main/squads/prova/base-do-prompt.ts
- Instrumento do integrador: `ffced56e089c` · 2026-10-03T04:52:49.685Z

## F00-bis — orquestrador, por modelo e por fatia

Cada fatia passa pelo `planejarSquad` de produção: pedido de `montarPedido` + bloco da base (árvore de arquivos e stack), validador endurecido, feedback das rejeições e o limite de três tentativas da M9-F04. As fatias são as 17 da primeira medição.

### `fase:claude-fable-5-1` — 17/17 dentro do limite (100.0%); 15/17 na primeira tentativa

| Fatia | Critérios | 1ª tentativa | Dentro do limite | Rejeições (1ª) | Rejeições (última) | Plano (tarefas / escritores / paths) | Latência | Prompt máx. (tokens) | Truncado |
|---|---:|---|---|---|---|---|---:|---:|---|
| M9-F01 | 6 | rejeitada | aceito (t2) | FONTE_FORA_DO_ESCOPO×1 | — | 11 / 1 / 16 | 95.3 s | — | não |
| M9-F02 | 7 | aceita | aceito (t1) | — | — | 11 / 1 / 14 | 51.0 s | — | não |
| M9-F03 | 13 | aceita | aceito (t1) | — | — | 13 / 1 / 42 | 99.7 s | — | não |
| M9-F04 | 12 | aceita | aceito (t1) | — | — | 12 / 1 / 29 | 81.8 s | — | não |
| M9-F05 | 13 | aceita | aceito (t1) | — | — | 13 / 1 / 19 | 119.9 s | — | não |
| M9-F06 | 9 | aceita | aceito (t1) | — | — | 12 / 1 / 39 | 71.5 s | — | não |
| M10-F01 | 6 | aceita | aceito (t1) | — | — | 11 / 1 / 14 | 46.4 s | — | não |
| M10-F02 | 6 | aceita | aceito (t1) | — | — | 12 / 1 / 25 | 62.6 s | — | não |
| M10-F03 | 6 | aceita | aceito (t1) | — | — | 12 / 1 / 13 | 54.4 s | — | não |
| M10-F04 | 6 | aceita | aceito (t1) | — | — | 11 / 1 / 12 | 42.2 s | — | não |
| M10-F05 | 7 | aceita | aceito (t1) | — | — | 10 / 1 / 28 | 46.6 s | — | não |
| M26-F01 | 7 | aceita | aceito (t1) | — | — | 11 / 1 / 25 | 61.3 s | — | não |
| M26-F02 | 8 | aceita | aceito (t1) | — | — | 12 / 1 / 47 | 68.7 s | — | não |
| M26-F03 | 8 | aceita | aceito (t1) | — | — | 12 / 1 / 26 | 91.4 s | — | não |
| M26-F04 | 6 | aceita | aceito (t1) | — | — | 11 / 1 / 18 | 57.5 s | — | não |
| M26-F05 | 6 | aceita | aceito (t1) | — | — | 10 / 1 / 21 | 49.7 s | — | não |
| M26-F06 | 8 | rejeitada | aceito (t2) | FONTE_FORA_DO_ESCOPO×1 | — | 12 / 1 / 33 | 144.0 s | — | não |

Latência por fatia (todas as tentativas): mediana 62.6 s, máxima 144.0 s. VRAM —. Chamadas com falha de execução: 0.
Rejeições por motivo, em todas as tentativas: FONTE_FORA_DO_ESCOPO×2.

### `hermes3:8b` — 0/17 dentro do limite (0.0%); 0/17 na primeira tentativa

| Fatia | Critérios | 1ª tentativa | Dentro do limite | Rejeições (1ª) | Rejeições (última) | Plano (tarefas / escritores / paths) | Latência | Prompt máx. (tokens) | Truncado |
|---|---:|---|---|---|---|---|---:|---:|---|
| M9-F01 | 6 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, ESCRITOR_EM_PAPEL_DE_LEITURA×1, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1 | PATH_FORA_DO_ESCOPO×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, CAMADA_FORA_DO_PERFIL×2, ESCRITOR_EM_PAPEL_DE_LEITURA×2, SCHEMA_DE_RESULTADO_DIVERGENTE×2, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 31.9 s | 2494 | não |
| M9-F02 | 7 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×7, CAPACIDADE_FORA_DO_PAPEL×2, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1 | — | 38.7 s | 2488 | não |
| M9-F03 | 13 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, CAMADA_FORA_DO_PERFIL×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, SCHEMA_DE_RESULTADO_DIVERGENTE×2, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 32.6 s | 3406 | não |
| M9-F04 | 12 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | SCHEMA_DE_RESULTADO_DIVERGENTE×4, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, CAPACIDADE_FORA_DO_PAPEL×1, REVISOR_FORA_DA_CAMADA×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 93.1 s | 2610 | não |
| M9-F05 | 13 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×4, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, CAMADA_FORA_DO_PERFIL×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | SCHEMA_DE_RESULTADO_DIVERGENTE×12, PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, CAMADA_FORA_DO_PERFIL×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1 | — | 102.8 s | 2836 | não |
| M9-F06 | 9 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×10, REDUNDANTE×4, PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | SCHEMA_DE_RESULTADO_DIVERGENTE×8, PAPEL_DE_ESCRITA_SEM_ESCRITOR×6, ESCRITOR_EM_PAPEL_DE_LEITURA×5, REDUNDANTE×4, CAPACIDADE_FORA_DO_PAPEL×2, CICLO×1, INTEGRADOR_FORA_DO_PERFIL×1, PATH_FORA_DO_ESCOPO×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 68.1 s | 3368 | não |
| M10-F01 | 6 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, PATH_FORA_DO_ESCOPO×2, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 36.4 s | 2133 | não |
| M10-F02 | 6 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×2, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, CAMADA_FORA_DO_PERFIL×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, SCHEMA_DE_RESULTADO_DIVERGENTE×1, ESCRITOR_EM_PAPEL_DE_LEITURA×1, CAMADA_FORA_DO_PERFIL×1, INTEGRADOR_FORA_DO_PERFIL×1, PATH_FORA_DO_ESCOPO×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 31.0 s | 3160 | não |
| M10-F03 | 6 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, SCHEMA_DE_RESULTADO_DIVERGENTE×4, ESCRITOR_EM_PAPEL_DE_LEITURA×4, REDUNDANTE×4, CAPACIDADE_FORA_DO_PAPEL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 45.0 s | 1864 | não |
| M10-F04 | 6 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, FONTE_FORA_DO_ESCOPO×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, PATH_FORA_DO_ESCOPO×3, ESCRITOR_EM_PAPEL_DE_LEITURA×3, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 32.1 s | 1998 | não |
| M10-F05 | 7 | rejeitada | rejeitado | CAMADA_FORA_DO_PERFIL×2, SCHEMA_DE_RESULTADO_DIVERGENTE×2, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×6, CAMADA_FORA_DO_PERFIL×2, CAPACIDADE_FORA_DO_PAPEL×1, REVISOR_FORA_DA_CAMADA×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 52.0 s | 3632 | não |
| M26-F01 | 7 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, INTEGRADOR_FORA_DO_PERFIL×2, CAMADA_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | ESCRITOR_EM_PAPEL_DE_LEITURA×2, SCHEMA_DE_RESULTADO_DIVERGENTE×2, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, CAMADA_FORA_DO_PERFIL×1, TEMPO_EXCEDIDO×1, TOKENS_EXCEDIDOS×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 105.6 s | 3336 | não |
| M26-F02 | 8 | rejeitada | rejeitado | CAMADA_FORA_DO_PERFIL×2, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, SCHEMA_DE_RESULTADO_DIVERGENTE×2, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, REDUNDANTE×1, COBERTURA_INCOMPLETA×1 | — | 45.6 s | 3563 | não |
| M26-F03 | 8 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×6, PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, INTEGRADOR_FORA_DO_PERFIL×2, CAMADA_FORA_DO_PERFIL×1, SEM_ESCRITOR×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, SCHEMA_DE_RESULTADO_DIVERGENTE×3, INTEGRADOR_FORA_DO_PERFIL×2, ESCRITOR_EM_PAPEL_DE_LEITURA×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 47.7 s | 3807 | não |
| M26-F04 | 6 | rejeitada | rejeitado | ESCRITOR_SEM_PATH×6, ESCRITOR_EM_PAPEL_DE_LEITURA×5, SCHEMA_DE_RESULTADO_DIVERGENTE×4, CAMADA_FORA_DO_PERFIL×1, INTEGRADOR_FORA_DO_PERFIL×1, CAPACIDADE_FORA_DO_PAPEL×1, REVISOR_FORA_DA_CAMADA×1, ESCRITORES_EXCEDIDOS×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×3, CAMADA_FORA_DO_PERFIL×3, ESCRITOR_EM_PAPEL_DE_LEITURA×3, CAPACIDADE_FORA_DO_PAPEL×2, REVISOR_FORA_DA_CAMADA×2, INTEGRADOR_FORA_DO_PERFIL×1, PATH_FORA_DO_ESCOPO×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 39.0 s | 3671 | não |
| M26-F05 | 6 | rejeitada | rejeitado | SCHEMA_DE_RESULTADO_DIVERGENTE×3, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, REDUNDANTE×2, ESCRITOR_EM_PAPEL_DE_LEITURA×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | ESCRITOR_EM_PAPEL_DE_LEITURA×7, PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, CAMADA_FORA_DO_PERFIL×2, INTEGRADOR_FORA_DO_PERFIL×2, SCHEMA_DE_RESULTADO_DIVERGENTE×1, SEM_ESCRITOR×1, REDUNDANTE×1, COBERTURA_INCOMPLETA×1 | — | 52.5 s | 3204 | não |
| M26-F06 | 8 | rejeitada | rejeitado | CAMADA_FORA_DO_PERFIL×2, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, ESCRITOR_EM_PAPEL_DE_LEITURA×1, SCHEMA_DE_RESULTADO_DIVERGENTE×1, INTEGRADOR_FORA_DO_PERFIL×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | ESCRITOR_EM_PAPEL_DE_LEITURA×4, PAPEL_DE_ESCRITA_SEM_ESCRITOR×4, SCHEMA_DE_RESULTADO_DIVERGENTE×3, CAMADA_FORA_DO_PERFIL×2, INTEGRADOR_FORA_DO_PERFIL×2, CAPACIDADE_FORA_DO_PAPEL×1, REVISOR_FORA_DA_CAMADA×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 43.0 s | 3596 | não |

Latência por fatia (todas as tentativas): mediana 45.0 s, máxima 105.6 s. VRAM 5.2 GB. Chamadas com falha de execução: 0.
Rejeições por motivo, em todas as tentativas: PAPEL_DE_ESCRITA_SEM_ESCRITOR×163, SCHEMA_DE_RESULTADO_DIVERGENTE×120, ESCRITOR_EM_PAPEL_DE_LEITURA×87, INTEGRADOR_FORA_DO_PERFIL×51, SEM_ESCRITOR×47, CAMADA_FORA_DO_PERFIL×42, COBERTURA_INCOMPLETA×40, PATH_FORA_DO_ESCOPO×34, REDUNDANTE×24, CAPACIDADE_FORA_DO_PAPEL×17, REVISOR_FORA_DA_CAMADA×10, ESCRITOR_SEM_PATH×6, FONTE_FORA_DO_ESCOPO×5, ORCAMENTO_EXCEDIDO×3, PATH_INEXISTENTE×2, CICLO×1, TEMPO_EXCEDIDO×1, TOKENS_EXCEDIDOS×1, ESCRITORES_EXCEDIDOS×1.

### `qwen3:8b` — 3/17 dentro do limite (17.6%); 0/17 na primeira tentativa

| Fatia | Critérios | 1ª tentativa | Dentro do limite | Rejeições (1ª) | Rejeições (última) | Plano (tarefas / escritores / paths) | Latência | Prompt máx. (tokens) | Truncado |
|---|---:|---|---|---|---|---|---:|---:|---|
| M9-F01 | 6 | rejeitada | aceito (t3) | PAPEL_DE_ESCRITA_SEM_ESCRITOR×6, SEM_ESCRITOR×1 | — | 6 / 1 / 12 | 54.6 s | 2379 | não |
| M9-F02 | 7 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×8, SEM_ESCRITOR×1, REDUNDANTE×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, ESCRITOR_EM_PAPEL_DE_LEITURA×2, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 91.2 s | 2415 | não |
| M9-F03 | 13 | rejeitada | rejeitado | ORCAMENTO_EXCEDIDO×1 | ORCAMENTO_EXCEDIDO×1 | — | 251.7 s | 3251 | não |
| M9-F04 | 12 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×11, ESCRITOR_EM_PAPEL_DE_LEITURA×1, SEM_ESCRITOR×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×12, SEM_ESCRITOR×1 | — | 114.5 s | 2861 | não |
| M9-F05 | 13 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×13, SEM_ESCRITOR×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×8, ESCRITOR_EM_PAPEL_DE_LEITURA×1, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 110.7 s | 3046 | não |
| M9-F06 | 9 | rejeitada | rejeitado | ORCAMENTO_EXCEDIDO×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×6, ESCRITOR_EM_PAPEL_DE_LEITURA×3, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 100.2 s | 2914 | não |
| M10-F01 | 6 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, ESCRITOR_EM_PAPEL_DE_LEITURA×2, SEM_ESCRITOR×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, ESCRITOR_EM_PAPEL_DE_LEITURA×5, SEM_ESCRITOR×1 | — | 70.9 s | 2005 | não |
| M10-F02 | 6 | rejeitada | rejeitado | ORCAMENTO_EXCEDIDO×1 | indisponivel | — | 462.5 s | 2897 | não |
| M10-F03 | 6 | rejeitada | aceito (t2) | PAPEL_DE_ESCRITA_SEM_ESCRITOR×6, SEM_ESCRITOR×1 | — | 6 / 1 / 6 | 36.4 s | 1766 | não |
| M10-F04 | 6 | rejeitada | rejeitado | ORCAMENTO_EXCEDIDO×1 | ORCAMENTO_EXCEDIDO×1 | — | 157.1 s | 1584 | não |
| M10-F05 | 7 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×7, ESCRITOR_EM_PAPEL_DE_LEITURA×3, SCHEMA_DE_RESULTADO_DIVERGENTE×2, SEM_ESCRITOR×1 | CRITERIO_INEXISTENTE×4, PAPEL_DE_ESCRITA_SEM_ESCRITOR×2, ESCRITOR_EM_PAPEL_DE_LEITURA×1, SEM_ESCRITOR×1 | — | 107.1 s | 3657 | não |
| M26-F01 | 7 | indisponivel | rejeitado | indisponivel | indisponivel | — | 307.1 s | — | não |
| M26-F02 | 8 | rejeitada | rejeitado | SCHEMA×1 | indisponivel | — | 374.1 s | — | não |
| M26-F03 | 8 | rejeitada | rejeitado | ORCAMENTO_EXCEDIDO×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×8, CRITERIO_INEXISTENTE×4, SEM_ESCRITOR×1 | — | 192.5 s | 3487 | não |
| M26-F04 | 6 | rejeitada | aceito (t2) | ESCRITOR_EM_PAPEL_DE_LEITURA×7, PAPEL_DE_ESCRITA_SEM_ESCRITOR×5, SEM_ESCRITOR×1 | — | 12 / 1 / 3 | 108.1 s | 3589 | não |
| M26-F05 | 6 | rejeitada | rejeitado | ORCAMENTO_EXCEDIDO×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×12, REDUNDANTE×6, SEM_ESCRITOR×1 | — | 134.7 s | 2800 | não |
| M26-F06 | 8 | rejeitada | rejeitado | PAPEL_DE_ESCRITA_SEM_ESCRITOR×9, REDUNDANTE×6, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | PAPEL_DE_ESCRITA_SEM_ESCRITOR×8, SEM_ESCRITOR×1, COBERTURA_INCOMPLETA×1 | — | 115.5 s | 3882 | não |

Latência por fatia (todas as tentativas): mediana 114.5 s, máxima 462.5 s. VRAM 5.8 GB. Chamadas com falha de execução: 3. 3 fatia(s) terminaram por falha de execução (M10-F02, M26-F01, M26-F02: chamada acima do timeout de 5 min do cliente, tratada como indisponibilidade, como no produto). Mesmo contando todas como aceitas, o limite superior é 6/17 = 35.3%.
Rejeições por motivo, em todas as tentativas: PAPEL_DE_ESCRITA_SEM_ESCRITOR×146, ESCRITOR_EM_PAPEL_DE_LEITURA×37, SEM_ESCRITOR×20, REDUNDANTE×14, CRITERIO_INEXISTENTE×13, ORCAMENTO_EXCEDIDO×13, COBERTURA_INCOMPLETA×9, ESCRITOR_SEM_PATH×4, CAPACIDADE_FORA_DO_PAPEL×3, SCHEMA_DE_RESULTADO_DIVERGENTE×3, SCHEMA×2.

## Integrador — o instrumento corrigido

**Os 6 casos de código** têm, em cada um, dois escritores que acrescentam **comportamentos diferentes no mesmo ponto** do módulo e do spec, cada um com teste próprio. Conflitam de verdade no `git` (módulo e spec); a verdade é a base com os dois lados, e o manifesto aplicado a ela dá **zero perdido e zero não resolvido** — o piso é zero por construção. A suíte do spec passou na base, em cada lado e na verdade **antes** de qualquer camada rodar:

| Caso | Alvo | Hunks | Base | Lado 1 | Lado 2 | Verdade |
|---|---|---:|---|---|---|---|
| E1-M9-F01 | `src/shared/domain/publicacao.ts` | 6 | verde | verde | verde | verde |
| E1-M9-F03 | `src/shared/domain/context-pack.ts` | 6 | verde | verde | verde | verde |
| E1-M9-F04 | `src/shared/domain/preflight.ts` | 6 | verde | verde | verde | verde |
| E1-M26-F01 | `src/shared/domain/fase.ts` | 6 | verde | verde | verde | verde |
| E1-M26-F02 | `src/shared/domain/modelo-da-fase.ts` | 6 | verde | verde | verde | verde |
| E1-M26-F06 | `src/shared/domain/rota-de-geracao.ts` | 6 | verde | verde | verde | verde |

**Bloco não resolvido é falha do caso**, nunca hunk preservado: o manifesto separa o hunk que só existe dentro de um bloco em conflito (`naoResolvidos`), e o caso só passa com zero perdidos, zero não resolvidos, nenhuma falha de resolução e a suíte verde.

### Camada `fase:claude-fable-5-1` — APROVADA (6/6)

| Caso | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | **Não resolvidos** | Falhas de resolução | Suíte | Latência |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| E1-M9-F01 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 22.9 s |
| E1-M9-F03 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 18.0 s |
| E1-M9-F04 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 24.7 s |
| E1-M26-F01 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 22.6 s |
| E1-M26-F02 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 19.5 s |
| E1-M26-F06 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 20.4 s |

*Merges históricos de docs (informativos, fora do critério):*

| Caso | Blocos | Hunks | Preservados | Perdidos sem registro | Não resolvidos | Falhas de resolução |
|---|---:|---:|---:|---:|---:|---|
| H-d37e0b4a | 4 | 140 | 134 | 5 | 0 | — |
| H-9f2a3c41 | 5 | 133 | 126 | 5 | 0 | — |
| H-e6262cf0 | 17 | 422 | 383 | 35 | 0 | — |
| H-26b301f5 | 1 | 25 | 24 | 1 | 0 | — |

### Camada `hermes3:8b` — REPROVADA (0/6)

| Caso | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | **Não resolvidos** | Falhas de resolução | Suíte | Latência |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| E1-M9-F01 | 3 | 6 | 1 | 0 | 5 (2 só de import) | 0 | — | **vermelha** | 5.9 s |
| E1-M9-F03 | 3 | 6 | 2 | 0 | 4 (2 só de import) | 0 | — | **vermelha** | 6.2 s |
| E1-M9-F04 | 3 | 6 | 2 | 0 | 4 (2 só de import) | 0 | — | **vermelha** | 5.1 s |
| E1-M26-F01 | 3 | 6 | 5 | 0 | 1 | 0 | — | **vermelha** | 4.4 s |
| E1-M26-F02 | 3 | 6 | 3 | 0 | 3 (2 só de import) | 0 | — | **vermelha** | 6.1 s |
| E1-M26-F06 | 3 | 6 | 3 | 0 | 3 (2 só de import) | 0 | — | **vermelha** | 4.3 s |

*Merges históricos de docs (informativos, fora do critério):*

| Caso | Blocos | Hunks | Preservados | Perdidos sem registro | Não resolvidos | Falhas de resolução |
|---|---:|---:|---:|---:|---:|---|
| H-d37e0b4a | 4 | 140 | 132 | 6 | 2 | 2 bloco(s): fora_do_contexto (89109 caracteres, limite local 1 |
| H-9f2a3c41 | 5 | 133 | 123 | 7 | 3 | 2 bloco(s): fora_do_contexto (88593 caracteres, limite local 1 |
| H-e6262cf0 | 17 | 422 | 376 | 43 | 3 | 2 bloco(s): fora_do_contexto (19139 caracteres, limite local 1 |
| H-26b301f5 | 1 | 25 | 23 | 2 | 0 | — |

### Camada `qwen3:8b` — REPROVADA (1/6)

Leitura alternativa, que **não** é o veredito: se fundir "import" numa linha fosse aceito, 2/6 casos passariam.

| Caso | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | **Não resolvidos** | Falhas de resolução | Suíte | Latência |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| E1-M9-F01 | 3 | 6 | 4 | 0 | 2 (2 só de import) | 0 | — | **vermelha** | 9.3 s |
| E1-M9-F03 | 3 | 6 | 4 | 0 | 2 (2 só de import) | 0 | — | **vermelha** | 7.6 s |
| E1-M9-F04 | 3 | 6 | 4 | 0 | 2 (2 só de import) | 0 | — | **vermelha** | 8.5 s |
| E1-M26-F01 | 3 | 6 | 4 | 0 | 2 (2 só de import) | 0 | — | verde | 5.7 s |
| E1-M26-F02 | 3 | 6 | 6 | 0 | 0 | 0 | — | verde | 6.0 s |
| E1-M26-F06 | 3 | 6 | 4 | 0 | 2 (2 só de import) | 0 | — | **vermelha** | 6.8 s |

*Merges históricos de docs (informativos, fora do critério):*

| Caso | Blocos | Hunks | Preservados | Perdidos sem registro | Não resolvidos | Falhas de resolução |
|---|---:|---:|---:|---:|---:|---|
| H-d37e0b4a | 4 | 140 | 134 | 4 | 2 | 2 bloco(s): fora_do_contexto (89109 caracteres, limite local 1 |
| H-9f2a3c41 | 5 | 133 | 125 | 5 | 3 | 2 bloco(s): fora_do_contexto (88593 caracteres, limite local 1 |
| H-e6262cf0 | 17 | 422 | 382 | 33 | 3 | 2 bloco(s): fora_do_contexto (19139 caracteres, limite local 1 |
| H-26b301f5 | 1 | 25 | 24 | 1 | 0 | — |

## Critérios de aceite da emenda

1. **Relatório por modelo e por fatia, primeira tentativa e dentro do limite:** seção *F00-bis*, acima.
2. **Teste negativo do manifesto — bloco não resolvido cai em falha:** `src/main/squads/prova/manifesto-hunks.spec.ts` (*bloco não resolvido*), suíte Regras.
3. **Teste do caso sintético — a verdade preserva os dois comportamentos e a suíte dela passa:** `src/main/squads/prova/caso-sintetico.spec.ts` prova a forma (conflito real no `git`, verdade com os dois lados, piso zero); a suíte da verdade passando está na tabela de controle acima, medida nos worktrees reais antes das camadas.

## Reprodução pelo snapshot

```
node scripts/prova-squads/snapshot-e1.mjs                 # fixa fatias, hashes do validador, do pedido e do laço (não rodar de novo: invalida as medições)
TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador-e1.mjs congelar
TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/orquestrador-e1.mjs <hermes3:8b|qwen3:8b|fase:claude-fable-5-1>
TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador-e1.mjs <camada>
node scripts/prova-squads/relatorio-e1.mjs
```

O orquestrador recusa rodar se um dos arquivos congelados mudou; o integrador, se o instrumento mudou ou se os casos não se reconstroem com os mesmos SHAs (commits com data e autor fixos).

## Limites declarados

- **O prompt de produção não leva o bloco da base.** A medição acrescenta a árvore de arquivos e a stack ao `system` (`src/main/squads/prova/base-do-prompt.ts`). Se o PI adotar o local como padrão, `montarPedido` precisa passar a levá-lo — o texto medido é o contrato.
- **Perfil de produção:** `PERFIL_PADRAO` com o orquestrador local (um escritor, `num_ctx` 8192). A primeira medição permitia dois escritores; um escritor é o que o produto roda hoje.
- **A árvore mostra os arquivos diretos de cada diretório permitido**, mais as subpastas (o validador aceita escrita nelas). A base de cada fatia é o pai do commit de merge.
- **Os casos de código mudaram de arquivo-alvo** em quatro fatias (M9-F01, M9-F03, M26-F01, M26-F02), porque o alvo da primeira medição (`terminal-engine.ts`, `call-provider.ts`, `index.ts`, `ProjetosLocais.tsx`) não tem como ser testado por spec puro. As seis fatias são as mesmas; todo alvo agora é um módulo de `src/shared/domain` com spec vizinho. M9-F04 e M26-F06 mantêm o alvo.
- **O conflito é "os dois acrescentam no mesmo ponto"** (fim do módulo, depois do último `import` do spec, fim do spec). Não cobre conflito semântico em lógica existente, em que a resolução exige reescrever uma função.
- **O manifesto identifica o hunk pela linha.** Fundir dois `import` numa linha é equivalente e conta como perda sem registro: 10 das 20 perdas do `hermes3:8b` e 10 das 10 perdas do `qwen3:8b` são só de import. O instrumento **não foi mudado depois de ver o resultado** (a SPEC proíbe ajustar o que se mede até um modelo passar); a leitura alternativa está em cada camada, o veredito não depende dela, e aceitar import fundido no manifesto fica como proposta ao PI para uma próxima medição.
- **O congelamento por hash cobre o que decide a aceitação e o texto do pedido** (validador, esquema, perfil, capacidades, limite de tentativas, `montarPedido`, `planejarSquad`, bloco da base; para o integrador, os casos, o manifesto e a forma do caso). **Não cobre os scripts do harness** (`integrador.mjs`, `integrador-e1.mjs`, `orquestrador.mjs`, `orquestrador-e1.mjs`): neles moram o prompt do integrador, o timeout do cliente e o cálculo de aprovado. O `orquestrador-e1.mjs` ganhou o `.catch` em volta da chamada ao modelo depois do primeiro commit, e por isso o `qwen3:8b` foi rerodado inteiro com ele; o `hermes3:8b` rodou antes dele e não teve erro de execução. Incluir os scripts no hash fica como proposta para a próxima medição. O relatório confere que cada JSON do integrador carrega o mesmo hash dos casos.
- **O critério dos casos de código exige também zero descarte registrado**, porque a verdade contém os dois lados e qualquer descarte é perda de comportamento (o casamento do descarte é por conteúdo e um único trecho longo cobriria vários hunks). Nenhum caso de código de nenhuma camada tinha descarte; o veredito é o mesmo com ou sem a regra.
- **Diretório `.` em `pathsPermitidos`** (M10-F03 e M10-F05) aparece na árvore como "não existe na base"; o validador não aceita escrita nele de qualquer forma, então a aceitação não muda, mas o texto que o modelo recebeu nessas duas fatias é impreciso.
- **Três fatias do `qwen3:8b` terminaram por timeout do cliente** (5 min, geração longa), tratado como indisponibilidade como no produto; o limite superior sem elas está na tabela do modelo.
- **Amostra de seis casos de código**, com comportamentos pequenos de propósito: mede se o integrador preserva os dois lados, não se ele sabe programar.
- **A suíte de cada caso é o spec do módulo** (testes antigos mais os dois novos), não a suíte inteira do projeto.
- **Os merges históricos de docs seguem informativos**: sem suíte, o resultado deles não prova o integrador.
- **Controle da fase por assinatura** (CLI do Claude, isolamento do adapter de produção), sem API paga.

