# SPEC-DesignSystem-05 — Identidades NOA e JARVIS

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 05)
- Status: **aprovada-pi** (2026-07-21) — todas as perguntas resolvidas pelo PI.
- Dependências: Fatia 02 entregue (tokens/tema/`uiTheme`/acento). Pode andar em paralelo com a Fatia 03; integra-se ao WorkspaceSwitcher da Fatia 04.
- Decisões que sustentam esta spec: MVP-003 §Decisões (**base única, 2 identidades**; fidelidade ao protótipo); `NOA.md §1`, `JARVISOS.md §1`, `README.md §2.4/§2.6`; PRD §5.2; LANDSCAPE (domínios NOA vs JARVIS).

## Objetivo

Expressar NOA e JARVIS OS como **duas identidades sobre a mesma base**, sem duplicar componentes. Uma camada fina de **tokens de identidade** (acento default, tom, superfície, mascote, tokens de tema `jt*`/`nt*`) parametriza os mesmos componentes do DS — provando a tese "base única, 2 identidades".

> **Guardrail anti-duplicação.** Nenhum componente é reescrito "versão NOA" / "versão JARVIS". A diferença vive em **tokens de identidade** e em props (`identity: 'noa' | 'jarvis'`), não em código de componente. Caso exija componente exclusivo de um módulo, ele **não** entra no DS (PRD §18.3) — vira componente de produto.

## Escopo

### Dentro

- **Contrato de identidade:** um token-set por módulo aplicado sobre as foundations (Fatia 02), **com par escuro/claro** (README §2.6):
  - **NOA** (`NOA.md §1`): tom calmo/íntimo; fundo escuro `#0b0d0d` (viés verde neutro) ↔ claro `#f2f4f2` aprox.; hairlines `nBord` `200,212,206` ↔ `34,44,38`; acento default `#C4C4C4` (fallback `#2CFF05`); mascote `assets/noa-cabeca.png`; tokens de tema `nt*`; **sem voz** por padrão.
  - **JARVIS** (`JARVISOS.md §1`): tom tático/direto; fundo escuro `#0a0b0e` **+ glow radial do acento** (`radial-gradient(1200px 500px at 70% 0%, color-mix(in srgb, accJ 6%, transparent), transparent 65%)`) ↔ claro `#f5f6f8` aprox.; hairlines `jBord` `200,204,212` ↔ `30,35,46`; acento default `#C4C4C4` (fallback `#D3AF37`); mascote `assets/jarvis-cabeca.jpg`; tokens de tema `jt*`; prop `falaAutomatica` reservada (voz real é Corte 4).
- **`uiTheme` é global e compartilhado** entre as duas identidades (README §2.6): o toggle da topbar afeta os dois módulos ao mesmo tempo. Identidade **não** troca o modo; só troca o token-set (`jt*` vs `nt*`) e o acento.
- **Mascote como componente visual** (VoiceMascot): anel `spin`, glow `corepulse`, `bob`, `mix-blend-mode:screen` (tile **sempre escuro**, inclusive no claro), olhos/boca reativos — **estado por props** (`speaking`/`listening`), **sem** motor de TTS/STT (mock/estático). Serve NOA e JARVIS trocando imagem/acento. **No NOA, voz desabilitada por prop** (mascote sem estados de fala por padrão).
- **Glow radial do JARVIS mantido** (decisão do PI): a atmosfera do acento no topo do conteúdo é parte da identidade tática e permanece como no protótipo.
- **Aplicação no shell:** o WorkspaceSwitcher (Fatia 04) troca a identidade ativa; a identidade do outro espaço nunca vaza (regra da SPEC-Fundacao-02). Cada módulo mantém seu acento (`accN`/`accJ`) — não reaproveitar o do outro.
- **Semânticas compartilhadas:** `status-*`/`risk-*`/`accent-violet` iguais nos dois (README §2.3) — identidade **não** as altera.

### Fora

- **Voz/áudio real** (TTS/STT online) — Corte 4. Aqui o mascote é visual.
- Telas específicas de cada módulo (as 7 do NOA; Command Center/Mission Control do JARVIS) — consumidoras, Corte 3+.
- Persistência do acento/`uiTheme` — modelo é do Settings (SPEC-Fundacao-05).
- Agentic OS (área interna do JARVIS) — usa a identidade JARVIS; conteúdo é produto, fora do DS.

## Critérios de aceite

1. Um mesmo componente (ex.: Card, Button) renderiza com identidade **NOA** e **JARVIS** trocando só o token-set/prop — **sem** componente duplicado (teste renderiza os dois).
2. Acento default por módulo aplicado (NOA `#C4C4C4`, JARVIS `#C4C4C4`); trocar o acento de um **não** afeta o outro (teste).
3. Par escuro/claro por identidade aplica os valores do README §2.6; `uiTheme` global afeta as duas identidades juntas (teste).
4. Glow radial do JARVIS presente no fundo do conteúdo (inspeção/teste de estilo).
5. `status-*`/`risk-*` idênticos nos dois módulos e nos dois modos (teste: identidade e `uiTheme` não mudam semântica).
6. VoiceMascot reflete `speaking`/`listening` por props, **sem** invocar `speechSynthesis`/`SpeechRecognition`; no NOA, sem estados de fala por padrão (teste: nenhum acesso a API de voz).
7. Tile do mascote permanece escuro no `uiTheme='light'` (teste/inspeção).
8. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Fundo por identidade:** **padrão escuro** (referência `01-login.png`); o claro é o modo alternativo das telas internas (README §2.6), com os pares por identidade acima. — resolvido.
2. **VoiceMascot no NOA:** **sem voz por padrão** — componente único, voz desabilitada por prop no NOA (mascote visual, sem estados de fala). — resolvido.
3. **Glow do JARVIS × legibilidade:** **manter o glow radial do acento** do protótipo. — resolvido.
4. **Acento no modo claro:** **permitir ajuste de tom só para leitura** — o acento mantém o tom na marca; onde renderiza texto e o contraste falha (comum no claro), ajusta-se só a luminância para leitura. Alinhado à SPEC-DesignSystem-02. — resolvido.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`. (Densidades foram cortadas na SPEC-DesignSystem-02.)
