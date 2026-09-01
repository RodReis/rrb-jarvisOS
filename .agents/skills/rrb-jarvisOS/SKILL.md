---
name: rrb-jarvisos-conventions
description: Use when planning, implementing, reviewing, testing, documenting, or delivering changes in rrb-jarvisOS. Routes work through the repository's canonical product, architecture, issue, Git, and evidence contracts.
---

# rrb-jarvisOS — convenções do repositório

Esta skill é um índice operacional. Ela não substitui os documentos canônicos e não transforma inferências de histórico Git em regras.

## Fontes de verdade

Leia apenas o necessário para a tarefa, nesta ordem:

1. `CLAUDE.md` — papéis, ciclo de vida, Git e regras técnicas gerais.
2. `docs/DEVELOPMENT.md` — ordem de execução e andamento interno.
3. `docs/STATUS.md` — fila e índice Fatia ↔ SPEC.
4. `docs/spec/` — contrato da fatia; implementação exige estado `aprovada-pi`.
5. `docs/ARCHITECTURE.md` e `docs/DECISIONS.md` — desenho e decisões estruturais.
6. `docs/CONVENTION.md` — domínio e projeção das issues.
7. `docs/TESTING.md` — evidência e classificação dos testes.
8. `docs/REVIEW.md` — contrato obrigatório em revisão.

Se os documentos divergirem, pare no ponto material, mostre a divergência e peça decisão ao PI. Não invente escopo.

## Modos de trabalho

### Planejamento

- Faça perguntas até eliminar decisões abertas.
- Registre a revisão exata aprovada pelo PI.
- Não implemente código durante o planejamento.
- Uma fatia só entra no Backlog após a SPEC aprovada.

### Implementação

- Confirme SPEC aprovada, issue correta e base atual antes de editar.
- Trabalhe em branch/worktree isolado; nunca faça commit direto na `main`.
- Preserve mudanças do usuário e mantenha o delta cirúrgico.
- Atualize a documentação exigida na mesma entrega.
- Use `refs #N`; nunca use palavras que fechem automaticamente a issue.

### Revisão

- Leia `docs/REVIEW.md` antes de classificar achados.
- Revise o delta contra a base correta e as dependências diretas.
- Use relatórios anteriores para não repetir falhas já resolvidas.
- Não invente LGPD, consentimento, aceite duplo ou regra de produto.
- Um `PASS` vale somente para o SHA efetivamente revisado.

## Contratos técnicos essenciais

- O renderer não acessa Node, segredos ou comandos diretamente; use preload e IPC mínimo e tipado.
- O runtime local é a fonte de verdade operacional; serviços cloud são integrações/espelhos conforme os ADRs.
- Entidades persistidas carregam o escopo definido no contrato de domínio.
- O Policy Engine falha fechado para ação desconhecida.
- Mudança estrutural exige leitura de `docs/DECISIONS.md`; ADR registra a decisão, mas sua ausência não paralisa uma correção já autorizada.

Não derive padrão universal de nomes, imports, exports ou tratamento de erro a partir de poucos commits. Inspecione o módulo afetado e siga o padrão local comprovado.

## Testes e evidência

Escolha o nível pelo comportamento alterado:

- `*.spec.ts`: regra de negócio/unidade.
- `*.int-spec.ts`: integração e persistência real.
- `*.test.tsx`: componente React.
- `tests/e2e/*.e2e.ts`: fronteira Electron e fluxo vivo quando aplicável.

Piso de validação da entrega:

```text
npm run lint
npm run typecheck
npm test
```

Siga `docs/TESTING.md` para relatório, guarda anti-drift e E2E condicional. Não edite números de `reports/TESTS.md` manualmente e não declare CI verde sem consultar o estado atual.

## Uso econômico de contexto

- Comece por busca dirigida e abra somente os arquivos relacionados ao fluxo.
- Se `graphify-out/` existir e o contrato vigente mandar usá-lo, use o grafo para localizar; confirme toda afirmação no código-fonte.
- Não faça varredura integral nem carregue relatórios inteiros sem uma razão registrada.
- Amplie o contexto progressivamente quando a evidência inicial for insuficiente.

## Entrega Git/GitHub

1. Confirme o diff e a ausência de segredo.
2. Rode as verificações pertinentes.
3. Faça commit em pt-BR e push do branch.
4. Abra/atualize PR com `refs #N`.
5. Aguarde CI e gate verdes.
6. Faça merge conforme a política do repositório.
7. Mova a issue para `proplan:done`; somente o PI fecha e aplica `proplan:finalizado`.

O merge integra a entrega; não representa aceite do PI.
