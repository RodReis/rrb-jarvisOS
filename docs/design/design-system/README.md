# Plataforma RRB — Design System (Índice)

> Base visual compartilhada por **dois módulos** que vivem no mesmo app (arquivo único `JARVIS Platform.dc.html`):
> - **JARVIS OS** — ambiente profissional / operações de negócio → [`JARVISOS.md`](./JARVISOS.md)
> - **NOA** — ambiente pessoal (agenda, rotina, saúde, finanças) → [`NOA.md`](./NOA.md)
>
> Este arquivo cobre **o que é comum aos dois**: fluxo de entrada, tokens base, tipografia, o
> sistema de **Toast**, animações, áudio e convenções de implementação para o Claude Code.

---

## 1. Arquitetura & fluxo do sistema

```
                       ┌───────────────┐
                       │    LOGIN      │  usuário + senha (ou Google / GitHub)
                       │  screen=login │  © RRB Trading · Goiânia · Brasil
                       └──────┬────────┘
                              │ doLogin() → success toast → _go('choice')
                              ▼
                       ┌───────────────┐
                       │    CHOICE     │  2 cards lado a lado + seletor de tema (canto sup. dir.)
                       │ screen=choice │
                       └──┬─────────┬──┘
                goNoa()   │         │   goJarvis()  (fala automática opcional)
                          ▼         ▼
                 ┌────────────┐   ┌──────────────────────────────┐
                 │    NOA     │   │           JARVIS             │
                 │ screen=noa │   │        screen=jarvis         │
                 └────────────┘   │  mod = 'jarvis' | 'agents'   │
                                  └──────────────────────────────┘
```

- **Transição entre telas** (`_go`): overlay radial escuro + scanline (`@keyframes scanline`),
  ~240 ms out / 300 ms in. Nunca troca `screen` sem passar por `_go` (garante o efeito).
- Ambos os ambientes se **linkam mutuamente**: o rail estreito tem um atalho para o outro
  ambiente (ícone NOA dentro do JARVIS e vice-versa) + botão **Sair** (volta ao login).
- Dentro do JARVIS há um **segundo nível de módulo**: `mod: 'jarvis'` (Professional Ops) e
  `mod: 'agents'` (**Agents OS**). O 2º ícone do rail alterna para Agents OS. Detalhes em `JARVISOS.md`.

### Estado global (raiz da lógica `class Component extends DCLogic`)
| chave | tipo | papel |
|---|---|---|
| `screen` | `'login'\|'choice'\|'jarvis'\|'noa'` | tela macro |
| `mod` | `'jarvis'\|'agents'` | módulo dentro do JARVIS |
| `jv` / `nv` | string | view ativa em JARVIS / NOA |
| `aos` | string | view ativa no Agents OS (`mission`, `teams`, `operator`, `h_claude`…) |
| `accJSel` / `accNSel` | hex\|null | acento escolhido em runtime (sobrepõe props) |
| `uiTheme` | `'dark'\|'light'` | fundo das **telas internas** JARVIS/NOA (default `'dark'`); ver §2.6 |
| `toasts` | array | fila de notificações (ver §5) |
| `speaking` / `listening` | bool | estado de voz do JARVIS |
| `cockLog` / `cockInput` | obj | terminais interativos do Cockpit (Agents OS) |

---

## 2. Tokens base (compartilhados)

### 2.1 Superfícies / fundo
| token | valor | uso |
|---|---|---|
| `--bg-root` | `#060708` | fundo absoluto (login/choice) |
| `--bg-app` | `#0a0b0e` | fundo do app JARVIS |
| `--bg-app-noa` | `#0b0d0d` | fundo do app NOA (leve viés verde) |
| `--panel` | `linear-gradient(180deg,#0c0e12,#090a0d)` | sidebar |
| `--card` | `linear-gradient(180deg, rgba(24,27,33,.7), rgba(13,15,18,.7))` | cards |
| `--card-hi` | `linear-gradient(180deg, rgba(22,25,30,.6), rgba(12,14,17,.6))` | stat cards |
| `--hair` | `rgba(200,204,212,.08–.12)` | divisórias / bordas neutras |

### 2.2 Texto
| token | valor |
|---|---|
| `--tx-hi` | `#eef1f5` (títulos) |
| `--tx` | `#dfe3ea` (corpo forte) |
| `--tx-mut` | `#9aa3b2` (secundário) |
| `--tx-dim` | `#6b7382` / `#5d6575` (labels mono, captions) |

