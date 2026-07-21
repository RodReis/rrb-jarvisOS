# SPEC-Execucao-02 — Policy Engine mínimo (classificação)

- MVP: `docs/mvp/mvp-002-execucao-local-controlada.md` (Fatia 02)
- Status: **aprovada-pi** (2026-07-21) — decisão-chave (só classifica, sem bloqueio) resolvida pelo PI.
- Dependências: MVP-001 entregue (usa `AuditEvent`/hash-chain da SPEC-Fundacao-04 e o logging da SPEC-Fundacao-06). É o backbone das fatias 03 (allowlist) e 05 (execução simulada) do MVP-002 e do enforcement no MVP-003.
- Decisões que sustentam esta spec: ARCHITECTURE §Policy Engine / §Fronteiras de segurança; ADR-004 (auditoria); `CLAUDE.md` (fail-closed); requisitos § "Ações Possíveis e Política de Aprovação".

## Objetivo

Estabelecer o **Policy Engine** em **modo classificação (report)**: dada uma ação de runtime, ele classifica o risco (**baixo | médio | alto | bloqueado**) e **registra a decisão como `AuditEvent`** — **sem enforçar** (não bloqueia) nesta fatia. Cria a máquina de política e a taxonomia de risco como dado; o **enforcement fail-closed** (barrar de verdade + aprovação humana) liga no **MVP-003**, onde há execução real a proteger.

> **Fronteira com o invariante fail-closed.** O `CLAUDE.md` exige Policy Engine fail-closed. Isto **não** é violado: aqui o engine já **classifica** o desconhecido como `bloqueado` (a decisão fail-closed existe e é auditada), mas ainda **não barra** — barrar é enforcement, e enforcement é MVP-003 (Fatia 01, execução real). É o mesmo padrão "report-only → gate depois" da cobertura no ADR-003.

## Escopo

### Dentro

- **Núcleo avaliador puro** em `src/shared/policies/`: `evaluate(action, context) → Decision`, onde
  `Decision = { tier: 'baixo'|'medio'|'alto'|'bloqueado', outcome: 'allow'|'requires-approval'|'block', reason }`.
  Sem I/O, sem storage, sem rede — lógica de domínio testável (categoria Regras).
- **Taxonomia de risco como dado (seed), não hardcode:** a lista de ações→risco vem dos requisitos (§ Ações Possíveis) e mora em `src/shared/policies/` como config versionada. Ajustar o risco de uma ação = editar o seed, não o código. Segue a regra "sem hardcode" do `CLAUDE.md`.
- **Classificação sensível ao contexto:** a decisão considera `workspace` e `sensitivity` (CONVENTION §2). Ex.: JARVIS OS acessando `personal`/`financial`/`health` ⇒ tier **alto** (aprovação), coerente com "JARVIS nunca acessa esses sem aprovação".
- **Fail-closed na classificação:** ação **não reconhecida** pela taxonomia ⇒ tier `bloqueado`. A decisão existe mesmo que ninguém a enforce ainda.
- **Auditoria de toda decisão:** cada `evaluate` gera um `AuditEvent` (encadeado, ADR-004) com `action`, `context` (redigido — sem segredo/PII, ADR-005), `tier`, `outcome` e `reason`. É a "toda decisão gera AuditEvent" da ARCHITECTURE.
- **Escopo de ações:** o engine governa **comandos de runtime/agente**, **não** UI. Trocar workspace, mudar setting e navegar são UI (auditados como `workspace-switch` etc. na SPEC-04), **não** passam pelo `evaluate`.
- **Carga real desta fatia:** a única ação de runtime que existe no MVP-002 é **"executar workflow simulado"** (classificada `baixo`) e ops de storage. O `evaluate` é exercitado por elas; o resto da taxonomia é semeado para quando terminal/providers/agentes chegarem.
- **Modo report:** o chamador (runtime) **recebe a `Decision` e a registra**, mas **não bloqueia** a execução nesta fatia.

### Fora

- **Enforcement (bloqueio/gating)** — MVP-003, Fatia 01 (execução real allowlisted): é lá que a `Decision.outcome = 'block'` passa a **barrar** e o fail-closed vira efetivo.
- **Fluxo de aprovação humana** (UI de aprovar + estado pendente) — junto do enforcement (MVP-003).
- **Postura default de baixo risco** (liberado-por-padrão vs opt-in do usuário) — decidida quando o enforcement ligar; sem bloqueio, não morde agora.
- **Permissões por papel** (owner/admin/operator/viewer/agent-service-account — RF-019): single-user agora; entra com multiusuário real.
- **Edição de política em runtime** (a própria UI de alterar política é ação de alto risco) — futuro.
- **BudgetPolicy** — MVP de providers (Corte 3), ADR-001 §1.

## Critérios de aceite

1. `evaluate(action, ctx)` classifica toda ação **reconhecida** no tier correto (baixo/médio/alto) a partir do seed; ação **não reconhecida** ⇒ tier `bloqueado` (fail-closed na classificação). Teste cobre os quatro tiers.
2. Classificação **sensível ao contexto**: JARVIS OS + `sensitivity ∈ {personal, financial, health}` ⇒ tier `alto`/`requires-approval` (CONVENTION §2). Teste comprova.
3. **Toda** avaliação gera um `AuditEvent` encadeado (ADR-004) com ação, contexto redigido, tier, outcome e reason. Teste: N avaliações ⇒ N eventos, cadeia íntegra (`verifyChain` passa).
4. A taxonomia é **seed** em `src/shared/policies/`, não constante embutida — mudar o risco de uma ação é editar o dado. Teste lê do seed.
5. **"Executar workflow simulado"** roda **classificada `baixo` e auditada**, e **não é bloqueada** (modo report) — a execução simulada segue mesmo que o engine classifique algo como `bloqueado`.
6. **Nenhuma ação é bloqueada nesta fatia** (enforcement é MVP-003) — verificável: uma ação classificada `bloqueado` ainda executa (simulada), com a decisão registrada no audit.
7. Renderer não avalia política — o `evaluate` roda no main/runtime; a UI só vê resultado via IPC tipado (ARCHITECTURE §Fronteiras: "Main não decide política sozinho — chama o Policy Engine").
8. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (categorias Regras + Banco).

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Enforcement nesta fatia:** **só classifica, sem bloqueio.** O engine retorna e audita a `Decision`; **não barra**. O enforcement fail-closed + aprovação humana ligam no **MVP-003** (execução real). — decidido.
2. **Postura default de baixo risco** (liberado vs opt-in): **deferida** para quando o enforcement ligar (MVP-003) — sem bloqueio, não tem efeito agora. — decidido.
