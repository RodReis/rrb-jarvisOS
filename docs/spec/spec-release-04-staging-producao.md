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

Decisões técnicas dentro do escopo, tomadas pelo Code (sem alterar ordem, janela, gates ou compatibilidade de schema):

5. **O serviço dirige o `ReleaseOrchestrator` da F01.** `PromotionEffects` implementa o `ReleasePort`; idempotência, lease com fencing, lane por projeto/ambiente e "ambíguo nunca repete" continuam sendo da F01. Cinco portas (`promotion-ports.ts`): build, backend, banco, frontend e verificação; os adapters são CLI-first em `src/main/release/adapters/`.
6. **Onde cada coisa acontece no diário.** `prepared` de Staging valida a configuração dos **dois** ambientes (antes de qualquer efeito), faz o build único do backend (a preparação da F02) e o deployment imutável do frontend, gravado nos dois ambientes com o mesmo id. `prepared` de Produção revalida a configuração. **O backup de Produção e a migration ficam juntos em `database_migrated`, nessa ordem**: assim a referência do backup é gravada na mesma linha da migration (`backup_ref`, migration 66) e sobrevive a um crash. Gates: `configuration`, `backup` (só Produção), `migration`, `backend_health`, `frontend_wiring`, `smoke` e `e2e_essential` (só Staging).
7. **Compensação.** O destino é o deployment da **última release concluída** no ambiente (não "o que estava no ar", que pode ser sobra de uma release que falhou), gravado no deployment como `replaces_external_id`. Só compensa o que o passo chegou a tentar: migration que falha antes da troca de tráfego não gera compensação. Frontend volta primeiro, depois o backend. Sem release anterior concluída não há para onde voltar: a compensação é registrada (`none:no-previous`) e a release termina `failed`. Compensação que falha deixa `degraded`.
8. **Retomada.** O serviço larga os leases ao sair. Passo `ambiguous` encerra a execução como `blocked`; a repetição reconcilia contra o provedor (`backend.current`, `frontend.current`) antes de agir. `prepared` e `database_migrated` não têm consulta barata e segura e ficam sem reconciliação automática (F05).
9. **Contrato do frontend e da jornada essencial.** O frontend publica `GET /runtime-config.json` → `{ "apiUrl": "https://..." }` resolvido pelo hostname; o verificador exige a origem do backend **do ambiente** e que o deployment servido seja o validado (a identidade vem do provedor; a saúde, do HTTP). A jornada E2E essencial é um comando do perfil de promoção (`npx|npm|node`) que recebe `E2E_BASE_URL`, `E2E_API_URL` e `E2E_ENVIRONMENT`; sem comando configurado o gate `e2e_essential` **falha fechado** (`e2e-not-configured`).
10. **Entrada.** `npm run release:promote -- --event merge --sha <sha>` (ou `--event resume --release <id>`), com um perfil de promoção do operador (JSON de campos fechados; segredos só por `RAILWAY_API_TOKEN` e `VERCEL_TOKEN`). A árvore local — contexto de build, migrations e a pasta do frontend — precisa ser exatamente o commit da release, porque `vercel deploy` publica o conteúdo da pasta, não o SHA. A ligação do evento de merge da V2 a este comando não faz parte da fatia.

11. **Revisão independente (código e segurança): 0 CRITICAL, 1 HIGH, tratados com teste vermelho antes.** O HIGH foi apontado pelos dois revisores sem combinar: o destino da compensação era gravado no `prepared` de Staging, e uma release vizinha que concluísse depois fazia a Produção voltar ao frontend de duas releases atrás — agora é resolvido **na hora de compensar** (`lastKnownDeployment`: Produção = última release concluída; Staging = última que confirmou o smoke). Também: sem baseline a release termina `degraded` (a versão ruim segue no ar), `pg_dump` não roda mais em Produção (a impressão do banco não tinha consumidor e lia dado do ambiente), o proxy TCP público do banco é fechado por quem o abriu, o commit precisa ser **completo** e ancestral da branch base (`--base-ref`, padrão `origin/main`), o perfil do operador não pode ficar dentro do código promovido, o E2E roda com HOME e credenciais isolados, `.vercelignore` na pasta do frontend é recusado (publicaria arquivos que o Git ignora), o frontend do perfil precisa ser o domínio que a Vercel promove, migration que falha de forma definitiva não fica `intended`, timeout do backup não prende a lane de Produção, e a estabilização exige um `passed` por check pedido. Vinte e uma mutações no código de produção foram medidas: cada uma reprova o teste certo.

**Limites declarados (não são aceite):**

- **Projeto Railway e Vercel não são conferidos contra o perfil:** deploy, migration e leitura de variáveis usam o projeto vinculado na pasta (`railway link`, `vercel link`); só o backup usa o `projectId` do perfil. Vínculo errado levaria o backup a um projeto e a migration a outro. O operador mantém os vínculos; verificá-los antes de qualquer efeito fica como evolução.
- **`PGSSLMODE=require` não valida o certificado** do proxy TCP do Railway (herdado da F03). O proxy aberto pela pipeline vive só durante a migration e é fechado em seguida (melhor esforço); um proxy que já existia é do operador e permanece.
- **O frontend de Produção é um build de "preview" da Vercel** (decisão 2). Variáveis `VITE_*`/`NEXT_PUBLIC_*` do escopo Preview são gravadas no build e vão para Produção; o que for específico de Produção precisa chegar em runtime.
- **O lease (15 min) é renovado por passo e a cada observação da estabilização, mas não dentro de um passo longo** (backup + `psql`). Um executor que perca o lease no meio de `database_migrated` deixa o passo `ambiguous` para o outro, que o reconcilia como `unknown` e fica `blocked`.
- **Anterior a esta fatia:** o `dockerfile` do perfil do projeto aceita `..` e pode sair do contexto verificado (`release-preparation-service`); `caminho()` dos perfis não resolve symlinks.

- **Smoke real em Railway e Vercel: `not_run`** — sem projeto de prova nem credenciais nesta máquina. Os adapters foram escritos contra a ajuda das CLIs (Railway 5.27, Vercel 54.2), a documentação oficial e fixtures de contrato. Premissas **não verificadas contra um projeto vivo**: a forma do JSON de `railway deployment list` e de `vercel list/deploy/inspect`; que a `meta` do deployment Railway traz a imagem com o digest completo (se não trouxer, `current`, a idempotência e o rollback falham fechado); que `railway environment edit` sem `--stage` dispara o deploy; que `vercel inspect <alias>` informa o deployment servido e `vercel promote` aceita promover um deployment de preview; e os nomes de campos da API GraphQL do Railway para volume/backup.
- **Backup:** a API não documenta um status de "backup completo"; o adapter trata "id novo na listagem" como confirmado, o que pode confirmar cedo demais se o Railway listar backups em andamento. Depende do plano Pro.
- **Rollback do Railway** reaponta o ambiente para a imagem do deployment alvo (a CLI não tem "voltar ao deployment X") e **não restaura** as variáveis informativas `RELEASE_ID`/`RELEASE_SOURCE_SHA`; a identidade que vale para os gates é o digest do provedor, não essas variáveis.
- A configuração lida é um snapshot por `prepared`; rotação entre dois `prepared` só é vista no seguinte.
- Fora desta fatia (F05): retry com backoff, reconciliação de `prepared`/`database_migrated`, cancelamento por fase, retorno à V2, manifesto/tag/GitHub Release e a jornada E2E de falhas.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; decisões de implementação 1–4 aprovadas pelo PI em 2026-10-14.
