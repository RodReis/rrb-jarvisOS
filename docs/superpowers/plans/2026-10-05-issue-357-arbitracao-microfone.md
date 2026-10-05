# Plano de implementação — issue #357

**Objetivo:** um fluxo de captura para wake word e push-to-talk, com estado único,
precedência explícita, barge-in, supressão do áudio reproduzido e auditoria.

**Base:** SPEC-Escuta-02 aprovada pelo PI; proposta visual do estado `escutando`
aprovada em 2026-10-05. O protótipo HTML existente define a identidade do Command
Center, mas o estado passivo novo usa arcos externos e texto próprio.

1. Contrato e máquina de estados no main, com testes de transição, recusa e auditoria.
2. Serviço de captura compartilhado no renderer, com teste de um único `getUserMedia`.
3. Precedência do push-to-talk, cancelamento sinalizado e timeout comum.
4. Referência PCM da fala, supressão de auto-disparo e barge-in que encerra a fonte.
5. Projeção única para mascote, legenda e indicador, nos dois temas e movimento reduzido.
6. Lint, typecheck, testes, prova visual, relatório e revisão do diff.
7. Commit, push, PR `refs #357`, CI e merge; comentário de encerramento antes de `done`.
