# SPEC-Scheduler-04 — Merge serializado

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 04).
- Issue: [#131](https://github.com/RodReis/rrb-jarvisOS/issues/131); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F03 aprovada e entregue.

## Objetivo

Permitir PRs concorrentes, mas serializar integração na mesma base e revalidar a fatia remanescente contra o estado recém-mergeado.

## Dentro

- `MergeLease` exclusivo por repositório/branch-base com fencing token.
- Reconciliação de PR, head SHA, regras vigentes e checks obrigatórios antes do merge.
- Após um merge, atualização/rebase controlado da fatia remanescente.
- Reexecução integral das validações exigidas e nova revisão do delta material.
- Atualização do manifesto, head SHA e prova de independência.
- Conflito ou mudança estrutural devolve o run a estado seguro, sem correção cega.

## Fora

- Dois merges simultâneos na mesma base.
- Considerar checks do SHA anterior como válidos.
- Merge queue na versão em que não estiver explicitamente suportada.
- Reverter merge confirmado automaticamente.

## Regras

1. PR verde não garante merge se base/head/regras mudaram.
2. Só o dono atual do `MergeLease` confirma o efeito no `EffectJournal`.
3. Rebase nunca roda hooks, filters, drivers ou comandos controláveis pelo repositório.
4. Conflito que exige decisão de produto/arquitetura para no gate adequado.

## Critérios de aceite

1. Somente um run por base entra na seção crítica de merge.
2. Segundo PR atualiza sua base e perde todos os checks obsoletos.
3. Revalidação usa o novo head SHA e regras observadas da branch-base.
4. Crash após chamada de merge reconcilia GitHub antes de repetir.
5. Merge confirmado permanece `MERGED` mesmo após cancelamento tardio.

## Testes e evidência

- corrida de dois PRs verdes;
- mudança de base/ruleset entre check e merge;
- crash antes/durante/depois do efeito;
- conflito de rebase e revalidação completa.

## Decisões de implementação (PI, 2026-10-04)

Tomadas na implementação da F04, depois de o Code mapear o que existia. Registradas aqui porque a opção recusada também é decisão. Todas seguiram a recomendação por valor; o custo declarado entrou só como desempate.

1. **A atualização da fatia é o `update-branch` do GitHub** (`PUT /pulls/{n}/update-branch`, com `expected_head_sha`), não um rebase local. Sem Git local, sem hook, filter, driver nem force-push: a regra 3 vale por construção, e não há `ApprovalRequest` por `--force-with-lease`. O preço é um commit de merge na branch da fatia, que some no squash. *Recusada:* rebase local com `--force-with-lease` (histórico linear, mas pausa em aprovação destrutiva a cada rebase, e o `CONFIG_DO_KERNEL` não neutraliza `filter.*` nem `merge.*.driver` do repositório; ~2–3× o custo e superfície de risco maior).
2. **O "manifesto" é o write set travado e a prova de independência.** Depois de um merge, `IndependenciaService.aoMergear` invalida as provas que contavam com o run (o registro fica, é evidência) e o run sai das travas pelo caminho que já existia. *Recusada:* regenerar também o `ContextPack` e o manifesto de workflow de CI do head novo (mais acoplamento com preflight e entrega, ~+40%, sem consumidor).
3. **"Regras vigentes" são a união da proteção da branch e dos repository rulesets.** Nova operação `rulesets.for-branch` (`GET /rules/branches/{branch}`); `lerRegraDaBase` une as duas fontes e é a **mesma** leitura do snapshot do `EntregaService` e da comparação sob o lease. Sem isso, um check exigido só por ruleset era invisível ao gate. *Recusada:* só proteção (a exigência por ruleset só apareceria como falha do merge, depois do efeito tentado).
4. **A nova revisão do delta reusa o gancho `revisar`**, agora com o delta (`headAnterior`, `headNovo`) como segundo argumento. Em produção o `revisar` ainda devolve lista vazia (`index.ts`), então a F04 prova o **encadeamento** — o gancho é chamado de novo quando o head muda, e um P1 achado no delta barra o merge —, não a qualidade da revisão. *Recusada:* ligar o `squad-revisor` ao `EntregaService` agora (escopo de MVP-011/M9; ~2× a fatia).

**Interpretação do Code, confirmada pelo PI em 2026-10-04 (delegou a escolha; ver SPEC-Scheduler-05).** "Reexecução integral das validações exigidas" foi lida como **os checks obrigatórios (proteção + rulesets) no head novo**: o gate os busca por SHA, então os do head anterior não valem. Os `comandosDeValidacao` **locais** não são reexecutados, porque o worktree local não é atualizado pelo `update-branch` (a atualização acontece na origem). Se a leitura correta é rodar também a validação local, é outra fatia: exige trazer o head novo para o worktree.

**Decisões do Code dentro da regra (não alteram escopo).**

- **A F04 depende de um FIX, e ele saiu antes:** [#393](https://github.com/RodReis/rrb-jarvisOS/issues/393) (PR #394) — `FilaService.concluir` marcava `MERGED` sem merge confirmado. Sem ele, "merge confirmado permanece `MERGED`" não teria o que proteger.
- **O MergeLease é uma linha de `lease`** (`merge:<dono>/<repo>:<base>`, com fencing token do contador do pool) e não uma tabela nova; a tabela `merge_tentativa` (migration 52) guarda o que o lease não guarda: qual PR, qual head e o que aconteceu.
- **Teto de revalidações:** `MAXIMO_DE_REVALIDACOES = 3`. Cada atualização da branch dispara um CI novo; uma base que avança a cada merge faria o run revalidar para sempre. Estourado o teto, o run vai a `BLOCKED` (`base-instavel`) com ação de retomada.
- **Cancelar não vence um merge que já saiu.** `FilaService.transicionar(..., 'CANCELLED')` devolve `merge-em-curso` enquanto há tentativa `iniciada`, ou `confirmada` e ainda não registrada no run. A tentativa e a conferência de `PR_CI` são a mesma transação: ou o cancelamento vence antes de o merge começar, ou o merge segura o cancelamento.

## Como cada critério é provado

| # | Critério | Prova |
|---|---|---|
| 1 | Somente um run por base entra na seção crítica | `merge-service.int-spec.ts` ("corrida de dois PRs verdes": o segundo recebe `lease-ocupado` com o primeiro **dentro** do `squashMerge`, sem tocar a origem; lease **expirado** de outro run também não é tomado); `merge-repository.int-spec.ts` (UNIQUE parcial: uma tentativa `iniciada` por base) |
| 2 | O segundo PR atualiza a base e perde os checks obsoletos | `merge-service.int-spec.ts` (o segundo vê a base nova, chama `update-branch` e devolve `revalidar` com o head novo); `entrega-service.int-spec.ts` ("os checks do head anterior não valem para o head novo": check verde no SHA antigo não basta, o run bloqueia sem CI próprio) |
| 3 | A revalidação usa o novo head SHA e as regras observadas da base | `merge-service.int-spec.ts` (check novo na proteção, check novo **só por ruleset**, merge queue nova e head que andou: `revalidar`, nenhum `squashMerge`); `entrega-service.int-spec.ts` (o merge seguinte leva o `expectedHeadSha` do head atualizado) |
| 4 | Crash após a chamada de merge reconcilia o GitHub antes de repetir | `merge-service.int-spec.ts` (crash **antes**, **durante** e **depois** do efeito: o merge feito antes do crash não é repetido; tentativa aberta com o PR ainda aberto é abandonada); `reconciliacao-merge.int-spec.ts` (reconciliação do boot, em ordem, com contrafactual medido: o gancho depois dos leases reprova); `effect-journal-repository.int-spec.ts` + `connector-service.int-spec.ts` (só o dono atual do lease conclui a entrada do diário) |
| 5 | Merge confirmado permanece `MERGED` após cancelamento tardio | `fila-service.int-spec.ts` ("cancelamento tardio não desfaz merge": cancelar com a tentativa `iniciada` ou `confirmada` é recusado e o `MERGED` vence); `merge-service.int-spec.ts` (run já cancelado: nenhuma tentativa nasce e nada é mergeado; lease perdido durante a chamada não desfaz o merge) |

Regra 3 (nunca roda hooks, filters, drivers): vale por construção — nenhum comando de Git é executado; a atualização é uma chamada à API. Regra 4 (conflito para no gate): `merge-service.int-spec.ts` e `entrega-service.int-spec.ts` (conflito ao atualizar vira `BLOCKED` com `conflito-na-atualizacao` e ação de retomada, e nada é mergeado).

## Contrato com as próximas fatias

- **Todo merge passa pelo `MergeService.tentar`.** O `EntregaService` não chama mais `pr.squash-merge` direto, e só pede `MERGED` à fila com o merge confirmado na origem.
- **`PedidoDeEntrega.fencingToken` (opcional)** é o token do slot do run: sem ele, a fila recusa `concluir` e `BLOCKED` de run que passou pelo pool. **Nenhum chamador de produção do `EntregaService.entregar` existe ainda** (só o boot o constrói); quem o ligar passa o token.
- **A F05 herda a reconciliação do boot** (`ReconciliacaoService.merge`) e o `runCorrente` por instância do `EntregaService` (abaixo).
- **Prefixo de lease novo:** `merge:`. Quem varre leases por prefixo deve conhecê-lo.

## Limites declarados

- **Não validado contra o GitHub real.** Os dois endpoints novos foram provados contra o servidor falso do adapter e conferidos na documentação (2022-11-28), mas **os textos das mensagens 422 do `update-branch` ("merge conflict between base and head" e "Expected head sha didn't match current head ref") vêm do conhecimento da API, não da documentação**: ela só documenta 403 e 422, sem separar head divergente de conflito. Se o GitHub mudar o texto, o conflito cai no 422 genérico, vira `aguardar` e o run espera até o teto em vez de bloquear com a ação certa. O smoke real (`scripts/smoke-github.mjs`) não foi estendido nem rodado.
- **`rulesets.for-branch` lê só a primeira página** (100 regras). Branch com mais regras ativas as ignora.
- **A revisão do delta é só o gancho** (decisão 4): o revisor de produção é um stub.
- **Uma instância do `EntregaService` ainda guarda um único `runCorrente`.** Dois `entregar` concorrentes na mesma instância o sobrescrevem; é o contexto que o `ExecutorProxy` usa para correlacionar custo. Não afeta o merge — o `MergeService` é por chamada —, mas é pré-requisito da F05.
- **A janela entre a conferência do cancelamento e o `UPDATE` é fechada pela execução síncrona do SQLite em um único processo.** Dois processos escrevendo o mesmo banco não são cobertos pela garantia do cancelamento; os UNIQUE parciais e o `EXISTS` do fencing, esses sim, valem no banco.
- **O `update-branch` não traz o head novo ao worktree local.** O commit novo existe só na origem; a validação local não o enxerga (ver a interpretação acima).
- **Os retornos `BLOCKED` do `EntregaService` que não passam pelo `bloquear`** (causa externa do gate, cancelamento por `signal`) seguem sem transicionar o run na fila — comportamento anterior à F04, fora do escopo.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; decisões de implementação em 2026-10-04.
