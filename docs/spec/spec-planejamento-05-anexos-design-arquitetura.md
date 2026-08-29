# SPEC-Planejamento-05 — Anexos de design e arquitetura

- MVP/Fatia: MVP-008 · M8-F05.
- Issue: [#98](https://github.com/RodReis/rrb-jarvisOS/issues/98).
- Status: **aprovada-pi** (2026-08-29) — forma do anexo resolvida pelo PI nesta data.
- Depende de: M8-F04.

## Objetivo

Exigir que o PI anexe `DESIGN-SYSTEM.md`, protótipos HTML e assets após o PRD; validar coerência e somente então produzir arquitetura e documentos operacionais.

## Gate de anexos

Estado `AWAITING_DESIGN_ATTACHMENTS` até existirem:

- `DESIGN-SYSTEM.md`;
- ao menos um protótipo `.html` cobrindo as jornadas críticas;
- assets locais referenciados.

A IA analisa e propõe ajustes, mas não substitui o ato de anexar. Ajuda de geração pode ser oferecida como fluxo separado, sem marcar o gate como atendido.

**Forma do anexo (decisão do PI 2026-08-29):** **seletor de arquivos na UI**, que **copia** o arquivo escolhido para dentro do diretório do projeto e calcula o **hash no instante do anexo**. Não há varredura de pasta convencionada: o gate conta a partir de um ato explícito e auditável, com instante definido.

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
7. **Anexo é ato explícito:** o arquivo é escolhido no seletor, copiado para o projeto e hasheado no ato, gerando `AuditEvent`. Arquivo largado no diretório por fora **não** satisfaz o gate. Teste dos dois casos.

## Testes e evidência

Fixtures de anexo ausente, links quebrados e fluxo divergente; parser/servidor local para HTML; Playwright nos protótipos. Relatório `SPEC-Planejamento-05`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Como o PI anexa `DESIGN-SYSTEM.md`, protótipos e assets:** **seletor de arquivos na UI**, que copia para o projeto e registra hash no instante do anexo. Descartado detectar arquivos largados numa pasta convencionada: exigiria varredura do filesystem e tornaria ambíguo o instante em que o anexo passa a contar para o gate — justamente o que este gate precisa ter preciso. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **O seletor copia, não referencia.** Um caminho externo continuaria fora da allowlist e poderia sumir; o projeto guarda a cópia e o hash dela.
- **A IA propõe ajuste, o PI autoriza** — ajuste aplicado preserva histórico e autoria (critério 5), então a proposta da IA nunca sobrescreve o anexo original em silêncio.
- **Protótipos são servidos localmente para validação** (parser/servidor local + Playwright), nunca abertos com origem remota.
