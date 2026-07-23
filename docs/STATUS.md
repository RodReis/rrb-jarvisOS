# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-07-22**. Mantido pelo Code a cada entrega (junto com `DEVELOPMENT.md`). Este arquivo espelha o board das GitHub Issues (`proplan:*`) — se divergirem, as **Issues vencem** e este arquivo deve ser corrigido.

## Board

### Backlog (`proplan:backlog` — spec `aprovada-pi`, aguardando fila)

| Issue | Fatia | MVP | Spec | Índice |
|---|---|---|---|---|
| [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) | 04 Registro de workflows + automações | MVP-002 (#9) | `spec-execucao-local-04-registro-workflows.md` | M2-F04 |
| [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) | 05 Motor de execução simulado | MVP-002 (#9) | `spec-execucao-local-05-execucao-simulada.md` | M2-F05 |

> **`proplan:next` = [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13)** (M2-F04, registro de workflows): o marcador avançou em 2026-07-22, quando a F03 (#12) foi entregue. A F04 depende da F02. Ordem restante do MVP-002: 04 → 05 (a 05 depende de 02+03+04).

> Card **[#34](https://github.com/RodReis/rrb-jarvisOS/issues/34)** (`[INFRA]`, Backlog): separar o E2E em job de CI próprio, condicional por paths. Criado pelo Code durante a F03 — o cache do Electron (parte fácil) já saiu no PR #35; a separação do E2E do relatório é infra maior e vai em PR dedicado.

> A Fatia 06 saiu como **#8** (o número 7 já estava ocupado). Sub-issue do épico #1; assignee PI.

### Feito (`proplan:done` — entregue, aguardando aceite do PI)

| Issue | Fatia | MVP | Spec | Índice | PR |
|---|---|---|---|---|---|
| [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) | 02 Policy Engine mínimo (classificação) | MVP-002 (#9) | `spec-execucao-local-02-policy-engine.md` | M2-F02 | [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) |
| [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) | 03 Diretórios permitidos (allowlist) | MVP-002 (#9) | `spec-execucao-local-03-allowlist-diretorios.md` | M2-F03 | [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) |

> **04 e 02 saíram no mesmo PR**, por decisão do PI (2026-07-22): o critério 4 da SPEC-04 exige `AuditEvent` de `workspace-switch`, cujo fluxo nasce na F02 — separá-las exigiria um stub que a F02 jogaria fora. O critério 4 fica **parcialmente atendido**: `workspace-switch` está provado ponta a ponta; `login`/`logout`/`login-offline-reuse` têm o tipo no contrato e o fluxo nasce na F03.

### Finalizado (`closed` + `proplan:finalizado` — aceito pelo PI)

| Issue | Fatia | MVP | Spec | Índice | PR | Aceite |
|---|---|---|---|---|---|---|
| [#2](https://github.com/RodReis/rrb-jarvisOS/issues/2) | 01 Bootstrap e estrutura | MVP-001 (#1) | `spec-fundacao-01-bootstrap.md` | F01 | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) | 2026-07-22 |
| [#8](https://github.com/RodReis/rrb-jarvisOS/issues/8) | 06 Observabilidade e Logging | MVP-001 (#1) | `spec-fundacao-06-observabilidade-logging.md` | F06 | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) | 2026-07-22 |
| [#5](https://github.com/RodReis/rrb-jarvisOS/issues/5) | 04 Dados mínimos + AuditEvent | MVP-001 (#1) | `spec-fundacao-04-dados-audit.md` | F04 | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | 2026-07-22 |
| [#3](https://github.com/RodReis/rrb-jarvisOS/issues/3) | 02 AppShell e WorkspaceSwitcher | MVP-001 (#1) | `spec-fundacao-02-appshell-workspaces.md` | F02 | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | 2026-07-22 |
| [#6](https://github.com/RodReis/rrb-jarvisOS/issues/6) | 05 Settings mínimo | MVP-001 (#1) | `spec-fundacao-05-settings.md` | F05 | [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) | 2026-07-22 |
| [#4](https://github.com/RodReis/rrb-jarvisOS/issues/4) | 03 Auth Google local-first | MVP-001 (#1) | `spec-fundacao-03-auth-google.md` | F03 | [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) | 2026-07-22 |
| [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) | 01 Supabase local + ambiente de sync | MVP-002 (#9) | `spec-execucao-local-01-supabase-local.md` | M2-F01 | [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) | 2026-07-22 |

### A Fazer · Em Andamento

*(vazios)*

### MVP-003 Design System — 8 fatias em Backlog (todas `aprovada-pi`, `proplan:backlog`, assignee PI)

Épico: **[#16](https://github.com/RodReis/rrb-jarvisOS/issues/16)**. Criadas e vinculadas em 2026-07-21. Ordem: F01 → F02 → (F03a, F03b, F05 ‖) → F04a → F04b → F06.

| Issue | Fatia | Índice | Spec |
|---|---|---|---|
| [#17](https://github.com/RodReis/rrb-jarvisOS/issues/17) | 01 Infra do design system | M3-F01 | `spec-design-system-01-infra.md` |
| [#18](https://github.com/RodReis/rrb-jarvisOS/issues/18) | 02 Foundations + ponte com o protótipo | M3-F02 | `spec-design-system-02-foundations.md` |
| [#19](https://github.com/RodReis/rrb-jarvisOS/issues/19) | 03a Componentes: ações + formulários | M3-F03a | `spec-design-system-03a-componentes-acoes-forms.md` |
| [#20](https://github.com/RodReis/rrb-jarvisOS/issues/20) | 03b Componentes: dados + overlays + feedback | M3-F03b | `spec-design-system-03b-componentes-dados-overlays.md` |
| [#21](https://github.com/RodReis/rrb-jarvisOS/issues/21) | 04a AppShell + navegação | M3-F04a | `spec-design-system-04a-appshell-navegacao.md` |
| [#22](https://github.com/RodReis/rrb-jarvisOS/issues/22) | 04b Padrões operacionais | M3-F04b | `spec-design-system-04b-padroes-operacionais.md` |
| [#23](https://github.com/RodReis/rrb-jarvisOS/issues/23) | 05 Identidades NOA e JARVIS | M3-F05 | `spec-design-system-05-identidades.md` |
| [#24](https://github.com/RodReis/rrb-jarvisOS/issues/24) | 06 Adoção & hardening | M3-F06 | `spec-design-system-06-adocao-hardening.md` |

> Base técnica (Fatia 01): **Radix + Tailwind v4 + Lucide**. Specs `03`/`04` originais viraram stubs *superseded* (divididas em a/b).

### Índice Fatia ↔ SPEC (fonte única do par MVP↔SPEC↔Fatia)

Não há catálogo numérico `SPEC-nnn` para o MVP-001: as specs são identificadas por slug (`SPEC-Fundacao-01..06`) e mapeiam 1:1 para a fatia (F01↔spec-01, …, F06↔spec-06). Por isso os títulos das issues usam `[MVP1][Fnn]` sem token `[SPEC-nnn]` (regra de ouro: não inventar número). **Pendência ao PI:** decidir se o projeto adota numeração `SPEC-nnn` — se sim, atribuir os números aqui e ajustar os títulos.

## MVPs

| MVP | Issue | Estado | Fatias fechadas |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | **fechado** — épico aceito pelo PI em 2026-07-22; todas as 6 filhas `proplan:finalizado` (#2, #3, #4, #5, #6, #8) | **6 / 6** |
| MVP-002 Execução local controlada (fundação) | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | **em execução**: F01 (#15) aceita; F02 (#11) e F03 (#12) entregues (aguardando aceite); 2 fatias em Backlog (#13, #14), com spec `aprovada-pi` | 1 aceita · **3 / 5 entregues** |
| MVP-003 Design System da Plataforma (base única, 2 identidades) | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | épico criado; **8 fatias** em Backlog (#17–#24), todas com spec `aprovada-pi` | 0 / 8 |
| MVP-004 Execução real (terminal + execução allowlisted) | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | renumerado de MVP-003 (título/rótulo atualizados + carimbo); 2 fatias lazy | 0 / 2 |
| MVP-providers (Corte 3) | — | planejado; incluirá **BudgetPolicy** (modelo decidido no ADR-001 #1) + providers/conectores/RAG | — |

> **Redefinição do MVP-003 (2026-07-21).** Por decisão do PI, o slot MVP-003 passou a ser o **Design System da Plataforma**; a "Execução real" foi renumerada para **MVP-004** (`docs/mvp/mvp-004-execucao-real.md`; o antigo `mvp-003-execucao-real.md` é um stub superseded). Decisões que moldam o novo MVP-003: (1) redefinir o slot; (2) conciliar protótipo `docs/design/design-system/` (referência visual) com a direção do PRD (implementação tipada, claro/escuro, WCAG 2.2); (3) base única, 2 identidades; (4) peso **leve solo+IA** — sem Storybook/Playwright/governança de 9 passos (mantém a suspensão do LANDSCAPE); (5) especificar agora, **executar depois de MVP-001/002**.

## Próximas ações

1. **MVP-001 entregue por inteiro** (2026-07-22): **6 das 6 fatias** — F01 (#2), F06 (#8), F04 (#5), F02 (#3), F05 (#6) e F03 (#4). Ordem executada: **01 → 06 → 04+02 → 05 → 03**. A F03 destravou quando o PI criou as credenciais e saiu no mesmo dia. O `proplan:next` avançou para o **MVP-002** (#9), começando pela F01 (#15), que é independente das demais.
2. ~~Resolver as "Perguntas ao PI" das specs do MVP-003~~ — **feito** (2026-07-21): as 8 specs estão `aprovada-pi`.
3. ~~Renumerar #10 → MVP-004 e criar o épico MVP-003 + issues~~ — **feito** (2026-07-21): #10 retitulada MVP-004 (carimbo), épico **#16** criado, 8 filhas **#17–#24** em Backlog e vinculadas.
4. **Code**: quando MVP-001/002 estiverem entregues, iniciar o MVP-003 pela F01 (#17); WIP = 1, na ordem F01 → F02 → (F03a/F03b/F05) → F04a → F04b → F06.
5. ~~**PI — desbloqueia a F03 (#4)**~~ — **feito** (2026-07-22): projeto Supabase de dev criado, cliente OAuth do Google Cloud registrado e `.env` preenchido. A fatia foi entregue no mesmo dia ([#30](https://github.com/RodReis/rrb-jarvisOS/pull/30)). *Nota:* o `GOOGLE_OAUTH_CLIENT_SECRET` do `.env` **não é consumido pelo app** — no desenho do ADR-002 quem fala com o Google é o Supabase, e o secret vive no painel dele. Decisão do PI: manter a variável sem uso.
6. ~~**Code**: MVP-002 F01 (#15), F02 (#11), F03 (#12)~~ — **feitos** (2026-07-22): F01 [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32), F02 [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33), F03 [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35). A allowlist é dado + checagem consultável (anti-escape com symlink), integrada ao Policy Engine (path fora eleva o tier). Próxima: **F04 (#13)**, registro de workflows — já marcada `proplan:next`. Ordem restante: 04 → 05 (a 05 depende de 02+03+04).
7. **PI**: (opcional) decidir a adoção de numeração `SPEC-nnn`.
8. ~~**PI**: aceitar as fatias do MVP-001 e fechar o épico #1~~ — **feito** (2026-07-22): as 6 filhas aceitas (`proplan:finalizado`) e o épico **#1 fechado**. **#15** (MVP-002 · F01) também aceita. **Pendentes de aceite:** **#11** (F02, Policy Engine — PR [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33)) e **#12** (F03, allowlist — PR [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35)), aguardando o PI.

## Roadmap macro

MVP-001 Fundação → Execução local controlada → Integrações reais → Voz e automação → Offline/multiplataforma. Detalhe em `docs/LANDSCAPE.md`.
