# SPEC-Voz-01 — STT local (faster-whisper) e push-to-talk

- MVP: `docs/mvp/mvp-017-command-center-voz.md` (Fatia 01) — abre o MVP-017. Épico [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193).
- Status: **aprovada-pi** (2026-08-30) — oito perguntas resolvidas pelo PI nesta data (quatro na definição do épico, quatro nesta spec). A fatia só entra na fila depois do MVP-009 (decisão do PI, 2026-08-30) e a issue-fatia nasce quando esta spec chegar à `main`.
- Dependências: MVP-001 (AppShell, `AuditEvent`/hash-chain, logging), MVP-003 (design system). **Independe do MVP-005** — esta fatia não chama LLM (persona é a F03) e não usa TTS (F02).
- Decisões que sustentam esta spec: decisões do PI de 2026-08-30 (épico #193 e § Perguntas resolvidas); regras invioláveis do `CLAUDE.md` (renderer nunca acessa Node; IPC mínimo e tipado via preload; ação sensível gera `AuditEvent` antes e depois; Policy Engine fail-closed); ARCHITECTURE (local é fonte de verdade operacional).

## Objetivo

A primeira metade do loop de voz do Command Center: pressionar para falar → capturar áudio → transcrever **localmente** com faster-whisper atrás de uma interface `SttEngine` → exibir o texto. Nenhum áudio sai da máquina; nenhum áudio persiste em disco. A fatia entrega a capacidade de o app **ouvir**, e só isso: quem responde é a F03 (persona no ponto único de IA) e quem fala é a F02 (Piper).

## Escopo

### Dentro

- **Interface `SttEngine`** no main — contrato mínimo `transcribe(pcm) → { text, language, segments }` — com faster-whisper como primeira implementação, **injetada**: trocar de engine é configuração, não refatoração (invariante do épico). Nenhum import do engine concreto fora da implementação.
- **Sidecar Python** como processo filho gerenciado pelo main: runtime **baixado no 1º uso** (python-build-standalone + wheels com versão e SHA-256 pinados), junto com o modelo — nada de Python do sistema. Protocolo main↔sidecar por **stdio, JSON por linha, com timeout**; o sidecar inicia sob demanda e morre com o app; crash do sidecar → erro tratado na UI com próxima ação + um restart automático — **nunca** derruba o app.
- **Modelo:** Whisper `small`, **idioma fixo pt-BR**; modelo e idioma configuráveis em Settings (valem na chamada seguinte, sem restart). Download no 1º uso com progresso e **SHA-256 pinado**; hash divergente rejeita e apaga. Artefatos em `userData/models/`.
- **Downloads auditados:** runtime, wheels e modelo vêm de **URLs fixas** embutidas (override de mirror em Settings), com `AuditEvent` antes e depois de cada download (ação sensível: rede + escrita em disco) e o Policy Engine classificando a ação. Não passa pelo runtime de conectores (não é capacidade externa com credencial) nem pelo ponto único de IA (não é chamada de modelo) — é caminho próprio com allowlist de URL e hash.
- **Captura:** o renderer captura via `getUserMedia` (Web API — a fronteira renderer/Node permanece intacta), 16 kHz mono PCM, e envia ao main por IPC tipado em chunks. **Áudio nunca persiste**: vive em memória, é transcrito e descartado.
- **Push-to-talk:** no botão do Command Center, **segurar = grava, soltar = transcreve** (walkie-talkie, como o protótipo); na **hotkey global, toggle** (um toque abre, outro encerra), registrada no main via `globalShortcut`, configurável em Settings, com mudança auditada. **Timeout duro de gravação** (default 60 s, configurável) — proteção para o toggle esquecido.
- **Compute:** CUDA quando disponível; sem GPU → CPU `int8` com indicação na UI; a escolha é logada (categoria `sistema`).
- **UI mínima da fatia:** estados do microfone (idle/gravando/transcrevendo/erro), transcript do último enunciado, estado “runtime/modelo ausente” com ação de baixar. Waveform e histórico são F05.

### Fora

- TTS (F02), persona/chamada de LLM (F03), mascote (F04), waveform/histórico/seletor de microfone (F05).
- Wake word e escuta contínua (MVP-018) — aqui o microfone só abre por ato explícito.
- **Transcrição parcial em streaming** — por enunciado completo nesta fatia (decisão do PI); parciais são evolução (F05/MVP-018, se necessário).
- **Retenção de áudio para debug** — fora (decisão do PI); se transcrição ruim exigir investigação, vira fatia própria com política de limpeza.

## Critérios de aceite

1. `SttEngine` é interface injetada no main; tela e fluxo não conhecem o engine concreto (teste com dublê); nenhum import de faster-whisper fora da implementação (guarda de lint, como o isolamento de provider da M5-F02).
2. Sidecar gerenciado: inicia sob demanda e morre com o app; matar o processo no meio de uma transcrição → a UI mostra erro com próxima ação e a tentativa seguinte funciona (restart), sem crash do app. Teste.
3. Renderer sem Node: captura via `getUserMedia` + IPC tipado; a guarda de enumeração da ponte acusa os canais novos; nenhum canal expõe processo, path de modelo ou comando.
4. 1º uso sem runtime/modelo → a UI oferece download com progresso; hash divergente (runtime, wheel ou modelo) rejeita, apaga e informa; `AuditEvent` antes/depois de cada download; `verifyAuditChain` → `ok`. Teste dos dois caminhos (sucesso e hash ruim).
5. Segurar o botão grava e soltar exibe a transcrição de uma frase em pt-BR; a hotkey global em toggle funciona com a janela minimizada; o timeout encerra gravação aberta. Verificação no app real.
6. pt-BR fixo por default; trocar modelo/idioma em Settings vale na chamada seguinte, sem restart. Teste.
7. Sem CUDA disponível, transcreve em CPU `int8` e a UI indica o modo; a escolha aparece no log. Teste forçando a indisponibilidade.
8. **Nenhum áudio em disco:** após uma sessão de uso, `userData` não contém arquivo de áudio (teste varre o diretório); o buffer PCM é descartado após a transcrição.
9. `npm run dev`, `npm run test`, `npm run lint` verdes; evidência em `reports/TESTS.md`, incluindo a **latência medida** (soltar → texto) na máquina do PI (Ryzen 7 9800X3D + RTX 5060 8GB).

## Perguntas resolvidas pelo PI (2026-08-30)

1. **Runtime STT:** faster-whisper (Python + CTranslate2), contra a alternativa whisper.cpp — o custo (runtime Python distribuído) é assumido e tratado pela decisão 5. — decidido.
2. **Modelo/idioma:** `small`, pt-BR fixo, configurável em Settings. — decidido.
3. **Distribuição do modelo:** download no 1º uso com hash verificado. — decidido.
4. **Ativação:** botão na UI **e** hotkey global. — decidido.
5. **Distribuição do runtime Python:** baixado no 1º uso (python-build-standalone + wheels pinados); instalador leve. — decidido.
6. **Comportamento:** segurar no botão, toggle na hotkey. — decidido.
7. **Áudio:** nunca persiste em disco. — decidido.
8. **Transcrição:** por enunciado completo, sem parciais na F01. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Protocolo main↔sidecar por stdio** (JSON por linha, timeout) — sem porta de rede local: superfície menor e nada para o firewall perguntar.
- **Downloads por caminho próprio auditado** (URL fixa + hash pinado) — fora do runtime de conectores e do ponto único de IA, porque nenhum dos dois descreve “baixar artefato estático sem credencial”.
- **Timeout duro de gravação** (60 s default, configurável) — consequência direta do toggle na hotkey.
- **Microfone:** dispositivo default do SO nesta fatia; o seletor de dispositivo fica para a F05.
- **Captura 16 kHz mono PCM no renderer** — `getUserMedia` é Web API; a fronteira renderer/Node não é tocada.
