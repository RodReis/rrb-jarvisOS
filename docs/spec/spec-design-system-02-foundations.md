# SPEC-DesignSystem-02 — Foundations + ponte com o protótipo

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 02)
- Status: **aprovada-pi** (2026-07-21) — todas as perguntas resolvidas pelo PI.
- Dependências: Fatia 01 entregue (camadas + toolchain). Consome preferências de tema/acento cujo **modelo de persistência** é da SPEC-Fundacao-05 (Settings) / SPEC-Fundacao-04 (dados) — aqui o DS só **lê e aplica**.
- Decisões que sustentam esta spec: MVP-003 §Decisões (**fidelidade ao protótipo** `docs/design/JARVIS Platform (offline).html`; PRD só na implementação tipada e a11y); `design-system/README.md §2` (tokens) e **§2.6 (modo claro/escuro das telas internas)**; PRD §9/§10/§16.1; PRD §14 (a11y); ADR-001.

## Objetivo

Transformar a estética provada no protótipo em **tokens tipados** e aplicá-los como **tema carbono**, incluindo o **modo claro/escuro das telas internas** exatamente como o protótipo o realiza (README §2.6). É a fatia da **ponte**: o protótipo (Michroma/Rajdhani/Share Tech Mono, cores `--ok/warn/err/info/violet`, acento `hexA`, tokens `jt*`/`nt*` de tema) entra como valor de token; a implementação segue a direção do PRD (React tipado, WCAG 2.2, sem reload).

> **Fidelidade ao protótipo é a regra.** Onde o protótipo `offline.html` e o PRD divergirem sobre a experiência realizada, **o protótipo vence** (decisão do PI). O PRD governa só a **forma de implementar** (React tipado, tokens em CSS variables, a11y) — não redesenha o que o protótipo já definiu.

> **Crítica técnica registrada (o que muda na conciliação).** O protótipo é implementado com **estilos inline / DC streaming, sem stylesheets nem classes** (README §8). Esse *modelo de implementação* é incompatível com componentes React reutilizáveis e é **abandonado** em favor de tokens (CSS variables) + componentes tipados. O que **não** muda é a aparência e o comportamento: fidelidade visual/UX ao protótipo é mandatória. (Nota: a crítica anterior de que o protótipo seria "dark-only" **caiu** — ele já tem claro/escuro interno, README §2.6.)

## Escopo

### Dentro

- **Tokens-base** (camada `tokens`, sem React): paleta, escala tipográfica, espaçamento, tamanhos, raios, bordas, sombras/elevação, duração/curvas de movimento, z-index, breakpoints (PRD §9.1). Valores **extraídos do protótipo** (raios 9–16px, sombra de card `0 20px 46px -18px rgba(0,0,0,.9)` + glow do acento, `cubic-bezier(.2,.7,.2,1)`, superfícies `#060708`/`#0a0b0e`/`#0b0d0d`).
- **Tokens semânticos** (PRD §9.1): `surface/surface-raised/surface-overlay`, `text-primary/secondary/muted/inverse`, `border-default/strong/focus`, `action-primary/secondary/danger`, `status-*`, `risk-*`, `focus-ring/selection/backdrop`. As **semânticas de status** herdam as cores do protótipo (`#34d399/#7dd3fc/#f59e0b/#ff6b81/#a78bfa`) e **não são retematizáveis pelo usuário** (PRD §15; README §2.3).
- **Modo claro/escuro das telas internas — fiel ao protótipo (README §2.6):**
  - Estado `uiTheme: 'dark' | 'light'`, **default `dark`**; **toggle sol/lua na topbar** de cada tela interna, **global** (vale JARVIS e NOA ao mesmo tempo).
  - **Aplica-se só às telas internas** `jarvis`/`noa`. **Login, Choice, overlay de transição e Toasts permanecem sempre escuros** (identidade de marca) — nunca invertem.
  - **Escuro = referência**: o valor escuro de cada token é a cor original do protótipo; o escuro não muda em nada.
  - **Modelo de token de tema**: cada cor de fundo/texto/borda das telas internas é um token de tema (`jt*` JARVIS, `nt*` NOA) resolvido por `themeTokens = uiLight ? tmLight : tmDark`. Bordas: RGB base vira token (`jBord` `200,204,212`↔`30,35,46`; `nBord` `200,212,206`↔`34,44,38`) preservando o alfa de cada uso.
  - **Derivação do claro**: inversão de luminância em HSL com saturação reduzida (~0,55) e reforço de contraste (fundos escuros→claros; texto claro→escuro; labels médios→cinza escuro nítido). Tabela de referência de pares no README §2.6.
  - **O acento do usuário e as semânticas NÃO invertem** — leem igual nos dois modos.
  - **Exceções mantidas escuras no claro**: elementos com `mix-blend-mode:screen` (tiles dos avatares do mascote no rail — `jt32`/`jt33`/`nt9` = `#040507`/`#05070a`) ficam **sempre escuros**, senão o mascote some.
