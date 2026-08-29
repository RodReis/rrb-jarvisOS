# SPEC-Planejamento-05 — Anexos de design e arquitetura

- MVP/Fatia: MVP-008 · M8-F05.
- Issue: [#98](https://github.com/RodReis/rrb-jarvisOS/issues/98).
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M8-F04.

## Objetivo

Exigir que o PI anexe `DESIGN-SYSTEM.md`, protótipos HTML e assets após o PRD; validar coerência e somente então produzir arquitetura e documentos operacionais.

## Gate de anexos

Estado `AWAITING_DESIGN_ATTACHMENTS` até existirem:

- `DESIGN-SYSTEM.md`;
- ao menos um protótipo `.html` cobrindo as jornadas críticas;
- assets locais referenciados.

A IA analisa e propõe ajustes, mas não substitui o ato de anexar. Ajuda de geração pode ser oferecida como fluxo separado, sem marcar o gate como atendido.

## Validação

Verificar links/assets, telas versus PRD, navegação, estados vazio/loading/erro/bloqueio, consistência visual, responsividade básica e contradições. Problemas viram perguntas com recomendação.

## Saídas

- `ARCHITECTURE.md`: módulos, dados, resiliência e fronteiras.
- `DECISIONS.md`: ADRs e decisões estruturais.
- `TESTING.md`: estratégia, evidência e relatório por SPEC.
- `REVIEW.md`: instruções de revisão do projeto.

## Critérios de aceite

1. Arquitetura não é gerada antes dos anexos completos.
2. Asset quebrado ou jornada crítica ausente é mostrado ao PI.
3. Design e arquitetura referenciam a mesma revisão do PRD.
4. Arquitetura não promete fluxo ausente dos protótipos.
5. Ajustes autorizados preservam histórico e autoria.
6. Pacote registra hashes de todos os anexos e saídas.

## Testes e evidência

Fixtures de anexo ausente, links quebrados e fluxo divergente; parser/servidor local para HTML; Playwright nos protótipos. Relatório `SPEC-Planejamento-05`.
