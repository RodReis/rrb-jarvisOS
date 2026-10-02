# Prova M11-F00 — orquestrador local e integrador

> Gerado por `scripts/prova-squads/relatorio.mjs` a partir de `reports/squads-prova/*.json`. 
> SPEC: [SPEC-Squads-00](../docs/spec/spec-squads-00-prova-orquestrador-integrador.md) · issue #369.

## Veredito

| Critério do PI | Resultado | Número |
|---|---|---|
| Orquestrador `hermes3:8b` ≥ 80% de planos aceitos | **REPROVADO** | 9/17 = 52.9% |
| Orquestrador `qwen3:8b` ≥ 80% de planos aceitos | **REPROVADO** | 10/17 = 58.8% |
| Integrador `fase:claude-fable-5-1`: zero hunk perdido sem registro **e** 100% de suítes verdes | **REPROVADO** | perdidos sem registro: 59; suítes verdes: 6/6 |
| Integrador `hermes3:8b`: zero hunk perdido sem registro **e** 100% de suítes verdes | **REPROVADO** | perdidos sem registro: 72; suítes verdes: 5/6 |
| Integrador `qwen3:8b`: zero hunk perdido sem registro **e** 100% de suítes verdes | **REPROVADO** | perdidos sem registro: 55; suítes verdes: 5/6 |

**Recomendação:** nenhum modelo local atingiu o critério. O padrão do orquestrador é o **modelo da fase**, pela assinatura (regra 2 da SPEC); o local fica como opção.

## Ambiente (regra 4)

- GPU: NVIDIA GeForce RTX 5060, 8151 MiB, 616.92
- Node v24.15.0 · win32 x64
- Modelos Ollama: hermes3:8b · 4f6b83f30b62; qwen3:8b · 500a1f067a9f
- `num_ctx` pedido: 8192 · temperatura 0 · semente 42 · `think: false`
- Snapshot: 2026-10-02T17:58:07.312Z · validador `ddfef988c2ce` · manifesto `c0dda637a407`

## Critério 1 — planos aceitos, por modelo e por fatia

### `fase:claude-fable-5-1` — 17/17 (100.0%)

| Fatia | Critérios | Decisão | Motivos de rejeição | Latência | Prompt / saída (tokens) | `num_ctx` efetivo | VRAM |
|---|---:|---|---|---:|---|---:|---:|
| M9-F01 | 6 | aceito | — | 60.5 s | 2 / 5093 | — | — |
| M9-F02 | 7 | aceito | — | 66.0 s | 2 / 5781 | — | — |
| M9-F03 | 13 | aceito | — | 79.7 s | 2 / 7339 | — | — |
| M9-F04 | 12 | aceito | — | 78.7 s | 2 / 6860 | — | — |
| M9-F05 | 13 | aceito | — | 96.6 s | 2 / 8449 | — | — |
| M9-F06 | 9 | aceito | — | 69.8 s | 2 / 5830 | — | — |
| M10-F01 | 6 | aceito | — | 87.4 s | 2 / 7369 | — | — |
| M10-F02 | 6 | aceito | — | 51.4 s | 2 / 4831 | — | — |
| M10-F03 | 6 | aceito | — | 61.0 s | 2 / 5368 | — | — |
| M10-F04 | 6 | aceito | — | 46.9 s | 2 / 4152 | — | — |
| M10-F05 | 7 | aceito | — | 60.3 s | 2 / 5090 | — | — |
| M26-F01 | 7 | aceito | — | 79.5 s | 2 / 6638 | — | — |
| M26-F02 | 8 | aceito | — | 71.9 s | 2 / 5696 | — | — |
| M26-F03 | 8 | aceito | — | 64.3 s | 2 / 6272 | — | — |
| M26-F04 | 6 | aceito | — | 69.0 s | 2 / 6149 | — | — |
| M26-F05 | 6 | aceito | — | 56.2 s | 2 / 5579 | — | — |
| M26-F06 | 8 | aceito | — | 117.8 s | 2 / 8909 | — | — |

