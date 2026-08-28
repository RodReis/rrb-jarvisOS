# SPEC-Entrega-02 — DAG, fila e reconciliação

- MVP/Fatia: MVP-009 · M9-F02.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M9-F01.

## Objetivo

Selecionar somente trabalho aprovado/desbloqueado, executar com WIP=1 por projeto e recuperar estado após interrupção sem duplicar efeitos.

## Estados

`PLANNED → AWAITING_PI → READY → RUNNING → VALIDATING → PR_CI → MERGED | BLOCKED | CANCELLED`.

Transição inválida é rejeitada. `MERGED`, `BLOCKED` e `CANCELLED` são terminais para aquele run; retomada de bloqueio cria continuação vinculada quando a causa for resolvida.

## Fila e lease

- Somente fatia com pacote, MVP e SPEC aprovados pode ficar `READY`.
- Dependências precisam estar concluídas.
- Lease tem proprietário, recurso, expiração e heartbeat.
- Antes de adquirir novo trabalho, o boot executa `reconcileAll`.
- Cada fronteira registra intenção e confirmação.

## Reconciliação

Consultar SQLite, filesystem, Git e GitHub. Completar evento pendente quando o efeito já existir; repetir somente operação segura/idempotente; bloquear quando houver risco ao trabalho existente.

## Critérios de aceite

1. DAG rejeita ciclos e dependências ausentes.
2. WIP=1 impede duas fatias simultâneas do mesmo projeto.
3. Lease expirado não autoriza roubo antes da reconciliação.
4. Crash antes/depois de efeito converge para um único resultado.
5. Run não pula diretamente para `MERGED`.
6. Bloqueio registra causa, evidência, tentativas, risco e ação.

## Testes e evidência

Property/unit tests de DAG/estado; integração com relógio controlado e crashes em todas as fronteiras. Relatório `SPEC-Entrega-02`.

