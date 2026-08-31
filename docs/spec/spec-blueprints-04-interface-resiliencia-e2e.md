# SPEC-Blueprints-04 — Interface e prova integrada de Blueprints

- MVP/Fatia: MVP-023 · M23-F04.
- Issue: [#217](https://github.com/RodReis/rrb-jarvisOS/issues/217); épico [#212](https://github.com/RodReis/rrb-jarvisOS/issues/212).
- Status: **rascunho-completo** (2026-08-31). Redação concluída; aceite exato de MVP/SPEC antes da construção ainda não presumido.
- Design: `docs/superpowers/specs/2026-08-31-mvp-023-blueprints-design.md`.
- Depende de: [#216](https://github.com/RodReis/rrb-jarvisOS/issues/216).
- Rastreabilidade: B-FR01–B-FR05/B-NFR01/B-NFR02; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada por este documento.

## Objetivo e fronteira

Entregar catálogo, detalhe, assistente e comparação ligados aos serviços F01–F03 e provar a jornada. Não criar regras novas, marketplace ou estilo visual presumido.

## Contrato e ownership

Renderer acessa DTOs tipados e comandos dos mesmos serviços; consultas paginadas padrão 25, máximo 100, cursor ligado a filtro/ordem/revisão. Comando devolve operationId, estado e referências; sucesso exige confirmação canônica. Cliques duplicados usam mesma identidade. Troca de projeto descarta respostas atrasadas. Conteúdo de template é texto de dado; preview usa o runner de protótipos existente, não execução privilegiada no renderer. CLI/serviço permite uso básico sem UI; fechar janela não interrompe efeito confirmado.

## Fluxo

Catálogo vazio/importar → detalhe com propósito/revisão/compatibilidade → selecionar revisão → variáveis/plano → wizard → PRD → seletor de DS/HTML → comparação/evolução opcional → revisão dos gates existentes. UI explica template versus projeto, draft versus aprovado, cópia candidata versus anexo formal. Estados loading/empty/incompatível/conflict/offline/parcial/cancelled/failed têm causa e ação válida; indisponibilidade não mostra coleção vazia como prova de ausência.

## Falhas, limites e retomada

Antes da construção visual, PI anexa DESIGN-SYSTEM.md e protótipos HTML formais cobrindo as jornadas, teclado/foco e largura reduzida. Screenshots históricos e este texto não são aceite visual. Smoke Electron/Playwright usa main/preload/renderer e serviços reais, filesystem/SQLite temporários; fake somente provider/efeitos externos. Crash em cada fronteira, operação repetida, arquivo concorrente e catálogo indisponível fazem parte da prova. Fixture de 100 revisões de até 200 arquivos; 30 amostras após 5 warm-ups, p95 de listagem ≤500 ms no ambiente registrado; medir bytes/idade/backlog, sem fingir latência de IA local.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/blueprints.ts`, `src/shared/contracts/blueprints.ts`, `src/main/blueprints/`, renderer do módulo e `tests/e2e/`. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Catálogo e detalhe exibem propósito, revisão, origem e compatibilidade.
2. Paginação 25/100 não carrega todo acervo e rejeita cursor incompatível.
3. Jornada completa usa F01–F03 reais e serviços M8, sem dados simulados na UI de produção.
4. A UI distingue draft, aprovação e candidato/anexo formal em todas as etapas.
5. Estados vazio, indisponível, conflito e resultado parcial têm tratamentos distintos.
6. Comando repetido e perda de transporte reconciliam o mesmo operationId.
7. Troca de projeto/janela descarta resposta obsoleta sem duplicar efeito.
8. DS/HTML formais precedem construção; teclado, foco e largura reduzida são provados.
9. Sentinela impede template de executar comandos, ler paths arbitrários ou conceder aprovação.
10. Crash, edição concorrente, cancelamento e catálogo ausente preservam instâncias e trabalho local.
11. Fixture/ambiente/amostras sustentam p95 ≤500 ms sem consultas ou memória ilimitadas.
12. Relatório vincula os 12 critérios à evidência real, separando pass/fail/not_run e sem declarar entrega por planejamento.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Playwright/Electron prova a jornada real da UI contra o design anexado. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima são proposta completa desta revisão. Revisão/aceite de entrada do PI e anexos visuais quando aplicáveis permanecem requisitos existentes; não bloqueiam publicar este planejamento nem autorizam código por inferência.
