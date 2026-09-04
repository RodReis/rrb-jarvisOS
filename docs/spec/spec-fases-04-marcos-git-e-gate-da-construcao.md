# SPEC-Fases-04 — Marcos Git visíveis e gate da construção

- MVP/Fatia: MVP-026 · M26-F04.
- Issue: [#254](https://github.com/RodReis/rrb-jarvisOS/issues/254); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **aprovada-pi** (2026-09-04) — perguntas respondidas pelo PI nesta data, antes da redação.
- Depende de: M26-F01 (trilha por fase); M8-F01 (Git local, marcos documentais, `GitRunner`); SPEC-Jornada-02..05 (commit por gate); M9-F01 (publicação no GitHub).

## Objetivo

Tornar **visível** que cada documento do planejamento está versionado no Git do projeto e **garantir** que ninguém entra na Construção com marco sem commit ou worktree sujo. Sem chamada de IA.

## O que já existe (não reescrever)

- M8-F01: Git local inicializado na criação; marcos documentais como commits; falha de commit preserva SQLite e oferece retomada.
- SPEC-Jornada-02..05: cada aceite (`BRIEF_ACCEPTED`, `PRD_ACCEPTED`, `PROJECT_PACKAGE`, `MVP_ENTRY`, `SLICE_ENTRY`) grava hash + identidade e cria commit documental.
- M9-F01: publicação do repositório no GitHub acontece na entrada da Construção.

Esta fatia **lê** esses fatos e os apresenta; não cria segundo caminho de escrita no Git (decisão cravada da M9-F01: Git só pelo `GitRunner`).

## Painel de marcos

- Na tela do projeto (F01), seção **Marcos** com uma linha por documento do planejamento: `PROMPT.md`, `BRIEF.md`, `PRD.md`, `LANDSCAPE.md`, `CONVENTION.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `TESTING.md`, `REVIEW.md`, roadmap/MVPs, SPEC aceita.
- Cada linha: estado (`sem revisão` / `revisão sem commit` / `commitado`), hash curto do commit do marco, data, e se o blob no commit **é** a revisão aceita (hash da revisão = `git hash-object` do arquivo no commit).
- Estado do worktree: `limpo` / `sujo` (arquivos listados, sem conteúdo). Estado do remoto quando publicado: `publicado em <sha>` / `não publicado`.
- Ação por linha quando falta commit: **"Commitar marco"**, que chama a retomada da M8-F01 — não um commit novo.
- Leitura pelo `GitRunner` (`status --porcelain`, `log -1 -- <arquivo>`, `hash-object`), auditada como os demais comandos do MVP-004; uma leitura por abertura da seção, com "Verificar de novo".

## Gate da construção

- No aceite da SPEC (`SLICE_ENTRY`), **antes** do `Approval`, roda `verificarMarcos(projectId)` — função determinística:
  1. todo documento com revisão aceita tem commit cujo blob bate com o hash da revisão;
  2. worktree limpo (`status --porcelain` vazio, ignorando o que o `.gitignore` do projeto exclui);
  3. HEAD não está em estado de merge/rebase interrompido.
- Qualquer item falhando → aceite **bloqueado** com `BLOCKED_EXTERNAL`-equivalente do planejamento: motivo por item e ação concreta ("Commitar marco PRD.md", "Descartar ou commitar alterações em …"). Não há "aceitar mesmo assim".
- Verificação registra `AuditEvent` com o resultado (passou/itens); o aceite só prossegue com resultado `ok` do mesmo `HEAD` — se o HEAD mudar entre a verificação e o clique, verifica de novo.
- O preflight da M9-F03 continua rodando depois; esta verificação é do planejamento, não do run.

## Critérios de aceite

1. Painel lista cada documento com estado, hash e coerência blob↔revisão; fixture de repositório com marco faltando mostra `revisão sem commit`.
2. Worktree sujo e remoto não publicado aparecem com os arquivos/o estado, sem expor conteúdo.
3. "Commitar marco" usa a retomada da M8-F01; teste prova que não existe segundo caminho de commit.
4. `verificarMarcos` bloqueia o `SLICE_ENTRY` em cada uma das três condições, com ação por item; com tudo `ok`, o aceite segue como hoje.
5. Verificação e resultado auditados; mudança de HEAD entre verificação e aceite força nova verificação.
6. Leitura do Git passa pelo `GitRunner` e aparece na auditoria de comandos.

## Testes e evidência

Unitários de `verificarMarcos` sobre fixtures de repositório (marco faltando, blob divergente, worktree sujo, rebase interrompido); int-spec com Git real em diretório temporário; Testing Library do painel; Playwright do gate bloqueado → commitar marco → aceite. Relatório `SPEC-Fases-04`. Gate visual do painel.

## Perguntas resolvidas pelo PI (2026-09-04)

1. **Painel de marcos + bloqueio no gate da SPEC.** Descartado "só painel" e "só bloqueio". — decidido.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **Coerência blob↔revisão, não só "existe commit".** Um commit antigo de `PRD.md` com o PI tendo aceitado uma revisão posterior é exatamente o caso em que "está no Git" seria falso.
- **Sem "aceitar mesmo assim".** A regra é do PI ("antes da construção os documentos precisam estar versionados"); um bypass a transformaria em sugestão.