### 2.3 Semânticas (iguais nos dois módulos)
| token | valor | significado |
|---|---|---|
| `--ok` | `#34d399` | sucesso / online / disponível |
| `--warn` | `#f59e0b` | atenção / aguardando aprovação |
| `--err` | `#ff6b81` | erro / bloqueado / falhou |
| `--info` | `#7dd3fc` | informação / cloud |
| `--accent-violet` | `#a78bfa` | memória / skills / knowledge |

### 2.4 Acentos de tema (o usuário escolhe)
Paleta oferecida em ambos (swatches no seletor de tema):
```
#D3AF37  #FF2C2C  #2CFF05  #2323FF  #C4C4C4  #FFFFE3  #8A00C4  #FF5C00
```
- **JARVIS** → prop `acentoJarvis` (default de fábrica `#C4C4C4 `; fallback de runtime `#D3AF37`).
- **NOA** → prop `acentoNoa` (default `#C4C4C4`; fallback de runtime `#2CFF05`).
- Helper de alfa: `hexA(hex, aa)` concatena um byte hex (`'59'`=35%, `'80'`=50%, `'b3'`=70%, `'cc'`=80%, `'1a'`/`'20'`/`'33'` para brilhos suaves).
  Derivados usados no código: `accJA20/35/50/70/80`, `accNA35/50/70`, `accLA35/50/70/80` (acento neutro `accL=#C4C4C4`).

### 2.5 Raio, espaçamento, sombra
- **Raios**: rail/ícones `9px`; cards `10–12px`; chips/pills `5–8px` e `99px`; modais `13–16px`.
- **Gaps**: layout `12–18px`; listas `9–10px`; formulários `10–12px`.
- **Sombra de card**: `0 20px 46px -18px rgba(0,0,0,.9)` + glow do acento `0 0 30px -14px <accent>`.

### 2.6 Modo claro / escuro (telas internas)
> Aplica-se **só às telas internas** `screen='jarvis'` e `screen='noa'`. Login, Choice, overlay de transição e **Toasts** permanecem sempre escuros (identidade de marca).

- **Toggle**: botão sol/lua na **topbar** de cada tela interna (ao lado do relógio), `onClick={{toggleUiTheme}}`. Alterna `state.uiTheme` entre `'dark'` e `'light'` — é **global** (vale para os dois módulos ao mesmo tempo). Ícone lua no escuro, sol no claro (`uiDark`/`uiLight`).
- **Padrão escuro = referência**: o valor escuro de cada token é exatamente a cor original — o modo escuro não muda em nada.
- **Como funciona (implementação)**: cada cor de fundo/texto/borda das duas telas foi extraída para um **token de tema** (`jt*` para JARVIS, `nt*` para NOA), exposto em `renderVals()` via `const themeTokens = uiLight ? _tmLight : _tmDark`. No template essas cores são holes (`{{ jt37 }}`, `{{ nt13 }}`…). As cores **semânticas** (`--ok/--warn/--err/--info/--accent-violet`) e o **acento do usuário** NÃO invertem — leem igual nos dois modos.
- **Derivação do claro**: inversão de luminância em HSL com saturação reduzida (~0.55) e reforço de contraste — fundos muito escuros → claros; texto claro → escuro; texto médio (labels) → cinza escuro nítido.
- **Bordas**: o RGB base vira token (`jBord`/`nBord`) preservando o alfa de cada uso — escuro `200,204,212` (JARVIS) / `200,212,206` (NOA); claro `30,35,46` / `34,44,38`.
- **Exceções mantidas escuras no claro** (têm `mix-blend-mode:screen`): os **tiles dos avatares do mascote** no rail (`jt32`/`jt33`/`nt9` = `#040507`/`#05070a`) — se clarearem, o mascote some.

| papel | escuro (ref.) | claro |
|---|---|---|
| fundo app JARVIS | `#0a0b0e` | `#f5f6f8` aprox. |
| fundo app NOA | `#0b0d0d` | `#f2f4f2` aprox. |
| card | `rgba(24,27,33,.7)` | `rgba(245,246,247,.7)` |
| texto título | `#eef1f5` | `#111316` |
| texto secundário | `#9aa3b2` | `#27292d` |
| label mono / dim | `#6b7382` | `#44464b` |
| borda (RGB) | `200,204,212` | `30,35,46` |

