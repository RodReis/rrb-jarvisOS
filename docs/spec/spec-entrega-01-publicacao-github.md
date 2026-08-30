# SPEC-Entrega-01 — Publicação no GitHub

- MVP/Fatia: MVP-009 · M9-F01.
- Issue: [#101](https://github.com/RodReis/rrb-jarvisOS/issues/101).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; as decisões que a afetam vêm do MVP-006 e da M9-F03. **Emenda 2026-08-30 (Cowork, PI pode vetar; fatia já em andamento — o Code deve ler § Emendas antes de fechar a entrega):** autenticação é Device Flow de usuário, não instalação; repositório só na conta do usuário; proteção de branch indisponível vira limitação explícita; quais issues nascem e com quais rótulos; forma das dependências; `ExternalRef` persistido.
- Dependências: MVP-006 concluído e pacote/MVP/fatia do MVP-008 aprovados.

## Objetivo

Publicar o repositório local e o backlog aprovado no GitHub de forma automática, idempotente e retomável.

## Fluxo

Validar autenticação (token do Device Flow, M6-F03) → `ensureRepository` (conta do usuário) → configurar branch-base/proteção (ou registrar limitação) → publicar commits documentais → `ensureIssue` do MVP e das fatias aprovadas + `ensureSubIssue` → registrar dependências → persistir `ExternalRef` → confirmar referências na origem.

## Regras

- Identificadores externos derivam de projeto, MVP, fatia e revisão.
- Conteúdo já aprovado não recebe nova aprovação para ser publicado.
- Repositório ou issue semelhante sem marcador idempotente não é adotado silenciosamente.
- Push usa a revisão local esperada; divergência preserva ambos os lados e bloqueia se houver risco.
- Nenhuma issue futura equivale a autorização de construção.

## Critérios de aceite

1. Repetir a operação não duplica repositório ou issue.
2. Commits locais aprovados correspondem à branch remota publicada.
3. Issues apontam para MVP, Fatia e SPEC corretos.
4. Dependências são confirmadas ou registradas como limitação explícita.
5. Falta de instalação/permissão gera bloqueio retomável.
6. Reinício após efeito remoto reconcilia antes de repetir.

## Testes, evidência e custo

Integração com GitHub fake e injeção de crash; smoke em repositório exclusivo. Evidência: URLs, IDs e SHAs, nunca tokens. Relatório `SPEC-Entrega-01`.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Todo Git da pipeline usa o mesmo caminho da M8-F01** — `git` do sistema pelo terminal controlado do MVP-004, auditado. Publicar não abre um segundo caminho de escrita.
- **Efeito remoto é do app, não do agente:** `ensureRepository`/`ensureIssue` rodam no main pelo GitHub Adapter (M6-F04). O executor nunca recebe token nem fala com o GitHub.
- **Escopo:** `user_id` + `workspace_id` + `project_id`; aqui o `project_id` já existe (criado no MVP-008).

## Emendas (2026-08-30) — revisão de furos de spec (Cowork; PI pode vetar)

1. **"Instalação" era resquício do desenho GitHub App.** O que existe é o token de usuário do Device Flow (M6-F03); `repo.ensure` cria **só na conta do usuário** (limite registrado da M6-F04). Organização fica fora desta fatia — pedido de publicar em org é `BLOCKED_EXTERNAL` com ação, não tentativa silenciosa.
2. **Proteção de branch pode ser recusada pela origem** (repositório privado em conta sem plano responde `403`). Isso **não bloqueia a publicação**: registra-se como limitação explícita no `ExternalRef` (critério 4), e a M9-F05 lê da origem quais checks são obrigatórios — se nenhum, aplica a regra "sem check não há merge".
3. **Quais issues nascem:** o épico do MVP (`proplan:mvp` ou o rótulo equivalente da Convention do projeto) e **somente as fatias com `SLICE_ENTRY` aprovado** — as demais ficam como checklist no corpo do épico (regra de `card = fatia` só com spec aprovada). A exceção `proplan:planejado` deste repositório **não é exportada** por padrão.
4. **Rótulos vêm da Convention do projeto-alvo**, nunca desta base (a M8-F04 não importa `proplan:`). Se a Convention define rótulos, esta fatia adiciona ao GitHub Adapter a capacidade `label.ensure` (idempotente por nome) — a M6-F04 não a tem. Se não define, nenhum rótulo é aplicado e o estado vive só no app.
5. **Dependência entre fatias** é registrada na forma que este repositório já usa: linha `Bloqueada por: #N` no corpo da issue, mais `ensureSubIssue` ligando a fatia ao épico. GitHub não tem dependência nativa; o fato de referência vive no `ExternalRef`, não no texto.
6. **`ExternalRef` (CONVENTION §4) é saída desta fatia**: repositório, branch-base, número da issue por fatia e SHAs publicados ficam persistidos com escopo — a M9-F05 precisa do número para `refs #N`, e a reconciliação da M9-F02 precisa dos SHAs. Sem isso, cada fatia seguinte teria de redescobrir na origem.
7. **Push nunca usa `--force`.** Divergência (remoto com commit que o local não tem) é `BLOCKED` com os dois SHAs e ação; `--force-with-lease` só sobre branch de run criada por este app e ainda sem PR — nunca sobre a branch-base.
