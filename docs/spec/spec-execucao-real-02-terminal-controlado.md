# SPEC-ExecucaoReal-02 — Terminal controlado (command-runner allowlisted)

- MVP: `docs/mvp/mvp-004-execucao-real.md` (Fatia 02).
- Status: **aprovada-pi** (2026-07-24) — modelo de política de comando, natureza do terminal e fronteira com a F01 resolvidos pelo PI nesta data.
- Dependências: **Fatia 01 entregue** (enforcement fail-closed do Policy Engine + fluxo de aprovação real — o terminal **consome** essa espinha, não a reinventa). MVP-002 entregue (Policy Engine, allowlist de diretórios, `ExecutionRun`). MVP-003 entregue (Design System — o painel mínimo de terminal usa os padrões de execução/logs da SPEC-DS-04b). `AuditEvent`/hash-chain (SPEC-Fundacao-04), logging (SPEC-Fundacao-06).
- Decisões que sustentam esta spec: requisitos § Corte 2 ("terminal controlado dentro do OS Desktop"), RF-016 (OS Desktop: "terminal executará comandos reais, com logs, permissões, working directory, allowlist e bloqueio de comandos perigosos"; "erros de execução devem aparecer no terminal e gerar evento de auditoria"), RF-019, § Ações Possíveis ("executar comando de terminal allowlisted" = médio; "executar comando destrutivo" = alto); ARCHITECTURE § Terminal Executor ("allowlist, cwd permitido, timeout, **sem admin no MVP**") e § Dependências críticas 1 (Policy Engine antes de terminal real); ADR-004; ADR-005.

## Objetivo

Ligar o **terminal controlado no Desktop**: executar **comandos reais** só quando permitidos por uma **allowlist de comandos** (conceito novo — o MVP-002 só tem allowlist de *diretórios*) e com **cwd dentro da allowlist de diretórios**, validados pelo Policy Engine em enforcement, **sem elevação/admin**, com **timeout obrigatório e kill**, **auditados** (antes/depois) e **logados**. O modelo é **command-runner** (submete comando → valida → executa → devolve saída/erro/exit code), **não** um PTY interativo — cada comando é isolado e gateável, decisão do PI 2026-07-24.

O terminal **reusa o guardrail e o fluxo de aprovação da Fatia 01** — mesma espinha (Policy Engine + `AuditEvent` antes/depois + aprovação humana), entry point diferente (comando em vez de filesystem).

## Escopo

### Dentro

- **Allowlist de comandos (conceito novo):** conjunto de comandos/binários permitidos (nome canônico do executável), persistido no SQLite, escopado por `user_id`/`workspace_id` (CONVENTION §2), editável pelo admin (single-user). **Default de fábrica: vazia** — nenhum comando roda até o usuário permitir explicitamente, espelhando a postura conservadora da allowlist de diretórios (SPEC-Execucao-03). Editar a allowlist de comandos é, ela mesma, ação **alto risco** (RF-019) — classificada pelo Policy Engine e auditada.
- **Duas barreiras, casando "só permitidos" + "bloqueio de perigosos"** (RF-016 pede as duas):
  1. **Allowlist de binário (1ª barreira):** o comando submetido é parseado; extrai-se o binário/comando-raiz e compara-se com a allowlist. Binário **fora** da allowlist ⇒ `block` (não executa).
  2. **Denylist de padrões destrutivos (2ª barreira):** um binário allowlisted ainda pode ser usado destrutivamente. Padrões perigosos (ex.: `rm -rf`, `del`, `format`, `mkfs`, `dd`, `shutdown`, fork bomb, redireção que sobrescreve, `--force` destrutivo) vêm de uma **denylist semeada** (`src/shared/policies/`, dado versionado, não hardcode). Comando que casa a denylist ⇒ **alto risco** ⇒ `requires-approval` (mesmo com binário allowlisted). "Executar comando destrutivo no terminal" é alto risco nos requisitos.
- **cwd obrigatório dentro da allowlist de diretórios:** o working directory do comando passa por `isPathAllowed` (SPEC-Execucao-03, canonicalização + matching recursivo). cwd fora ⇒ `block`.
- **Sem elevação/admin** (ARCHITECTURE § Terminal Executor): nada de `sudo`/`runas`/token de elevação. Tentativa de elevação ⇒ `block`.
- **Command-runner (não PTY):** submete um comando → Policy Engine `evaluate` (contexto: binário, cwd, `workspace`, `sensitivity`) → se `allow`, executa via `child_process` no main com **cwd explícito, env controlado, timeout obrigatório e kill em estouro** → captura `stdout`/`stderr`/`exitCode`/duração → devolve ao renderer. **Sem sessão de shell persistente** — cada comando é isolado; não há estado de shell carregado entre comandos.
- **Aprovação reusada da F01:** comando `requires-approval` (destrutivo/alto) **pausa** e abre `ApprovalRequest` pelo **mesmo fluxo da Fatia 01** (fila/painel de aprovações do DS). Aprovado, executa; negado, não executa. Sem reinventar o fluxo.
- **Auditoria (RF-016 + RF-019):** cada execução registra **comando, diretório (cwd), saída, erro, duração e exit code** como `AuditEvent` **antes e depois**, encadeado (ADR-004); saída redigida de segredo (ADR-005). **Erro de execução aparece no terminal E gera `AuditEvent`** (exigência literal do RF-016).
- **Logging (ADR-005)** com `correlationId` casando as entradas da execução.
- **UI mínima de terminal** consumindo o DS (padrões de execução/logs da SPEC-DS-04b; RF-016 "abrir terminal/log controlado por permissão"): campo de comando + área de saída (stdout/stderr) + estado (rodando/concluído/falhou/aguardando aprovação). Operável por teclado, foco visível. É **consumidora** do DS, não parte dele.
- **Fronteira de processo:** o executor roda no **main**; o renderer submete o comando e vê a saída **via IPC tipado**, nunca toca `child_process`/Node/segredo (ARCHITECTURE § Fronteiras 1).