- **Acento por paleta FIXA (README §2.4 + §1):** **não** é color picker livre — é uma **paleta fechada de 8 swatches**, **oferecida por módulo** (um bloco NOA + um bloco JARVIS), escolhida na **2ª tela (CHOICE)** no painel **TEMA** (engrenagem, canto sup. dir.), estado `accNSel`/`accJSel` (sobrepõe o default). As 8 cores: `#D3AF37 #FF2C2C #2CFF05 #2323FF #C4C4C4 #FFFFE3 #8A00C4 #FF5C00`. Default por módulo: JARVIS `#FF5C00`, NOA `#C4C4C4`. Helper de alfa `hexA`. Aplicado a seleção, foco de marca, controles ativos e ações primárias; **nunca** substitui status/risco. Por ser conjunto **fechado e conhecido**, o "ajuste de tom só para leitura" (abaixo) pode ser **pré-calculado** para cada uma das 8 cores × modo (dark/light) — sem picker, sem validação de cor arbitrária.
  - **Contraste do acento — "ajuste de tom só para leitura" (decisão do PI 2026-07-21):** a cor escolhida é **preservada** como identidade nas superfícies de marca (borda, glow, preenchimento, dot). **Só quando o acento renderiza texto/conteúdo legível** e o contraste falha (sobretudo no claro) o DS **ajusta apenas o tom** (luminância) do acento **naquele contexto de leitura**, até atingir contraste legível. **Nunca rejeita** a cor e **nunca** toca semânticas/status. É um ajuste suave e escopado à leitura — não o gate de "rejeitar com explicação" do PRD §9.3.
- **Tipografia (PRD §10.1 + README §3) — fiel ao protótipo:** tokens de família — display **Michroma**, corpo **Rajdhani** (500/600/700, mantido inclusive em texto denso — decisão do PI), mono **Share Tech Mono**; algarismos **tabulares** para custo/tokens/duração; label pequena = mono UPPERCASE, `letter-spacing` 1.5–3px, cor dim.
- **Movimento:** durações/curvas como token (README §6); respeita `prefers-reduced-motion` (adição de a11y sobre o protótipo).
- **Contrato de aplicação:** um provider de tema que recebe `{ uiTheme, accentJarvis, accentNoa }` por props e expõe os tokens via CSS variables. O DS **não** persiste preferência (Settings/dados).

### Fora

- **Densidades** `comfortable`/`compact` — **cortadas do MVP** (decisão do PI 2026-07-21): o protótipo não tem; reavaliar quando houver telas densas reais. Sem `DensitySwitcher` agora.
- Componentes visuais (Button, Input, Toast…) — Fatia 03.
- Persistência de `uiTheme`/acento — SPEC-Fundacao-05/04 (o protótipo hoje mantém em `state`, sem localStorage; persistir é fatia futura, README §9 roadmap).
- Identidades NOA/JARVIS (deltas, mascote, tom) — Fatia 05.

## Critérios de aceite

1. `uiTheme` alterna `dark`⇄`light` pelo toggle da topbar **sem reload**, **global** (afeta as duas telas internas); default `dark` (teste).
2. **Login, Choice e Toasts permanecem escuros** com `uiTheme='light'` (teste: só as telas internas invertem).
3. No claro, fundos/textos/bordas usam os tokens de tema (`jt*`/`nt*`, `jBord`/`nBord`) com os valores do README §2.6; **semânticas não mudam**; o **acento preserva o tom** na marca (borda/glow/fill/dot) e, quando usado como **texto** com contraste ruim, tem **só o tom ajustado para leitura** (teste: mesmo acento extremo mantém hue na borda e é clareado/escurecido só no texto).
4. Elementos `mix-blend-mode:screen` (tiles do mascote) permanecem escuros no claro (teste/inspeção).
5. Tokens de tipografia expõem Michroma/Rajdhani/Share Tech Mono e ativam `tabular-nums` nos números.
6. `prefers-reduced-motion` zera/reduz as animações regidas por token (teste).
7. Escuro tem **paridade** com o protótipo (valores idênticos aos originais) e o claro não deixa nenhum controle ilegível (revisão de contraste).
8. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Modo default:** **escuro** (`uiTheme='dark'`), fiel ao protótipo e ao `01-login.png`. O `system` do PRD §9.4 **não** entra no MVP (o protótipo tem toggle manual, sem sync com o SO) — pode virar fatia futura. — resolvido.
2. **Claro de verdade?** **Sim** — o claro/escuro das telas internas já existe no protótipo (README §2.6) e é **canônico**. Fica no escopo, faithful ao modelo `uiTheme`. — resolvido.
3. **Contraste do acento:** **ajuste de tom só para leitura** — o acento mantém o tom nas superfícies de marca; quando usado como texto/conteúdo legível e o contraste falha, ajusta-se **apenas a luminância** para atingir leitura, **sem rejeitar** a cor nem tocar semânticas. Não é o gate de rejeição do PRD §9.3. — resolvido.
4. **Densidades (`comfortable`/`compact`):** **cortadas do MVP** — o protótipo não tem; reavaliar quando houver telas densas reais. Sem `DensitySwitcher`. — resolvido.
5. **Fontes:** **manter Rajdhani** no corpo (fidelidade ao protótipo), inclusive em texto/log denso. O ajuste de legibilidade do PRD §10.1 não entra agora. — resolvido.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`.
