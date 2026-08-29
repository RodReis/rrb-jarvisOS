# SPEC-Release-04 — Staging e Produção automática

- MVP/Fatia: MVP-014 · M14-F04.
- Issue: ainda não criada.
- Status: **aprovada-pi** (2026-08-29); implementação depende da fila e de issue ainda não criada.
- Depende de: M14-F03 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Objetivo

Promover automaticamente um merge confirmado para Staging e Produção usando os mesmos artefatos imutáveis, com migrations forward-only, gates técnicos e compensação mínima obrigatória, sem segundo aceite do PI.

## Stack e estrutura

- `ReleaseOrchestrator`, `ReleaseGateEngine`, `ConfigurationReferenceValidator` e `StabilizationMonitor`.
- Vercel frontend; Railway backend; Railway PostgreSQL separado; GHCR por digest.
- Staging e Produção persistentes, isolados entre si.
- Diário de passos e adapters definidos nas fatias anteriores.

Plano de promoção tipado:

```ts
interface PromotionPlan {
  releaseId: string
  sourceSha: string
  backendDigest: string
  frontendDeploymentId: string
  environments: readonly ['staging', 'production']
}
```

## Dentro

- Evento de merge cria/atualiza candidato ainda em `queued`.
- Consolidação de SHAs pendentes antes de Staging; depois disso o candidato é imutável.
- Build único do backend e deployment imutável do frontend para o SHA final.
- Staging: validar config, migrar seu PostgreSQL, implantar backend/frontend e rodar health, smoke e E2E essencial.
- Produção: validar config, gerar backup, migrar PostgreSQL, implantar o mesmo digest e promover o mesmo frontend.
- Ordem por ambiente: `prepared → database_migrated → backend_healthy → frontend_promoted → smoke_passed`.
- Estabilização padrão de cinco minutos, configurável por projeto, com health a cada trinta segundos.
- Compensação mínima de aplicação: voltar frontend/backend para deployments conhecidos se promoção/health/smoke falhar.
- Projetos diferentes em paralelo; uma promoção ativa por projeto/ambiente.
- Estado técnico `completed` somente depois da estabilização.

## Fora

- Retry completo, crash recovery avançado, cancelamento por fase, retorno automático à V2, manifesto/tag/GitHub Release e jornada E2E de falhas — pertencem à F05.
- Restore automático do banco.
- SemVer inferido pela IA.
- Métricas históricas e regressão do MVP-015.

## Regras

1. Staging aprovado tecnicamente é obrigatório antes de Produção.
2. Não há rebuild entre ambientes.
3. Produção é automática depois dos gates; fechamento de issue não bloqueia.
4. Migration é forward-only/expand-contract; mudança destrutiva ocupa releases separadas.
5. Versão anterior da aplicação permanece compatível com schema expandido durante rollback.
6. Falha de migration não troca tráfego.
7. Falha posterior compensa aplicações, nunca restaura banco automaticamente.
8. Documentação incompleta gera pendência, não rollback de release saudável.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
```

## Estratégia de testes

- Unitários de plano, ordem, gates, consolidação e janela de estabilização.
- Contract tests dos adapters com deployment IDs e estados reais normalizados.
- Integração com Staging fake e Production fake usando o mesmo digest/ID.
- Smoke real explícito em projeto de prova; nunca no projeto pessoal do PI.
- Contrafactuais: rebuild entre ambientes, promoção antes de Staging e segundo aceite devem falhar.

## Critérios de aceite

1. Merge elegível chega a Staging sem intervenção adicional.
2. Staging e Produção registram o mesmo `backend_digest` e `frontend_deployment_id`.
3. Config ausente ou divergência proibida bloqueia antes do efeito.
4. Backup confirmado precede migration de Produção.
5. Migration/health/smoke falho impede `completed`.
6. Falha de aplicação restaura deployments anteriores conhecidos; banco permanece forward-only.
7. Cinco minutos saudáveis produzem `completed`; uma falha reinicia a contagem ou compensa.
8. Segunda release do mesmo projeto aguarda; projeto diferente continua.
9. Nenhum segundo aceite do PI é solicitado.
10. Nenhuma tag/release nasce nesta fatia antes da F05 completar a evidência.

## Limites

- **Sempre:** promover artefato imutável, fazer backup antes de migration e manter compensação mínima.
- **Consultar a SPEC:** mudar ordem, janela, gates ou compatibilidade de schema.
- **Nunca:** rebuild, restore automático, deploy concorrente no mesmo ambiente ou alteração direta por agente.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
