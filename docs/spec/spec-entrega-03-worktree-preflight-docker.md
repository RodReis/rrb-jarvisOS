# SPEC-Entrega-03 — Worktree, preflight e Docker

- MVP/Fatia: MVP-009 · M9-F03.
- Issue: [#103](https://github.com/RodReis/rrb-jarvisOS/issues/103).
- Status: **aprovada-pi** (2026-08-29) — o Docker passa a ser o **sandbox do executor** por decisão do PI nesta data, não apenas serviço do projeto. **Emenda 2026-08-30 (PI):** autenticação do executor por **proxy no host** (critério 9 mantido literal); fonte dos paths permitidos, Git dentro do container e rede do container definidos (ver § Emendas).
- Depende de: M9-F02 e SPEC aprovada da fatia-alvo.

## Objetivo

Preparar um ambiente isolado e reproduzível sem tocar o checkout ativo ou colidir com recursos de outros projetos. **O isolamento do executor é o container** (decisão do PI 2026-08-29): o worktree é montado nele e o Claude Code roda lá dentro, nunca no host.

## Fluxo

Resolver/fetch da base → fixar base SHA → criar branch/worktree determinísticos → verificar árvore limpa própria → montar ContextPack → validar provider/GitHub/orçamento/comandos → reservar portas/containers → registrar lease → liberar execução.

## Regras Git/filesystem

- Worktree fica fora do checkout ativo e dentro da raiz operacional validada.
- Diff permitido deriva dos **paths permitidos** da fatia. A SPEC gerada pela M8-F06 **não tem seção de paths**; a fonte é a seção `## Paths permitidos` da SPEC quando existir e, na sua ausência, o preflight **deriva e registra** a lista a partir da arquitetura aprovada (`ARCHITECTURE.md` do pacote: módulos citados pela fatia) mais `docs/` do projeto-alvo. A lista derivada entra no `ContextPack` e na evidência do run — o que vale para o critério 6 é a lista registrada, nunca uma inferência no momento do commit. Expansão exige justificativa registrada.
- Estado inicial é capturado para detectar modificação externa.
- Limpeza só remove path exato pertencente ao lease/projeto.

## Docker

**Duplo papel, decidido em 2026-08-29:** (a) **sandbox do executor** — o container onde o Claude Code roda, com o worktree montado e nada mais; (b) serviços do projeto (banco, cache) quando a SPEC-alvo os exigir. O papel (a) é obrigatório; o (b) só existe se o projeto declarar serviços.

- **Docker ausente ou desligado e que não sobe → `BLOCKED_EXTERNAL`** com ação concreta. **Nunca há fallback para executar no host** — seria justamente o buraco que esta decisão fecha.
- O container do executor recebe **o worktree e o ContextPack**, e **nenhum segredo**: token do GitHub, credenciais do Vault e chaves de provider ficam no main. **O executor autentica por proxy no host** (decisão do PI, 2026-08-30): o container recebe só `ANTHROPIC_BASE_URL` apontando para um endpoint do main, que injeta a credencial/sessão da rota escolhida (assinatura ou API paga) e registra uso no ponto único (`AiCallService`, ledger e gate de orçamento do MVP-005). Nenhuma chave ou sessão do `~/.claude` do host é montada.
- **Rede do container:** egress permitido só para o proxy do host e para os destinos que o `ContextPack` declara (registro de pacotes do projeto e o MCP do Context7 da M9-F04); `api.github.com` e demais hosts são negados. "O executor nunca fala com o GitHub" é garantido por rede, não por instrução ao agente.
- **Git dentro do container:** o `.git` de um worktree é um arquivo apontando para caminho **do host**; montado sozinho, `git` no container quebra — e o Claude Code roda `git status/diff` o tempo todo. O preflight monta o worktree com o `gitdir` reescrito para o caminho dentro do container e o diretório `.git/worktrees/<lease>` do repositório principal **somente leitura**; o repositório principal não é montado. Quem versiona (commit, push, rebase) continua sendo o app, no host.
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
9. **Nenhum segredo entra no container.** Teste inspeciona ambiente e montagens do container e não encontra token, chave ou credencial.
10. **Docker indisponível bloqueia o preflight** com `BLOCKED_EXTERNAL` e ação; nenhum executor inicia. Teste.
11. **Proxy é o único caminho até o modelo:** teste comprova que o container não tem credencial de provider e que a chamada do executor chega ao `AiCallService` do host com `CostEvent`/`AuditEvent` atribuídos ao run e à tentativa. Sem o proxy no ar, o preflight falha.
12. **Egress restrito:** teste comprova que, de dentro do container, `api.github.com` é inalcançável e o proxy do host é alcançável.
13. **Lista de paths permitidos existe antes de o executor iniciar**, registrada no `ContextPack` com a origem (`spec` ou `derivada`); sem lista, o preflight falha.

## Testes e evidência

Integração Git real temporária, colisão de porta/container e validação de path; smoke Docker quando aplicável. Relatório `SPEC-Entrega-03`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Fronteira de isolamento do executor:** **container Docker**. O MVP-004 criou a allowlist de comandos para o app não rodar comando arbitrário, mas o Claude Code precisa rodar comandos arbitrários (test, lint, build) para construir qualquer coisa — a allowlist não pode governá-lo sem inviabilizá-lo. A fronteira passa a ser o container, com o worktree montado; a allowlist de comandos do MVP-004 continua governando o terminal **do usuário**. Descartado executar no host: um agente autônomo teria acesso irrestrito à máquina. **Consequência:** o Docker vira dependência dura do MVP-009, e esta fatia ganha o papel de sandbox além do de serviços do projeto. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **O container é do run, não do projeto:** nome e portas derivam do lease, e a limpeza da M9-F06 o remove. Volume persistente de serviço do projeto continua preservado.
- **Git da pipeline roda no host**, pelo terminal controlado (M8-F01) — commits, push e rebase são atos do app. O agente altera arquivos no worktree montado; quem versiona é o app.
- **Reconciliação de porta antes de subir** vale para os dois papéis do Docker, sandbox incluído.
- **Todo comando de validação disparado pelo app** (test/lint/type/build da M9-F04/F05) também roda **dentro do container** — rodar código recém-escrito pelo agente no host seria a fuga do sandbox que a decisão 1 fecha.

## Emendas (2026-08-30) — revisão de furos de spec, decididas pelo PI

1. **Autenticação do executor.** A versão anterior ("nenhum segredo entra no container") deixava o Claude Code sem como chamar modelo — a assinatura MAX vive em `~/.claude` do host. Alternativas postas ao PI: proxy no host (escolhida), volume dedicado só com a credencial do executor (`CLAUDE_CONFIG_DIR`), ou executor no host. O proxy preserva o critério 9 literal e mantém o ledger no ponto único do MVP-005. **Custo declarado:** o proxy não existe hoje e é escopo desta fatia.
2. **Paths permitidos:** a SPEC gerada não os traz; a regra passa a nomear a fonte e a exigir a lista registrada antes da execução (critério 13). **A derivação a partir da arquitetura é decisão cravada pelo Cowork, não do PI — PI pode vetar.** Alternativa: emendar a M8-F06 para a SPEC gerada nascer com `## Paths permitidos` (reabre uma fatia já entregue; vira `[FIX]` ou fatia nova).
3. **Git no container e rede** eram lacunas técnicas que a spec tratava como triviais; agora estão escritas para o Code não ter de decidir sozinho.
4. **Validações do app no container** — estava implícito e é a diferença entre sandbox e teatro.
