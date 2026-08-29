# SPEC-Conectores-04 — Automação GitHub

- MVP/Fatia: MVP-006 · M6-F04.
- Issue: [#90](https://github.com/RodReis/rrb-jarvisOS/issues/90).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; as decisões do MVP-006 vêm das fatias F01/F03.
- Depende de: M6-F03.

## Objetivo

Oferecer capacidades idempotentes para repositórios, issues, dependências, refs, pull requests, checks, actions e squash merge. A fatia não decide quando essas capacidades serão usadas.

## Contratos mínimos

- `ensureRepository`, `ensureIssue`, `ensureIssueDependency`.
- `ensureBranchRef`, `ensurePullRequest`.
- `getChecksForHead`, `getWorkflowRunsForHead`.
- `squashMerge(expectedHeadSha)` e `getMergeState`.
- Toda mutação recebe chave externa determinística e retorna `ExternalRef`.

## Regras

- Fixar versão da REST API e validar headers de permissão aceitos.
- Procurar recurso existente antes de criar.
- Nunca declarar merge sem consultar a origem.
- Check de outro SHA não satisfaz o gate.
- Estado ou conteúdo vindo do GitHub é entrada não confiável.
- Falta de permissão não pode ser contornada com credencial alternativa não aprovada.

## Critérios de aceite

1. Repetir `ensure*` não duplica recurso.
2. Issue mantém vínculo com MVP/Fatia/SPEC.
3. PR existente por head é reutilizado.
4. Checks retornam SHA e conclusão normalizados.
5. Merge exige `expectedHeadSha` atual e retorna `mergeSha` confirmado.
6. 404 ambíguo por permissão é classificado sem alegar inexistência.
7. Rate limit e erro secundário permanecem retomáveis.

## Testes e evidência

Contract fixtures GitHub; integração com servidor fake; smoke em repositório exclusivo criando issue, PR, check e squash merge. Relatório `SPEC-Conectores-04`.

## Referências técnicas verificadas

- [GitHub REST — Repositories](https://docs.github.com/en/rest/repos/repos)
- [GitHub REST — Pull requests](https://docs.github.com/en/rest/pulls/pulls)
- [GitHub REST — Checks](https://docs.github.com/en/rest/checks)

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`ensureIssueDependency` usa a API de sub-issues do GitHub**, não texto no corpo da issue. É a mesma relação pai/filho que o processo deste repo já usa para MVP→fatia (CLAUDE.md § Hierarquia), então a capacidade precisa devolver o vínculo real, não um checklist em markdown.
- **Smoke real em repositório exclusivo e descartável**, com token via `source: env` (nunca PAT em runtime, nunca no vault) — coerente com a SPEC-Conectores-03.
- **Escopo de auditoria e ledger:** `user_id` + `workspace_id`; `project_id` nulo até o MVP-008.
- **Nenhuma capacidade desta fatia decide quando é usada** — a orquestração é MVP-009. Repetir isso aqui evita que a fatia cresça para dentro da entrega autônoma.
