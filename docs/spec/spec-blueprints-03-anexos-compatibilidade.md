# SPEC-Blueprints-03 — Anexos, compatibilidade e evolução

- MVP/Fatia: MVP-023 · M23-F03.
- Issue: [#216](https://github.com/RodReis/rrb-jarvisOS/issues/216); épico [#212](https://github.com/RodReis/rrb-jarvisOS/issues/212).
- Status: **aprovada-pi** em 2026-08-31, revisão exata `6a6e702a4d6ced5820d3f4c7674d6278f0b2d391`.
- Design: `docs/superpowers/specs/2026-08-31-mvp-023-blueprints-design.md`.
- Depende de: [#215](https://github.com/RodReis/rrb-jarvisOS/issues/215), [#98](https://github.com/RodReis/rrb-jarvisOS/issues/98), [#99](https://github.com/RodReis/rrb-jarvisOS/issues/99).
- Rastreabilidade: B-FR04/B-FR05/B-NFR01; requisitos definidos no design, não escopo novo.
- Implementação: não iniciada; o aceite habilita o Backlog, sem alterar `next` ou a fila.

## Objetivo e fronteira

Tratar anexos do blueprint como candidatos e oferecer evolução opcional de instâncias com comparação e preservação das edições. Não anexar pelo PI automaticamente nem transportar aprovações.

## Contrato e ownership

DESIGN-SYSTEM.md, HTML e assets copiados mantêm proveniência de blueprint, mas não têm evento de anexo do PI. Após o PRD, o seletor do M8-F05 recebe a escolha explícita do PI e registra arquivos/hash pelo contrato existente. Só esse fluxo satisfaz o requisito de anexo. A biblioteca não dispara validação executável por importar/clicar no catálogo. Compatibilidade informa versão do schema de blueprint e contrato de planejamento consumido; incompatível explica o motivo sem migração tácita.

## Fluxo

Comparar revisão originalmente instanciada (base), revisão candidata e draft local atual. Mudança somente na origem vira candidata ao plano; somente local é preservada; mudança nos dois lados gera conflito a resolver. Exclusão na origem nunca apaga arquivo local automaticamente. O PI escolhe alterações do plano, não reaprova a revisão antiga. Aplicação gera nova revisão documental; M8-F05/F06 calculam materialidade, invalidação dos dependentes não executados e carry-forward existente. Nenhuma Approval é copiada ou reescrita pela biblioteca.

## Falhas, limites e retomada

Plano de evolução fixa as três revisões e hashes. Compare-and-set no dono antes da aplicação; se o usuário editar depois da comparação, o plano fica em conflito e requer recomposição. Retry usa o mesmo ID/recibos; nenhum Git reset, overwrite global ou atualização em massa. Projeto aprovado continua operacional se ignorar atualização ou se o blueprint sumir. Retomada/cancelamento mantêm alterações já confirmadas e exibem resultado parcial. Comparação respeita os limites por pacote da F01; sem varredura do repositório inteiro.

## Destinos planejados e disciplina

Reutilizar TypeScript/Electron, armazenamento e IPC existentes: `src/shared/domain/blueprints.ts`, `src/shared/contracts/blueprints.ts`, `src/main/blueprints/` e testes junto aos módulos. Migrations, quando necessárias, são incrementais no banco existente, sem serviço novo obrigatório. O implementador adapta paths à organização vigente e registra o recorte antes de executar; não há arquivos implementados alegados aqui.

Escolha técnica reversível dentro deste contrato é autônoma e registrada no PR. SPEC, domínio, gates, gasto e ações externas não são ampliados. Revisão lê `docs/REVIEW.md` e achados anteriores; correção ganha regressão verificável. Git segue o fluxo automático do projeto sem sobrescrever trabalho local ou fechar a issue pelo merge.

## Critérios de aceite

1. Cópia de DS/HTML não cria evento de anexo nem libera gate visual.
2. Anexação explícita posterior ao PRD usa o seletor e auditoria M8-F05.
3. Origem/revisão/hash de cada candidato permanece rastreável após anexo.
4. Blueprint incompatível informa contrato divergente e não migra silenciosamente.
5. Comparação distingue mudança de origem, edição local e conflito bilateral.
6. Exclusão no template não apaga arquivo local automaticamente.
7. Edição concorrente invalida plano antigo antes de sobrescrever conteúdo.
8. Aplicação cria revisão nova e delega impacto/carry-forward ao dono dos gates.
9. Approval de template/projeto anterior nunca é transportada ou alterada.
10. Retry e crash não duplicam revisão/efeito; cancelamento relata parcialidade.
11. Rejeitar atualização ou perder catálogo não bloqueia projeto já instanciado.
12. Fixtures provam atualização sem conflito, conflito bilateral, anexos e preservação de gates.

## Testes e evidência da implementação futura

Contratos puros com relógio/identidades controlados; integração com SQLite/filesystem temporários; injeção de falha nos pontos descritos e prova de não duplicação. Fakes de fronteiras externas não substituem a implementação real do núcleo da fatia. A suíte padrão não exige credenciais, instalação de CLI ou gasto.

Executar os scripts existentes de typecheck, lint, testes e build; relatório gerado em `reports/TESTS.md` conforme `docs/TESTING.md`. Evidência humana aponta critério, commit, ambiente, resultado e referência da prova, sem fabricar números. Smoke externo ausente é `not_run`, não `pass`. Documento/ADR auxiliar é atualizado no mesmo PR, sem aceite duplo. Planejamento completo não é implementação concluída.

## Encerramento documental

Não há decisão estrutural delegada implicitamente à construção. Limites e desenhos acima foram aceitos na revisão exata registrada. Dependências, fila e anexos visuais quando aplicáveis permanecem requisitos de entrada; o aceite não inicia código por inferência.
