# SPEC-ExecucaoReal-01 — Execução real de filesystem allowlisted (enforcement + aprovação)

- MVP: `docs/mvp/mvp-004-execucao-real.md` (Fatia 01) — **headline do MVP-004**.
- Status: **aprovada-pi** (2026-07-24) — as quatro decisões estruturais (fronteira F01×F02, escopo de aprovação) resolvidas pelo PI nesta data.
- Dependências: MVP-002 entregue (Policy Engine em modo report — SPEC-Execucao-02; allowlist de diretórios consultável — SPEC-Execucao-03; motor de execução simulado com `ExecutionRun` — SPEC-Execucao-05). MVP-003 entregue (Design System — os padrões de risco/aprovação da SPEC-DS-04b são UI por props, consumidos pela UI mínima de aprovação). Usa `AuditEvent`/hash-chain (SPEC-Fundacao-04) e logging (SPEC-Fundacao-06).
- Decisões que sustentam esta spec: requisitos § Corte 2 ("execução simulada **e execução real allowlisted** com logs e auditoria"), § "Ações Possíveis e Política de Aprovação", RF-019 (segurança/permissões; "toda execução com filesystem auditada"); ARCHITECTURE § Fronteiras de segurança / § Resiliência / § Dependências críticas (Policy Engine antes de terminal real); `CLAUDE.md` (Policy Engine **fail-closed**); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

Ligar a **execução real de filesystem com guardrails**. O motor do MVP-002 sai do modo simulado/report e passa a **tocar recurso real** — mas **só operações de filesystem** (ler, gravar, apagar, mover, sobrescrever arquivo), **exclusivamente** dentro da allowlist de diretórios e sob o Policy Engine em **enforcement fail-closed**. O que o MVP-002 deixou como "report" (Policy Engine classifica mas não barra; allowlist checa mas não gateia) passa aqui a **barrar de verdade**. Toda operação real gera `AuditEvent` **antes e depois** (ADR-004) e é logada (ADR-005). Ações classificadas `requires-approval` **pausam** o `ExecutionRun` e esperam **aprovação humana real** (com UI mínima) — não auto-continuam como na simulação.

**Executar comando/processo real e o terminal ficam FORA desta fatia** — são a **Fatia 02** (decisão do PI 2026-07-24). Esta fatia não faz `spawn` de processo; toca só o filesystem.

## Escopo

### Dentro

- **Enforcement liga (fim do modo report):** o Policy Engine (SPEC-Execucao-02) passa de classificar-e-registrar para **barrar**. A `Decision.outcome` agora tem efeito:
  - `allow` → a operação segue (auditada);
  - `requires-approval` → o run **pausa** e abre `ApprovalRequest` (ver fluxo de aprovação);
  - `block` → a operação é **barrada** e o run trata como etapa falha (fail-closed). Ação **não reconhecida** pela taxonomia continua classificada `bloqueado` (SPEC-02) e agora **efetivamente barra** — o fail-closed do `CLAUDE.md` vira real.
- **Gating real da allowlist de FS (SPEC-Execucao-03):** `isPathAllowed(path)` deixa de ser só consultável e passa a **gatear a operação real**. A checagem canoniza o path (resolve `..`, `.`, symlink) e faz matching recursivo, como já especificado na Fatia 03.
- **Operações de filesystem reais nesta fatia:** ler arquivo, gravar/criar arquivo, apagar, mover, sobrescrever — dentro dos limites do mapa de enforcement abaixo. **Nenhum `spawn`/`exec` de processo** (isso é F02).
- **Mapa tier → enforcement** (derivado do requisitos § Ações Possíveis; cravado pelo Cowork, PI pode vetar):

  | Operação | Onde | Tier | Enforcement |
  |---|---|---|---|
  | Ler arquivo | **dentro** da allowlist | baixo/médio | `allow`, auditado |
  | Ler arquivo | **fora** da allowlist | médio | `requires-approval` — a aprovação concede a exceção pontual; aprovado, executa e audita; negado, barra |
  | Gravar/criar arquivo | **dentro** da allowlist | médio | `allow`, auditado |
  | Gravar/criar arquivo | **fora** da allowlist | (não reconhecida) | `block` (fail-closed) — não há aprovação para escrever fora do permitido |
  | Apagar / mover / sobrescrever | qualquer lugar | **alto** | `requires-approval` **sempre** (operação destrutiva, requisitos § Alto risco) |
  | Alterar `.env` / vault / secrets / tokens | qualquer lugar | **alto** | `requires-approval` **sempre** (requisitos § Alto risco) |

- **Fluxo de aprovação humana real** (o que o MVP-002 auto-continuava, agora pausa de verdade):
  - Etapa/operação `requires-approval` cria uma `ApprovalRequest` (entidade do modelo, requisitos § Modelo de Informação), escopada por `user_id`/`workspace_id`, ligada ao `ExecutionRun` e à etapa.
  - O `ExecutionRun` entra em **`aguardando aprovação`** e **pausa** (não auto-continua — revoga o comportamento da SPEC-Execucao-05 crit. 5, que era explícito para o modo simulado).
  - **UI mínima de aprovação:** uma fila/painel de aprovações pendentes, construída **só com componentes públicos do DS** (os padrões de risco/aprovação da SPEC-DS-04b, que recebem estado por props). Operável por teclado, foco visível.
  - **Aprovar** → o run **retoma** a etapa e a executa de verdade. **Negar** → a etapa vira `falhou`; o run segue a política de retry/cancelamento já existente.
  - `AuditEvent` encadeado na **criação** da `ApprovalRequest` e na **resolução** (aprovado | negado), com quem, quando e a decisão.
