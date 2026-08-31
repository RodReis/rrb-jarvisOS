# MVP-019 — Briefing matinal e proatividade interna

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Nenhuma fatia tem SPEC** — nascimento lazy.
- GitHub: épico [#195](https://github.com/RodReis/rrb-jarvisOS/issues/195).
- Fila: depois do MVP-017 (não depende do MVP-018 — briefing e anúncio funcionam com push-to-talk).
- Depende de: MVP-017. Não depende de: MVP-018, MVP-020.
- Resultado: JARVIS conta o que importa sem ser perguntado, a partir dos dados que o app **já tem** — projetos, fila da pipeline, entregas em `AWAITING_PI`, erros — mais a previsão do tempo como única dependência externa.

## Tese

O diferencial "estilo Tony Stark" não é a integração externa — é a proatividade sobre o que o próprio jarvisOS opera. Pipeline parada, erro de run e entrega aguardando aceite são eventos que o app já materializa localmente (fonte de verdade operacional, ADR-001); este MVP os transforma em voz e notificação, sem raspar o GitHub em paralelo.

## Fatias previstas

| Índice | Fatia | SPEC prevista |
|---|---|---|
| M19-F01 | Briefing matinal falado (dados internos + previsão do tempo) | `spec-briefing-01-briefing-matinal.md` |
| M19-F02 | Proatividade: eventos da pipeline → anúncio TTS | `spec-briefing-02-eventos-anuncio.md` |
| M19-F03 | Notificação no celular | `spec-briefing-03-notificacao-celular.md` |

Ordem: F01 → F02 → F03. O canal da notificação (ntfy/Telegram/push próprio) é decisão da SPEC da F03.

## Invariantes

- Fonte dos dados do briefing é o estado local do app — nunca uma segunda leitura do GitHub em paralelo ao que a pipeline materializa.
- Anúncio falado usa o TTS do MVP-017; nenhum segundo caminho de áudio.
- Evento → anúncio passa por regra configurável (o que anunciar, em que horário), não hardcode.

## Done do épico

- Briefing matinal falado com projetos, fila, aceites pendentes e previsão do tempo.
- Erro ou pipeline parada gera anúncio em voz na hora, sem pergunta do PI.
- O mesmo evento chega como notificação no celular.