Latência: mediana 69.0 s, máxima 117.8 s. Truncamento de prompt: 0.
Rejeições por motivo: nenhuma.

### `hermes3:8b` — 9/17 (52.9%)

| Fatia | Critérios | Decisão | Motivos de rejeição | Latência | Prompt / saída (tokens) | `num_ctx` efetivo | VRAM |
|---|---:|---|---|---:|---|---:|---:|
| M9-F01 | 6 | rejeitado | REDUNDANTE×6 | 18.0 s | 745 / 1372 | 8192 | 5.2 GB |
| M9-F02 | 7 | aceito | — | 12.0 s | 737 / 926 | 8192 | 5.2 GB |
| M9-F03 | 13 | aceito | — | 22.8 s | 1198 / 1716 | 8192 | 5.2 GB |
| M9-F04 | 12 | rejeitado | REDUNDANTE×2, COBERTURA_INCOMPLETA×1 | 18.8 s | 1294 / 1400 | 8192 | 5.2 GB |
| M9-F05 | 13 | rejeitado | REDUNDANTE×7, COBERTURA_INCOMPLETA×1 | 21.4 s | 970 / 1626 | 8192 | 5.2 GB |
| M9-F06 | 9 | rejeitado | COBERTURA_INCOMPLETA×1 | 12.8 s | 790 / 974 | 8192 | 5.2 GB |
| M10-F01 | 6 | rejeitado | PATH_FORA_DO_ESCOPO×1, REDUNDANTE×2, COBERTURA_INCOMPLETA×1 | 20.6 s | 1023 / 1546 | 8192 | 5.2 GB |
| M10-F02 | 6 | rejeitado | REDUNDANTE×6 | 18.2 s | 1026 / 1379 | 8192 | 5.2 GB |
| M10-F03 | 6 | aceito | — | 9.7 s | 958 / 738 | 8192 | 5.2 GB |
| M10-F04 | 6 | rejeitado | ORCAMENTO_EXCEDIDO×1, COBERTURA_INCOMPLETA×1 | 21.0 s | 968 / 1654 | 8192 | 5.2 GB |
| M10-F05 | 7 | aceito | — | 10.1 s | 988 / 800 | 8192 | 5.2 GB |
| M26-F01 | 7 | aceito | — | 9.4 s | 773 / 744 | 8192 | 5.2 GB |
| M26-F02 | 8 | aceito | — | 11.0 s | 836 / 872 | 8192 | 5.2 GB |
| M26-F03 | 8 | rejeitado | COBERTURA_INCOMPLETA×1 | 15.3 s | 794 / 1216 | 8192 | 5.2 GB |
| M26-F04 | 6 | aceito | — | 10.1 s | 749 / 776 | 8192 | 5.2 GB |
| M26-F05 | 6 | aceito | — | 8.4 s | 1134 / 623 | 8192 | 5.2 GB |
| M26-F06 | 8 | aceito | — | 13.1 s | 1565 / 969 | 8192 | 5.2 GB |

Latência: mediana 13.1 s, máxima 22.8 s. Truncamento de prompt: 0.
Rejeições por motivo: REDUNDANTE×23, COBERTURA_INCOMPLETA×6, PATH_FORA_DO_ESCOPO×1, ORCAMENTO_EXCEDIDO×1.

### `qwen3:8b` — 10/17 (58.8%)

