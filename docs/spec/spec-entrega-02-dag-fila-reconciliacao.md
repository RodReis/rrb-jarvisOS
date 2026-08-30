# SPEC-Entrega-02 — DAG, fila e reconciliação

- MVP/Fatia: MVP-009 · M9-F02.
- Issue: [#102](https://github.com/RodReis/rrb-jarvisOS/issues/102).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; os estados e a reconciliação já refletem as invariantes da CONVENTION §4. **Emenda 2026-08-30 (PI):** WIP=1 passa a ser **slot global**, não por projeto; estado terminal `AWAITING_MERGE` adicionado; significado de `AWAITING_PI` fixado (ver § Emendas).
- Depende de: M9-F01.

## Objetivo

Selecionar somente trabalho aprovado/desbloqueado, executar com **WIP=1 global** (um run por máquina; concorrência é escopo do MVP-012) e recuperar estado após interrupção sem duplicar efeitos.

## Estados

`PLANNED → AWAITING_PI → READY → RUNNING → VALIDATING → PR_CI → MERGED | AWAITING_MERGE | BLOCKED | CANCELLED`.

- `AWAITING_PI` = a fatia aguarda o gate `SLICE_ENTRY` da M8-F06 (aprovação da revisão exata da SPEC pelo PI). **É a única aprovação humana do run** — não existe segundo "go" para construir. `Approval` vigente para a revisão da SPEC + MVP aprovado + dependências concluídas é o que leva a `READY` (DECISIONS 2026-08-28 §8; invariante 5 da CONVENTION §4).
- `AWAITING_MERGE` = PR aberto, checks verdes no `head SHA` esperado e merge autônomo **desligado** pelo kill-switch do projeto (M9-F05). Terminal para o run; **não é bloqueio nem falha**. O merge feito depois pelo PI é reconciliado como `MERGED` em continuação vinculada.

Transição inválida é rejeitada. `MERGED`, `AWAITING_MERGE`, `BLOCKED` e `CANCELLED` são terminais para aquele run; retomada de bloqueio cria continuação vinculada quando a causa for resolvida.

## Fila e lease

- Somente fatia com pacote, MVP e SPEC aprovados pode ficar `READY`.
- Dependências precisam estar concluídas.
- Lease tem proprietário, recurso, expiração e heartbeat. O **slot global de WIP é um lease** persistido como os demais.
- Antes de adquirir novo trabalho, o boot executa `reconcileAll`.
- Cada fronteira registra intenção e confirmação.

## Reconciliação

Consultar SQLite, filesystem, Git, GitHub, container e portas do lease. Completar evento pendente quando o efeito já existir; repetir somente operação segura/idempotente; bloquear quando houver risco ao trabalho existente.

## Critérios de aceite

1. DAG rejeita ciclos e dependências ausentes.
2. WIP=1 **global** impede duas fatias simultâneas, inclusive de projetos diferentes; o slot participa de `reconcileAll`.
3. Lease expirado não autoriza roubo antes da reconciliação.
4. Crash antes/depois de efeito converge para um único resultado.
5. Run não pula diretamente para `MERGED`.
6. Bloqueio registra causa, evidência, tentativas, risco e ação.
7. Nenhuma transição sai de `AWAITING_PI` sem `Approval` do gate `SLICE_ENTRY` para a revisão vigente da SPEC; com kill-switch desligado o run termina em `AWAITING_MERGE`, nunca em `BLOCKED`. Teste dos dois caminhos.

## Testes e evidência

Property/unit tests de DAG/estado; integração com relógio controlado e crashes em todas as fronteiras. Relatório `SPEC-Entrega-02`.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **A reconciliação consulta também o container e as portas** do lease (M9-F03), não só SQLite/FS/Git/GitHub — desde a decisão do sandbox, um container órfão é estado tão real quanto um worktree órfão.
- **`reconcileAll` no boot é bloqueante:** nenhum trabalho novo é adquirido antes dela terminar. Já está nas regras; cravado aqui como invariante de inicialização.
- **Lease expirado nunca autoriza roubo direto** — a reconciliação decide, porque a expiração pode significar máquina lenta, não processo morto.

## Emendas (2026-08-30) — revisão de furos de spec, decididas pelo PI

1. **WIP global, não por projeto.** Dois executores na mesma máquina disputariam CPU, portas e a mesma assinatura; concorrência é o MVP-012. Objetivo e critério 2 reescritos.
2. **`AWAITING_MERGE`** entra na máquina de estados: a M9-F05 e a M9-F06 exigiam um terminal "PR verde aguardando o PI" que esta spec não tinha — o Code teria de inventá-lo.
3. **`AWAITING_PI` é o gate `SLICE_ENTRY`**, e só ele. Um segundo "go" seria aceite duplicado (invariante 2 da CONVENTION §4). Critério 7 adicionado.
