# JARVIS OS — Design System (Ambiente Profissional + Agents OS)

> Módulo **tático / operações de negócio**. Compartilha a base em [`README.md`](./README.md).
> Entra por: LOGIN → CHOICE → card **JARVIS** (`goJarvis()` → `screen='jarvis'`, `jv='command'`).
> Dentro do JARVIS há **dois sub-módulos** controlados por `state.mod`:
> - `mod='jarvis'` → **Professional Ops** (Command Center, HUD, Kanban, Workflows, Analytics, Negócios, Sistema)
> - `mod='agents'` → **Agents OS** (Mission Control, Harnesses, Teams, Governance, Knowledge)

---

## 1. Identidade visual do JARVIS

- **Tom**: tático, leal, direto, "máquina de guerra". Copy objetiva, mono para dados.
- **Fundo do app**: `#0a0b0e` + brilho radial do acento no topo: `radial-gradient(1200px 500px at 70% 0%, color-mix(in srgb, accJ 6%, transparent), transparent 65%)`.
- **Hairlines**: `rgba(200,204,212,.08–.12)`.
- **Acento** (`accJ`): prop `acentoJarvis`, default de fábrica `#FF5C00`; fallback runtime `#D3AF37`. Derivados `accJA20/35/50/70/80` via `hexA`.
- **Mascote**: `assets/jarvis-cabeca.jpg` (`mix-blend-mode:screen`), com olhos e boca reativos à voz.
- **Prop extra**: `falaAutomatica` (boolean, default `true`) — JARVIS fala ao entrar.

### Tokens JARVIS (delta sobre o README)
| token | valor | uso |
|---|---|---|
| `--jv-bg` | `#0a0b0e` | fundo app |
| `--jv-glow` | `radial 70% 0% accJ 6%` | atmosfera do conteúdo |
| `--jv-accent` | `accJ` | acento do usuário |
| `--jv-panel` | `linear-gradient(180deg,#0c0e12,#090a0d)` | sidebar |
| harness colors | ver §5.2 | cor fixa por harness (AG/CC/OC/KD/NC/HE) |

> **Modo claro/escuro** (ver README §2.6): a tela interna do JARVIS suporta `uiTheme='light'` via toggle sol/lua na topbar. Todos os fundos/textos/bordas usam tokens `jt*` que invertem para o claro; acento (`accJ`) e semânticas permanecem. Bordas: `jBord` = `200,204,212` (escuro) / `30,35,46` (claro). Os tiles dos avatares do mascote no rail (`jt32`/`jt33`) ficam **sempre escuros** por causa do `mix-blend-mode:screen`.

---

## 2. Layout & navegação

Grid: `60px 232px 1fr` / `52px 1fr 34px` (rail | sidebar | conteúdo; topbar/rodapé).

### Rail (60px)
Mascote JARVIS → **Command Center** (ícone alvo, `railCommand`) → **Agents OS** (ícone grade, `railMission`, title="Agents OS") → (flex) → atalho **NOA** (`goNoa`) → **Sair** (`logout`).
Estado ativo do rail: `railCmdBorder/Color` (JARVIS ops) e `railMisBorder/Color` (Agents OS) via `railOn(bool)`.

### Sidebar (232px) — muda com `mod`
- **Header dinâmico**: `mod='jarvis'` → "JARVIS / PROFESSIONAL OPS"; `mod='agents'` → "AGENTS OS / HARNESSES · TEAMS · SKILLS".
- **Nav**: `mod='jarvis'` usa `navJDef`; `mod='agents'` usa `navADef` (via `mkNav`).
- Rodapé da sidebar: pill "● MODO AUTÔNOMO".