---

## 3. Tipografia

| Papel | Fonte | Uso |
|---|---|---|
| **Display / títulos** | **Michroma** | logotipos "JARVIS/NOA", títulos de tela (`font-size` 20–24px, letter-spacing 2–6px) |
| **Corpo / UI** | **Rajdhani** (500/600/700) | textos, botões, cards, números grandes (700, `font-variant-numeric: tabular-nums`) |
| **Mono / técnico** | **Share Tech Mono** | labels de seção, timestamps, terminais, badges, código, kbd |

Import (no `<helmet>`):
```html
<link href="https://fonts.googleapis.com/css2?family=Michroma&family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
```
Convenção: **toda label pequena e caption** é Share Tech Mono em UPPERCASE com `letter-spacing` 1.5–3px e cor `--tx-dim`.

---

## 4. Assets / imagens

| arquivo | uso |
|---|---|
| `assets/carbono.jpg` | fundo de login e choice (brilho .62, contraste 1.08, animação `kb` de zoom lento) |
| `assets/jarvis-cabeca.jpg` | mascote JARVIS (login, card choice, rail, mascote animado do Command Center) — `mix-blend-mode: screen` sobre fundo escuro |
| `assets/noa-cabeca.png` | mascote NOA (equivalente) |
| `assets/jarvis-camaleao.jpg` | variação camaleão (referência) |

Padrão do mascote: círculo com anel tracejado girando (`spin`), glow pulsante (`corepulse`), imagem em `object-fit: cover` com `mask-image` radial e `mix-blend-mode: screen`. No Command Center ganha olhos e boca reativos à fala (ver `JARVISOS.md §voz`).

---

## 5. Sistema de Toast (padrão único para TODAS as mensagens do sistema)

> **Regra**: qualquer INFO / WARN / ERROR / SUCCESS do sistema é entregue por Toast. Não usar
> `alert`, banners inline ad-hoc, nem `console` para feedback ao usuário.

### 5.1 API (na lógica)
```js
this.info(title, msg?, dur?)     // ciano  #7dd3fc  glyph "i"  kind INFO
this.warn(title, msg?, dur?)     // âmbar  #f59e0b  glyph "!"  kind WARN
this.error(title, msg?, dur?)    // rosa   #ff6b81  glyph "×"  kind ERROR
this.success(title, msg?, dur?)  // verde  #34d399  glyph "✓"  kind SUCCESS
this.toast(type, title, msg, dur)// base
this.dismissToast(id)
```
- Fila em `state.toasts` (máx **5**, mais novo no topo). Auto-dismiss default **4200 ms**
  (timers em `this._toastTimers`, id incremental `this._tid`). Cada toast guarda `stamp` (HH:MM:SS).

### 5.2 Layout (futurista)
Container: `position:fixed; top:64px; right:22px; z-index:200; width:360px; gap:12px; pointer-events:none` (cada card reativa `pointer-events:auto`).

Cada toast:
- Card glass: `linear-gradient(135deg, rgba(14,16,20,.92), rgba(8,9,12,.94))` + `backdrop-filter:blur(14px)`, raio `13px`.
- **Borda** `1px` em `hexA(cor,'4d')`; **sombra** `0 20px 46px -18px #000, 0 0 30px -14px <cor>, inset 0 1px 0 rgba(255,255,255,.05)`.
- **Barra lateral** esquerda 3px na cor + glow.
- **Sheen** diagonal varrendo (`@keyframes toastScan`, 2.4s).
- **Ícone** 34px, quadrado arredondado, fundo `hexA(cor,'1a')`, pulsando (`@keyframes toastIco`).
- Cabeçalho: `KIND` (mono, cor) à esquerda + `stamp` à direita; título Rajdhani 700 15px; msg opcional 13px `--tx-mut`.
- **Barra de progresso** inferior 2px que encolhe (`@keyframes toastBar`, duração = `dur`) até fechar.
- Entrada: `@keyframes toastIn` (slide-x + scale, 0.42s).
- `×` para fechar manual.

