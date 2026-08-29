# SPEC-Observabilidade-02 — Reconciliação, saúde, custos e quotas

- MVP/Fatia: MVP-015 · M15-F02.
- Issue: ainda não criada.
- Status: **aprovada-pi** (2026-08-29); implementação depende da fila e de issue ainda não criada.
- Depende de: M15-F01 aprovada e entregue; adapters canônicos dos MVPs 010–014.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## Objetivo

Reconciliar o estado externo atual com o histórico local e produzir snapshots tipados de saúde, custo e quota sem scraping, valor inventado ou sobrescrita de observação mais nova.

## Stack e estrutura

- `src/shared/domain/observability.ts`: `ProviderObservation`, `ProviderHealthSnapshot` e `UsageSnapshot`.
- `src/main/observability/reconciliation/`: scheduler, cursor, backoff e coordenador.
- `src/main/observability/adapters/`: ports de leitura sobre GitHub, GHCR, Vercel, Railway e executores existentes.
- `src/main/observability/reconciliation-repository.ts`: cursors, tentativas e snapshots.
- Fixtures versionadas em `src/main/observability/adapters/__fixtures__/`.

```ts
type UsageSourceQuality = 'authoritative' | 'reported' | 'estimated' | 'unknown'

interface UsageSnapshot {
  readonly provider: string
  readonly profileFingerprint: string
  readonly mode: 'subscription_limited' | 'subscription_credits' | 'api' | 'local'
  readonly windowId: string
  readonly used?: number
  readonly remaining?: number
  readonly resetAt?: string
  readonly observedAt: string
  readonly quality: UsageSourceQuality
}
```

## Dentro

- Reconciliação GitHub/PR/checks, GHCR/digest, Vercel/deployment, Railway/backend/PostgreSQL e executores.
- Cadência de 30 s em Preview/Release ativa e 5 min em ociosidade.
- Disparo ao iniciar/retomar app e comando idempotente “Atualizar”.
- Cursor por fonte quando suportado; polling integral limitado quando não houver cursor.
- Backoff exponencial com jitter, orçamento de tentativas e estado `unknown/degraded`.
- Snapshots de saúde com motivo, último sucesso e idade da evidência.
- Projeção dos `CostEvent`/`BudgetLedger` existentes; nenhuma segunda contabilidade.
- Codex por fonte estruturada `account/rateLimits/read` quando suportada pelo adapter aprovado.
- Claude Code como `quota_unknown` enquanto não houver fonte estruturada suportada.
- Separação de janelas de 5 h, semanal, créditos ou outras identificadas pela origem.
- Códigos de falha normalizados; payload externo bruto não é persistido.

## Fora

- Scraping/OCR/parsing de tela ou HTML de uso.
- Alterar `BudgetPolicy`, elegibilidade, rota ou teto monetário.
- Somar janelas distintas ou converter assinatura em USD.
- Criar alertas e notificações; a F03 consome os snapshots.
- Webhook público ou novo provedor.

## Regras

1. Estado externo atual vence projeção local somente com observação tipada mais nova.
2. Falha de consulta nunca produz `healthy` nem renova artificialmente `observedAt`.
3. Duas janelas sem sucesso geram condição de atraso para a F03.
4. Resposta parcial preserva campos conhecidos e marca desconhecidos; não preenche por estimativa silenciosa.
5. Perfil externo usa alias/fingerprint, nunca token ou diretório de autenticação.
6. Custo vem do ledger; quota vem da fonte declarada; qualidade acompanha cada snapshot.
7. Fallback de transporte precisa ser explícito e evidenciado; browser não é fallback.
8. Evento atrasado entra no histórico, mas não substitui snapshot atual.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Fake clock prova cadências, retomada e transição ativo/ocioso.
- Contract fixtures de sucesso, auth, 429, timeout, resposta parcial, cursor vencido e schema incompatível.
- Teste de ordem com observações antigas chegando após novas.
- Codex com/sem `account/rateLimits/read`; Claude sem fonte estruturada permanece desconhecido.
- Contrafactual: parser de screenshot/percentual inventado e soma de janelas devem falhar.

## Critérios de aceite

1. Evento interno aparece imediatamente, sem esperar polling externo.
2. Projeto ativo consulta no máximo pela cadência de 30 s; ocioso reduz para 5 min.
3. Reinício/retomada reconcilia sem duplicar observações.
4. Provedor inacessível fica `unknown/degraded` com idade da última evidência e ação mínima.
5. Observação atrasada não regride deployment, release, health ou quota atual.
6. Codex expõe janelas/reset/créditos somente quando a fonte estruturada os fornece.
7. Claude Code sem fonte suportada mostra `quota_unknown`, nunca zero ou 100% disponível.
8. Custo do painel coincide com o ledger para o mesmo filtro.
9. Janelas incompatíveis continuam separadas e identificáveis.
10. Nenhum fixture, evento, log ou relatório contém credencial ou payload externo integral.

## Limites

- **Sempre:** declarar origem/qualidade, preservar idade da evidência e aplicar backoff.
- **Consultar a SPEC:** nova fonte, janela, transporte ou regra de saúde.
- **Nunca:** raspar tela, inventar valor, mudar gate ou persistir resposta bruta.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
