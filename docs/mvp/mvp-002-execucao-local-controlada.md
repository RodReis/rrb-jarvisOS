# MVP-002 — Execução local controlada (fundação de execução)

- Tipo: épico (`proplan:mvp`). Container de fatias — **sem spec própria**.
- Status: **definido** (2026-07-21) — recorte e papel dos bancos aprovados pelo PI. Épico criado ([#9](https://github.com/RodReis/rrb-jarvisOS/issues/9)); fatias nascem lazy (viram issue só quando a spec vira `aprovada-pi`).
- Base: `docs/iniciais/requisitos-agent-os.md` § Corte 2; ADR-001 (local-first), ADR-004 (auditoria), ADR-005 (logging).
- Depende de: **MVP-001 entregue** (usa auth, workspaces, SQLite, AuditEvent e logging da fundação).
- Dono do aceite: PI. Só fecha quando todas as fatias-filhas fecharem.

## Tese

Tornar a execução local **possível com segurança e evidência** — sem ligar a execução real ainda. Entra o modelo de permissões (fail-closed), a allowlist de diretórios, o ambiente de sincronização (Supabase local), o registro de workflows/automações e o **motor de execução em modo simulado**, tudo auditado (ADR-004) e logado (ADR-005). É o "pode executar com segurança" — o "executa de verdade" (terminal, execução real, BudgetPolicy) fica no **MVP-003**.

Recorte deliberado: o Corte 2 dos requisitos foi **dividido em dois MVPs** (decisão do PI, 2026-07-21) para não concentrar risco (terminal + execução real + budget juntos).

## Papel dos bancos (decisão do PI, 2026-07-21)

- **SQLite** = banco interno **embutido** da aplicação — **fonte de verdade operacional** local (ADR-001/004). O isolamento multiusuário/workspace segue por `user_id`/`workspace_id` (SPEC-Fundacao-04).
- **Supabase** = alvo de **sincronização na nuvem**. Em dev, roda **Supabase local via Docker** (migrações, RLS, seeds); a RLS vale no lado Supabase, não substitui o SQLite. O sync bidirecional completo é do Corte 3 — aqui entra só o ambiente.

## Checklist de fatias previstas

Cada item vira issue-filha **somente** quando sua spec estiver `aprovada-pi` (nasce lazy). Ainda sem spec:

- [ ] **Fatia 01 — Supabase local (Docker) + ambiente de sync (dev)** ([#15](https://github.com/RodReis/rrb-jarvisOS/issues/15), spec `aprovada-pi`): `supabase` CLI, migrations starter (UserProfile/Workspace/AuditEvent) + RLS, seeds; sem lógica de sync (Corte 3); SQLite segue fonte de verdade.
- [ ] **Fatia 02 — Policy Engine mínimo (classificação)** ([#11](https://github.com/RodReis/rrb-jarvisOS/issues/11), spec `aprovada-pi`): classifica risco (baixo/médio/alto/bloqueado) e audita a decisão, **sem enforçar** (modo report); enforcement fail-closed liga no MVP-003. Taxonomia como seed.
- [ ] **Fatia 03 — Diretórios permitidos (allowlist)** ([#12](https://github.com/RodReis/rrb-jarvisOS/issues/12), spec `aprovada-pi`): allowlist configurável (default = só o dir do app), checagem `isPathAllowed` anti-traversal/symlink, alimenta o Policy Engine; gating real de FS fica no MVP-003.
- [ ] **Fatia 04 — Registro de workflows + automações manuais** ([#13](https://github.com/RodReis/rrb-jarvisOS/issues/13), spec `aprovada-pi`): catálogo/registro com schema pleno RF-006 (sem execução); só manual acionável; alimenta a Fatia 05.
- [ ] **Fatia 05 — Motor de execução em modo simulado** ([#14](https://github.com/RodReis/rrb-jarvisOS/issues/14), spec `aprovada-pi`): headline do MVP — lê a def (F04), classifica (F02) e checa allowlist (F03), simula sem efeito real, `ExecutionRun` auditado (ADR-004) e logado (ADR-005).

## Ordem e dependências

02 (Policy Engine) e 01 (ambiente de sync) podem ir cedo → 03 depende de 02 → 04 (registro) em paralelo → 05 depende de 02+03+04. Logging (MVP-001 F06) e AuditEvent (MVP-001 F04) são pré-requisitos.

## Fora deste MVP (→ MVP-003 e além)

- **MVP-003 (segunda metade do Corte 2):** terminal controlado no Desktop, **execução real allowlisted**, **BudgetPolicy** (USD 1/dia, 1/mês). *A BudgetPolicy depende de resolver a questão aberta 1 do ADR-001 (estimativa+alerta vs proxy) antes de sua spec.*
- **Corte 3+ (MVPs futuros):** providers de IA, conectores reais, memória híbrida + RAG, sync bidirecional, vault de credenciais.
- Voz, crons, squads, Power Guard (Corte 4).

## Critérios de done do MVP

- Supabase local sobe via Docker; migrações e seeds rodam. SQLite segue fonte de verdade operacional.
- Policy Engine **bloqueia ação não reconhecida** (fail-closed); ação sensível gera `AuditEvent` antes e depois.
- Allowlist de diretórios configurável e respeitada nos caminhos de execução.
- Workflows e automações manuais registráveis (catálogo).
- **Execução simulada** roda ponta a ponta — auditada e logada — **sem tocar recurso real**.
- `npm run dev`, `npm run test`, `npm run lint` passam; evidência registrada no `reports/TESTS.md` (ADR-003).
