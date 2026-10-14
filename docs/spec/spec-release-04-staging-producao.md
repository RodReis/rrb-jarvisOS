# SPEC-Release-04 — Staging e Produção automática

- MVP/Fatia: MVP-014 · M14-F04.
- Issue: [#153](https://github.com/RodReis/rrb-jarvisOS/issues/153).
- Status: **aprovada-pi** (2026-08-29); issue #153 em `proplan:doing` desde 2026-10-14; decisões de implementação em § Decisões de implementação.
- Depende de: M14-F03 aprovada e entregue (PR [#428](https://github.com/RodReis/rrb-jarvisOS/pull/428)).
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

## Decisões de implementação

Quatro pontos que a SPEC deixava em aberto foram levados ao PI antes de codificar (2026-10-14); em todos o PI adotou a recomendação do Code. Opções recusadas ficam registradas.

1. **Backup de Produção = backup nativo do volume via API do Railway.** A CLI do Railway 5.27 não tem comando de backup (`railway volume` só lista, cria, anexa e navega); o adapter chama a API GraphQL, confirma pelo id do backup e grava a referência. O dado de Produção não sai do provedor, e a referência que o restore operacional exige já existe. Sem backup confirmado, a migration não roda (critério 4). *Recusadas:* `pg_dump` pelo app via TCP proxy (copia dado de Produção para o disco local; cifrar e reter viraria escopo) e "backup como pré-requisito declarado" (não gera backup, contrariando o texto da SPEC). *Custo declarado:* depende do plano Pro do Railway e de validar o schema da API num projeto de prova — sem o projeto, o smoke fica `not_run`.
2. **Mesmo deployment de frontend, backend resolvido em runtime por hostname.** Como Staging e Produção apontam para backends diferentes e a regra 2 proíbe rebuild, a URL do backend não pode estar gravada no build. O frontend lê uma configuração de runtime resolvida pelo domínio em que foi servido; o contrato vai no perfil do projeto e o verificador confere, em cada ambiente, que o frontend fala só com o backend daquele ambiente. *Recusadas:* rewrite/proxy `/api` por ambiente customizado da Vercel (depende de plano pago e de configuração fora do deployment) e rebuild por ambiente (viola a regra 2 e o critério 2).
3. **Falha na estabilização: uma falha isolada reinicia a janela; a segunda compensa.** No máximo um reinício por release; depois, compensa frontend e backend. O limite de reinícios é configurável por projeto junto com a janela e o intervalo. Retry com backoff completo continua na F05. *Recusadas:* "qualquer falha compensa" (um timeout isolado reverteria uma release saudável) e "reinicia até um teto de tempo" (Produção fica instável por mais tempo antes de reverter).
4. **"Divergência proibida" = mesmo valor em Staging e Produção para chaves de isolamento.** O perfil do projeto lista `isolatedKeys` (por exemplo, URL e credencial do PostgreSQL); fingerprint idêntico entre os dois ambientes numa dessas chaves bloqueia antes do efeito, porque significaria banco ou credencial compartilhados. Divergência em qualquer outra chave continua permitida. *Recusadas:* só "ausente" bloqueia (não protege contra Staging apontando para o banco de Produção) e "conjunto de chaves diferente" (já é coberto por "ausente").

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; decisões de implementação acima aprovadas pelo PI em 2026-10-14.
