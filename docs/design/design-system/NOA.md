# NOA — Design System (Ambiente Pessoal)

> Módulo **pessoal e privado por padrão**: agenda, rotina, saúde, finanças, conteúdo e memória.
> Compartilha a base em [`README.md`](./README.md). Aqui vai o específico do NOA.
> Entra por: LOGIN → CHOICE → card **NOA** (`goNoa()` → `screen='noa'`, `nv='hoje'`).

---

## 1. Identidade visual do NOA

- **Tom**: calmo, íntimo, sem urgência (oposto do JARVIS tático). Copy em tom sereno.
- **Fundo do app**: `#0b0d0d` (viés levemente verde/neutro).
- **Hairlines/bordas**: `rgba(200,212,206,.08–.12)` (leve verde, distinto do JARVIS que usa `200,204,212`).
- **Acento** (`accN`): prop `acentoNoa`, default de fábrica `#C4C4C4`; fallback runtime `#2CFF05`.
  Mesma paleta de swatches do sistema (ver README §2.4). Derivados: `accNA35/50/70` via `hexA`.
- **Mascote**: `assets/noa-cabeca.png` (círculo, anel `spin`, glow `corepulse`, `bob`, `mix-blend-mode:screen`).
- **Tipografia**: idêntica ao sistema — Michroma (títulos "NOA"), Rajdhani (UI), Share Tech Mono (labels/mono).

### Tokens NOA (delta sobre o README)
| token | valor | uso |
|---|---|---|
| `--noa-bg` | `#0b0d0d` | fundo app |
| `--noa-text` | `#e2e8e5` | corpo (leve verde) |
| `--noa-hair` | `rgba(200,212,206,.08)` | divisórias |
| `--noa-accent` | `accN` | acento do usuário |
| semânticas | herdadas | `--ok/warn/err/info/violet` iguais ao README |

> **Modo claro/escuro** (ver README §2.6): a tela interna do NOA suporta `uiTheme='light'` via toggle sol/lua na topbar (estado `uiTheme` é global, compartilhado com o JARVIS). Fundos/textos/bordas usam tokens `nt*` que invertem para o claro; acento (`accN`) e semânticas permanecem. Bordas: `nBord` = `200,212,206` (escuro) / `34,44,38` (claro). O tile do avatar do mascote no rail (`nt9` = `#040507`) fica **sempre escuro** (`mix-blend-mode:screen`). Rótulos de hábito e demais textos calculados na lógica também ficam escuros no modo claro.

---

## 2. Layout & navegação

Grid do app (igual estrutura do JARVIS, cores NOA):
```
grid-template-columns: 60px 232px 1fr;
grid-template-rows: 52px 1fr 34px;   /* rail | sidebar | conteúdo ; topbar/rodapé */
```

- **Rail (60px)**: mascote NOA no topo → atalhos de view → (base) atalho para **JARVIS** (`goJarvis`) e **Sair** (`logout`).
- **Sidebar (232px)**: logo "NOA / PESSOAL" + grupos de nav (mono uppercase, item ativo com barra/dot no acento).
- **Topbar (52px)**: label da view + hora (`{{ time }}`) + selo de ambiente.
- **Rodapé (34px)**: © RRB Trading + versão.

### Grupos de navegação (`navNDef`)
| grupo | itens (`nv`) |
|---|---|
| **VOCÊ** | `hoje` (Hoje), `agenda` (Agenda), `rotina` (Rotina) |
| **VIDA** | `saude` (Saúde), `financas` (Finanças), `conteudo` (Conteúdo), `memoria` (Memória) |

Views implementadas: `nImplemented = ['hoje','agenda','financas','saude','rotina','conteudo','memoria']`.
Qualquer `nv` fora disso cai no **estado vazio** (`viewEmptyN`): anel girando + label + "MÓDULO EM CONSTRUÇÃO · PROTÓTIPO".

`mkNav(navNDef, s.nv, accN, 'nv')` monta os itens; item ativo: borda `hexA(accN,'59')`, fundo `linear-gradient(90deg, hexA(accN,'1f'), transparent 85%)`, texto `#f2fbfd`, dot no acento.

---

## 3. Telas (uma a uma)

> Todas seguem o padrão: `<div style="padding:24–26px 30px;display:flex;flex-direction:column;gap:16–18px">`
> com título Michroma 20–22px e, quando útil, uma sublinha mono. Cards usam `--card`.

### 3.1 Hoje (`viewHoje`)
Painel de abertura pessoal. Componentes:
- **Saudação dinâmica** `saudacao` = "Bom dia/Boa tarde/Boa noite, Operador." (por `new Date().getHours()`), + `dateLabel` (mono).
- **Agenda de hoje** (`agendaHoje`): lista `{h, t}` — ex. `09:00 Revisão médica anual`, `15:00 Foco profundo — sem notificações`, `19:30 Treino — inferiores`.
- **Hábitos** (`habitosList`, estado `state.habitos`): checkbox interativo. Ao marcar, `toggle()` inverte `d`; caixa vira preenchida no acento, texto ganha `line-through`. Itens: Treino de força, Leitura 30 min, Meditação, Água 3L.
- **Saúde resumida** (cards de `saude`): Sono ontem 7h20, Passos hoje 6.4k (meta 8k), Sequência 5 dias.

