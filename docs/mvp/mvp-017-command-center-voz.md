# MVP-017 — Command Center: voz, persona e mascote

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **Nenhuma fatia tem SPEC** — nascimento lazy: fatia só vira issue quando a SPEC dela ficar `aprovada-pi`.
- GitHub: épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Fila: **depois do MVP-009**, antes dos MVP-010–016 (decisão do PI, 2026-08-30).
- Depende de: MVP-005 (ponto único de IA, entregue). Não depende de: MVP-006, MVP-007.
- Resultado: conversa de voz completa e 100% local no Command Center — falar → Whisper (STT) → persona JARVIS no ponto único de IA → Piper (TTS) → mascote com lip-sync por visemes.

## Tese

O Command Center do protótipo (voz + mascote) é a identidade do produto. Este MVP a torna real de ponta a ponta sem nenhuma integração externa: push-to-talk como único modo de ativação (escuta contínua é o MVP-018), pipeline de voz local, persona configurável, e a boca do mascote sincronizada pelo timing de fonemas do TTS — não por amplitude de áudio.

## Decisões do PI (2026-08-30)

| # | Decisão |
|---|---|
| 1 | Stack de voz **local**: Whisper (STT) + Piper (TTS). ElevenLabs e Gemini-TTS fora do MVP — se voltarem, é fatia nova atrás da mesma interface Engine, não retrabalho |
| 2 | **Home Assistant removido** do escopo do Command Center (valia para a proposta original inteira) |
| 3 | Escuta contínua/wake word é o MVP-018; aqui o único gatilho é o push-to-talk |
| 4 | Hardware registrado: Ryzen 7 9800X3D + RTX 5060 8GB GDDR7. Whisper `small` como default — Qwen3 8B Q4 (~5GB) + Whisper residentes encostam no teto de VRAM |

## Fatias previstas

Índice `M17-Fnn`. Nomes de SPEC são **previstos** — a SPEC nasce quando a fatia entrar em redação.

| Índice | Fatia | SPEC prevista |
|---|---|---|
| M17-F01 | STT local (Whisper) atrás de interface Engine + push-to-talk | `spec-voz-01-stt-local-push-to-talk.md` |
| M17-F02 | TTS Piper com timestamps de fonema | `spec-voz-02-tts-piper-fonemas.md` |
| M17-F03 | Persona JARVIS no ponto único de IA | `spec-voz-03-persona-ponto-unico.md` |
| M17-F04 | Mascote com lip-sync por visemes + estados | `spec-voz-04-mascote-lipsync.md` |
| M17-F05 | UI do Command Center (waveform, transcript, histórico) | `spec-voz-05-ui-command-center.md` |

Ordem: F01 → F02 → F03 → F04 → F05.

## Invariantes

- Renderer nunca toca áudio nativo, processo filho ou modelo direto — IPC mínimo e tipado via preload (regra inviolável do projeto).
- Toda chamada de LLM passa pelo ponto único de IA do MVP-005 (budget, auditoria, roteamento); nenhum caminho paralelo.
- STT e TTS ficam atrás de interface Engine — trocar de engine é configuração, não refatoração.
- Lip-sync por **visemes** (timing de fonemas do Piper), nunca por amplitude.

## Done do épico

- Conversa de voz completa (falar → resposta falada) sem nenhuma chamada cloud.
- Boca do mascote sincronizada por visemes, com estados idle/ouvindo/pensando/falando.
- Persona editável em Settings sem rebuild.

As perguntas abertas de cada fatia serão apresentadas ao PI na redação da SPEC correspondente — nenhuma está decidida por este documento.
