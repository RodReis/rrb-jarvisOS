# M13-F04 Projeções e próximo gate — plano de implementação

> **Para agentes de execução:** executar as etapas em sequência neste branch, conferindo o diff completo antes de cada checkpoint remoto. O protótipo visual é submetido ao PI antes da implementação da interface.

**Objetivo:** expor uma projeção reconciliada e rastreável do DAG de execução, preparar o pacote exato do próximo gate e manter STATUS, histórico e evidências idempotentes sem decidir pelo PI.

**Arquitetura:** reutilizar o inventário reconciliado da M13-F01 como autoridade combinada de roadmap, issue, PR, checks e hashes; enriquecer a vista do quadro com o run local persistido e metadados da branch. Preparar o próximo gate a partir da primeira revisão efetivamente pendente e apresentar a referência exata dos artefatos, divergências, mudanças conhecidas, questões documentadas e recomendação sem gravar aprovação. STATUS segue curto e o histórico longo fica em STATUS-ARQUIVO; projeções repetidas com os mesmos fingerprints não criam novas entradas.

**Stack:** Electron, React, TypeScript, SQLite, IPC tipado, GitHub Connector, Vitest e Playwright-Electron.

---

## Mapa inicial dos arquivos

- `src/main/pipeline/inventario-global.ts`: estado reconciliado de DAG, issues e PRs.
- `src/main/pipeline/inventario-global-service.ts` e `inventario-snapshot-repository.ts`: reconciliação completa e snapshot validado por hashes.
- `src/main/pipeline/quadro-execucao-service.ts` e `src/shared/domain/quadro-execucao.ts`: estado persistido dos runs e projeção usada pela UI.
- `src/shared/contracts/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/preload/index.ts`, `src/main/index.ts`: fronteira IPC e composição.
- `src/renderer/src/app/QuadroDeExecucao.tsx` e `QuadroDeExecucao.test.tsx`: painel a estender após aprovação do protótipo.
- `src/main/pipeline/*spec*` e `tests/e2e/quadro-execucao.e2e.ts`: regressões de projeção, reinício e fluxo vivo.
- `docs/DEVELOPMENT.md`, `docs/STATUS.md`, `docs/STATUS-ARQUIVO.md`: execução interna, quadro resumido e histórico.
- `reports/TESTS.md`: somente gerado a partir dos artefatos brutos da execução oficial.

## Etapas

### 1. Prototipar e obter aceite visual

- [x] Criar protótipo HTML navegável em `docs/design/m13-f04-projecoes-prototipo.html` com três áreas: estado da reconciliação, DAG por estado técnico e pacote do próximo gate.
- [x] Mostrar issue/branch/PR/checks/run, estado de bloqueio ou cancelamento, divergências explícitas e hashes/artefatos da revisão que pede decisão.
- [x] Usar conteúdo marcado como demonstração; não apresentar mock como estado operacional.
- [x] Abrir o protótipo no Codex e obter aceite explícito em 2026-10-08 antes de alterar componentes de interface.

### 2. Fechar o contrato puro de projeção

- [x] Criar testes de domínio para estados do nó, referências externas, checks desconhecidos, branch/run, divergências e construção do pacote do próximo gate.
- [x] Implementar os tipos e projetores em `src/shared/domain/projecoes-execucao.ts`; ordenar por DAG e fingerprint, sem timestamp no hash material.
- [x] Recusar pacote acionável quando a reconciliação estiver incompleta, tiver diagnóstico ou não identificar uma única revisão pendente.

### 3. Compor inventário e evidência local

- [x] Adaptar a projeção GitHub para preservar branch do PR; associar branch ao run somente pelo registro de PR persistido.
- [x] Estender o serviço do quadro para juntar inventário completo, run persistido, estado remoto atual e referência exata da SPEC.
- [x] Reutilizar snapshots já escopados por `user_id`, `workspace_id` e `project_id`, validados por fingerprint/hash; não podar auditoria ou evidência.
- [x] Cobrir conflito de branch/merge e execução incompleta em testes de domínio e serviço.

### 4. Integrar API e interface aprovada

- [x] Adicionar canal IPC tipado de reconciliação explícita e validação no main; renderer não acessa Git, filesystem ou credenciais.
- [x] Implementar o protótipo aprovado em `QuadroDeExecucao`, incluindo estados sem snapshot, divergência, bloqueio e gate pendente.
- [x] Adicionar testes de componente para links, hashes e ausência de aprovação/fechamento automáticos. E2E fica coberto pelo job de fronteira no CI devido à mudança do preload.

### 5. Atualizar documentação e entregar

- [x] Corrigir DEVELOPMENT/STATUS para as entregas remotas atuais e manter o STATUS curto; registrar detalhes no arquivo histórico sem duplicar entradas.
- [x] Executar build, lint, typecheck, formatação e 57 testes focados.
- [x] Revisar diff e registrar regressões de link de issue e fontes reconciliadas.
- [x] Gerar `reports/TESTS.md` e passar o self-check com os três JSONs brutos oficiais da CI #496; Regras 2.994, Banco 2.409 e Tela 806 testes totais.
- [x] Comitar apenas arquivos da entrega, publicar branch e abrir PR #419 com `refs #137`.
- [ ] Confirmar checks e merge na origem, publicar comentário de encerramento e mover #137 para `proplan:done`, mantendo-a aberta para aceite do PI.

## Verificação contra a SPEC

- Idempotência: testes de repetição e chave por fingerprint antes de gravar histórico.
- STATUS curto e índice íntegro: validação do par MVP/Fatia↔SPEC e comparação com o índice canônico.
- Issue aberta após merge: PR/commit usa exclusivamente `refs #137`; rotina de conclusão não fecha issue.
- Gate exato: pacote contém a revisão e os artefatos que aguardam decisão, sem API de aprovação.
- Divergência local/GitHub: snapshot só é publicado após coleta completa e diagnóstico exibido antes de nova projeção.
- Retenção: testes de persistência provam preservação de hashes, auditoria e relatório versionado.
