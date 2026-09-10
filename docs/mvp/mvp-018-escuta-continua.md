# MVP-018 — Escuta contínua e Modo Boas-Vindas

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Redação da M18-F01 aberta em 2026-09-10**, com nove decisões do PI; F02 e F03 seguem sem SPEC (nascimento lazy).
- GitHub: épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Fila: **não altera `next`.** A redação foi autorizada em paralelo à Pipeline de Desenvolvimento; a construção corrente é a M10-F01 ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)). SPEC aprovada habilita o Backlog, nada mais.
- Depende de: **MVP-017 (fechado em 2026-09-10)**. Não depende de: MVP-019.
- Resultado: JARVIS ativado pela frase **"Ei, amigo"**, com escuta contínua **global nos dois espaços** (JARVIS OS + NOA); push-to-talk vira o caso secundário (decisão do PI, 2026-08-30).

## Tese

O MVP-017 entrega a conversa; este MVP muda o gatilho. A detecção de wake word roda 100% local — nenhum áudio sai da máquina antes de a palavra disparar — e o pipeline pós-ativação é exatamente o do MVP-017: mesmas engines, mesmo ponto único, nenhum segundo caminho de áudio.

## Fatias previstas

| Índice | Fatia | SPEC | Estado |
|---|---|---|---|
| M18-F01 | Engine de wake word local, global nos dois espaços | `spec-escuta-01-wake-word.md` | **`aprovada-pi` (2026-09-10)** |
| M18-F02 | Arbitração wake word ↔ push-to-talk + estados do microfone | `spec-escuta-02-arbitracao-microfone.md` | a redigir |
| M18-F03 | Modo Boas-Vindas (saudação por horário/chegada) | `spec-escuta-03-boas-vindas.md` | a redigir |

Ordem: F01 → F02 → F03. A música do Boas-Vindas é o MVP-020 (conector Spotify) — a F03 entrega o gancho.

## Invariantes

- Wake word detectado localmente; nenhum áudio sai da máquina antes do disparo.
- O pipeline pós-ativação é o do MVP-017; este MVP não cria engine nova.
- **Conversa por voz continua não executando ação** (invariante herdado do MVP-017): o wake word muda quem abre o turno, não o que o turno pode fazer.

## Decisões do PI (2026-09-10)

1. **Engine: openWakeWord.** O **Porcupine foi descartado por fato externo** — a Picovoice encerrou o free tier em **2026-06-30** e o SDK não opera sem AccessKey válida, validada contra a nuvem, o que contraria o invariante "100% local". Não reabrir sem licença paga.
2. **Modelo próprio, não os pré-treinados.** Os modelos prontos do openWakeWord são **CC BY-NC-SA 4.0 (não comercial)** e deixariam dívida de licença no produto. O modelo é treinado com áudio sintético gerado pelo **Piper**, que o app já embarca desde a M17-F02.
3. **Palavra de ativação: "Ei, amigo".**
4. **Escuta ligada sempre que o app estiver rodando** — minimizado, em segundo plano e **com a máquina bloqueada**. Resolve as duas perguntas que este documento carregava desde 2026-08-30.
5. **Com a sessão bloqueada, responde só por voz.** A janela não sobe (a lock screen do Windows é outra sessão, e subir exporia a conversa); o turno aparece no histórico ao destravar.
6. **Com a sessão desbloqueada, o disparo traz o Command Center à frente.**
7. **Modelo distribuído como artefato baixado no 1º uso**, SHA-256 pinado e `AuditEvent`, pelo mesmo caminho auditado do runtime Python, do Whisper (M17-F01) e do Piper (M17-F02). O treino acontece fora do app.
8. **Sensibilidade ajustável em Settings, com teste ao vivo**, reusando o medidor de nível da M17-F05.
9. **Controle do microfone aberto, os quatro dentro da F01:** kill switch sempre alcançável, indicador permanente de escuta ativa, `AuditEvent` ao ligar/desligar e hotkey global de mute.

## Risco conhecido do MVP

**Falso positivo.** "Amigo" é palavra corrente em pt-BR, e o PI trabalha falando sobre o próprio projeto. A SPEC-Escuta-01 responde com frase de duas palavras, dataset negativo dirigido (critério 2, com contrafactual) e limiar calibrável — mas o veredito é o uso real, não a suíte.

## Done do épico

- A palavra de ativação abre a conversa sem toque, nos dois espaços.
- Push-to-talk continua funcionando como caminho secundário, sem conflito.
- Modo Boas-Vindas dispara saudação personalizada por horário/chegada.
