# SPEC-Entrega-02 — DAG, fila e reconciliação

- MVP/Fatia: MVP-009 · M9-F02.
- Issue: [#102](https://github.com/RodReis/rrb-jarvisOS/issues/102).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; os estados e a reconciliação já refletem as invariantes da CONVENTION §4.
- Depende de: M9-F01.

## Objetivo

Selecionar somente trabalho aprovado/desbloqueado, executar com **um slot global na V1** e recuperar estado após interrupção sem duplicar efeitos. Concorrência começa somente no MVP-012.

## Estados

`PLANNED → AWAITING_PI → READY → RUNNING → VALIDATING → PR_CI → MERGED | BLOCKED | CANCELLED`.

Transição inválida é rejeitada. `MERGED`, `BLOCKED` e `CANCELLED` são terminais para aquele run; retomada de bloqueio cria continuação vinculada quando a causa for resolvida.

## Fila e lease

- Somente fatia com pacote, MVP e SPEC aprovados pode ficar `READY`.
- Dependências precisam estar concluídas.
- Lease tem proprietário, recurso, expiração e heartbeat.
- Antes de adquirir novo trabalho, o boot executa `reconcileAll`.
- Cada fronteira registra intenção e confirmação.
- O slot global é lease persistido e participa de `reconcileAll`; projeto diferente não contorna o WIP da V1.

## Reconciliação

Consultar SQLite, filesystem, Git e GitHub. Completar evento pendente quando o efeito já existir; repetir somente operação segura/idempotente; bloquear quando houver risco ao trabalho existente.

## Critérios de aceite

1. DAG rejeita ciclos e dependências ausentes.
2. WIP global=1 impede duas fatias simultâneas, inclusive de projetos diferentes; a regra será expandida somente pelo MVP-012.
3. Lease expirado não autoriza roubo antes da reconciliação.
4. Crash antes/depois de efeito converge para um único resultado.
5. Run não pula diretamente para `MERGED`.
6. Bloqueio registra causa, evidência, tentativas, risco e ação.

## Testes e evidência

Property/unit tests de DAG/estado; integração com relógio controlado e crashes em todas as fronteiras. Relatório `SPEC-Entrega-02`.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **A reconciliação consulta também o container e as portas** do lease (M9-F03), não só SQLite/FS/Git/GitHub — desde a decisão do sandbox, um container órfão é estado tão real quanto um worktree órfão.
- **`reconcileAll` no boot é bloqueante:** nenhum trabalho novo é adquirido antes dela terminar. Já está nas regras; cravado aqui como invariante de inicialização.
- **Lease expirado nunca autoriza roubo direto** — a reconciliação decide, porque a expiração pode significar máquina lenta, não processo morto.
- **Intenção externa usa `EffectJournal`** da SPEC-Conectores-01; resultado `ambiguous` consulta filesystem/Git/GitHub antes de repetir.
