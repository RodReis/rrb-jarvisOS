# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-08-28** (pós-merge da F01). Mantido pelo Code a cada entrega (junto com `DEVELOPMENT.md`). Este arquivo espelha o board das GitHub Issues (`proplan:*`) — se divergirem, as **Issues vencem** e este arquivo deve ser corrigido.

> **Correção de deriva (2026-08-28).** O arquivo tinha parado em 2026-07-24 e descrevia um board que não existe mais: apontava #34, #41, #43, #47, #52, #57, #58 e #69 como "aguardando aceite" (todos já `proplan:finalizado`), #66 como "Em Andamento" (fechado em 2026-07-25) e não conhecia as **7 issues novas** (#74–#80) nem os MVPs **005 a 009**. Reescrito contra o board real.

## Board

### Backlog (`proplan:backlog` — spec `aprovada-pi`, aguardando fila)

| Issue | Fatia | MVP | Spec | Índice |
|---|---|---|---|---|
| [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) | 02 Terminal controlado (command-runner) | MVP-004 (#10) | `spec-execucao-real-02-terminal-controlado.md` | M4-F02 |
| [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77) | 01 Vault de credenciais (CredentialRef) | MVP-005 (#76) | `spec-providers-01-vault-credenciais.md` | M5-F01 |
| [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78) | 02 Framework de adapters + Claude API | MVP-005 (#76) | `spec-providers-02-adapter-claude-api.md` | M5-F02 |
| [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79) | 03 BudgetPolicy (gate de custo) | MVP-005 (#76) | `spec-providers-03-budget-policy.md` | M5-F03 |
| [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80) | 04 Multi-provider + roteamento | MVP-005 (#76) | `spec-providers-04-multi-provider-roteamento.md` | M5-F04 |

> **Rótulo do #64 corrigido em 2026-08-28.** O `[FIX]` estava em `proplan:backlog` desde 2026-07-24 apesar de **entregue e mergeado** (PR [#65](https://github.com/RodReis/rrb-jarvisOS/pull/65), squash `b9f583a`) — aparecia como trabalho pendente por mais de um mês. Verificado na `main` antes de mover (`src/renderer/src/i18n/recursos.ts:99-100`) e carimbado `proplan:done`. Está em **Feito**, aguardando o aceite do PI.

> **`proplan:next` sem sucessor definido.** Nenhuma issue aberta carrega o marcador. Com a F01 entregue, a cabeça da fila é a **F02 do MVP-004** (#75) — ela consome o enforcement e o fluxo de aprovação que a F01 acabou de entregar. O MVP-005 (#76) é o corte seguinte e **independe do MVP-004** (providers são caminho de execução distinto — rede/adapter, não FS/terminal).

### Feito (`proplan:done` — entregue, aguardando aceite do PI)

| Issue | Fatia | MVP | Spec | PR | Mergeado |
|---|---|---|---|---|---|
| [#74](https://github.com/RodReis/rrb-jarvisOS/issues/74) | 01 Execução real de filesystem allowlisted | MVP-004 (#10) | `spec-execucao-real-01-filesystem-allowlisted.md` | [#81](https://github.com/RodReis/rrb-jarvisOS/pull/81) | 2026-08-28 |

> **F01 entregue** (Code, 2026-08-28) — PR [#81](https://github.com/RodReis/rrb-jarvisOS/pull/81) mergeado (squash `19870a3`), CI verde nos quatro checks. Os 7 critérios cobertos; os de comportamento (1–4) provados **pelo efeito** em 4 testes de integração. Evidência carimbada no `reports/TESTS.md` com issue, spec e PR.
>
> ⚠️ **A fila de aprovação não foi vista renderizada no app real.** O app foi levantado e duas `ApprovalRequest` pendentes foram semeadas no SQLite, mas ele para na tela de login — sem sessão não se alcança a rota Operações. O que a captura alcançou está em `reports/comparacao/f01-tela-inicial.png`. jsdom não aplica folha de estilo nem faz layout, e foi assim que #57, #58 e #64 passaram com a suíte verde. Fechar a lacuna exige login real (OAuth, passo humano) ou decisão do PI sobre semear a sessão.
>
> O CI pegou quatro coisas que o piso local não pegou: superfície da ponte no E2E (o build de `out/` estava velho), stack Supabase parada (7 testes de RLS pulados), `ENTREGA SEM CARIMBO` no relatório e o conflito do `CLAUDE.md` com o #31.

O #64 foi **aceito pelo PI em 2026-08-28** e saiu daqui para **Finalizado**.

### Finalizado (`closed` + `proplan:finalizado` — aceito pelo PI)

**32 issues fechadas.** Os três MVPs entregues estão consolidados na tabela de MVPs; abaixo, as fatias e os cards avulsos.

#### MVP-001 Fundação (épico #1, fechado)

| Issue | Fatia | Spec | Índice | PR | Aceite |
|---|---|---|---|---|---|
| [#2](https://github.com/RodReis/rrb-jarvisOS/issues/2) | 01 Bootstrap e estrutura | `spec-fundacao-01-bootstrap.md` | F01 | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) | 2026-07-22 |
| [#3](https://github.com/RodReis/rrb-jarvisOS/issues/3) | 02 AppShell e WorkspaceSwitcher | `spec-fundacao-02-appshell-workspaces.md` | F02 | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | 2026-07-22 |
| [#4](https://github.com/RodReis/rrb-jarvisOS/issues/4) | 03 Auth Google local-first | `spec-fundacao-03-auth-google.md` | F03 | [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) | 2026-07-22 |
| [#5](https://github.com/RodReis/rrb-jarvisOS/issues/5) | 04 Dados mínimos + AuditEvent | `spec-fundacao-04-dados-audit.md` | F04 | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | 2026-07-22 |
| [#6](https://github.com/RodReis/rrb-jarvisOS/issues/6) | 05 Settings mínimo | `spec-fundacao-05-settings.md` | F05 | [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) | 2026-07-22 |
| [#8](https://github.com/RodReis/rrb-jarvisOS/issues/8) | 06 Observabilidade e Logging | `spec-fundacao-06-observabilidade-logging.md` | F06 | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) | 2026-07-22 |

> **04 e 02 saíram no mesmo PR**, por decisão do PI (2026-07-22): o critério 4 da SPEC-04 exige `AuditEvent` de `workspace-switch`, cujo fluxo nasce na F02 — separá-las exigiria um stub que a F02 jogaria fora. O critério 4 fica **parcialmente atendido**: `workspace-switch` está provado ponta a ponta; `login`/`logout`/`login-offline-reuse` têm o tipo no contrato e o fluxo nasce na F03.

> A Fatia 06 saiu como **#8** (o número 7 já estava ocupado).

#### MVP-002 Execução local controlada (épico #9, fechado)

| Issue | Fatia | Spec | Índice | PR | Aceite |
|---|---|---|---|---|---|
| [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) | 01 Supabase local + ambiente de sync | `spec-execucao-local-01-supabase-local.md` | M2-F01 | [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) | 2026-07-22 |
| [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) | 02 Policy Engine mínimo (classificação) | `spec-execucao-local-02-policy-engine.md` | M2-F02 | [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) | 2026-07-22 |
| [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) | 03 Diretórios permitidos (allowlist) | `spec-execucao-local-03-allowlist-diretorios.md` | M2-F03 | [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) | 2026-07-22 |
| [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) | 04 Registro de workflows + automações | `spec-execucao-local-04-registro-workflows.md` | M2-F04 | [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36) | 2026-07-22 |
| [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) | 05 Motor de execução simulado | `spec-execucao-local-05-execucao-simulada.md` | M2-F05 | [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37) | 2026-07-23 |

> A F05 fecha o corte: o motor percorre um workflow classificando (F02) e checando allowlist (F03) **sem tocar recurso real** — invariante provado pelo efeito (arquivo não criado, diretório idêntico). É exatamente esse "modo report" que o **MVP-004 F01 (#74)** converte em enforcement.

#### MVP-003 Design System (épico #16, fechado)

| Issue | Fatia | Spec | Índice | PR | Aceite |
|---|---|---|---|---|---|
| [#17](https://github.com/RodReis/rrb-jarvisOS/issues/17) | 01 Infra do design system | `spec-design-system-01-infra.md` | M3-F01 | [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38) | 2026-07-23 |
| [#18](https://github.com/RodReis/rrb-jarvisOS/issues/18) | 02 Foundations + ponte com o protótipo | `spec-design-system-02-foundations.md` | M3-F02 | [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40) | 2026-07-23 |
| [#19](https://github.com/RodReis/rrb-jarvisOS/issues/19) | 03a Componentes: ações + formulários | `spec-design-system-03a-componentes-acoes-forms.md` | M3-F03a | [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42) | 2026-07-23 |
| [#20](https://github.com/RodReis/rrb-jarvisOS/issues/20) | 03b Componentes: dados + overlays + feedback | `spec-design-system-03b-componentes-dados-overlays.md` | M3-F03b | [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45) | 2026-07-23 |
| [#21](https://github.com/RodReis/rrb-jarvisOS/issues/21) | 04a AppShell + navegação | `spec-design-system-04a-appshell-navegacao.md` | M3-F04a | [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49) | 2026-07-23 |
| [#22](https://github.com/RodReis/rrb-jarvisOS/issues/22) | 04b Padrões operacionais | `spec-design-system-04b-padroes-operacionais.md` | M3-F04b | [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) | 2026-07-23 |
| [#23](https://github.com/RodReis/rrb-jarvisOS/issues/23) | 05 Identidades NOA e JARVIS | `spec-design-system-05-identidades.md` | M3-F05 | [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46) | 2026-07-23 |
| [#24](https://github.com/RodReis/rrb-jarvisOS/issues/24) | 06 Adoção & hardening | `spec-design-system-06-adocao-hardening.md` | M3-F06 | [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51) | 2026-07-23 |

> Base técnica (Fatia 01): **Radix + Tailwind v4 + Lucide**. Specs `03`/`04` originais viraram stubs *superseded* (divididas em a/b). Ordem executada: F01 → F02 → (F03a, F03b, F05 ‖) → F04a → F04b → F06 — **as 8 fatias em um dia** (2026-07-23).

#### Fatia avulsa (sem MVP pai)

| Issue | Fatia | Spec | PR | Aceite |
|---|---|---|---|---|
| [#69](https://github.com/RodReis/rrb-jarvisOS/issues/69) | CHOICE — seleção de espaço + acento | `spec-choice-01-selecao-de-espaco.md` | [#70](https://github.com/RodReis/rrb-jarvisOS/pull/70) | 2026-07-24 |

> Os **11 critérios** saíram num PR só (squash `0d4e42d`). `TelaChoice` fiel ao protótipo, acento persistido no `UserProfile` (migration 6), Settings com o mesmo seletor; rail e `WorkspaceSwitcher` **intactos** (opção A). Nasceu como card solto por decisão do PI — container de MVP em aberto.

#### Cards `[FIX]` / `[INFRA]`

| Issue | Card | MVP | Fonte do comportamento correto | PR | Aceite |
|---|---|---|---|---|---|
| [#43](https://github.com/RodReis/rrb-jarvisOS/issues/43) | o app nunca lia o `.env` | MVP-001 | `.env.example` §1-8 | [#44](https://github.com/RodReis/rrb-jarvisOS/pull/44) | 2026-07-24 |
| [#47](https://github.com/RodReis/rrb-jarvisOS/issues/47) | `navegacao.spec.ts` nunca rodou | MVP-001 | `TESTING.md` §2/§3, ADR-003 | [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48) | 2026-07-24 |
| [#52](https://github.com/RodReis/rrb-jarvisOS/issues/52) | o `Meter` escondia o rótulo em `aria-label` | MVP-003 | SPEC-DS-03b crit. 4, SPEC-DS-06 crit. 5 | [#53](https://github.com/RodReis/rrb-jarvisOS/pull/53) | 2026-07-24 |
| [#57](https://github.com/RodReis/rrb-jarvisOS/issues/57) | a tela de login não seguia o protótipo | MVP-001 | protótipo `Login`, `01-login.png`, README §2.6 | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#58](https://github.com/RodReis/rrb-jarvisOS/issues/58) | o Tailwind não varria `src/design/` | MVP-003 | `src/design/README.md` § Base técnica | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#34](https://github.com/RodReis/rrb-jarvisOS/issues/34) | CI: E2E em job próprio, condicional por paths | — | PI 2026-07-22 + ADR-003 | [#71](https://github.com/RodReis/rrb-jarvisOS/pull/71) | 2026-07-25 |
| [#41](https://github.com/RodReis/rrb-jarvisOS/issues/41) | renderer subia em porta variável | MVP-001 | `CLAUDE.md` § Portas, `vite.prova.config.ts` | [#73](https://github.com/RodReis/rrb-jarvisOS/pull/73) | 2026-07-25 |
| [#66](https://github.com/RodReis/rrb-jarvisOS/issues/66) | custo do GitHub Actions em repo privado | — | PI 2026-07-24 | [#72](https://github.com/RodReis/rrb-jarvisOS/pull/72) | 2026-07-25 |
| [#64](https://github.com/RodReis/rrb-jarvisOS/issues/64) | rótulo "Aguardando…" quebrava o botão do provedor | MVP-001 | protótipo § Login, `base.ts` `ALTURA_CONTROLE` | [#65](https://github.com/RodReis/rrb-jarvisOS/pull/65) | 2026-08-28 |

> **#58** — o Tailwind v4 detecta os arquivos a partir da pasta do CSS de entrada (`src/renderer/`), e sem `@source` o design system inteiro ficava fora do scanning: `text-[var(--jos-cor-texto)]` (37 usos em 20 arquivos), `disabled:opacity-45`, `mix-blend-screen`, os anéis do `VoiceMascot`. O `Button` secundário caía no `button { color: inherit }` do reset — texto quase preto sobre superfície escura. CSS compilado 22,9 KB → 56,8 KB. **Os 562 testes passavam porque jsdom não aplica folha de estilo.**

> **#66 resolvido na origem** — o PI tornou o repo público (Actions grátis). O `concurrency` no `ci.yml` saiu mesmo assim (PR #72), como guarda "se voltar a privado"; a separação do E2E por paths foi o #34.

> ⚠️ **O merge do #44 fechou a issue #43 sozinho** — reaberta e carimbada à mão. Causa: o squash concatena as mensagens do PR, e um commit se chamava `docs: registra o FIX #43 (...)`; o GitHub leu `FIX #43` como palavra-chave. Todos os commits usavam só `refs #43`. Regra registrada no `CONVENTION.md` §1.

### A Fazer · Em Andamento

*Vazio.* Nenhuma issue com `proplan:todo` ou `proplan:doing`. WIP = 0.

> A próxima da fila é a **F02 do MVP-004** ([#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) — terminal controlado), que consome o enforcement e o fluxo de aprovação entregues pela F01.

### Índice Fatia ↔ SPEC (fonte única do par MVP↔SPEC↔Fatia)

Não há catálogo numérico `SPEC-nnn`: as specs são identificadas por slug e mapeiam 1:1 para a fatia. Por isso os títulos das issues usam `[MVPn][Fnn]` sem token `[SPEC-nnn]` (regra de ouro: não inventar número). **Pendência ao PI:** decidir se o projeto adota numeração `SPEC-nnn` — se sim, atribuir os números aqui e ajustar os títulos.

| Índice | MVP | Fatia | Spec (slug) |
|---|---|---|---|
| F01–F06 | MVP-001 | Bootstrap · AppShell · Auth · Dados · Settings · Observabilidade | `spec-fundacao-01..06` |
| M2-F01–F05 | MVP-002 | Supabase local · Policy Engine · Allowlist · Workflows · Execução simulada | `spec-execucao-local-01..05` |
| M3-F01–F06 | MVP-003 | Infra · Foundations · Componentes (a/b) · AppShell (a/b) · Identidades · Hardening | `spec-design-system-01..06` |
| M4-F01–F02 | MVP-004 | Filesystem allowlisted · Terminal controlado | `spec-execucao-real-01..02` |
| M5-F01–F04 | MVP-005 | Vault · Adapter Claude · BudgetPolicy · Multi-provider | `spec-providers-01..04` |
| M6-F01–F06 | MVP-006 | Núcleo · Governança · GitHub App · GitHub automação · Tavily search · Tavily extract | `spec-conectores-01..06` |
| M8-F01–F06 | MVP-008 | Projeto git local · Contexto/skills · Wizard · PRD/Landscape · Anexos · Roadmap | `spec-planejamento-01..06` |
| M9-F01–F06 | MVP-009 | Publicação · DAG/fila · Worktree/Docker · Construção · Revisão/CI · Evidência | `spec-entrega-01..06` |

## MVPs

| MVP | Issue | Estado | Fatias fechadas |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | **fechado** — aceito pelo PI em 2026-07-22 | **6 / 6** |
| MVP-002 Execução local controlada | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | **fechado** — aceito pelo PI em 2026-07-23 | **5 / 5** |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | **fechado** — aceito pelo PI em 2026-07-23 | **8 / 8** |
| MVP-004 Execução real (FS + terminal) | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | **aberto** — F01 (#74) entregue em 2026-08-28, aguardando aceite; F02 (#75) em Backlog | 0 / 2 (1 entregue) |
| MVP-005 Providers + Vault + BudgetPolicy | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | **aberto** — 4 fatias em Backlog (#77–#80); as 4 specs `aprovada-pi` em 2026-07-24 | 0 / 4 |
| MVP-006 Conectores Essenciais | — | desenho aprovado pelo PI (2026-08-28); **6 specs em revisão documental**, implementação não autorizada — sem issues | — |
| MVP-007 Memória Contextual e RAG | — | slot reservado; proposta não detalhada; implementação não autorizada | — |
| MVP-008 Planejamento Governado | — | desenho aprovado pelo PI (2026-08-28); **6 specs em revisão documental**, implementação não autorizada — sem issues | — |
| MVP-009 Entrega Autônoma | — | desenho aprovado pelo PI (2026-08-28); **6 specs em revisão documental**, implementação não autorizada — sem issues | — |

> **Corte 3 partido em três** (decisão do PI, 2026-07-24): **MVP-005 Providers+Vault+Budget → MVP-006 Conectores externos → MVP-007 Memória híbrida+RAG**. Mesma lógica do split do Corte 2 — evitar concentrar risco num épico gigante. O MVP-005 **independe do MVP-004**.

> **MVPs 006, 008 e 009 não têm issue no board** — e é o comportamento correto. Suas specs estão em *revisão documental*, não `aprovada-pi`; pela regra lazy do `CLAUDE.md`, a issue-fatia só nasce quando a spec é aprovada. As 18 specs existem em `docs/spec/` como desenho, não como autorização de implementação.

> **Redefinição do MVP-003 (2026-07-21).** Por decisão do PI, o slot MVP-003 passou a ser o **Design System**; a "Execução real" foi renumerada para **MVP-004** (o antigo `mvp-003-execucao-real.md` é um stub superseded).

> **BudgetPolicy saiu do MVP-004.** Ela mede gasto com providers de IA, que só existem no Corte 3 — construí-la antes seria o guarda antes de existir o que guardar. Modelo decidido no ADR-001 (questão 1): **estimativa + alerta com bloqueio no ponto único de chamada** do adapter, não proxy. Virou a **F03 do MVP-005** (#79).

## Próximas ações

1. **PI — aceitar a F01 (#74)**, em `proplan:done` desde 2026-08-28. Antes disso, vale fechar a ressalva: a fila de aprovação nunca foi vista renderizada no app real (ver a nota em **Feito**) — precisa de um login real ou da decisão sobre semear a sessão.
2. **Code — iniciar a F02 (#75)** depois que o PI decidir a ordem: terminal controlado (command-runner allowlisted), que consome o enforcement e a aprovação da F01. Spec `aprovada-pi` desde 2026-07-24.
3. **PI — decidir se o MVP-005 (#76) corre em paralelo ou depois do MVP-004.** Ele **independe** do MVP-004 (providers são caminho de execução por rede/adapter, gateado por Policy Engine + BudgetPolicy, não pelo FS/terminal), então a ordem é escolha de foco, não de dependência. Com WIP = 1 e time solo, a leitura do Code é **sequencial: MVP-004 → MVP-005**.
4. **Cowork — spec de login por senha + GitHub** (decisão do PI, 2026-07-24). O mockup `01-login.png` mostra usuário/senha, GitHub e "cadastre-se com"; o backend só tem Google OAuth, e o #57 entregou a tela sem esses controles justamente para a UI não prometer o que o sistema não faz. Virar fatia exige a spec resolver, com o PI: política de senha; quem pode se cadastrar (aberto? convite? domínio restrito?); recuperação de senha (**depende de e-mail transacional, que não existe** — o ambiente é 100% local até o fim do MVP); vinculação de contas com o mesmo e-mail via Google e GitHub; verificação de e-mail. **Não é `[FIX]`** — há decisão de produto em cada linha.
5. **PI — (opcional) decidir a adoção de numeração `SPEC-nnn`.**
6. **Cowork — levar as specs dos MVPs 006/008/009 de "revisão documental" a `aprovada-pi`**, uma a uma, quando o PI decidir abrir essas frentes. Só então nascem as issues-fatia. O MVP-007 ainda precisa da proposta detalhada.

> A partir do MVP-003, as fatias de UI usam a skill **impeccable** para construir, verificar e polir (decisão do PI, 2026-07-23) — sem substituir o piso de `dev`/`test`/`lint` verdes.

## Roadmap macro

MVP-001 Fundação ✅ → Execução local controlada ✅ → Design System ✅ → **Execução real (FS + terminal)** ← *aqui* → Providers de IA + Vault + Budget → Conectores essenciais → Memória contextual/RAG → Planejamento governado → Entrega autônoma. Detalhe em `docs/LANDSCAPE.md`.
