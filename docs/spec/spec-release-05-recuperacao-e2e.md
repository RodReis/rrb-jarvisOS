# SPEC-Release-05 — Compensação, retorno à V2 e E2E

- MVP/Fatia: MVP-014 · M14-F05 — **fecha o MVP-014**.
- Issue: [#154](https://github.com/RodReis/rrb-jarvisOS/issues/154).
- Status: **aprovada-pi** (2026-08-29); issue em `proplan:backlog`; implementação depende da fila.
- Depende de: M14-F04 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Objetivo

Completar a resiliência da release, provar recuperação de efeitos parciais e fechar a jornada com identidade, evidência e correção automática pela V2 sem modificar Produção diretamente.

## Stack e estrutura

- `ReleaseCorrectionDispatcher`, `ReleaseEvidenceWriter` e política completa de compensação/cancelamento.
- Git/GitHub para branch, PR, tag, GitHub Release e vínculos.
- Vercel/Railway/GHCR reais somente em projeto de prova limitado.
- Playwright para jornada funcional externa.

Resultado de compensação:

```ts
interface CompensationResult {
  releaseId: string
  failedStep: string
  action: string
  state: 'confirmed' | 'ambiguous' | 'failed'
  externalRef?: string
}
```

## Dentro

- Até três retries com backoff para falha `transient`.
- Reconciliação obrigatória para resultado `unknown/ambiguous` antes de repetir.
- Retomada depois de crash em cada fronteira intenção/efeito/confirmação.
- Compensação independente de frontend e backend; PostgreSQL nunca é restaurado automaticamente.
- Estado `degraded` quando não há retorno completo a estado conhecido.
- Cancelamento seguro antes de Staging, durante Staging, durante Produção e após promoção.
- Falha de código/teste/health/migration retorna à V2 em nova branch/PR, mesma SPEC e relatórios anteriores.
- Sem novo aceite quando a correção não altera escopo.
- `release_id`, manifesto, changelog e release notes.
- Tag padrão `release-YYYYMMDD-HHMM-<shortsha>` após estabilização; SemVer só com política explícita.
- GitHub Release vinculada a SHA, digest, deployments, migrations, gates, SPECs/issues e release anterior.
- Proteção de artefatos ainda necessários para rollback.
- Jornada E2E real de Preview → merge → Staging → Produção → estabilização → rollback/correção.

## Fora

- Incidente operacional contínuo, SLO, métricas históricas ou detecção de regressão do MVP-015.
- Restore automático do banco.
- Correção fora da SPEC ou aprovação automática de escopo novo.
- Provedor adicional.

## Regras

1. Falha transitória usa no máximo três tentativas totais por passo.
2. Resposta incerta consulta o provedor pelo identificador externo antes de repetir.
3. Cancelar nunca mata cegamente efeito remoto nem apaga evidência.
4. Depois da promoção, cancelar equivale a rollback para `release_id` conhecido.
5. Correção da V2 usa nova branch/PR e nunca edita Produção.
6. Relatório anterior entra no contexto; achado resolvido não reaparece como novo.
7. Tag/GitHub Release só existem para Produção estabilizada.
8. Documento com falha não reverte aplicação saudável; cria pendência de evidência incompleta.

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

- Fault injection em cada passo e entre intenção/efeito/confirmação.
- Fixtures de timeout após sucesso remoto, IDs obsoletos, auth expirada e compensação parcial.
- Reinício local repetido até convergência, provando ausência de duplicação.
- E2E real limitado com orçamento, projeto e nomes exclusivos.
- Playwright nas três URLs e após rollback.
- Contrafactual: tag antes da estabilização, restore automático e correção direta em Produção devem falhar.

## Critérios de aceite

1. Timeout depois de sucesso remoto reconcilia e não duplica deployment.
2. Crash em cada fronteira retoma do último passo confirmado.
3. Três retries esgotados param com causa, evidência e ação mínima.
4. Compensação parcial produz `degraded` e pausa somente o projeto afetado.
5. Cancelamento em cada fase termina em estado conhecido ou reconciliável.
6. Falha de código abre correção na V2 com mesma SPEC e histórico, sem novo aceite de produto.
7. Produção estabilizada gera manifesto, tag, GitHub Release e changelog verificáveis.
8. Release falha não recebe tag nem GitHub Release.
9. Rollback usa `release_id` e restaura frontend/backend conhecidos sem restore automático do banco.
10. Jornada E2E prova Preview, Staging, Produção, estabilização, falha, compensação e limpeza.
11. Nenhum segredo, dado de Produção em Preview ou instrução de conteúdo externo atravessa o boundary.

## Limites

- **Sempre:** reconciliar, preservar evidência e ligar correção à revisão exata.
- **Consultar a SPEC:** mudança de política de retry, cancelamento, tag ou retorno à V2.
- **Nunca:** corrigir Produção diretamente, apagar release confirmada, restaurar banco automaticamente ou ampliar escopo.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
