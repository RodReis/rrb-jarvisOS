# SPEC-Entrega-03 — Worktree, preflight e Docker

- MVP/Fatia: MVP-009 · M9-F03.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M9-F02 e SPEC aprovada da fatia-alvo.

## Objetivo

Preparar um ambiente isolado e reproduzível sem tocar o checkout ativo ou colidir com recursos de outros projetos.

## Fluxo

Resolver/fetch da base → fixar base SHA → criar branch/worktree determinísticos → verificar árvore limpa própria → montar ContextPack → validar provider/GitHub/orçamento/comandos → reservar portas/containers → registrar lease → liberar execução.

## Regras Git/filesystem

- Worktree fica fora do checkout ativo e dentro da raiz operacional validada.
- Diff permitido deriva dos paths da SPEC; expansão exige justificativa registrada.
- Estado inicial é capturado para detectar modificação externa.
- Limpeza só remove path exato pertencente ao lease/projeto.

## Docker

- Pode iniciar o serviço quando estiver desligado.
- Reutiliza apenas recurso identificado como pertencente ao mesmo projeto/run.
- Novo recurso recebe nome e porta livres, nunca porta configurada por outro container/projeto.
- Volume persistente não é apagado como limpeza automática.

## Critérios de aceite

1. Executor nunca recebe o checkout ativo como cwd.
2. Branch nasce do SHA registrado.
3. Porta ocupada é detectada antes de subir recurso.
4. Container/porta possuem lease reconciliável.
5. Preflight falho não inicia o executor.
6. Mudança fora do allowlist é detectada antes do commit.
7. Limpeza não alcança path ou recurso não pertencente ao run.

## Testes e evidência

Integração Git real temporária, colisão de porta/container e validação de path; smoke Docker quando aplicável. Relatório `SPEC-Entrega-03`.

