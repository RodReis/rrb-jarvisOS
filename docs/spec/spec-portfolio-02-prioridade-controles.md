# SPEC-Portfolio-02 — Prioridade e controles canônicos

- MVP/Fatia: MVP-024 · M24-F02.
- Issue: [#219](https://github.com/RodReis/rrb-jarvisOS/issues/219); épico [#213](https://github.com/RodReis/rrb-jarvisOS/issues/213).
- Status: **rascunho-completo** (2026-08-31). Redação concluída; aceite exato de MVP/SPEC antes da construção ainda não presumido.
- Design: `docs/superpowers/specs/2026-08-31-mvp-024-portfolio-design.md`.
- Depende de: [#218](https://github.com/RodReis/rrb-jarvisOS/issues/218), [#128](https://github.com/RodReis/rrb-jarvisOS/issues/128).
- Rastreabilidade: P-FR02/P-FR04/P-NFR01; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada por este documento.

## Objetivo e fronteira

Oferecer ao PI prioridade e pausa/retomada de admissões pelo scheduler existente. Não mudar capacidade, BudgetPolicy, aprovações, provider, next ou cancelar run por efeito da pausa.

## Contrato e ownership

PortfolioCommandFacade aceita setPriority/pauseAdmissions/resumeAdmissions com operationId, chave idempotente, projeto, revisão esperada, autoria e argumentos já aceitos pelo scheduler. Não inventar escala própria. Mesmo ID/payload retorna recibo; payload divergente conflita. O scheduler revalida identidade, estado vivo, autoridade e revisão na confirmação. A projeção verde não concede direito de agir. Se faltar recibo/idempotência no dono, a fatia o adiciona no scheduler com seus testes; nunca retry cego na fachada.

## Fluxo

PI inspeciona estado/motivos → envia intenção → accepted/forwarding → applied/rejected/reconciling → atualiza projeção pela confirmação. Prioridade só afeta admissões futuras e respeita fairness, dependências e precedência explícita M12. PauseAdmissions não mata ou retira lease ativo da contagem. ResumeAdmissions remove apenas pausa; não força início nem ignora quota. Run adquirido conserva executor e PolicySnapshot. Reordenar não aprova SPEC nem altera gate.

## Falhas, limites e retomada

Timeout após envio reconcilia recibo pelo mesmo ID antes de repetir. Operação incerta permanece visível; não mostrar sucesso otimista. Conflito de revisão devolve estado atual e exige nova intenção explícita, não replay automático obsoleto. Cancelar intenção antes de envio é permitido; depois consulta o dono, sem fingir rollback. Reinício e UI fechada não perdem comando entregue. Comandos não consultam rede diretamente; todas as decisões de aquisição continuam no scheduler.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/portfolio.ts`, `src/shared/contracts/portfolio.ts`, `src/main/portfolio/` e testes junto aos módulos. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Só três comandos declarados e argumentos canônicos são aceitos.
2. Identidade/autoria/revisão são revalidadas pelo scheduler, não apenas pela UI.
3. ID e payload iguais retornam recibo original sem novo efeito.
4. ID igual e payload divergente conflitam antes de aplicar.
5. Estado concorrente gera conflito e não sobrescreve revisão mais nova.
6. Prioridade afeta apenas futura aquisição, conservando fairness/dependências.
7. Pausa impede nova admissão sem matar run ou liberar lease ativo.
8. Retomada não ignora gate, capacidade, quota ou precedência.
9. Timeout pós-envio reconcilia mesmo ID e mantém estado incerto visível.
10. Reinício/janela fechada preserva recibo e não repete comando aplicado.
11. Nenhum controle muda next, Approval, budget, provider ou PolicySnapshot ativo.
12. Prova multiprojeto confirma uma aplicação por intenção e nenhuma segunda fila.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Fakes de fronteiras externas não substituem a implementação real do núcleo da fatia. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima são proposta completa desta revisão. Revisão/aceite de entrada do PI e anexos visuais quando aplicáveis permanecem requisitos existentes; não bloqueiam publicar este planejamento nem autorizam código por inferência.
