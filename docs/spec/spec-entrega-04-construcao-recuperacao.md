# SPEC-Entrega-04 — Construção e recuperação

- MVP/Fatia: MVP-009 · M9-F04.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M9-F03 e adapter Claude Code do MVP-005.

## Objetivo

Executar Claude Code no worktree aprovado, validar continuamente e recuperar até duas vezes usando somente delta e falhas relevantes.

## Entrada do executor

SPEC/hashes aprovados, ContextPack, paths permitidos, comandos de validação, `REVIEW.md`, orçamento, tentativa e falhas abertas. Segredos e relatórios resolvidos não entram.

## Regras

- Máximo de três tentativas totais: inicial + duas recuperações.
- Escolha técnica reversível dentro da SPEC é autônoma e registrada.
- Requisito de produto ausente não é inferido.
- Documento/ADR auxiliar é atualizado no mesmo PR, sem bloquear depois do gate.
- TDD é obrigatório quando a SPEC envolver isolamento, autorização, idempotência financeira ou outra invariante crítica explicitamente existente.
- Timeout/cancelamento mata a árvore de processos e preserva evidência.
- Recuperação recebe diff atual, erros novos e histórico resumido; não relê o repositório inteiro por padrão.

## Classificação

- Corrigível: teste/lint/type/build, revisão, CI ou conflito solucionável dentro da SPEC.
- PI: mudança de produto, contradição estrutural ou escolha irreversível material.
- Externo: auth, quota, serviço ou infraestrutura sem alternativa autorizada.
- Risco do usuário: potencial de sobrescrever trabalho existente.

## Critérios de aceite

1. Comando e cwd são controlados pelo adapter.
2. Tentativa excedente é impedida.
3. Recuperação não repete descoberta resolvida.
4. Alteração fora do escopo bloqueia commit e traz diff.
5. Cancelamento não deixa subprocesso órfão.
6. Custo/tokens são atribuídos por tentativa.
7. Falha terminal contém ação mínima de retomada.

## Testes e evidência

Adapter fake nas suítes comuns; fixtures de timeout/cancelamento/falha repetida/nova; smoke Claude real limitado. Relatório `SPEC-Entrega-04`.

