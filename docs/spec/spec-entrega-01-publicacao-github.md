# SPEC-Entrega-01 — Publicação no GitHub

- MVP/Fatia: MVP-009 · M9-F01.
- Status: **revisão documental; implementação não autorizada**.
- Dependências: MVP-006 concluído e pacote/MVP/fatia do MVP-008 aprovados.

## Objetivo

Publicar o repositório local e o backlog aprovado no GitHub de forma automática, idempotente e retomável.

## Fluxo

Validar autenticação/instalação → `ensureRepository` → configurar branch-base/proteção → publicar commits documentais → `ensureIssue` do MVP/fatias → registrar dependências → confirmar referências na origem.

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

