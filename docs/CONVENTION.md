# CONVENTION.md — rrb-jarvisOS

Dois contratos vivem aqui: (1) a convenção de processo que o board ProPlan lê nas GitHub Issues deste repo; (2) o contrato de dados das entidades do produto. Mudar qualquer um dos dois é mudança estrutural → ler `docs/DECISIONS.md` antes.

## 1. Contrato de processo (labels `proplan:*`)

O board é uma **projeção** das GitHub Issues: `issue → coluna` por **label + open/closed**. Nenhum estado mora fora das issues.

### Labels

| Label | Coluna | Estado da issue | Significado |
|---|---|---|---|
| `proplan:mvp` | — (épico) | open até o PI fechar | Container de fatias; corpo = checklist |
| `proplan:backlog` | Backlog | open | Spec `aprovada-pi`, aguardando fila |
| `proplan:todo` | A Fazer | open | Próxima fatia; Code se atribuiu |
| `proplan:doing` | Em Andamento | open | Em implementação (WIP = 1) |
| `proplan:done` | Feito | open | PR **mergeado**, aguardando aceite do PI |
| `proplan:finalizado` | Finalizado | closed | Aceito pelo PI (só o PI fecha) |
| `proplan:descartado` | Descartado | closed | Descartada deliberadamente pelo PI |

### Regras invariantes

- Uma issue de fatia tem **exatamente um** label `proplan:*` de coluna por vez; a transição troca o label, nunca acumula.
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
- `AuditEvent` é imutável, append-only: `id`, `user_id`, `workspace_id?`, `type`, `payload`, `created_at`.
- Desenvolvimento usa dados fake/seeds — nunca dados reais como fixture.
- Contratos TypeScript vivem em `src/shared/domain/` e `src/shared/contracts/`; a UI consome contrato, nunca objeto solto.