| Fatia | Critérios | Decisão | Motivos de rejeição | Latência | Prompt / saída (tokens) | `num_ctx` efetivo | VRAM |
|---|---:|---|---|---:|---|---:|---:|
| M9-F01 | 6 | aceito | — | 9.1 s | 751 / 605 | 8192 | 5.8 GB |
| M9-F02 | 7 | aceito | — | 10.7 s | 747 / 724 | 8192 | 5.8 GB |
| M9-F03 | 13 | aceito | — | 19.2 s | 1219 / 1262 | 8192 | 5.8 GB |
| M9-F04 | 12 | rejeitado | ORCAMENTO_EXCEDIDO×1, REDUNDANTE×18 | 57.6 s | 1318 / 3805 | 8192 | 5.8 GB |
| M9-F05 | 13 | aceito | — | 19.7 s | 983 / 1303 | 8192 | 5.8 GB |
| M9-F06 | 9 | aceito | — | 14.1 s | 795 / 944 | 8192 | 5.8 GB |
| M10-F01 | 6 | rejeitado | PATH_FORA_DO_ESCOPO×4, REDUNDANTE×3 | 22.2 s | 1033 / 1479 | 8192 | 5.8 GB |
| M10-F02 | 6 | aceito | — | 19.7 s | 1034 / 1313 | 8192 | 5.8 GB |
| M10-F03 | 6 | rejeitado | PATH_FORA_DO_ESCOPO×6, REDUNDANTE×6 | 20.6 s | 970 / 1385 | 8192 | 5.8 GB |
| M10-F04 | 6 | rejeitado | COBERTURA_INCOMPLETA×1 | 20.9 s | 972 / 1401 | 8192 | 5.8 GB |
| M10-F05 | 7 | rejeitado | COBERTURA_INCOMPLETA×1 | 21.2 s | 998 / 1426 | 8192 | 5.8 GB |
| M26-F01 | 7 | aceito | — | 22.2 s | 784 / 1496 | 8192 | 5.8 GB |
| M26-F02 | 8 | rejeitado | REDUNDANTE×6, COBERTURA_INCOMPLETA×1 | 21.3 s | 848 / 1445 | 8192 | 5.8 GB |
| M26-F03 | 8 | aceito | — | 15.8 s | 802 / 1069 | 8192 | 5.8 GB |
| M26-F04 | 6 | aceito | — | 9.3 s | 750 / 636 | 8192 | 5.8 GB |
| M26-F05 | 6 | aceito | — | 10.6 s | 1158 / 713 | 8192 | 5.8 GB |
| M26-F06 | 8 | rejeitado | REDUNDANTE×2 | 20.8 s | 1603 / 1378 | 8192 | 5.8 GB |

Latência: mediana 19.7 s, máxima 57.6 s. Truncamento de prompt: 0.
Rejeições por motivo: REDUNDANTE×35, PATH_FORA_DO_ESCOPO×10, COBERTURA_INCOMPLETA×3, ORCAMENTO_EXCEDIDO×1.

### Medição v1 arquivada

- `qwen3:8b` com o teto fixo de 12 tarefas: 6/17 (35.3%). Duas fatias têm 13 critérios e cada tarefa aponta um critério só, então cobri-los com 12 tarefas era impossível para qualquer modelo; o teto passou a `max(12, nº de critérios)` no **perfil** — o validador, congelado por hash, não mudou. Os dois números ficam aqui para o PI ver o efeito da correção.

## Critérios 2 e 3 — integrador

**Amostra:** 6 casos sintéticos (conflito injetado sobre fatia real) + 4 históricos reais (merges de `main` que conflitaram, todos de docs) + 0 reconstruídos por pares de fatias.

Os pares de fatias do conjunto de referência deram **zero** casos: o processo é WIP=1 e linear, e nenhuma das 17 fatias nasceu de uma main que andou. Motivos dos pares descartados: o patch do segundo escritor não aplica na base (88); sem arquivo de código em comum (45); o merge dos dois lados é limpo (3).

