# MVP-018 — Escuta contínua e Modo Boas-Vindas

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Nenhuma fatia tem SPEC** — nascimento lazy.
- GitHub: épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Fila: depois do MVP-017.
- Depende de: MVP-017. Não depende de: MVP-019.
- Resultado: JARVIS ativado por wake word, com escuta contínua **global nos dois espaços** (JARVIS OS + NOA); push-to-talk vira o caso secundário (decisão do PI, 2026-08-30).

## Tese

O MVP-017 entrega a conversa; este MVP muda o gatilho. A detecção de wake word roda 100% local — nenhum áudio sai da máquina antes de a palavra disparar — e o pipeline pós-ativação é exatamente o do MVP-017: mesmas engines, mesmo ponto único, nenhum segundo caminho de áudio.

## Fatias previstas

| Índice | Fatia | SPEC prevista |
|---|---|---|
| M18-F01 | Engine de wake word local, global nos dois espaços | `spec-escuta-01-wake-word.md` |
| M18-F02 | Arbitração wake word ↔ push-to-talk + estados do microfone | `spec-escuta-02-arbitracao-microfone.md` |
| M18-F03 | Modo Boas-Vindas (saudação por horário/chegada) | `spec-escuta-03-boas-vindas.md` |

Ordem: F01 → F02 → F03. A música do Boas-Vindas é o MVP-020 (conector Spotify) — a F03 entrega o gancho.

## Invariantes

- Wake word detectado localmente (openWakeWord/Porcupine — a escolha é decisão da SPEC da F01); nenhum áudio sai da máquina antes do disparo.
- O pipeline pós-ativação é o do MVP-017; este MVP não cria engine nova.

## Perguntas já registradas para as SPECs (o PI decide lá)

- Comportamento do microfone contínuo com o app em segundo plano.
- Wake word com a tela bloqueada: escuta ou não.

## Done do épico

- A palavra de ativação abre a conversa sem toque, nos dois espaços.
- Push-to-talk continua funcionando como caminho secundário, sem conflito.
- Modo Boas-Vindas dispara saudação personalizada por horário/chegada.