### Grupos — Professional Ops (`navJDef`, chave `jv`)
| grupo | itens |
|---|---|
| COMANDO | `command` Command Center · `hud` HUD |
| AGENTS OS | `mission` Mission Control · `specialties` Specialties · `skills` Skills Catalog (levam para `mod='agents'`) |
| OPERAÇÕES | `kanban` · `workflows` · `automations` · `osdesktop` OS Desktop |
| INTEL | `analytics` · `insights` |
| NEGÓCIOS | `projects` Projects Hub · `goals` Metas · `studio` · `seo` SEO Content · `video` Video Director |
| SISTEMA | `services` · `connectors` · `providers` · `settings` |

### Grupos — Agents OS (`navADef`, chave `aos`)
| grupo | itens |
|---|---|
| CORE | `mission` Mission Control · `specialties` · `skills` |
| HARNESSES | `h_antigravity` · `h_claude` · `h_opencode` · `h_kiro` · `h_neocode` · `h_hermes` |
| TEAMS | `teams` Specialist Teams |
| GOVERNANCE | `operator` Operator Central |
| KNOWLEDGE | `memory` Agent Memory · `notebook` Notebook |

Alternância de módulo: `railCommand()` → `{mod:'jarvis', jv:'command'}`; `railMission()` → `{mod:'agents', aos:'mission'}`. Views resolvem com `inA = mod==='agents'` (ex.: `viewMission = inA && aos==='mission'`).

---

## 3. Command Center (`viewCommand`) — a joia da voz

Layout 2 colunas: comandos rápidos (esq.) + **mascote animado + HUD de voz** (dir.).

### 3.1 Comandos rápidos (`quickCmds`)
Botões com glyph + label, entrada escalonada (`riseIn` com `delay`). Cada um **fala + dispara Toast**:
| botão | fala | toast |
|---|---|---|
| ▚ STATUS DO SISTEMA | status | INFO |
| ➜ DEPLOY | deploy | WARN (requer aprovação) |
| ◍ ESCANEAR REDE | scan | SUCCESS |
| ⚡ EXECUTAR AGENTES | agents | INFO |

### 3.2 Mascote reativo
- Anéis girando (`spin`/`spinr`), glow (`ringglow`), imagem com `mask-image` radial + `mix-blend-mode:screen`.
- **Olhos**: idle `eyeblink` / falando `eyeglow`. **Boca**: `talk` (play-state segue `speaking`). **Hue**: `huegl` (2.4s falando, 9s idle).
- **Ondas de áudio** (`waveBars`, 22 barras `wave`), opacidade/play-state por `speaking`.
- **Legenda** com texto sendo "digitado" + cursor `blink`.

### 3.3 Voz (áudio)
- **TTS** `window.speechSynthesis`: `speak(text)` — cancela fala anterior, escolhe voz pt-BR (`_pickVoice`), `rate 1.0`, `pitch 0.9`; anima o texto char-a-char (`_si` interval 26ms); estados `onend/onerror` limpam `speaking`.
- **STT** `SpeechRecognition`/`webkit`: `startListening()` — `lang pt-BR`, `interimResults`, mostra transcrição em `speechText`, e responde via `_reply(said)` (regex → status/deploy/scan/agents/hello/fallback).
- **Botão de mic**: cor/glow por estado (`micBorder/micGlow/micIconColor/micLabel`): idle=acento, falando=acento forte, ouvindo=`#ff5c5c` com pulso.
- **Fala automática** ao entrar (`goJarvis` + `props.falaAutomatica`), uma vez (`_spoke`).
- **Limpeza**: `componentWillUnmount` cancela synth/rec e limpa intervals.

---

## 4. Outras telas Professional Ops