- **Auditoria antes/depois de toda operação real de FS** (RF-019: "toda execução com filesystem... deve ser auditada"; ARCHITECTURE § Fronteiras 3). O par antes/depois entra na hash-chain; `verifyChain` passa.
- **Logging (ADR-005)** com o `correlationId` do run casando as entradas; **erro de execução** é logado e auditado.
- **Resiliência (ARCHITECTURE § Resiliência):** operação real tem tratamento de falha; falha de etapa mantém o `retry state` do `ExecutionRun` (SPEC-Execucao-05). (Timeout/kill de processo é carga da F02.)
- **Fronteira de processo:** tudo roda no **main/runtime**; o renderer **dispara o run e resolve aprovações via IPC tipado**, nunca toca FS/Node/segredo (ARCHITECTURE § Fronteiras 1). Saída de arquivo devolvida ao renderer é redigida de segredo (ADR-005).

### Fora

- **Executar comando/processo real e o terminal** — **Fatia 02** (decisão do PI 2026-07-24). Esta fatia não faz `spawn`.
- **Rede, providers de IA, chamada a API externa** — Corte 3 (MVP-providers). "Fazer chamada para API externa" e "conectar novo provider" são médio risco, mas não há adapter nem vault aqui.
- **BudgetPolicy** — Corte 3 (só mede gasto com providers, que não existem ainda; ADR-001 §1).
- **Scheduler (cron/evento/webhook)** — Corte 4; aqui só gatilho manual (herda a SPEC-Execucao-05).
- **Granularidade read-only vs read-write por entrada de diretório** (flag por diretório na allowlist) — **fora**: nesta fatia o risco vem do **tipo de operação** (gravar = médio, destrutivo = alto), não de flag por diretório (ver Decisões cravadas). Reabrível se um caso concreto exigir.
- **Permissões por papel** (owner/operator/agent-service-account — RF-019) — entra com multiusuário real.
- **Postura default de baixo risco liberado-vs-opt-in além do que o mapa acima define** — o mapa já crava a postura desta fatia; ajustes finos ficam para quando houver mais ações reais.

## Critérios de aceite

1. **Enforcement fail-closed liga:** operação sobre path **fora** da allowlist é barrada de verdade — gravar fora ⇒ `block` (não executa, arquivo não é criado); ler fora ⇒ `requires-approval`. Ação **não reconhecida** pela taxonomia é barrada. Teste comprova cada caminho pelo **efeito** (arquivo não criado, leitura não retornada sem aprovação).
2. **Operação permitida executa de verdade:** gravar arquivo **dentro** da allowlist cria o arquivo; ler arquivo dentro retorna o conteúdo. `AuditEvent` **antes e depois** de cada operação; `verifyChain` passa.
3. **Destrutivo sempre pausa:** apagar/mover/sobrescrever (mesmo dentro da allowlist) e alterar `.env`/secrets ⇒ `requires-approval`; o run entra em `aguardando aprovação` e **pausa**. Teste comprova que sem aprovação o efeito destrutivo **não** ocorre.
4. **Aprovação real retoma/nega:** aprovar uma `ApprovalRequest` retoma o run e executa a operação; negar leva a etapa a `falhou` sem efeito. `AuditEvent` na criação e na resolução da `ApprovalRequest`. Teste dos dois desfechos.
5. **UI mínima de aprovação** operável por teclado, foco visível, estados nunca só por cor, construída só com componentes públicos do DS (Testing Library).
6. **Renderer não toca FS:** o motor roda no main; o renderer dispara/aprova via IPC tipado; nenhum acesso a Node/FS/segredo no renderer; saída redigida de segredo.
7. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (categorias Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Fronteira F01×F02:** F01 torna real **apenas o filesystem** (ler/gravar/apagar/mover/sobrescrever dentro da allowlist, gateado). **Todo "executar comando/processo real" é exclusivo da Fatia 02** (terminal). — decidido.
2. **Escopo do fluxo de aprovação:** a **F01 entrega o enforcement E o fluxo de aprovação real** (pausa/retoma em `requires-approval`) **com UI mínima** reusando o DS — coerente com o critério do Corte 2 "ações sensíveis ficam bloqueadas por aprovação humana". — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Mapa tier → enforcement** (tabela acima), derivado do requisitos § Ações Possíveis: ler fora = `requires-approval`; gravar fora = `block` (fail-closed, não reconhecido); destrutivo e secrets = alto, `requires-approval` sempre.
- **Granularidade read/write combinada** por diretório (herda a SPEC-Execucao-03 crit. 2): um diretório permitido vale leitura e escrita não-destrutiva; o risco maior vem do **tipo de operação**, não de flag por diretório. Simplicidade primeiro.
- **`ApprovalRequest` sem expiração automática** no MVP: fica pendente até o usuário resolver. Expiração/timeout de aprovação é decisão futura.
- **Mesma espinha de guardrail** que a F02 (Policy Engine + allowlist + `AuditEvent` antes/depois); esta fatia é o entry point de **filesystem**, a F02 é o de **comando**.
- **Revoga o auto-continue da SPEC-Execucao-05 (crit. 5)** para o modo real: `aguardando aprovação` agora **pausa de verdade**. É emenda deliberada — o auto-continue era explícito para o modo simulado.
