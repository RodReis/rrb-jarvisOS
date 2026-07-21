# SPEC-Execucao-03 — Diretórios permitidos (allowlist)

- MVP: `docs/mvp/mvp-002-execucao-local-controlada.md` (Fatia 03)
- Status: **aprovada-pi** (2026-07-21) — postura padrão da allowlist resolvida pelo PI.
- Dependências: MVP-001 entregue (SQLite e `AuditEvent`/hash-chain da SPEC-Fundacao-04). Depende da **Fatia 02 (Policy Engine)** — a allowlist alimenta o `evaluate`. É pré-requisito da Fatia 05 (execução simulada) e do enforcement de FS/terminal no MVP-003.
- Decisões que sustentam esta spec: requisitos § Corte 2 / RF-016 (OS Desktop, terminal, diretórios configuráveis) e § "permissões conservadoras"; ARCHITECTURE §Terminal Executor ("allowlist, cwd permitido"); ADR-004 (auditoria).

## Objetivo

Estabelecer a **allowlist de diretórios permitidos** — a fonte de verdade, configurável pelo admin (o usuário, single-user), do que o filesystem/terminal podem tocar — mais a **função de checagem** e a **integração com o Policy Engine**. Postura **conservadora**: por padrão só o diretório gerido pelo app é permitido. Nesta fatia a allowlist é **dado + checagem consultável**, não gating real de FS/terminal — barrar operação real é MVP-003 (não há FS real tocado no MVP-002; a execução é simulada).

## Escopo

### Dentro

- **Modelo da allowlist:** conjunto de diretórios permitidos (paths **canônicos**), persistido no SQLite (fundação), escopado por `user_id` (e `workspace_id` quando aplicável, CONVENTION §2).
- **Default de fábrica:** **apenas o diretório gerido pelo app** (sob `userData`). Tudo fora disso é **opt-in explícito** do usuário — nada do sistema dele é alcançável por padrão.
- **Função de checagem pura** em `src/shared/policies/`: `isPathAllowed(path, allowlist) → boolean`, com
  - **canonicalização** do path (resolve `..`, `.`, e **symlinks**) antes de comparar;
  - **matching recursivo** — permitir um diretório inclui suas subpastas;
  - **anti-escape:** um path que canoniza para **fora** de todo diretório permitido retorna `false` (barra traversal `../` e symlink apontando pra fora).
- **Edição da allowlist** (adicionar/remover diretório): gera `AuditEvent` encadeado (ADR-004). Editar a allowlist é, ela mesma, ação sensível (RF-019, alto risco) — **classificada** pelo Policy Engine (Fatia 02), mas **sem enforcement** ainda (MVP-002).
- **Integração com o Policy Engine (Fatia 02):** o contexto de `evaluate` passa a incluir se o path da ação está na allowlist. Path **fora** do permitido **eleva o tier** (ex.: "ler/gravar fora de diretório permitido" ⇒ `médio`, conforme requisitos). A allowlist é insumo da classificação.
- **Fronteira de processo:** a allowlist é gerida no **main**; a checagem roda no main. O renderer **não** lê/edita FS nem a allowlist direto — só vê/edita via **IPC tipado**.

### Fora

- **Gating/enforcement real de FS e terminal** — MVP-003 (execução real + terminal): é lá que `isPathAllowed = false` passa a **barrar** a operação. Aqui a checagem existe e é consultada, não aplicada a recurso real.
- **Granularidade read vs write por diretório** — MVP-003 (quando há FS real). Aqui um diretório permitido vale para leitura e escrita juntas.
- **File Explorer / System Monitor / UI de terminal** (RF-016 do OS Desktop) — futuro.
- Diretórios de rede/remotos, montagens externas — fora.

## Critérios de aceite

1. Allowlist persistida no SQLite, escopada por `user_id`; **default de fábrica = só o diretório gerido pelo app** (`userData`). Teste comprova o default e o escopo por usuário.
2. `isPathAllowed` **canoniza** o path (resolve `..` e symlink) e faz matching **recursivo**; um path que resolve para fora de todo diretório permitido retorna `false`. Testes: `permitido/sub` ⇒ true; `permitido/../fora` ⇒ false; symlink em dir permitido apontando pra fora ⇒ false.
3. Adicionar/remover diretório da allowlist gera `AuditEvent` encadeado (ADR-004); `verifyChain` passa.
4. O Policy Engine (Fatia 02) consulta a allowlist: ação sobre path **fora** do permitido é classificada em tier maior que a mesma ação **dentro** do permitido. Teste da integração.
5. Renderer não lê/edita FS nem a allowlist direto — só via IPC tipado; a checagem roda no main.
6. **Nada de FS real é barrado nesta fatia** (enforcement é MVP-003): a allowlist é fonte de verdade + checagem consultável, não aplicada a operação real.
7. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (categorias Regras + Banco).

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Allowlist padrão de fábrica:** **só o diretório gerido pelo app** (sob `userData`); tudo fora é opt-in explícito do usuário (postura conservadora dos requisitos). — decidido.
2. **Semântica de matching e granularidade** (cravado pelo Cowork, não-fork): matching **recursivo** + **canonicalização anti-traversal/symlink**; **read/write tratados juntos** nesta fatia (granularidade read-only vs read-write → MVP-003, quando há FS real a gatear). — aplicado.