| view | conteúdo-chave |
|---|---|
| **HUD** (`viewHud`) | Telemetria (`hudStats` CPU/RAM/GPU/DISK com barras) + Sistema (`hudLines` uptime/agentes/triggers/memória/modo) |
| **Kanban** (`viewKanban`) | 4 colunas (BACKLOG/EM EXECUÇÃO/REVISÃO/CONCLUÍDO), cards `{title, agent, pri}`, contagem por coluna |
| **Workflows** (`viewWorkflows`) | linhas com nome, etapas, barra de progresso, status pill, "last" |
| **Analytics** (`viewAnalytics`) | gráfico de barras 7 dias (`chart`) + custo mensal BYOK + taxa de sucesso |
| **Specialties** (`viewSpecialties`) | grade 3col de especialidades `{i,n,d,sk}` (Research/Code/Conteúdo/Voz/Operações/Finanças) |
| **Skills Catalog** (`viewSkills`) | lista `skillsCat` `{n,cat,runs}`, header "56 SKILLS · 6 ESPECIALIDADES" |
| **Automations** (`viewAutomations`) | abas (SKILLS/CRONS/…) + squads `{n,d,st,c}` + crons `{n,sch,next}` |
| **OS Desktop** (`viewOsdesktop`) | File Explorer mock (macOS traffic lights) + terminal (`termLines` + cursor blink) + System Monitor |
| **Insights** (`viewInsights`) | cards `{tag,t,d}` (custo/harness/padrão) |
| **Projects Hub** (`viewProjects`) | cards `{n,d,st,pct,c}` com barra |
| **Metas** (`viewGoals`) | `goals` `{n,pct,sub}` com barra no acento |
| **Studio** (`viewStudio`) | fila de produção `{n,st}` |
| **SEO Content** (`viewSeo`) | stats + abas (RESEARCH/OPENSEO/…) + GSC + form Keyword Research |
| **Video Director** (`viewVideo`) | fila `{n,eta,st,c}` |
| **Services** (`viewServices`) | 8 serviços backend `{n,crit,d,st}`, dot online, badge CRITICAL |
| **Connectors** (`viewConnectors`) | grade `{i,bg,n,d,st,stc}` (Google/OpenAI/Groq/Ollama/Tavily/…) |
| **Providers** (`viewProviders`) | LLM providers `{n,model,lat,lc}` + lógica de roteamento (`routing`) |
| **Settings** (`viewSettings`) | perfil + Geral (idioma, toggles `settingsToggles`) + AI Engine + IDENTITY/SOUL.md |
| **Empty** (`viewEmptyJ`) | anel `spin` + "MÓDULO EM CONSTRUÇÃO · PROTÓTIPO" |

---

## 5. AGENTS OS (módulo `mod='agents'`)

### 5.1 Mission Control (`viewMission`, `aos='mission'`)
Header "I. SELF — MISSION CONTROL" + descrição multi-terminal. Stats (`stats`): Harnesses 6/6, Execuções 74, Sucesso 85%, Skills 56.
**4 abas** (`missionTabs`, estado `aosTab`, via `mkTabs`):

1. **Cockpit** (`aosTabCockpit`) — tab "Main (6)" + "+" → grade de **terminais interativos** (`cockpits`):
   - Cada card: header traffic-lights + chip do harness + projeto (pill) + `×`; corpo com `Session: <sess>…` e **log** (`ck.log`); input real + botão ▸.
   - **Interação**: `ck.setInput`/`ck.onKey`(Enter)/`ck.send`. `cockSend(id,name,accent)` → append `$ <cmd>` + resposta de `_cockReply` (comandos `/help /clear /status /skills /run <prompt>`), corta em 40 linhas, e dispara **Toast** (`/run`→success, `/status`→info, `/clear`→info, outros→info). Estado em `cockLog{}` / `cockInput{}`.
2. **Builds** (`aosTabBuilds`) — grade de cards de harness (`harnesses`): chip AG/CC/NC/HE/KD/OC, "Disponível", badge "harness", descrição, tag de execução, rodapé `runs · succ · age`.
3. **Ativos** (`aosTabActive`) — lista `activeRuns` `{n,c,dot,st,dur}`; **clicável** (`r.open`) → Toast por estado (FALHOU=error, EXECUTANDO=info, CONCLUÍDO=success).
4. **Custos** (`aosTabCosts`) — stats (Total 74 / Concluídas 63 / Falhas 11) + "CONSUMO POR AGENTE" (`costBars`, barras com gradiente por agente) + nota de provedores não configurados.

