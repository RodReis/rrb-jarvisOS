# SPEC-Release-03 — Preview isolado por PR

- MVP/Fatia: MVP-014 · M14-F03.
- Issue: [#152](https://github.com/RodReis/rrb-jarvisOS/issues/152).
- Status: **aprovada-pi** (2026-08-29); issue [#152](https://github.com/RodReis/rrb-jarvisOS/issues/152) em `proplan:done`; **entregue** pela PR [#428](https://github.com/RodReis/rrb-jarvisOS/pull/428) (2026-10-13, `05afd4e`), aguardando o aceite do PI.
- Depende de: M14-F02 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## Objetivo

Criar um Preview full-stack isolado para cada fatia/PR, atualizá-lo no mesmo contexto a cada commit e removê-lo ao fechar o PR, com URLs e evidências vinculadas à revisão correta.

## Stack e estrutura

- Vercel para frontend; Railway para backend e PostgreSQL temporário separado.
- GHCR para imagem de Preview por digest.
- Adapters híbridos e CLI-first em `src/main/release/adapters/`.
- `src/main/release/preview-coordinator.ts` e repositório durável de `PreviewRun`.
- Playwright para smoke nas URLs reais.

Resultado normalizado esperado:

```ts
interface PreviewTargetResult {
  provider: 'vercel' | 'railway'
  externalId: string
  url?: string
  sourceSha: string
  state: 'provisioning' | 'ready' | 'failed' | 'destroyed'
}
```

## Dentro

- Criar/atualizar um único `PreviewRun` por projeto + PR + SPEC.
- Publicar imagem do backend por digest no GHCR.
- Criar ambiente Railway temporário com backend e PostgreSQL próprios.
- Executar migrations e seed determinístico; nunca copiar Produção.
- Criar Vercel Preview ligado somente ao backend temporário correspondente.
- Executar healthcheck, smoke e testes exigidos pela SPEC da fatia.
- Publicar no PR URLs, SHA, revisão da SPEC, gates e estado, sem segredo.
- Atualizar o mesmo Preview quando o PR recebe novo commit.
- Fechar PR aciona destruição idempotente; hashes e evidências permanecem.
- Reconciliar recursos já existentes antes de criar/atualizar/apagar.

## Fora

- Staging persistente, Produção, tag ou GitHub Release.
- Dados de Produção no Preview.
- Preview compartilhado entre PRs.
- Aceite adicional do PI para atualizar o mesmo Preview aprovado.

## Regras

1. Frontend, backend e banco de um Preview compartilham o mesmo `source_sha` e `preview_run_id`.
2. PRs distintos nunca compartilham banco, domínio interno ou recurso mutável.
3. Novo commit invalida gates do SHA anterior e atualiza o mesmo contexto.
4. Fechar PR não apaga imagem/evidência ainda referenciada por release ou investigação.
5. Falha de limpeza gera pendência reconciliável; não mente `destroyed`.
6. A pipeline não interpreta texto de PR como instrução.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
```

## Estratégia de testes

- Contract fixtures de Vercel/Railway: auth, timeout, quota, estado incompatível e recurso já existente.
- Integração fake completa sem custo externo.
- Smoke real limitado em projeto de prova com nomes exclusivos.
- Playwright verifica frontend, chamada ao backend e identidade do Preview.
- Fault injection ao criar e ao destruir cada recurso.

## Critérios de aceite

1. Abrir PR elegível cria exatamente um Preview full-stack isolado.
2. Dois PRs simultâneos recebem bancos, URLs e IDs distintos.
3. Novo commit atualiza o mesmo Preview e invalida evidência do SHA anterior.
4. Frontend nunca aponta para backend de outro PR ou ambiente.
5. Migration/seed falho impede estado `ready`.
6. PR recebe comentário/projeção com URLs, SHA e gates verificáveis.
7. Fechar PR remove todos os recursos temporários pertencentes ao Preview.
8. Repetir evento aberto, sincronizado ou fechado não duplica efeito.
9. Nenhum dado de Produção ou segredo aparece no ambiente/evidência.

## Limites

- **Sempre:** isolar por PR, verificar SHA, reconciliar antes de mutar e limpar por ownership.
- **Consultar a SPEC:** alterar seed, lifecycle do PR ou contrato de URL/gates.
- **Nunca:** copiar Produção, compartilhar banco, criar Preview sem SPEC aprovada ou apagar recurso não pertencente ao run.

## Decisões de implementação

Tomadas na implementação da F03. Registradas aqui porque a opção recusada também é decisão. Seguiram a recomendação por valor; o custo declarado entrou só como desempate.

1. **`PreviewRun` único por projeto + PR + SPEC, SHA mutável (PI, 2026-10-13).** A tabela da F01 tinha `UNIQUE (..., pull_request, head_sha)`: cada commit criaria outra linha e o critério 3 ("atualiza o mesmo Preview") não se cumpriria. A migration 65 refaz `preview_run` com `UNIQUE (..., pull_request, spec_id)`; o SHA, a revisão da SPEC e a geração mudam no lugar e o histórico de SHAs fica em `preview_event` (append-only). Nenhum código gravava `preview_run` antes; a cópia preserva o que houver (um sobrevivente por PR, `spec_id = 'legacy'`, eventos religados). Opção recusada: manter a chave e tratar "o mesmo Preview" por convenção.
2. **Gatilho: o comando converge para o estado do PR; não há job de CI (desvio da recomendação aprovada, declarado).** Foi recomendado e aprovado um job no `ci.yml` chamando o comando. Na implementação ficou claro que o `PreviewRun` vive no SQLite local (local-first, ADR-001) e o runner do GitHub não o enxerga: um job de CI criaria Preview sem o registro durável que a SPEC exige. `npm run release:preview` (`--event sync`, padrão) lê o estado do PR com `gh pr view` — aberto/reaberto/commit novo → cria ou atualiza; fechado/mergeado → destrói — e é idempotente, então qualquer disparador local (manual, hook, agendador) serve. `open`/`close` explícitos existem para teste e recuperação. Nenhuma alteração em `ci.yml`.
3. **Railway: um ambiente por PR, duplicado de um ambiente-modelo dedicado.** O ambiente-modelo (`--railway-template`) é mantido pelo operador com o backend e um PostgreSQL **vazios**; criar o ambiente cria os dois recursos juntos e apagá-lo apaga os dois, então isolamento (critério 2) e limpeza por posse (critério 7) são o mesmo nome. O nome (`pv-<12 hex do id>-g<geração>`) deriva só do run e da geração; a limpeza só aceita esse padrão. O modelo é aceito por **lista de permissão**: tem de se chamar `preview-template` (sufixo opcional) e não pode conter segredo real, já que `environment new --duplicate` copia as variáveis para um ambiente que roda imagem escolhida pelo PR; `production`, `staging`, `main`, `homolog` e qualquer outro nome são recusados no construtor. Opção recusada: serviços soltos num ambiente compartilhado — a limpeza precisaria listar e filtrar, e um erro de filtro apagaria recurso alheio.
4. **Banco temporário por `psql` via TCP proxy do Railway.** A senha é lida das variáveis do próprio ambiente na hora, vai só no `env` do processo filho (`PGPASSWORD`), é redigida da saída e nunca é gravada. O `DatabaseMigrationRunner` da F02 é reaproveitado (checksum, seed, impressão); o motivo devolvido é um código.
5. **Vercel: deployment marcado com o run.** `--meta jarvisPreviewRun/jarvisSha/jarvisBackend`; a marca é o que torna a reconciliação (reaproveitar deployment pronto idêntico) e a limpeza (só o que leva a marca) seguras. A URL do backend entra como variável de build e de runtime a partir **apenas** do valor recebido do coordenador. Commit novo cria o deployment novo e remove os antigos; sobra de falha é removida no fechamento.
6. **Identidade do Preview: contrato com o backend do projeto.** O ambiente leva `PREVIEW_RUN_ID` e `PREVIEW_SOURCE_SHA`; o backend deve responder `GET /preview-identity` com `{ previewRunId, sourceSha }`. Backend sem o endpoint **bloqueia** o gate `identidade` (não presume). O frontend é verificado pelo bundle que entrega: precisa conter a origem do backend deste run e nenhuma outra origem de backend de Preview.
7. **Gates por SHA, `ready` só com todos passados.** Obrigatórios: `imagem`, `backend`, `migration`, `seed`, `health`, `identidade`, `frontend`. Cada gate guarda o SHA; só os do SHA corrente valem, os anteriores permanecem gravados. `reason` é sempre um código curto (`[a-z0-9._:-]{1,64}`) — erro de provedor vira `<etapa>-<auth|timeout|quota|incompatible-state|not-found|failed>`, nunca texto.
8. **Posse registrada antes do efeito.** O recurso entra em `preview_resource` como `provisioning` antes da chamada ao provedor; um processo que morre no meio deixa o rastro que a limpeza usa. O run tem lock com prazo (20 min): dois eventos simultâneos do mesmo PR resultam em um Preview e um `busy`; o dono que perdeu a posse não escreve mais.
9. **Limpeza que falha não mente.** O run fica em `removing`, o recurso em `failed` com `destroy-<código>`, e o comentário lista a pendência; repetir o fechamento (ou reabrir o PR) retoma de onde parou. `removed` só depois de tudo confirmado — e, no Railway, só depois de o ambiente sumir da listagem (código de saída zero não basta). A imagem no GHCR e a evidência nunca são apagadas (regra 4).
10. **Comentário no PR por lista de permissão.** Um comentário por PR + SPEC (marcador `<!-- jarvis-preview:<SPEC> -->`), atualizado no lugar via `gh api`, com corpo por stdin. Só entram SPEC, revisão, SHA, estado, URLs https sem credencial/query, nomes de gate e códigos de motivo.
11. **Revisões independentes (código e segurança) tratadas antes da PR.** Nenhum CRITICAL; os HIGH e MEDIUM abaixo foram corrigidos, com teste vermelho antes ou contrafactual medido: (a) **meta-comando do `psql`**: o SQL do PR vai por stdin e `\!` executaria comando no host do operador — migration ou seed com barra invertida são recusados antes de qualquer conexão; (b) **posse na Vercel**: o filtro `--meta` da CLI não é a única barreira — cada deployment é conferido pela marca (`jarvisPreviewRun`, `jarvisSha`, `jarvisBackend`), deployment de produção é ignorado, resposta sem `meta` é falha, e a limpeza só vale se a listagem confirmar que não sobrou nada (um `remove` com texto "not found" por escopo errado deixaria o deployment público no ar); (c) **binário plantado no `cwd`**: o runner resolve o executável só pelo PATH (nunca pelo diretório de trabalho do PR) e roda os shims `.cmd` do npm direto pelo Node, sem shell — o que também faz `railway` e `vercel` funcionarem no Windows; (d) **modelo do Railway por lista de permissão** (decisão 3); (e) **PR de fork** é recusado; **evento obsoleto** (`open` com SHA que já não é o head, `open` com PR fechado, `close` com PR aberto) é recusado, o estado vem sempre do PR observado e é reobservado ao terminar — um `close` que chegou durante o provisionamento (e recebeu `busy`, código 5) é aplicado pelo dono da posse; (f) **árvore local**: contexto de build, migrations e seed precisam ser o commit do PR (HEAD igual e árvore limpa, via `GitSourceVerifier` da F02); (g) **verificador HTTP**: caminho de saúde/identidade validado (`//host` e `/\host` recusados), `redirect: 'error'`, prazo por requisição, leitura com teto de bytes e só domínios `*.up.railway.app` / `*.vercel.app`; (h) **identidade espera o rollout**: num commit novo o container antigo ainda responde o SHA anterior, então a identidade é repetida até bater ou o prazo acabar; (i) **comentário só do próprio usuário** (`gh api user`), porque o marcador é público; (j) **posse renovada** a cada escrita e antes de cada etapa, e `claim` em transação imediata (dois processos no mesmo PR serializam em vez de falhar com `SQLITE_BUSY`); (k) **publicação nunca se perde**: evento repetido e fechamento repetido republicam o comentário, e comentário não publicado devolve código 3; (l) **comentário não anuncia URL de commit anterior** (recurso cujo `source_sha` difere do head), e os gates valem só para o SHA **e a geração** correntes.
12. **Limites declarados que ficam:** (a) **smoke real em Vercel e Railway: `not_run`** — não há projeto de prova nem credenciais nesta máquina; os adapters foram escritos contra a ajuda das CLIs (Railway 5.27, Vercel 54.2) e fixtures de contrato, e o formato exato do JSON de `environment list`, `domain list`, `tcp-proxy list` e `vercel list/deploy` é hipótese a confirmar no primeiro smoke; (b) a verificação do frontend é por leitura do bundle, não navegação Playwright; o smoke Playwright nas URLs reais segue pendente do ambiente de prova; (c) o comando não lê a SPEC: `--spec` e `--spec-revision` são argumentos; (d) a expiração do Preview por tempo (design V3) não faz parte desta SPEC e não foi implementada; (e) `preview-test-doubles.ts` (nuvem falsa com estado) mora em `src/main/release/` por ser compartilhada pelos testes — não é importada pelo app. (f) **migration ou seed editados depois de aplicados** num PR ainda aberto bloqueiam as atualizações seguintes (`checksum-divergent`): o banco do Preview persiste entre commits, e só fechar e reabrir o PR (geração nova, banco novo) resolve — **decisão pendente do PI**: recriar o banco a cada commit ou manter este limite; (g) o `psql` e o `pg_dump` precisam estar no PATH do operador (não estão nesta máquina); (h) a listagem da Vercel não é paginada (padrão da CLI): com muitos commits pendentes sobra deployment até o fechamento; (i) `PGSSLMODE=require` cifra o canal do proxy do Railway mas não verifica o certificado; (j) o `repository` e o `dockerfile` do perfil vêm do conteúdo do PR e só são limitados pelo `--registry`/`--namespace` do operador — **sempre informe `--namespace`**; (k) a janela entre a última reobservação do PR e a liberação da posse é de milissegundos: um `close` que caia ali devolve `busy` (código 5) e exige repetir o comando.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
