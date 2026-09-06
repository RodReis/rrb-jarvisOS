# MVP-027 — Política de PR e CI multiplataforma

- Status: definido pelo PI em 2026-09-06; GitHub #313.
- Objetivo: fazer a pipeline gerar, preservar e validar CI segundo o perfil aprovado de cada projeto, com Windows como ambiente primário comprovado e sem falso verde.
- Dependência: MVP-009 Entrega Autônoma concluído.

## Fatias

- [ ] M27-F01 — Política de PR e CI por projeto — [SPEC aprovada](../spec/spec-pipeline-01-politica-pr-ci.md), GitHub #314. A aprovação não altera a cabeça da fila.

## Done do MVP

- Perfis Node/npm e Python/pip validados em Windows/PowerShell.
- Runner remoto respeita OS e shell declarados, sem default oculto para Linux ou Node.
- Workflow humano é preservado; adoção e migração são materiais e rastreáveis.
- Execução única, dependências, paralelismo, concorrência e gate são provados pelos contrafactuais da SPEC.
- Evidência pertence ao projeto, perfil, tentativa e estado Git realmente validados.
