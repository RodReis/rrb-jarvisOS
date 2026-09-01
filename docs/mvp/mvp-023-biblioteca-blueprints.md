# MVP-023 — Biblioteca de Blueprints

- Status: **design e quatro SPECs aprovados pelo PI** em 2026-08-31, revisão exata `6a6e702a4d6ced5820d3f4c7674d6278f0b2d391`; implementação não iniciada e sujeita à fila.
- GitHub: [#212](https://github.com/RodReis/rrb-jarvisOS/issues/212); fatias no índice canônico `docs/STATUS.md`.
- Direção: Pipeline V3; design `docs/superpowers/specs/2026-08-31-mvp-023-blueprints-design.md`.
- Dependência funcional: MVP-008, planejamento governado. Não depende de memória, Graphify, aprendizado ou Portfólio.
- Numeração: a direção “MVP-017 — Biblioteca de Blueprints” da versão inicial da V3 passa a **MVP-023**; MVP-017 do Command Center e suas issues não são renumerados.

## Resultado

Reutilizar padrões locais de PRD, arquitetura, SPEC, documentos operacionais e perguntas, por cópia versionada/editável. Um blueprint é ponto de partida, não aprovação nem instrução com autoridade sobre o projeto.

## Fatias e ordem

| Fatia | SPEC | Dependência | Resultado |
|---|---|---|---|
| M23-F01 ([#214](https://github.com/RodReis/rrb-jarvisOS/issues/214)) | `spec-blueprints-01-catalogo-revisoes.md` | M8-F06 | Catálogo local, manifesto, compatibilidade e revisão imutável |
| M23-F02 ([#215](https://github.com/RodReis/rrb-jarvisOS/issues/215)) | `spec-blueprints-02-instanciacao-wizard.md` | F01; M8-F03 | Cópia idempotente para rascunho e perguntas do wizard existente |
| M23-F03 ([#216](https://github.com/RodReis/rrb-jarvisOS/issues/216)) | `spec-blueprints-03-anexos-compatibilidade.md` | F02; M8-F05/F06 | Anexos candidatos, evolução explícita e impacto por revisão |
| M23-F04 ([#217](https://github.com/RodReis/rrb-jarvisOS/issues/217)) | `spec-blueprints-04-interface-resiliencia-e2e.md` | F03 | Interface, recuperação e prova integrada |

As quatro SPECs receberam `aprovada-pi` para a revisão exata registrada; alterações técnicas posteriores exigem nova revisão.

## Dentro

- catálogo no armazenamento local existente, filtros e descontinuação;
- pacote sem código executável, versionado e validado;
- proveniência da cópia e edição independente pelo projeto;
- perguntas orientadas com recomendação e “Decide por mim”, conforme M8-F03;
- compatibilidade declarada, conflito explícito, atualização por novo rascunho;
- teste de retomada sem duplicação, alteração de aprovações ou sobrescrita de trabalho.

## Fora

- marketplace, download/sincronização remota, monetização ou novo serviço;
- executar scripts/hooks, instalar dependências ou iniciar construção;
- extrair automaticamente projetos inteiros, segredos ou memórias para publicação;
- herdar aprovação de projeto, MVP ou SPEC de outro projeto;
- substituir mecanismos de orçamento, Git, anexos, wizard ou políticas.

## Fechamento verificável

Um PI seleciona uma revisão local, obtém rascunho editável com origem rastreada, responde somente perguntas aplicáveis, anexa os designs após o PRD pelo ato exigido e percorre os gates existentes. Atualizar o blueprint não modifica instâncias anteriores. Interrupção/retry não duplica projeto, documentos ou efeitos Git.

## Antes da construção

O aceite das quatro SPECs habilita o Backlog, sem alterar `next`. A F04 exige `DESIGN-SYSTEM.md` e protótipos HTML formais anexados pelo PI; este pacote não afirma que eles existem. Templates de design são candidatos locais, não satisfazem automaticamente o gate de anexos.