### 3.2 Agenda (`viewAgenda`)
Agenda por dias (`agendaSemana`): grupos `{dia, items:[{h,t,tag}]}`:
- HOJE · SÁBADO, 18 JUL — Revisão médica (SAÚDE), Foco profundo (ROTINA), Treino (SAÚDE)
- AMANHÃ · DOMINGO, 19 JUL — Café família (PESSOAL), Planejamento da semana (ROTINA)
- SEGUNDA, 20 JUL — Renovar CNH (DOCUMENTOS)
Cada item: hora mono + título Rajdhani + tag em pill mono.

### 3.3 Rotina (`viewRotina`)
Blocos do dia (`rotina`): MANHÃ / TARDE / NOITE, cada um com `items:[{h,t}]`.
- MANHÃ: 06:30 acordar+hidratação, 07:00 treino/mobilidade, 08:15 planejamento.
- TARDE: 12:30 almoço sem telas, 15:30 pausa+caminhada, 17:45 revisão de pendências.
- NOITE: 21:00 leitura 30 min, 22:00 desligar telas, 22:30 dormir.
Layout: 3 colunas de cartões-bloco com header mono no acento.

### 3.4 Saúde (`viewSaude`)
Cards de métrica (`saude`) + espaço para expansão (sono/passos/sequência). Números Rajdhani 700 tabular; sublabel `--tx-mut`.

### 3.5 Finanças (`viewFinancas`)
Categorias (`financas`): `{n, val, pct, col, sub}` com barra de progresso:
- Essenciais R$ 3.100/5.000 (62%, accN)
- Estilo de vida R$ 570/1.500 (38%, accN)
- Investimentos R$ 1.600/2.000 (80%, `#7dd3fc`)
- Reserva de emergência R$ 24.000 (100%, `#34d399`) — meta 6 meses atingida.
Barra: trilho `rgba(200,204,212,.1)` + preenchimento na cor da categoria.

### 3.6 Conteúdo (`viewConteudo`)
Fila pessoal (`conteudo`): `{tag, t, sub, st}` — LIVRO Deep Work (62%), PODCAST Sono e performance (NA FILA), ARTIGO Guia de aportes (SALVO), VÍDEO Mobilidade de quadril (NOVO). Tag em pill mono + status à direita.

### 3.7 Memória (`viewMemoria`)
Memória pessoal (`memoria`), agrupada:
- **PREFERÊNCIAS**: treinos 19h30; foco sem notificações após 15h; resumo em tom calmo.
- **FATOS E DATAS**: aniversário da mãe 12/set; reserva 6 meses atingida; revisão médica hoje 09:00.
Cada entrada: título + data/rótulo (mono).
> Obs.: é distinta da **Agent Memory** do Agents OS (rede neural/vault) — esta é a memória *pessoal* do usuário.

---

## 4. Interações & feedback
- **Hover** em cards/itens: `border-color` sobe para `hexA(accN,'35')` (ou neutro), sem elevar demais (tom calmo).
- **Toggle de hábito**: única interação de escrita hoje; feedback puramente visual (sem toast, para manter a leveza). Se futuramente precisar confirmar, usar **Toast SUCCESS** (padrão do README §5).
- **Sem voz/áudio** no NOA por padrão (privacidade). Se adicionar, reusar o motor do JARVIS.
- **Toasts**: quando NOA disparar mensagens de sistema (ex.: item salvo, meta atingida), usar a mesma API global `this.info/warn/error/success` — mesmo visual e canto superior direito.

---

## 5. Componentes reutilizáveis (NOA)
| componente | descrição | tokens-chave |
|---|---|---|
| **StatCard** | label mono + número Rajdhani 700 tabular | `--card-hi`, cor por métrica |
| **ProgressRow** | nome + valor + barra | trilho `rgba(200,204,212,.1)`, fill `col` |
| **ListItem** | hora/tag + título + status | pill mono, hover borda acento |
| **HabitCheck** | caixa + rótulo com `line-through` ao concluir | fill `accN`, texto `#8fa39a` |
| **BlockColumn** | header mono no acento + itens `{h,t}` | usado na Rotina |
| **SectionGroup** | label mono uppercase + itens | Memória, Agenda |
| **EmptyState** | anel `spin` + dot + legenda | `viewEmptyN` |

---

## 6. Implementação (delta para o Claude Code)
- Todas as views são `<sc-if value="{{viewXxx}}">` alimentadas por `s.nv` (via `viewHoje`, `viewAgenda`, …).
- Dados vivem em `renderVals()` (`agendaHoje`, `agendaSemana`, `rotina`, `financas`, `saude`, `conteudo`, `memoria`, `habitosList`).
- `habitosList` deriva de `state.habitos` e expõe `toggle()` por item (única mutação de estado do NOA hoje).
- Cores: usar `accN` e derivados `accNA*`; **não** reaproveitar `accJ` (é do JARVIS).
- Manter estilos inline e `hint-*` em todo `sc-for`/`sc-if`.

---

## 7. Roadmap NOA
- [x] Hoje, Agenda, Rotina, Saúde, Finanças, Conteúdo, Memória (protótipo com dados mock)
- [x] Hábitos interativos (toggle)
- [x] Tema por acento (`acentoNoa`) + seletor na tela de escolha
- [ ] Dados reais de Saúde (integração body scan / wearables) e Finanças (contas/BYOK)
- [ ] Persistência (localStorage) de hábitos e preferências
- [ ] Busca semântica na Memória pessoal
- [ ] Notificações via Toast (metas, lembretes) — opt-in
- [ ] Screenshots das 7 telas em `design-system/screens/noa/`