**Como ler os "perdidos sem registro".** O manifesto lista todo hunk que os dois escritores produziram e conta como perdido o que não está no resultado e não tem motivo registrado. O **piso** é o mesmo cálculo sobre a resposta de verdade (o PR real, ou o merge humano): ele não é zero. Nos sintéticos, o hunk mutado (`// w2`) só pode entrar se o integrador escolher um lado e **registrar** o descarte do outro; nos merges de docs, o humano também descartou linhas superadas sem registro. Um integrador no piso fez o que a verdade fez; acima do piso, perdeu algo a mais.

### Camada `fase:claude-fable-5-1` — REPROVADA

| Caso | Tipo | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | Piso (perdidos na verdade) | Suíte | Falhas |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| S-M9-F01 | sintetico | 1 | 55 | 54 | 0 | 1 | 1 | verde | — |
| S-M9-F03 | sintetico | 1 | 44 | 43 | 0 | 1 | 1 | verde | — |
| S-M9-F04 | sintetico | 1 | 36 | 35 | 0 | 1 | 1 | verde | — |
| S-M26-F01 | sintetico | 1 | 61 | 59 | 0 | 2 | 2 | verde | — |
| S-M26-F02 | sintetico | 1 | 71 | 69 | 1 | 1 | 2 | verde | — |
| S-M26-F06 | sintetico | 1 | 68 | 65 | 0 | 3 | 3 | verde | — |
| H-d37e0b4a | historico | 4 | 140 | 133 | 1 | 6 | 8 | n/a (docs) | — |
| H-9f2a3c41 | historico | 5 | 133 | 126 | 0 | 7 | 5 | n/a (docs) | — |
| H-e6262cf0 | historico | 17 | 422 | 383 | 3 | 36 | 63 | n/a (docs) | — |
| H-26b301f5 | historico | 1 | 25 | 24 | 0 | 1 | 1 | n/a (docs) | — |

### Camada `hermes3:8b` — REPROVADA

