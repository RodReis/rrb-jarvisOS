# SPEC-Entrega-03 — Worktree, preflight e Docker

- MVP/Fatia: MVP-009 · M9-F03.
- Issue: [#103](https://github.com/RodReis/rrb-jarvisOS/issues/103).
- Status: **aprovada-pi** (2026-08-29) — o Docker passa a ser o **sandbox do executor** por decisão do PI nesta data, não apenas serviço do projeto.
- Depende de: M9-F02 e SPEC aprovada da fatia-alvo.

## Objetivo

Preparar um ambiente isolado e reproduzível sem tocar o checkout ativo ou colidir com recursos de outros projetos. **O isolamento do executor é o container** (decisão do PI 2026-08-29): o worktree é montado nele e o Claude Code roda lá dentro, nunca no host.

## Fluxo

Resolver/fetch da base → fixar base SHA → criar branch/worktree determinísticos → verificar árvore limpa própria → montar ContextPack → validar provider/GitHub/orçamento/comandos → reservar portas/containers → registrar lease → liberar execução.

## Regras Git/filesystem

- Worktree fica fora do checkout ativo e dentro da raiz operacional validada.
- Diff permitido deriva dos paths da SPEC; expansão exige justificativa registrada.
- Estado inicial é capturado para detectar modificação externa.
- Limpeza só remove path exato pertencente ao lease/projeto.

## Docker

**Duplo papel, decidido em 2026-08-29:** (a) **sandbox do executor** — o container onde o Claude Code roda, com o worktree montado e nada mais; (b) serviços do projeto (banco, cache) quando a SPEC-alvo os exigir. O papel (a) é obrigatório; o (b) só existe se o projeto declarar serviços.

- **Docker ausente ou desligado e que não sobe → `BLOCKED_EXTERNAL`** com ação concreta. **Nunca há fallback para executar no host** — seria justamente o buraco que esta decisão fecha.
- O container recebe worktree, ContextPack e **somente autenticação do executor/MCP aprovada**, por volume/secret dedicado e fora da imagem/worktree/log. Token GitHub, Vault e credenciais do projeto ficam no main.
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
8. **O executor só recebe cwd dentro do container**, com o worktree montado; tentativa de executar no host é impedida. Teste comprova que não existe caminho de execução no host.
9. **Segredo mínimo e segregado:** teste encontra somente mounts de autenticação do executor/MCP declarados; não encontra GitHub, Vault, credencial do projeto nem segredo na imagem, worktree, env exposto, log ou evidência.
10. **Docker indisponível bloqueia o preflight** com `BLOCKED_EXTERNAL` e ação; nenhum executor inicia. Teste.

## Testes e evidência

Integração Git real temporária, colisão de porta/container e validação de path; smoke Docker quando aplicável. Relatório `SPEC-Entrega-03`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Fronteira de isolamento do executor:** **container Docker**. O MVP-004 criou a allowlist de comandos para o app não rodar comando arbitrário, mas o Claude Code precisa rodar comandos arbitrários (test, lint, build) para construir qualquer coisa — a allowlist não pode governá-lo sem inviabilizá-lo. A fronteira passa a ser o container, com o worktree montado; a allowlist de comandos do MVP-004 continua governando o terminal **do usuário**. Descartado executar no host: um agente autônomo teria acesso irrestrito à máquina. **Consequência:** o Docker vira dependência dura do MVP-009, e esta fatia ganha o papel de sandbox além do de serviços do projeto. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **O container é do run, não do projeto:** nome e portas derivam do lease, e a limpeza da M9-F06 o remove. Volume persistente de serviço do projeto continua preservado.
- **Git da pipeline roda no host**, pelo terminal controlado (M8-F01) — commits, push e rebase são atos do app. O agente altera arquivos no worktree montado; quem versiona é o app.
- **Reconciliação de porta antes de subir** vale para os dois papéis do Docker, sandbox incluído.
- **Perfis dedicados:** Claude usa `CLAUDE_CONFIG_DIR` e, na V2, Codex usa `CODEX_HOME`; o PI autentica diretamente no CLI e o app trata apenas referência/status.
