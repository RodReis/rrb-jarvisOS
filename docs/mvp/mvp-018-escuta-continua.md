# MVP-018 — Escuta contínua e Modo Boas-Vindas

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Redigido em 2026-09-10**: as três SPECs previstas ficaram `aprovada-pi` na mesma data, e o PI criou uma **quarta fatia (M18-F04)**, ainda sem SPEC.
- GitHub: épico [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194).
- Fila: **não altera `next`.** A redação foi autorizada em paralelo à Pipeline de Desenvolvimento; a construção corrente é a M10-F01 ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)). SPEC aprovada habilita o Backlog, nada mais.
- Depende de: **MVP-017 (fechado em 2026-09-10)**. Não depende de: MVP-019.
- Resultado: JARVIS ativado pela frase **"Ei, amigo"**, com escuta contínua **global nos dois espaços** (JARVIS OS + NOA); push-to-talk vira o caso secundário (decisão do PI, 2026-08-30).

## Tese

O MVP-017 entrega a conversa; este MVP muda o gatilho. A detecção de wake word roda 100% local — nenhum áudio sai da máquina antes de a palavra disparar — e o pipeline pós-ativação é exatamente o do MVP-017: mesmas engines, mesmo ponto único, nenhum segundo caminho de áudio.

## Fatias

| Índice | Fatia | SPEC | Estado |
|---|---|---|---|
| M18-F01 | Engine de wake word local, global nos dois espaços | `spec-escuta-01-wake-word.md` | **`aprovada-pi` (2026-09-10)** |
| M18-F02 | Arbitração wake word ↔ push-to-talk + estados do microfone | `spec-escuta-02-arbitracao-microfone.md` | **`aprovada-pi` (2026-09-10)** |
| M18-F03 | Modo Boas-Vindas (saudação + mídia local na chegada) | `spec-escuta-03-boas-vindas.md` | **`aprovada-pi` (2026-09-10)** |
| M18-F04 | Cronograma de atividades configurável | `spec-escuta-04-cronograma.md` | a redigir |

Ordem: F01 → F02 → F03 → F04.

## Invariantes

- Wake word detectado localmente; nenhum áudio sai da máquina antes do disparo.
- O pipeline pós-ativação é o do MVP-017; este MVP não cria engine nova.
- **Conversa por voz continua não executando ação** (invariante herdado do MVP-017). A mídia local da F03 não abre essa porta: é o próprio app reproduzindo um arquivo que o PI escolheu antes, disparado por evento do sistema — nada lê intenção de fala e a transforma em efeito. Quando o cronograma da F04 chegar, é ele quem carrega Policy Engine e aprovação.

## Decisões do PI (2026-09-10)

### Fatia 01 — engine e escuta

1. **Engine: openWakeWord.** O **Porcupine foi descartado por fato externo** — a Picovoice encerrou o free tier em **2026-06-30** e o SDK não opera sem AccessKey válida, validada contra a nuvem, o que contraria o invariante "100% local". Não reabrir sem licença paga.
2. **Modelo próprio, não os pré-treinados.** Os modelos prontos do openWakeWord são **CC BY-NC-SA 4.0 (não comercial)** e deixariam dívida de licença no produto. O modelo é treinado com áudio sintético gerado pelo **Piper**, que o app já embarca desde a M17-F02.
3. **Palavra de ativação: "Ei, amigo".**
4. **Escuta ligada sempre que o app estiver rodando** — minimizado, em segundo plano e **com a máquina bloqueada**.
5. **Com a sessão bloqueada, responde só por voz.** A janela não sobe (a lock screen do Windows é outra sessão, e subir exporia a conversa); o turno aparece no histórico ao destravar.
6. **Com a sessão desbloqueada, o disparo traz o Command Center à frente.**
7. **Modelo distribuído como artefato baixado no 1º uso**, SHA-256 pinado e `AuditEvent`, pelo mesmo caminho auditado do runtime Python, do Whisper (M17-F01) e do Piper (M17-F02).
8. **Sensibilidade ajustável em Settings, com teste ao vivo**, reusando o medidor de nível da M17-F05.
9. **Controle do microfone aberto:** kill switch sempre alcançável, indicador permanente, `AuditEvent` ao ligar/desligar e hotkey global de mute.

### Fatia 02 — arbitração

10. **Durante a fala do JARVIS: interromper por voz**, com supressão do próprio áudio para que o Piper dizendo "ei, amigo" não auto-dispare o app.
11. **Push-to-talk sempre ganha** — segurar o botão suspende a detecção; soltar retoma.
12. **Disparo com turno em andamento: ignora e sinaliza.** Nada é enfileirado.
13. **`escutando` é o quinto estado do mascote**, com expressão própria.

### Fatia 03 — Boas-Vindas

14. **Gatilho: primeiro desbloqueio do dia** (`powerMonitor`), sem câmera e sem sensor.
15. **Saudação pela persona com queda para frase fixa** — chegada nunca fica muda nem pendurada esperando o Ollama.
16. **As quatro guardas:** janela de horário, respeita o kill switch da escuta, silêncio se houver áudio tocando, teto de uma por período.
17. **Música: local agora, Spotify no MVP-020.** O PI pediu música na chegada; antecipar o conector traria OAuth, Vault, Policy Engine e rate limit para dentro de uma fatia de saudação, e duplicaria o MVP-020.
18. **Gancho: evento `boas-vindas` publicado, sem consumidor obrigatório.**

### Fatia 04 — nova, criada nesta rodada

19. **O cronograma de atividades configurável vira fatia própria**, depois da F03. É escopo novo — sequência de ações disparada por evento, com ordem, condições, Policy Engine e aprovação — e é a mesma família da fatia de "comandos com efeito" que o PI tirou da M17-F05 em 2026-09-09. Fica em `docs/mvp/`, a redigir; nenhuma issue nasce antes da SPEC.

## Riscos conhecidos do MVP

- **Falso positivo (F01).** "Amigo" é palavra corrente em pt-BR, e o PI trabalha falando sobre o próprio projeto. A SPEC responde com frase de duas palavras, dataset negativo dirigido e contrafactual obrigatório — mas o veredito é o uso real.
- **Supressão do próprio áudio (F02).** Depende de o app conhecer exatamente o que está tocando; qualquer caminho de reprodução fora dessa referência reabre o auto-disparo.
- **Falar primeiro (F03)** é a decisão mais fácil de odiar depois. Daí as quatro guardas e o liga/desliga próprio.

## Done do épico

- A palavra de ativação abre a conversa sem toque, nos dois espaços.
- Push-to-talk continua funcionando como caminho secundário, sem conflito.
- Modo Boas-Vindas dispara saudação personalizada por horário/chegada.