### Fora

- **PTY interativo / shell persistente** (stdin em streaming, estado de shell vivo entre comandos) — decisão explícita do PI (command-runner). Um shell interativo não permite gatear cada comando dentro da sessão. Futuro, se um caso concreto exigir.
- **File Explorer e System Monitor** (o resto do OS Desktop, RF-016) — futuro.
- **Comando que toca rede / chama provider / API externa** — Corte 3 (não há adapter nem vault). A allowlist pode conter binários que fazem rede, mas o guardrail de custo/credencial de providers é Corte 3.
- **Elevação/admin** — fora do MVP (ARCHITECTURE).
- **Rodar comando por scheduler (cron/evento/webhook)** — Corte 4; aqui só submissão manual.
- **Granularidade de argumento por allowlist** (permitir `git status` mas não `git push`) além da denylist de padrões — a 1ª barreira é por binário; refino por subcomando fica para depois se preciso.

## Critérios de aceite

1. **Binário fora da allowlist ⇒ barrado:** comando cujo executável não está na allowlist é `block`, auditado, **não executa**. Teste comprova pelo efeito.
2. **Comando permitido executa de verdade:** binário allowlisted + cwd dentro da allowlist ⇒ executa via `child_process`, captura `stdout`/`stderr`/`exitCode`/duração; `AuditEvent` **antes e depois** com comando, cwd, saída redigida, erro, duração, exit code; `verifyChain` passa.
3. **cwd fora da allowlist ⇒ block**, auditado. Teste.
4. **Destrutivo pausa:** comando que casa a denylist (mesmo com binário allowlisted) ⇒ `requires-approval`; pausa pelo fluxo da F01; aprovado executa, negado não. Teste dos dois desfechos.
5. **Timeout obrigatório:** comando que excede o timeout é **morto (kill)**, estado `falhou`, auditado. Teste.
6. **Sem elevação:** tentativa de `sudo`/`runas`/elevação ⇒ `block`. Teste.
7. **Editar a allowlist de comandos** gera `AuditEvent` encadeado e é classificada alto risco. Teste.
8. **Erro de execução** aparece na saída do terminal **e** gera `AuditEvent` (RF-016). Teste.
9. **Renderer não executa:** o executor roda no main; o renderer submete/lê via IPC tipado; sem `child_process`/Node/segredo no renderer; saída redigida de segredo.
10. **UI mínima de terminal** operável por teclado, foco visível, estados nunca só por cor, só com componentes públicos do DS (Testing Library).
11. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Fronteira F01×F02:** executar comando/processo real é **exclusivo desta fatia** (a F01 é só filesystem). — decidido.
2. **Modelo de política de comando:** **allowlist de comandos** (postura conservadora, "só roda o que está na lista") + cwd na allowlist de diretórios; desconhecido = barrado. — decidido.
3. **Natureza do terminal:** **command-runner** (submete → valida → executa → devolve saída), **não** PTY interativo. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Default da allowlist de comandos = vazia** — nada roda até o usuário permitir, espelhando o default conservador da allowlist de diretórios (SPEC-Execucao-03).
- **Duas barreiras:** allowlist de binário (barra desconhecido) + denylist semeada de padrões destrutivos (eleva a `requires-approval`) — é como se satisfaz simultaneamente "só executa comandos permitidos" e "bloqueio de comandos perigosos" do RF-016.
- **Reusa o fluxo de aprovação da F01** — sem reinventar; comando destrutivo cai na mesma fila de `ApprovalRequest`.
- **`child_process` isolado por comando**, env controlado, cwd explícito, sem shell persistente — coerente com o modelo command-runner e com a gateabilidade comando-a-comando.
- **F02 entrega o executor + um painel de terminal mínimo** (consumidor do DS). Se o PI preferir adiar a UI e entregar só o executor + IPC nesta fatia, é um veto pontual que não muda o núcleo de segurança.

## Ordem e dependências

MVP-002 entregue → **Fatia 01** (enforcement de FS + fluxo de aprovação) → **Fatia 02** (terminal, consome o enforcement e o fluxo de aprovação da F01). A F02 **não** começa antes da F01 entregue — o terminal depende da espinha de aprovação que a F01 constrói.
