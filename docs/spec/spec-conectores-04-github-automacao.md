# SPEC-Conectores-04 — Automação GitHub

- MVP/Fatia: MVP-006 · M6-F04.
- Status: **revisão documental; implementação não autorizada**.
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