### 5.2 Páginas de Harness (`viewHarness`, `aos` começa com `h_`)
Fonte: `harnessMeta` (6 harnesses). Cada um: `{i, c, n, slug, d, tag, cwd, sess, runs, succ, last}`.
Cores fixas: **AG** `#34d399` · **CC** `#f59e0b` · **OC** `#e2e8f0` · **KD** `#a78bfa` · **NC** `#22d3ee` · **HE** `#f472b6`.
Header "II. AGENTS OS — HARNESS" + chip + nome + Disponível + cwd. **6 abas** (`hTabs`, estado `hTab`):
- **Chat**: terminal mock (`hChat`) com input + ▸.
- **Projeto**: pares `{k,v}` (`hProj`) — diretório, branch, arquivos, última modificação, execução.
- **Overview**: 4 stat cards (`hOverview`) runs/sucesso/última/sessões + badge da tag.
- **Sessões**: lista `hSessions` `{id,when,dur,st}`.
- **MCPs**: lista `hMcps` `{n,d,st}` (obsidian/windows/playwright/supabase).
- **Skills**: grade `wsSkills` com badge **READ** `#9aa3b2` / **WRITE** `#fb923c` / **EXECUTE** `#fbbf24`.

### 5.3 Specialist Teams (`viewTeams`, `aos='teams'`)
Header "IV. AGENTS OS — SPECIALIST TEAMS". Abas de organização (`orgTabs`, estado `teamOrg`): **PiperClip** (6) · **Conselho MMOS** (19) · **AIOX Squads** (13) — dados em `orgsDef` `{title,desc,specs}`.
Coluna esquerda: seletor de PROJETO (21) com SCAN, seletor TIME/SUBSETOR, descrição do time, e lista de especialistas (`specs`) — **multi-seleção** (`sp.toggle`, estado `selSpecs`).
Coluna direita: `selNone` → estado "Governança & C-Suite" (ícone templo) com instrução; `selSome` → chips selecionados + hint + botões **ABRIR CHAT (1:1)** (`openChat`) e **INICIAR DEBATE (2+)** (`startDebate`).
**Toasts**: chat exige 1 seleção (senão WARN → success); debate exige 2+ (senão WARN → info). `chatOp/debateOp` controlam opacidade dos botões.

### 5.4 Operator Central (`viewOperator`, `aos='operator'`)
Header "VII. GOVERNANCE — OPERATOR CENTRAL". Stats (`opStats`): OmniRoute OFFLINE, Pendentes 0, Resolvidas 0, Eventos 0. Abas (`opTabs`, estado `opTab`):
- **Router**: banner "OmniRoute Gateway — UNREACHABLE" com botões **RECONECTAR** (`opRetry` → info depois **error** após 1.4s) e **LOCKDOWN** (`opLockdown` → warn). Grade **TIER → MODEL** (`tiers` SIMPLE/MODERATE/COMPLEX/CRITICAL, clicáveis → info com o modelo). **TASK TIER FLOORS** (`floors`). **LAST ROUTING DECISION** (info box).
- **Approvals**: estado vazio "Nenhuma aprovação pendente".
- **Audit**: "0 eventos de auditoria nesta sessão".
- **Policy**: regras (`policyRules`) clicáveis (`pl.toggle`) → Toast por nível: AUTÔNOMO=success, REQUER APROVAÇÃO=info, BLOQUEADO=warn.

