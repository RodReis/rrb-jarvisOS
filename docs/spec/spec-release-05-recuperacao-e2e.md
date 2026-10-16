# SPEC-Release-05 — Compensação, retorno à V2 e E2E

- MVP/Fatia: MVP-014 · M14-F05 — **fecha o MVP-014**.
- Issue: [#154](https://github.com/RodReis/rrb-jarvisOS/issues/154).
- Status: **aprovada-pi** (2026-08-29); issue #154 em `proplan:doing` (PR [#432](https://github.com/RodReis/rrb-jarvisOS/pull/432)); decisões de implementação em § Decisões de implementação.
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

## Decisões de implementação

Tomadas pelo Code dentro do escopo aprovado (nenhuma muda ordem, janela, gates, política de retry, cancelamento, tag ou retorno à V2 definidos acima). As que dependem de leitura do PI estão em § Confirmações pedidas ao PI.

1. **Tentativas: três totais por passo.** O texto diz "até três retries" (Dentro, critério 3) e "no máximo três tentativas totais" (Regra 1). Vale a Regra 1, que é a mais restritiva. O contador é `release_step.attempt` — vem do diário, então sobrevive a uma retomada. Backoff de 2 s antes da 2ª tentativa e 8 s antes da 3ª (domínio, `release-recovery.ts`).
2. **O que se repete.** Só falha **transitória**: cota (`quota`) e efeito incerto (timeout ou exceção desconhecida) **depois de reconciliado**. Recusa definitiva (`auth`, `not-found`, `incompatible-state`, `failed`) e falha de gate não se repetem — repetir não conserta credencial nem código. Esgotadas as três, o passo para com causa, evidência (`retries-exhausted`) e ação mínima (`check-provider-status`) e a release compensa. Reconciliação que o provedor não responde três vezes seguidas deixa a release `blocked`, sem compensar nem repetir às cegas.
3. **Reconciliação que a F04 deixou de fora.** `database_migrated` pergunta ao PostgreSQL do ambiente o que já foi aplicado (nova porta `applied`, só leitura do `schema_migrations`): tudo aplicado com o checksum esperado = aplicado (e o gate que a resposta perdida deixou sem registro é gravado agora); qualquer falta = repetir é seguro, porque o runner pula o que já existe. Leitura que falha lança — nunca vira "nada aplicado". `prepared` reconcilia pelos artefatos e deployments gravados; build e frontend são idempotentes por release. **Custo conhecido:** queda entre o backup e a intenção da migration refaz o backup de Produção (no máximo um a mais por queda).
4. **Crash em cada fronteira** é provado por morte simulada antes e depois de **cada gravação** do caminho feliz (~80 pontos × 2): o processo seguinte converge para `completed` sem segundo build, deployment ou migration. Mutação medida: reconciliar tudo como "não aplicado" reprova o teste.
5. **Degraded pausa só o projeto.** Compensação incompleta ou sem baseline (`no-previous-release`) grava a pausa (`release_project_pause`): merges novos entram na fila (`queued`) e não promovem; outro projeto segue. `recover` toma a lane de Produção como o rollback (devolve `waiting` se ela está ocupada), refaz o que falhou, **prova na nuvem** que cada ambiente voltou ao deployment conhecido e libera; sem estado a provar, só `recover --acknowledge` libera — declaração do operador, marcada `acknowledged` na cadeia de auditoria, distinta da recuperação provada. A pausa também vale para uma release já em voo: ela não toma a lane de Produção depois que o projeto foi pausado. Frontend e backend são compensados de forma independente.
6. **Cancelamento seguro.** O pedido é gravado (`release_cancellation`) e o executor o cumpre no próximo ponto seguro — antes de cada operação, entre fases e a cada observação da estabilização —, depois de terminar e reconciliar a operação remota corrente; sem executor, o comando cumpre na hora; com outro executor segurando a release, devolve `requested`. Antes de Staging limpa os temporários do Docker (por lease, nunca artefato nem diário); em Staging e Produção devolve o ambiente ao deployment conhecido; depois da promoção equivale a rollback para a última release concluída. Termina `failed` (ou `degraded` + pausa) com motivo `cancelled`; **cancelar não é falha de código e não volta à V2**. Passo incerto que o provedor não deixa reconciliar deixa o cancelamento `blocked`, reconciliável.
7. **Rollback por `release_id`.** `release:promote --event rollback --to <uuid>` (nunca "a anterior"): o alvo precisa ser uma release `completed` com backend, frontend e artefato gravados; o comando toma a lane de Produção (serializa com qualquer promoção), reaponta frontend e backend, **prova** health, fiação e smoke contra a identidade do alvo e só então confirma. Falha de restauração ou de prova pausa o projeto. O que Produção serve passa a ser a release para a qual o último rollback confirmado voltou (ou a última concluída depois dele): rollback com salto (C → A) tira B de cena e rollback para frente (A → B) vale; as compensações seguintes voltam para essa release. O que Produção serve é relido depois de tomar a lane. Nenhuma chamada ao banco.
8. **Retorno à V2.** Falha de código, teste, health, migration ou build (`classificarFalha`) abre na V2 um run `PLANNED` na **fatia de origem** (a inclusão do merge carrega `--slice`), com chave de dispatch `release-correction:<release_id>` (idempotente). O run segue o gate `SLICE_ENTRY` normal: reaproveita a aprovação vigente da **mesma** revisão da SPEC — sem novo aceite — e volta a exigir aceite se a SPEC mudou (provado contra a `FilaService` real). Falha de configuração, transitória ou desconhecida é decisão do operador e não volta. V2 fora do ar deixa a correção `pending` (sem mascarar a falha) e a retomada a reabre. O despachante não recebe nenhuma porta de nuvem.
9. **Contexto da correção.** JSON canônico só de ids, hashes e códigos (release, SHA, falha, SPECs, inclusões, último resultado de cada gate, achados e evidência), gravado em `release_correction` (endereçável pela chave `release-correction:<release_id>`) e passado ao adaptador da V2, que hoje **não o anexa ao run**: a V2 o lê por essa chave quando passar a consumi-lo. Achado anterior da mesma SPEC entra como `open` ou `resolved` (a SPEC concluiu uma release depois); o mesmo código de novo é `recurring`, **nunca `new`**.
10. **Identidade da release.** Manifesto canônico e imutável (`release_manifest`: SHA, artefatos, deployments, migrations, gates, SPEC/PR/issue, instantes, release anterior e a tag dela), changelog derivado só do manifesto (com `Manifest-SHA256`), tag `release-YYYYMMDD-HHMM-<shortsha>` em UTC e GitHub Release criada por `gh release create --target <sha>` (notas por stdin). **Só depois de `completed`**: release falha, degradada, cancelada ou em estabilização é recusada antes de qualquer chamada ao GitHub. A intenção de publicar é gravada antes de `completed`; falha do GitHub vira pendência (`release_publication`, `retry-publication`) e a retomada publica — nunca reverte a aplicação. Tag em outro commit é conflito (`resolve-tag-conflict`), nunca sobrescrita. `verify` recalcula o manifesto e confere tag, commit e notas. SemVer **não** foi implementado: nenhum projeto declarou política.
11. **Proteção de artefatos.** `protectedArtifacts` lista o que nenhuma limpeza pode remover: tudo de releases abertas, as duas últimas concluídas válidas (a que serve e o alvo do rollback) e qualquer rollback em andamento (origem e destino). A release que pausou o projeto entra na proteção (o backup dela é a referência de restore operacional). Hoje nenhum código remove artefato, deployment ou backup de release; a limpeza do cancelamento só toca temporários do Docker. Quem remover consulta isto antes.
12. **Fronteira (critério 11).** Evidência, motivo, ação e detalhes aceitam só código curto — o repositório recusa o resto antes do banco — e texto de provedor, GitHub, V2 e campos de PR/SPEC nunca é repetido. Uma varredura de **todas** as tabelas, da auditoria, do manifesto, do contexto da V2 e do que sai para o GitHub não acha o segredo nem a instrução injetados pelos quatro canais, e o instrumento prova que enxerga o que procura. Preview não toca a nuvem de promoção.
13. **Comando.** `release:promote` ganha `cancel`, `rollback`, `recover`, `publish` e `verify` (e `--pr/--spec/--slice/--issue` no `merge`); `release_id` é sempre UUID; `publish` e `verify` dispensam os tokens do Railway e da Vercel; o perfil de promoção ganha `github.repository` (sem campo de credencial). Código de saída: 0 fez o pedido, 3 falhou ou exige o operador, 5 aguarda, 2 uso inválido.
14. **Testes da F04 cujo contrato mudou** (a SPEC da F04 declarava retry e reconciliação como F05): cinco testes de `release-promotion-falhas` afirmavam "bloqueia no primeiro timeout"; agora afirmam o novo contrato (reconcilia, repete uma vez e conclui, ou bloqueia quando o provedor não responde). Um sexto (o resíduo de release `degraded`) passou a reconhecer o projeto pausado com `recover --acknowledge` antes da release seguinte.

**Provas.** Unidade de domínio (classificação, tentativas, tag, manifesto, achados); integração sobre SQLite real e nuvem falsa com estado (retry, reconciliação, morte em cada gravação, pausa e recuperação, cancelamento por fase, rollback, identidade, retorno à V2 pela fila real, fronteira, contrafactuais, jornada Preview → Staging → Produção → falha → correção → rollback → limpeza); contratos dos adaptadores (`gh`, banco, V2); jornada Playwright nas três URLs e depois do rollback (prova local, no CI). **Trinta mutações** no código de produção foram medidas e todas reprovam o teste certo.

**Limites declarados (não são aceite):**

- **Smoke real em Vercel, Railway, GHCR e GitHub: `not_run`.** Não há projeto de prova nem credenciais nesta máquina; o critério 10 ("jornada E2E real") está provado contra a nuvem falsa e contra ambientes locais efêmeros, **não** contra provedores. O roteiro real é `release:preview` → `release:promote --event merge` → `rollback` e as fases `baseline`/`urls`/`after-rollback` do Playwright com `RELEASE_JOURNEY_URLS`, `RELEASE_JOURNEY_PHASE` e `RELEASE_JOURNEY_STATE` (sem as variáveis o modo real é `not_run`, nunca `pass`). **Fechar o MVP-014 depende desse roteiro.**
- **Premissas não verificadas contra um provedor vivo:** a forma do JSON de `gh api repos/…/git/ref/tags/<tag>` e de `gh release view --json body`; que `gh release create <tag> --target <sha>` cria a tag no commit pedido; o hash das notas depois da normalização do GitHub (fim de linha e espaço final são ignorados); a consulta `to_regclass('public.schema_migrations')` pelo `psql`.
- **O contexto da correção não chega ao run da V2:** ele é gravado em `release_correction` e passado ao adaptador, mas o adaptador só cria o run `PLANNED` — o histórico da regra 6 fica disponível pela chave `release-correction:<release_id>` e o construtor da V2 precisa lê-lo (fatia da V2). A ligação do evento de merge da V2 ao `release:promote` (e de `--slice` ao PR) segue fora, como já estava na F04.
- **Cancelamento só vale nos pontos seguros:** uma operação remota longa (backup + `psql`, build) termina antes de o executor olhar o pedido — é o desenho (não matar às cegas), mas o cancelamento espera essa operação.
- **Backup:** queda entre o backup e a intenção da migration refaz o backup de Produção (um a mais por queda).
- **Rollback não confere compatibilidade de schema** entre a release alvo e o banco já migrado: a regra 5 da F04 (versão anterior compatível com o schema expandido) segue por conta das releases expand/contract.
- **Arquivos acima do teto de 800 linhas já existiam** (`release-repository.ts`, 1.063): não foram tocados além de `releaseLane`.

## Confirmações pedidas ao PI

Nenhuma bloqueia a entrega; cada uma é uma leitura do texto da SPEC que o Code fixou e o PI pode reverter:

1. **"Até três retries" × "três tentativas totais"** (decisão 1): adotado o mais restritivo (três tentativas no total). Se a intenção era quatro, muda uma constante.
2. **`recover --acknowledge`** (decisão 5): quando não há release anterior para provar, o operador libera o projeto por declaração auditada. A alternativa é nunca liberar sem prova — o projeto ficaria pausado até alguém criar uma baseline.
3. **Critério 10 e o fechamento do MVP-014:** a prova real em Vercel/Railway/GHCR/GitHub exige o projeto de prova e o orçamento da SPEC, que não existem aqui. Decidir se a fatia é aceita com esse limite (como a F04 foi) e quando o roteiro real roda.
4. **Contexto da correção na V2** (limite acima): confirmar que o consumo pelo construtor entra numa fatia da V2.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29; as confirmações acima são leituras do Code, não bloqueios.
