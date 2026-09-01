# SPEC-Scheduler-03 — Isolamento concorrente

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 03).
- Issue: [#130](https://github.com/RodReis/rrb-jarvisOS/issues/130); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F02 aprovada e entregue.

## Objetivo

Garantir que cada fatia concorrente tenha worktree, branch, container, portas, volumes, sessão e leases próprios.

## Dentro

- Workspace gerido por `run_id`, criado da revisão-base reconciliada.
- Branch determinística e exclusiva por fatia/attempt conforme política Git automática.
- Container/rede/volumes temporários identificados e etiquetados.
- Alocação de portas inéditas entre runs ativos, sem reutilizar portas já configuradas por outro container.
- Perfis Claude/Codex montados conforme executor, sem compartilhamento de diretório gravável entre runs.
- Inventário durável de recursos para recuperação e limpeza segura.

## Fora

- Escrever no checkout ativo do usuário.
- Compartilhar worktree/container entre fatias para economizar recurso.
- Colocar GitHub/Vault/segredos do projeto dentro do container.
- Limpeza de branch/PR remoto.

## Regras

1. Repositório existente é registrado no lugar; sua árvore ativa nunca é alterada.
2. Recursos são criados com nomes/labels verificáveis, não descobertos por glob destrutivo.
3. Porta é reservada antes de subir o container e liberada após confirmação de parada.
4. Limpeza só atinge recursos ligados ao run reconciliado.

## Critérios de aceite

1. Duas fatias simultâneas possuem paths, branches, containers, portas e leases distintos.
2. Mudança em um worktree não aparece no outro nem no checkout do usuário.
3. Nenhuma porta já configurada/ativa é reutilizada.
4. Scanner confirma ausência de credenciais proibidas em ambos os containers.
5. Crash permite reencontrar e reconciliar cada recurso sem afetar o outro run.

## Testes e evidência

- integração com dois worktrees/containers;
- colisão de porta e nome;
- crash durante criação e limpeza;
- inventário antes/depois com ausência de órfãos.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