### 5.3 Onde já dispara (referência de cobertura)
- **Login**: success ("Autenticado") / warn (campos vazios).
- **Command Center**: STATUS→info, DEPLOY→warn, ESCANEAR REDE→success, EXECUTAR AGENTES→info.
- **Agents OS · Cockpit** (terminais): `/run`→success, `/status`→info, `/clear`→info, outros→info.
- **Agents OS · Ativos**: clicar num run → FALHOU=error, EXECUTANDO=info, CONCLUÍDO=success.
- **Agents OS · Times**: ABRIR CHAT (1:1) / INICIAR DEBATE (2+) → success/info/warn por seleção.
- **Agents OS · Operator Central**: RECONECTAR→info depois error; LOCKDOWN→warn; cards de tier→info; regras de Política→success/info/warn.

---

## 6. Animações (keyframes globais no `<helmet>`)

| keyframe | efeito | onde |
|---|---|---|
| `kb` | zoom/pan lento | fundo carbono |
| `spin` / `spinr` | rotação (h/anti-horário) | anéis do mascote |
| `corepulse` | opacidade pulsante | glow do núcleo |
| `sheen` | brilho diagonal | vidro do login |
| `bob` | flutuação vertical | mascotes |
| `wave` / `talk` | barras/boca de áudio | HUD de voz do JARVIS |
| `fadeIn` / `screenIn` / `riseIn` / `mascotIn` | entradas de tela/elemento | transições |
| `scanline` | linha varrendo | overlay de transição `_go` |
| `blink` | cursor piscando | terminais |
| `dotpulse` | ponto de status pulsando | badges online |
| `huegl` | hue-rotate leve | mascote falando |
| `eyeblink` / `eyeglow` | olhos do mascote | idle vs. falando |
| `ringglow` | brilho do anel | mascote Command Center |
| `toastIn` / `toastScan` / `toastBar` / `toastIco` | ver §5 | toasts |

Princípios de movimento: durações 0.18–0.6s para UI; loops ambientais 2–30s; easing padrão `cubic-bezier(.2,.7,.2,1)`; hover sempre com `transition:all .18–.28s ease` (elevação `translateY(-3..-6px)` + glow do acento).

---

## 7. Áudio & voz (exclusivo JARVIS — ver detalhes em `JARVISOS.md`)
- **TTS** via `window.speechSynthesis` (voz pt-BR preferida, `rate 1.0`, `pitch 0.9`).
- **STT** via `SpeechRecognition`/`webkitSpeechRecognition` (pt-BR, interim results).
- Sincronizado com o mascote (olhos/boca/ondas) e com toasts nos comandos rápidos.
- NOA não usa voz por padrão.

---

## 8. Convenções para o Claude Code implementar
1. **DC único** streaming-first: template (markup entre `<x-dc>`), classe `Component extends DCLogic`, e `data-props`. Sem stylesheets/classes — **estilos inline** (paint imediato).
2. **Holes `{{ }}` só para valores vivos**; tema/tokens ficam como literais inline em cada elemento (repetir é esperado).
3. Toda repetição via `<sc-for>` e condicional via `<sc-if>` **com `hint-*`**.
4. Handlers/dados calculados em `renderVals()` e expostos por nome.
5. **Props tweakáveis** hoje: `acentoJarvis` (color), `acentoNoa` (color), `falaAutomatica` (boolean). **Tema claro/escuro** das telas internas é runtime (`state.uiTheme`, toggle na topbar), não é prop — ver §2.6.
6. Toda mensagem de sistema → **Toast** (§5). Nunca criar outro padrão.
7. Navegação entre telas **sempre** via `_go()`.

---

## 9. Roadmap (compartilhado)
- [x] Login + escolha de ambiente + temas por acento
- [x] JARVIS Professional Ops (Command Center, HUD, Kanban, Workflows, Analytics, negócios, sistema)
- [x] **Agents OS** (Mission Control com Cockpit/Builds/Ativos/Custos, páginas de harness, Teams, Operator Central, Memory, Notebook)
- [x] Terminais do Cockpit interativos
- [x] Sistema de Toast unificado (INFO/WARN/ERROR/SUCCESS)
- [x] Modo claro/escuro nas telas internas (toggle na topbar, `state.uiTheme`) — ver §2.6
- [ ] NOA — aprofundar Saúde/Finanças/Memória com dados reais
- [ ] Persistência (localStorage) de tema, sessão e logs de terminal
- [ ] Voz online (runtime real) substituindo o mock de fala
- [ ] Integração real dos harnesses/CLIs e providers (BYOK)
- [ ] Auditoria/Approvals com eventos reais no Operator Central
- [ ] Exportar screenshots de todas as telas para `design-system/screens/`
