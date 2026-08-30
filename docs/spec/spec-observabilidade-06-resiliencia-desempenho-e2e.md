# SPEC-Observabilidade-06 — Resiliência, desempenho e prova E2E

- MVP/Fatia: MVP-015 · M15-F06 — **fecha o MVP-015**.
- Issue: [#161](https://github.com/RodReis/rrb-jarvisOS/issues/161).
- Status: **aprovada-pi** (2026-08-29); issue em `proplan:backlog`; implementação depende da fila.
- Depende de: M15-F05 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## Objetivo

Provar que observabilidade converge sob falhas, mantém desempenho local no volume de referência e explica uma jornada completa sem bloquear ou alterar os runtimes proprietários.

## Stack e estrutura

- Vitest para unidade/integração/fault injection.
- Playwright/Electron em `tests/e2e/observability.e2e.ts`.
- Fixtures determinísticas em `tests/fixtures/observability/`.
- Gerador de carga em `tests/performance/observability-load.ts` sem rede externa.
- Prova externa opt-in em projeto exclusivo, com IDs/recursos próprios.
- Evidência em `docs/test-reports/SPEC-Observabilidade-06.md` e `reports/TESTS.md`.

## Dentro

- Crash/restart em outbox, projeção, reconciliação, notificação, rollup e compactação.
- Eventos duplicados, atrasados, fora de ordem e com clock skew.
- Provider com timeout, auth, 429, resposta parcial, schema incompatível e estado oscilante.
- Disco/projeção indisponível depois do commit canônico.
- Delta IPC perdido/duplicado/fora de ordem e renderer reiniciado.
- Notificação nativa indisponível.
- Fixture de 100 mil eventos e 10 mil ocorrências.
- Medição `p95` das consultas principais, tempo de console útil e latência de evento interno.
- Jornada run → PR → Preview → Release → alerta → reconhecimento → resolução → evidência.
- Smoke externo opt-in de reconciliação em projeto de prova; nunca Produção.
- Relatório com ambiente, warm-up, versões, contagens, percentis e hashes.

## Fora

- Benchmark de provedor/Internet como gate estável de CI.
- Carga com dados reais, segredo ou projeto de Produção.
- APM/tracing da aplicação publicada.
- Teste que altera política, executa rollback real ou compra crédito.
- Otimização não justificada por medição.

## Regras

1. Suíte comum usa fixtures e não gasta quota/recursos externos.
2. Smoke externo é explícito; ausência de credencial resulta `not_run`, nunca `pass`.
3. Métrica registra máquina/CI, versão, dataset e warm-up.
4. Consulta principal deve obter `p95 ≤ 500 ms` com a fixture aprovada.
5. Console útil deve aparecer em até 2 s e evento interno em até 1 s no ambiente de referência.
6. Falha do observador não pode chamar ou alterar operação proprietária.
7. Toda falha injetada termina convergida ou `degraded` com causa e ação mínima.
8. Relatórios anteriores entram no contexto para não repetir achado resolvido.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
npm run test:report
npm run test:report:check
```

## Estratégia de testes

- Matriz de crash em cada fronteira intenção/commit/claim/projeção/confirmação.
- Property tests com permutação e duplicação de eventos.
- Fake clock para cadências, idade, reabertura e retenção.
- Playwright com preload/IPC/main/renderer reais e adapters fake.
- Load test determinístico repetido com mediana/p95 e regressão reportada.
- Contrafactual: permitir regressão de estado, apagar marco, inventar quota ou bloquear release precisa falhar.

## Critérios de aceite

1. Crash em cada fronteira retoma sem evento/projeção duplicados.
2. Evento atrasado completa timeline e não regride estado atual.
3. Provider oscilante fica stale/unknown/degraded corretamente e converge ao voltar.
4. Perda de delta força snapshot; renderer não mantém visão parcial como atual.
5. Falha de notificação não perde alerta; falha de compactação não remove amostra sem rollup.
6. Payload proibido é rejeitado antes de persistir em todos os caminhos testados.
7. Dataset de referência satisfaz `p95 ≤ 500 ms`, console ≤ 2 s e evento interno ≤ 1 s no ambiente registrado.
8. Jornada E2E permite localizar causa, impacto e evidência e administrar alerta pelo console.
9. UI e CLI retornam resultados equivalentes para o mesmo filtro/versão.
10. Observabilidade indisponível não dispara retry, bloqueio, deploy, rollback ou compensação.
11. Smoke externo, quando executado, usa projeto de prova e registra IDs/resultado sem segredo.
12. `reports/TESTS.md` e relatório da SPEC refletem resultados de máquina e diferenciam `pass`, `fail` e `not_run`.

## Limites

- **Sempre:** testar falhas, registrar ambiente e preservar separação de autoridade.
- **Consultar a SPEC:** mudar dataset, limite de desempenho, smoke ou matriz E2E.
- **Nunca:** usar Produção, maquiar `not_run`, inventar número ou otimizar sem evidência.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
