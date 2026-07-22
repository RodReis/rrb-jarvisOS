# CONVENTION.md — rrb-jarvisOS

Três contratos vivem aqui: (1) a convenção de processo que o board ProPlan lê nas GitHub Issues deste repo; (2) o contrato de dados das entidades do produto; (3) o contrato de logging (observabilidade). Mudar qualquer um é mudança estrutural → ler `docs/DECISIONS.md` antes.

## 1. Contrato de processo (labels `proplan:*`)

O board é uma **projeção** das GitHub Issues: `issue → coluna` por **label + open/closed**. Nenhum estado mora fora das issues.

### Labels

| Label | Coluna | Estado da issue | Significado |
|---|---|---|---|
| `proplan:mvp` | — (épico) | open até o PI fechar | Container de fatias; corpo = checklist |
| `proplan:backlog` | Backlog | open | Spec `aprovada-pi`, aguardando fila |
| `proplan:next` | — (marcador, fica no card do topo do Backlog) | open | Cabeça da fila do `docs/STATUS.md` — o próximo card a puxar. Não é coluna |
| `proplan:todo` | A Fazer | open | Próxima fatia; Code se atribuiu |
| `proplan:doing` | Em Andamento | open | Em implementação (WIP = 1) |
| `proplan:done` | Feito | open | PR **mergeado**, aguardando aceite do PI |
| `proplan:finalizado` | Finalizado | closed | Aceito pelo PI (só o PI fecha) |
| `proplan:descartado` | Descartado | closed | Descartada deliberadamente pelo PI |

### Regras invariantes

- Uma issue de fatia tem **exatamente um** label `proplan:*` de coluna por vez; a transição troca o label, nunca acumula.
- `proplan:next` é **marcador, não coluna**: coexiste com `proplan:backlog` (fica no card do topo da fila) e **não** viola a regra acima. No máximo **um** `proplan:next` entre as issues abertas — zero quando a fila esvazia.
- A **ordem da fila** é decisão do PI e vive **só** no `docs/STATUS.md`. `proplan:next` é a projeção da **cabeça** dessa fila no board, nunca uma segunda fonte da ordem completa. O **Cowork** marca `next` na cabeça ao montar/reordenar o Backlog; o **Code**, ao puxar o card `next` para A Fazer, **avança o marcador** para o próximo item da fila do STATUS.md — ação mecânica que segue a ordem, não decide prioridade.
- **`closes #N` é proibido** em PR/commit — forjaria o aceite. Sempre `refs #N`.
- Issue nunca é deletada; descarte = `closed` + `proplan:descartado`.
- Mover para Finalizado/Descartado posta comentário de carimbo na issue.
- Fatia só vira issue quando a spec correspondente em `docs/spec/` está `aprovada-pi`, com link para o arquivo da spec no corpo e assignee = PI.
- `card = fatia`, nunca passo de spec. Passos vivem em `docs/DEVELOPMENT.md`.

### Specs

- Local: `docs/spec/spec-<mvp>-<nn>-<slug>.md`.
- Cabeçalho obrigatório: MVP pai, status (`rascunho` | `aprovada-pi`), dependências.
- Corpo obrigatório: Objetivo, Escopo (Dentro/Fora), Critérios de aceite, Perguntas abertas ao PI.
- Spec só muda para `aprovada-pi` com **todas** as perguntas abertas resolvidas — a resolução é registrada na própria spec (e em ADR quando for estrutural).

### MVPs

- Local: `docs/mvp/mvp-<nnn>-<slug>.md`. Espelha a issue-épico: tese, checklist de fatias, fora de escopo, critérios de done.

## 2. Contrato de dados das entidades

Toda entidade persistida carrega os campos de escopo:

| Campo | Obrigatório | Valores / regra |
|---|---|---|
| `user_id` | Sim | Dono do dado; isolamento multiusuário |
| `workspace_id` | Quando o dado pertence a um espaço | `noa` \| `jarvis` — **enum fechado**. `Desenvolvimento` e `Agentic OS` **não são** workspaces |
| `organization_id` | Quando houver contexto organizacional | Somente JARVIS OS |
| `visibility` | Quando aplicável | `private` \| `shared` \| `organization` \| `system` — NOA usa `private` por padrão |
| `sensitivity` | Quando aplicável | `public` \| `internal` \| `personal` \| `financial` \| `health` \| `credential` \| `secret` |

Regras:

- JARVIS OS nunca acessa `personal`, `financial` ou `health` sem aprovação explícita do usuário.
- Compartilhamento NOA ↔ JARVIS OS é bloqueado no MVP.
- Índices derivados (textual, vetorial, grafo) herdam autorização/RLS da fonte; revogar a fonte remove dos índices.
- `AuditEvent` é imutável, append-only e **à prova de adulteração** (ADR-004): `id`, `user_id`, `workspace_id?`, `type`, `payload`, `created_at`, mais os campos de integridade `seq` (monotônico por `user_id`), `prev_hash` e `hash` (HMAC-SHA-256 do conteúdo canônico + `prev_hash`, chave no `safeStorage`/DPAPI). Imutabilidade garantida por trigger SQLite (bloqueia UPDATE/DELETE) + repositório sem alteração; integridade verificável por `verifyChain()`.
- Desenvolvimento usa dados fake/seeds — nunca dados reais como fixture.
- Contratos TypeScript vivem em `src/shared/domain/` e `src/shared/contracts/`; a UI consome contrato, nunca objeto solto.

## 3. Contrato de logging (observabilidade)

Governado pelo **ADR-005** e detalhado na `SPEC-Fundacao-06`. Vale para NOA e JARVIS OS.

- **Todo método relevante loga.** Fluxo normal → `info`; degradação recuperável → `warn`; falha → `error`. Silêncio não é opção em caminho de auth, storage, IPC, integração, AI ou agente.
- **Mensagem (`msg`) em pt-BR**, curta e descritiva, **sem stack trace e sem segredo**. O detalhe técnico vai em `ctx` (stack em `ctx.stack`).
- **Registro estruturado (JSON)** com no mínimo: `ts`, `level`, `category`, `direction?` (`in`|`out`), `workspace` (`noa`|`jarvis`|`sistema`), `msg`, `ctx`, `correlationId`, `pid`, `source` (`main`|`renderer`).
- **Categorias:** `integracao`, `ai`, `agent`, `db`, `auth`, `ipc`, `ui`, `sistema`. Fluxos externos e de AI/agente logam **entrada e saída** (`direction`), casados por `correlationId`.
- **Redaction é obrigatória.** `token`/`password`/`secret`/`authorization`/`accessToken`/`refreshToken`/`apiKey` e campos `sensitivity: credential|secret` **nunca** são gravados; `personal|financial|health` mascarados (JARVIS não loga esses sem aprovação — §2). Todo log é `sensitivity: internal` no mínimo.
- **Escritor único:** o renderer captura via `electron-log` e encaminha por IPC; o **main** grava via `winston` (nunca o renderer em disco). Retenção por nível (info 3d/warn 7d/error 10d), zipada, em `userData/logs/`.
- **Log ≠ AuditEvent.** Log é observabilidade efêmera (rotaciona/apaga); `AuditEvent` é evidência permanente e à prova de adulteração (§2, ADR-004). Um evento pode gerar os dois; um nunca substitui o outro. Auditoria não vai para arquivo de log; log não vai para o SQLite de auditoria.
