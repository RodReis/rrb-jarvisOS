# MVP-015 — Observabilidade Operacional

- Status: **design e seis SPECs aprovados pelo PI** em 2026-08-29; implementação depende da fila e de issues ainda não criadas.
- GitHub: épico e issues ainda não criados.
- Depende de: MVP-014 concluído.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## Tese

Dar ao PI uma visão local, correlacionada e verificável de runs, PRs, deploys, falhas, saúde, custos e quotas, sem transformar observabilidade em outro orquestrador nem copiar logs brutos dos provedores.

## Fatias

| Ordem | Fatia | SPEC | Estado |
|---:|---|---|---|
| 1 | Núcleo de eventos, outbox e projeções | `spec-observabilidade-01-eventos-outbox-projecoes.md` | aprovada-pi |
| 2 | Reconciliação, saúde, custos e quotas | `spec-observabilidade-02-reconciliacao-saude-custos-quotas.md` | aprovada-pi |
| 3 | Alertas e notificações | `spec-observabilidade-03-alertas-notificacoes.md` | aprovada-pi |
| 4 | Consultas, retenção, rollups e CLI | `spec-observabilidade-04-consultas-retencao-cli.md` | aprovada-pi |
| 5 | Console operacional | `spec-observabilidade-05-console-operacional.md` | aprovada-pi; gate visual pendente antes da construção |
| 6 | Resiliência, desempenho e prova E2E | `spec-observabilidade-06-resiliencia-desempenho-e2e.md` | aprovada-pi |

## Dentro

- eventos normalizados, outbox, projeções e rebuild;
- reconciliação de GitHub/GHCR/Vercel/Railway/executores;
- saúde, custo, quota, timeline e evidência por projeto;
- alertas determinísticos e central de notificações;
- retenção, rollups, serviço de consulta, CLI e console;
- fault injection, carga e prova E2E.

## Fora

- SaaS adicional de observabilidade;
- APM e tracing da aplicação publicada;
- IA para criar alerta/gate ou detectar anomalia;
- ações de run/deploy/rollback no console;
- portfólio entre projetos;
- scraping de telas de quota;
- e-mail, Slack, Discord ou webhook.

## Done

1. Timeline correlaciona `MVP → SPEC → run → PR → deploy → alerta/evidência`.
2. Estado interno e externo converge após reinício, duplicação, atraso e falha transitória.
3. Custo/quota declara fonte e qualidade, sem inventar USD ou percentual.
4. Alerta é deduplicado, reconhecível, resolvível e não cria gate próprio.
5. UI e CLI consultam o mesmo serviço; renderer não acessa SQLite.
6. O console aprovado funciona com 100 mil eventos dentro dos limites de referência.
7. Falha da observabilidade degrada o painel sem bloquear a pipeline canônica.

## Gate adicional da UI

A M15-F05 só entra em construção depois de anexar e aprovar `DESIGN-SYSTEM.md` e protótipos HTML formais. O mockup de brainstorming não substitui esses artefatos.