### 5.5 Agent Memory (`viewMemory`, `aos='memory'`)
Header "VI. SELF — MEMORY". Stats: Memórias 13, Entradas 24, Categorias 2. Abas (`memTabs`, estado `memTab`):
- **Rede**: canvas de "rede neural" — 64 pontos gerados deterministicamente (`memDots`, seno-hash) sobre fundo radial violeta; nós rotulados `self_improve:mo…` e `daily_log` pulsando (`corepulse`).
- **Recentes**: `memRecent` `{cat,t,d}`.
- **Notas**: `memNotes` `{n,p}` (vault Obsidian).
- **Busca**: input de busca semântica (llm-wiki) + dica.

### 5.6 Notebook (`viewNotebook`, `aos='notebook'`)
Lista `notebookItems` `{t,d}` — caderno operacional do workspace.

---

## 6. Componentes reutilizáveis (JARVIS)
| componente | descrição |
|---|---|
| **StatCard** | label mono + número Rajdhani 700 tabular, `--card-hi` |
| **Tabs (pill)** | `mkTabs(defs,cur,key)` → pills clicáveis, ativo borda `hexA(accJ,'66')`+fundo `hexA(accJ,'1a')` |
| **HarnessCard** | chip colorido + status + badge + tag + rodapé métricas |
| **CockpitTerminal** | header traffic-lights, log rolável, input+▸ (interativo) |
| **RunRow** | dot de status + nome mono + estado + duração (clicável→toast) |
| **SpecCard** | especialista selecionável (multi-seleção) |
| **TierCard** | borda-esquerda colorida + temp + modelo |
| **PolicyRow** | nome + badge de nível (clicável→toast) |
| **MemoryGraph** | pontos determinísticos + nós rotulados |
| **VoiceMascot + WaveHUD + MicButton** | mascote reativo à fala (Command Center) |
| **EmptyState** | anel girando + legenda |
| **Toast** | ver README §5 (global) |

---

## 7. Movimentos & áudio (resumo)
- Movimento: ver README §6. Específicos do JARVIS: `eyeblink/eyeglow`, `talk`, `wave`, `huegl`, `ringglow` (mascote de voz); `scanline` no overlay `_go`.
- Áudio: TTS + STT (§3.3). NOA não usa. Sempre limpar synth/rec em unmount.

---

## 8. Implementação (delta para o Claude Code)
- Resolver views com `inA = (mod==='agents')`: `viewCommand=!inA && jv==='command'`, `viewMission=inA && aos==='mission'`, harness `viewHarness=inA && aos.startsWith('h_')`, etc.
- `navJ` alterna entre `navJDef`/`navADef` conforme `inA`; label da topbar via `jLabels`/`aLabels`.
- Terminais do Cockpit: manter `cockLog{}`/`cockInput{}` keyed por id do harness; cortar log em 40 linhas.
- Toda ação relevante dispara **Toast** (README §5) — não criar outro padrão.
- Estilos inline; `<sc-for>`/`<sc-if>` sempre com `hint-*`; dados e handlers em `renderVals()`.
- Props tweakáveis do JARVIS: `acentoJarvis` (color), `falaAutomatica` (boolean).

---

## 9. Roadmap JARVIS / Agents OS
- [x] Command Center com voz (TTS/STT mock) + mascote reativo
- [x] Professional Ops completo (HUD, Kanban, Workflows, Analytics, Negócios, Sistema)
- [x] Agents OS: Mission Control (Cockpit/Builds/Ativos/Custos), Harness pages, Teams, Operator Central, Memory, Notebook
- [x] Terminais do Cockpit interativos
- [x] Toast unificado ligado a Command Center, Cockpit, Ativos, Teams, Operator Central
- [ ] Persistência (localStorage): tema, `mod`/view ativa, logs de terminal, seleção de times
- [ ] Voz online real (runtime) substituindo o mock
- [ ] Integração real de harnesses/CLIs, providers (BYOK) e MCPs
- [ ] Operator Central com Approvals/Audit reais (eventos imutáveis)
- [ ] Custos reais via usage API (Anthropic/OpenRouter)
- [ ] Screenshots de todas as telas em `design-system/screens/jarvis/`
