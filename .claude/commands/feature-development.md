---
description: Executa uma fatia aprovada do rrb-jarvisOS sem romper os gates de produto, Git e evidência.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*), Bash(npm:*)
---

# /feature-development

Use este comando para implementar uma fatia já autorizada. Ele não cria escopo e não substitui a SPEC.

## Entrada obrigatória

- issue da fatia;
- SPEC com estado `aprovada-pi` e revisão aprovada identificável;
- posição vigente em `docs/STATUS.md`;
- base e branch de trabalho;
- relatórios/falhas anteriores relevantes.

Se faltar decisão de produto, pare e pergunte ao PI. Documento auxiliar ou ADR pendente não bloqueia uma implementação já autorizada: implemente o comportamento aprovado e registre a decisão no PR.

## Fluxo

1. Leia `CLAUDE.md`, a SPEC, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/CONVENTION.md` e `docs/TESTING.md` no escopo necessário.
2. Confirme issue, labels, dependências e SHA/base; preserve alterações do usuário.
3. Crie ou use worktree/branch isolado da fatia. Nunca trabalhe diretamente na `main`.
4. Converta os critérios da SPEC em verificações observáveis. Para comportamento crítico, escreva primeiro o teste que falha.
5. Implemente o menor delta coerente; não invente LGPD, consentimento, aceite duplo ou regra fora da SPEC.
6. Rode lint, typecheck, testes pertinentes e smoke/E2E quando a fronteira alterada exigir.
7. Atualize os documentos e a evidência definidos por `docs/TESTING.md`; não edite números gerados à mão.
8. Revise conforme `docs/REVIEW.md`, faça commit/push e abra ou atualize a PR com `refs #N`.
9. Verifique o CI atual. Só faça merge com o gate verde.
10. Após o merge, mova a issue para `proplan:done`. Não feche a issue: o aceite final é do PI.

## Resultado esperado

Informe o SHA entregue, PR, verificações executadas, riscos residuais e documentos atualizados. Não declare sucesso com base em execução antiga ou apenas no código de saída.
