# MVP-017 — Command Center: voz, persona e mascote

- Status: épico criado em 2026-08-30; divisão aprovada pelo PI na mesma data. **As cinco SPECs estão `aprovada-pi`**: F01, F02 e F03 em 2026-08-30 (issues [#200](https://github.com/RodReis/rrb-jarvisOS/issues/200), [#202](https://github.com/RodReis/rrb-jarvisOS/issues/202) e [#204](https://github.com/RodReis/rrb-jarvisOS/issues/204), **as três entregues e `proplan:finalizado` em 2026-09-08**); F04 e F05 em **2026-09-09** (issues [#351](https://github.com/RodReis/rrb-jarvisOS/issues/351) e [#352](https://github.com/RodReis/rrb-jarvisOS/issues/352)).
- GitHub: épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Fila: **depois do MVP-009**, antes dos MVP-010–016 (decisão do PI, 2026-08-30). A cabeça de 2026-09-09 é a F04 ([#351](https://github.com/RodReis/rrb-jarvisOS/issues/351)); a F05 ([#352](https://github.com/RodReis/rrb-jarvisOS/issues/352)) assume depois e fecha o MVP.
- Depende de: MVP-005 (ponto único de IA, entregue). Não depende de: MVP-006, MVP-007.
- Resultado: conversa de voz completa e 100% local no Command Center — falar → Whisper (STT) → persona JARVIS no ponto único de IA → Piper (TTS) → mascote com lip-sync por visemes, na tela do protótipo.

## Tese

O Command Center do protótipo (voz + mascote) é a identidade do produto. Este MVP a torna real de ponta a ponta sem nenhuma integração externa: push-to-talk como único modo de ativação (escuta contínua é o MVP-018), pipeline de voz local, persona configurável, e a boca do mascote sincronizada pelo timing de fonemas do TTS — não por amplitude de áudio.

## Decisões do PI (2026-08-30)

| # | Decisão |
|---|---|
| 1 | Stack de voz **local**: Whisper (STT) + Piper (TTS). ElevenLabs e Gemini-TTS fora do MVP — se voltarem, é fatia nova atrás da mesma interface Engine, não retrabalho |
| 2 | **Home Assistant removido** do escopo do Command Center (valia para a proposta original inteira) |
| 3 | Escuta contínua/wake word é o MVP-018; aqui o único gatilho é o push-to-talk |
| 4 | Hardware registrado: Ryzen 7 9800X3D + RTX 5060 8GB GDDR7. Whisper `small` como default — Qwen3 8B Q4 (~5GB) + Whisper residentes encostam no teto de VRAM |
| 5 | Conversa de voz é **só local** (Qwen3 8B via Ollama); sem fallback cloud — indisponibilidade recusa com próxima ação (SPEC-Voz-03) |

## Decisão do PI (2026-09-08) — dispositivos

O padrão de dispositivos é **do app, não do sistema**. Medido no app real: `getUserMedia` sem `deviceId` cai no padrão do Windows (a entrada da placa-mãe, sem nada plugado), RMS 95–364 contra 2076 de fala que o Whisper aceita — três conversas voltaram vazias por isso. O seletor é a **F05**; o registro completo está no comentário do épico #193.

## Decisões do PI (2026-09-09) — redação das F04 e F05

| # | Decisão |
|---|---|
| 1 | **Boca geométrica paramétrica** sobre a arte existente — a barra atual vira forma vetorial com abertura/largura/intensidade por viseme. Descartados 15 poses desenhadas (30 assets inexistentes) e mascote vetorial novo (Rive/Lottie) |
| 2 | **Comandos rápidos do protótipo ficam fora da F05** — o invariante "voz não executa ação" é preservado; comandos com efeito viram fatia própria com Policy Engine + aprovação |
| 3 | **Câmera fora da F05** — volta no MVP-021, que traz o seletor junto do consumidor |
| 4 | **A escolha do microfone é pedida antes do primeiro uso**, com medidor de nível ao lado — em vez de usar o padrão do SO e repetir o caso de origem |

## Fatias previstas

Índice `M17-Fnn`.

| Índice | Fatia | SPEC |
|---|---|---|
| M17-F01 | STT local (faster-whisper) atrás de interface Engine + push-to-talk | `spec-voz-01-stt-local-push-to-talk.md` — **`aprovada-pi` (2026-08-30)** · issue [#200](https://github.com/RodReis/rrb-jarvisOS/issues/200) · **finalizada** |
| M17-F02 | TTS Piper com timeline de visemes | `spec-voz-02-tts-piper-fonemas.md` — **`aprovada-pi` (2026-08-30)** · issue [#202](https://github.com/RodReis/rrb-jarvisOS/issues/202) · **finalizada** |
| M17-F03 | Persona JARVIS no ponto único de IA | `spec-voz-03-persona-ponto-unico.md` — **`aprovada-pi` (2026-08-30)** · issue [#204](https://github.com/RodReis/rrb-jarvisOS/issues/204) · **finalizada** |
| M17-F04 | Mascote com lip-sync por visemes + estados | `spec-voz-04-mascote-lipsync.md` — **`aprovada-pi` (2026-09-09)** · issue [#351](https://github.com/RodReis/rrb-jarvisOS/issues/351) · **em implementação** |
| M17-F05 | Tela do Command Center (ondas, legenda, histórico) e seletor de dispositivos | `spec-voz-05-ui-command-center.md` — **`aprovada-pi` (2026-09-09)** · issue [#352](https://github.com/RodReis/rrb-jarvisOS/issues/352) · **próxima** |

Ordem: F01 → F02 → F03 → F04 → F05. A F05 consome o `posicaoMs()` que a F04 introduz no relógio de áudio — inverter a ordem duplicaria esse relógio.

## Invariantes

- Renderer nunca toca áudio nativo, processo filho ou modelo direto — IPC mínimo e tipado via preload (regra inviolável do projeto).
- Toda chamada de LLM passa pelo ponto único de IA do MVP-005 (budget, auditoria, roteamento); nenhum caminho paralelo.
- STT e TTS ficam atrás de interface Engine — trocar de engine é configuração, não refatoração.
- Lip-sync por **visemes** (timing de fonemas do Piper), nunca por amplitude.
- Conversa por voz **não executa ação**: comando de voz com efeito é fatia futura com spec própria (Policy Engine + aprovação), nunca subproduto da F03 nem da F05.

## Done do épico

- [x] Conversa de voz completa (falar → resposta falada) sem nenhuma chamada cloud — entregue na F03 (2026-09-08).
- [ ] Boca do mascote sincronizada por visemes, com estados idle/ouvindo/pensando/falando — **F04**.
- [x] Persona editável em Settings sem rebuild — entregue na F03.
- [ ] A tela do Command Center do protótipo, com o dispositivo de áudio escolhido pelo usuário — **F05**.

As perguntas abertas de cada fatia são apresentadas ao PI na redação da SPEC correspondente — as da F01 (oito decisões), F02 (quatro) e F03 (quatro) foram resolvidas em 2026-08-30; as da F04 e F05, em 2026-09-09. Nenhuma fatia deste MVP tem pergunta aberta.
