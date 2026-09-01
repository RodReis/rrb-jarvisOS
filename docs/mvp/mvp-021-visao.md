# MVP-021 — Visão: presença via Frigate

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Nenhuma fatia tem SPEC** — nascimento lazy. Último da série do Command Center.
- GitHub: épico [#197](https://github.com/RodReis/rrb-jarvisOS/issues/197).
- Fila: depois do MVP-018.
- Depende de: MVP-018.
- Resultado: presença física detectada pelo Frigate vira gatilho e contexto do JARVIS (Boas-Vindas sem toque e sem wake word).

## Gate de hardware

Registrar **antes de o épico entrar na fila** (como o Docker no MVP-009): exige câmera com stream dedicado e aceleração para detecção — a RTX 5060 8GB já divide VRAM com o LLM local do MVP-017; confirmar que os dois convivem antes de puxar a primeira fatia.

## Tese

O Frigate roda local e o app **consome eventos** (MQTT/API) — não processa vídeo dentro do Electron. Detecção de pessoa é o MVP; rosto e gesto são fatias próprias, pesadas, e só entram com decisão explícita do PI — não são itens "opcionais" de outra fatia.

## Fatias previstas

| Índice | Fatia | SPEC prevista |
|---|---|---|
| M21-F01 | Frigate + câmera: detecção de pessoa/presença como evento no app | `spec-visao-01-frigate-presenca.md` |
| M21-F02 | Presença → gatilho do Boas-Vindas e contexto do assistente | `spec-visao-02-presenca-gatilho.md` |
| M21-F03 | Reconhecimento de rosto (só com decisão explícita do PI) | `spec-visao-03-rosto.md` |
| M21-F04 | Reconhecimento de gesto (idem) | `spec-visao-04-gesto.md` |

Ordem: F01 → F02; F03 e F04 só entram se o PI puxar.

## Invariantes

- Frigate roda local; nenhum frame sai da máquina.
- O app consome eventos do Frigate — nunca processa vídeo no Electron.
- Evento de visão vira gatilho dos fluxos existentes (MVP-018/019); nenhum caminho novo de anúncio.

## Done do épico

- Detecção de pessoa dispara o Modo Boas-Vindas sem toque e sem wake word.
- Estado de presença visível no Command Center.