| Caso | Tipo | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | Piso (perdidos na verdade) | Suíte | Falhas |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| S-M9-F01 | sintetico | 1 | 55 | 53 | 0 | 2 | 1 | verde | — |
| S-M9-F03 | sintetico | 1 | 44 | 42 | 0 | 2 | 1 | verde | — |
| S-M9-F04 | sintetico | 1 | 36 | 34 | 0 | 2 | 1 | verde | — |
| S-M26-F01 | sintetico | 1 | 61 | 59 | 0 | 2 | 2 | verde | — |
| S-M26-F02 | sintetico | 1 | 71 | 68 | 0 | 3 | 2 | verde | — |
| S-M26-F06 | sintetico | 1 | 68 | 64 | 0 | 4 | 3 | **vermelha** | — |
| H-d37e0b4a | historico | 4 | 140 | 134 | 0 | 6 | 8 | n/a (docs) | fora_do_contexto (89109 caracteres, limite local 18000); fora_do_contexto (24099 |
| H-9f2a3c41 | historico | 5 | 133 | 126 | 0 | 7 | 5 | n/a (docs) | fora_do_contexto (88593 caracteres, limite local 18000); fora_do_contexto (23507 |
| H-e6262cf0 | historico | 17 | 422 | 380 | 0 | 42 | 63 | n/a (docs) | fora_do_contexto (19139 caracteres, limite local 18000); fora_do_contexto (24232 |
| H-26b301f5 | historico | 1 | 25 | 23 | 0 | 2 | 1 | n/a (docs) | — |

### Camada `qwen3:8b` — REPROVADA

| Caso | Tipo | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | Piso (perdidos na verdade) | Suíte | Falhas |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| S-M9-F01 | sintetico | 1 | 55 | 53 | 0 | 2 | 1 | verde | — |
| S-M9-F03 | sintetico | 1 | 44 | 43 | 0 | 1 | 1 | verde | — |
| S-M9-F04 | sintetico | 1 | 36 | 35 | 0 | 1 | 1 | verde | — |
| S-M26-F01 | sintetico | 1 | 61 | 59 | 0 | 2 | 2 | verde | — |
| S-M26-F02 | sintetico | 1 | 71 | 69 | 0 | 2 | 2 | verde | — |
| S-M26-F06 | sintetico | 1 | 68 | 65 | 0 | 3 | 3 | **vermelha** | — |
| H-d37e0b4a | historico | 4 | 140 | 136 | 0 | 4 | 8 | n/a (docs) | fora_do_contexto (89109 caracteres, limite local 18000); fora_do_contexto (24099 |
| H-9f2a3c41 | historico | 5 | 133 | 128 | 0 | 5 | 5 | n/a (docs) | fora_do_contexto (88593 caracteres, limite local 18000); fora_do_contexto (23507 |
| H-e6262cf0 | historico | 17 | 422 | 384 | 4 | 34 | 63 | n/a (docs) | fora_do_contexto (19139 caracteres, limite local 18000); fora_do_contexto (24232 |
| H-26b301f5 | historico | 1 | 25 | 24 | 0 | 1 | 1 | n/a (docs) | — |

## Critério 3 — o manifesto detecta perda injetada

Teste negativo em `src/main/squads/prova/manifesto-hunks.spec.ts`: hunk removido de propósito, arquivo inteiro sumido, remoção que não aconteceu e motivo em branco — os quatro caem em *perdido sem registro*. Roda na suíte Regras.

## Critério 4 — reprodução pelo snapshot

```
node scripts/prova-squads/snapshot.mjs            # fixa fatias, perfil, hash do validador (não rodar de novo: invalida as medições)
TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/orquestrador.mjs <hermes3:8b|qwen3:8b|fase:claude-fable-5-1>
node scripts/prova-squads/levantar-casos.mjs
TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador.mjs <camada>
node scripts/prova-squads/relatorio.mjs
```

O orquestrador e o integrador **recusam rodar** se o hash de `squad-plan.ts` diverge do snapshot. Os prompts moram em `orquestrador.mjs` e `integrador.mjs` (versionados); o conjunto, em `snapshot.json`.

## Limites declarados

- **Um plano por fatia, uma tentativa.** O critério é "planos aceitos"; replanejar até passar mediria a paciência do loop.
- **Validador mínimo**, não o da F02. A taxa depende das regras dele (cobertura total dos critérios, redundância, escopo de paths); trocar regra muda o número, e por isso ele é congelado por hash.
- **Diretórios permitidos** vêm dos diretórios que o PR real tocou — o modelo recebe o escopo que a fatia de fato teve.
- **Conflitos do integrador são fabricados** nos casos sintéticos (código e verdade reais, conflito injetado); os históricos reais são só de docs, sem suíte. O "zero hunk perdido" vale para essa amostra pequena e não generaliza.
- **O integrador é o `git merge-tree` + a camada por bloco em conflito.** O que o merge faz sozinho entra no manifesto como preservado por construção.
- **Suíte = specs que o PR tocou + vizinhos do arquivo em conflito** (categoria Regras/Tela); `int-spec` fica fora. Caso cuja árvore da verdade já não passa neste ambiente é marcado "ambiente inválido" e sai do critério.
- **Camada local não integra conflito grande.** Blocos acima de ~18 mil caracteres (`num_ctx` 8192) ficam com os marcadores de conflito (`falhas: fora_do_contexto`), e o manifesto os conta como preservados porque as duas versões estão no arquivo — quem pega o arquivo quebrado é a suíte, que nos merges de docs não existe. Os merges de docs não provam o integrador local.
- **O manifesto tem piso, não zero.** A verdade também "perde" hunks (coluna Piso), então o critério literal do PI (zero perdido sem registro) reprova até o resultado humano; o relatório mostra os dois números e o veredito segue o critério literal.
- **A suíte de cada caso sintético é parcial** (specs do PR + vizinhos), não a suíte inteira do projeto.
- **Baseline por assinatura** (CLI do Claude, isolamento do adapter de produção), sem API paga.

