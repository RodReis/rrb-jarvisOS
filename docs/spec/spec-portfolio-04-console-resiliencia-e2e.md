# SPEC-Portfolio-04 — Console de portfólio e prova integrada

- MVP/Fatia: MVP-024 · M24-F04.
- Issue: [#221](https://github.com/RodReis/rrb-jarvisOS/issues/221); épico [#213](https://github.com/RodReis/rrb-jarvisOS/issues/213).
- Status: **rascunho-completo** (2026-08-31). Redação concluída; aceite exato de MVP/SPEC antes da construção ainda não presumido.
- Design: `docs/superpowers/specs/2026-08-31-mvp-024-portfolio-design.md`.
- Depende de: [#219](https://github.com/RodReis/rrb-jarvisOS/issues/219), [#220](https://github.com/RodReis/rrb-jarvisOS/issues/220).
- Rastreabilidade: P-FR01–P-FR04/P-NFR01/P-NFR02; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada por este documento.

## Objetivo e fronteira

Expor visão multiprojeto, motivos, controles e consumo pelos serviços F01–F03; provar consistência e degradação sem duplicar módulos canônicos.

## Contrato e ownership

Lista/detalhe/fila global/consumo usam um snapshot composto com fonte e idade. Comando conserva operationId e revisão esperada; estado aplicado só após recibo do scheduler. Controles desabilitados explicam falta de elegibilidade, sem criar aprovação adicional. Links de run/release/aprendizado abrem fluxos canônicos sem efeito automático. CLI/serviço e UI usam os mesmos resultados, variando somente apresentação. Tela não é um novo centro de aprovações.

## Fluxo

Quatro projetos (três elegíveis, um incompleto) → ver motivos/próxima fatia → mudar prioridade → pausar novas admissões de um projeto → conferir run ativo preservado → retomar → conciliar custo/quota compartilhada → abrir evidência canônica. Injetar conflito de revisão, transporte incerto, atraso de uma fonte e reinício do renderer/main. Mesma intenção produz um recibo e nenhuma troca de executor/snapshot. Falha da UI deixa scheduler operando conforme seu contrato.

## Falhas, limites e retomada

Antes de construção, anexos formais DESIGN-SYSTEM.md e HTML do PI cobrem desktop/largura reduzida, teclado/foco, partial/unknown/offline/conflict e reconciliação de comando. Nada presume aceite dos screenshots anteriores. Fixture local100projetos/10milruns, paginação25/100 da F01; cinco warm-ups e30medições por consulta, p95≤500ms no ambiente registrado; painel útil≤2s quando serviços locais saudáveis. Registrar memória/backlog e fontesfakes, não esconder custo fora da medição. Prova Electron usa serviços, ponte e UI reais; efeitos externos são simulados sem gasto.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/portfolio.ts`, `src/shared/contracts/portfolio.ts`, `src/main/portfolio/`, renderer do módulo e `tests/e2e/`. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Lista, detalhe, fila e consumo compartilham serviços e fontes canônicas.
2. Quatro projetos evidenciam prontidão, pendência e motivos sem score opaco.
3. Prioridade/pausa/retomada usam recibos e preservam fairness e run adquirido.
4. Desconhecido, parcial, offline e vazio têm mensagens/ações diferentes.
5. Conflito e resultado incerto não exibem sucesso nem repetem intenção antiga.
6. Troca de projeto/reconexão descarta resposta tardia e refaz snapshot coerente.
7. Quota compartilhada e custo conciliado mantêm unidades, período e proveniência.
8. Links de detalhe não iniciam run, deploy, aprendizado ou aprovação.
9. DS/HTML formal precede construção e prova teclado, foco e largura reduzida.
10. Crash/timeout/evento duplicado preserva uma intenção, fonte e fila canônicas.
11. Fixture/ambiente medidos sustentam paginação e metas sem memória/fila ilimitadas.
12. Relatório liga cada critério a testes/provas, declara not_run de smoke ausente e não fecha issue por planejamento.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Playwright/Electron prova a jornada real da UI contra o design anexado. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima são proposta completa desta revisão. Revisão/aceite de entrada do PI e anexos visuais quando aplicáveis permanecem requisitos existentes; não bloqueiam publicar este planejamento nem autorizam código por inferência.
