# SPEC-Portfolio-01 — Catálogo e prontidão do portfólio

- MVP/Fatia: MVP-024 · M24-F01.
- Issue: [#218](https://github.com/RodReis/rrb-jarvisOS/issues/218); épico [#213](https://github.com/RodReis/rrb-jarvisOS/issues/213).
- Status: **rascunho-completo** (2026-08-31). Redação concluída; aceite exato de MVP/SPEC antes da construção ainda não presumido.
- Design: `docs/superpowers/specs/2026-08-31-mvp-024-portfolio-design.md`.
- Depende de: [#132](https://github.com/RodReis/rrb-jarvisOS/issues/132), [#159](https://github.com/RodReis/rrb-jarvisOS/issues/159).
- Rastreabilidade: P-FR01/P-NFR02; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada por este documento.

## Objetivo e fronteira

Compor a visão de projetos, planejamento e fila usando registros e serviços canônicos. Não criar scheduler, gate, registro paralelo de projetos ou dependência de Blueprints.

## Contrato e ownership

PortfolioQueryService combina catálogo M8, snapshots do scheduler M12 e consultas M15. Identidade userId/workspaceId/projectId vem da sessão/registro, nunca do nome/path. Snapshot contém id, observedAt, versões/idade por fonte, cobertura e razões; não finge transação global. Readiness é projeção: planning_incomplete/awaiting_pi/ready/running/paused/waiting_dependency/unavailable. Ready exige fontes obrigatórias atuais e aprovação exata segundo os donos. Falta de fonte resulta em desconhecido, não gate satisfeito.

## Fluxo

Resolver escopo da sessão → consultar catálogo paginado → juntar snapshots locais pelo ID → derivar estado de apresentação com motivos canônicos → retornar página e referências aos consoles originais. Página padrão25/máximo100, ordenação estável e ID no desempate, cursor fixando filtro/ordem/revisão do índice. Cursor vencido exige reiniciar consulta. Filtrar/ocultar na vista não registra, arquiva ou remove o projeto. Eventos alimentam índices reconstruíveis, não novas fontes de verdade.

## Falhas, limites e retomada

Composição com prazo de2s retorna parcial tipada; cache máximo100 snapshots/16MiB por sessão e TTL30s, sempre com idade. Janela ativa pode atualizar no máximo a cada5s; janela fechada não faz polling. Atualizar deduplica consulta em curso e não aumenta cadência do M15/provedores. Fonte lenta afeta apenas campos dependentes. Rebuild paginado publica geração íntegra; eventos fora de ordem não regridem revisão. Falha do painel não paralisa scheduler, e cache nunca autoriza dispatch. Resposta de projeto/sessão anterior é descartada.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/portfolio.ts`, `src/shared/contracts/portfolio.ts`, `src/main/portfolio/` e testes junto aos módulos. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Projetos só aparecem no escopo user/workspace corrente com identidade canônica.
2. Readiness conserva motivos dos donos, sem criar gate novo.
3. Fontes ausentes/stale não viram ready nem zero de pendências.
4. Snapshot composto informa idade, revisão e cobertura por fonte.
5. Paginação25/100 e cursor fixado impedem mistura silenciosa de revisões.
6. Ordenação/desempate reproduzem a mesma sequência para mesmas entradas.
7. Prazo de2s produz parcial tipada sem mascarar o campo indisponível.
8. Cache30s/100snapshots/16MiB é limitado e nunca usado como autorização.
9. Refresh é deduplicado, limitado a5s ativo e não faz polling com janela fechada.
10. Rebuild e eventos duplicados/fora de ordem mantêm geração coerente.
11. Filtrar/ocultar e falha do painel não alteram cadastro, fila ou execuções.
12. Fixture com três projetos elegíveis e um incompleto prova estados, fontes e degradação isolada.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Fakes de fronteiras externas não substituem a implementação real do núcleo da fatia. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima são proposta completa desta revisão. Revisão/aceite de entrada do PI e anexos visuais quando aplicáveis permanecem requisitos existentes; não bloqueiam publicar este planejamento nem autorizam código por inferência.
