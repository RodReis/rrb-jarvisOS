# SPEC-Jornada-03 — PRD, Landscape e Convention por IA

- MVP/Fatia: MVP-025 · M25-F03.
- Issue: [#240](https://github.com/RodReis/rrb-jarvisOS/issues/240); épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237).
- Status: **aprovada-pi** (2026-09-03) — perguntas abertas resolvidas pelo PI nesta data.
- Depende de: M25-F02; M6-F05/F06 (Tavily Search e Extract); M8-F04 (verificador de evidência, marcos e commit documental).

## Objetivo

Gerar `PRD.md`, `LANDSCAPE.md` e `CONVENTION.md` a partir do **brief aceito** e de evidência extraída, com origem por afirmação, e submetê-los ao gate `PRD_ACCEPTED`. Substitui a composição da M8-F04; mantém o que dela é garantia (evidência extraída, bloqueio sem fonte, commit por marco).

## Entrada

- `BRIEF.md` na revisão aceita (hash), decisões vigentes, prompt.
- Termo de pesquisa de mercado **gerado pela IA a partir do brief** e exibido ao PI para editar antes de pesquisar; o PI pode deixar sem pesquisa, e o Landscape declara isso.

## Geração

1. **Pesquisa**: Tavily Search descobre, Extract confirma (M8-F04). Evidência persistida antes de virar afirmação.
2. **PRD**: problema, usuários, jornadas, escopo, não objetivos, critérios de sucesso, restrições e questões pendentes (SPEC-Planejamento-04). Cada requisito com origem `brief` (com âncora na afirmação do brief), `decisao`, `evidencia` ou `proposto`.
3. **Landscape**: cenário, alternativas, diferenciação, incertezas e gatilhos de revisão. Toda afirmação sobre terceiros exige `evidencia` (URL, data, trecho, hash) — a IA **sintetiza** sobre evidência; conclusão sem evidência só pode existir como `proposto` e marcada como hipótese.
4. **Convention**: entidades, estados, invariantes e vocabulário **do projeto**. Regra sem origem `brief`/`decisao` é `proposto`; política de outro projeto (incluindo `proplan:*` deste repositório) continua proibida.
5. Validador de saída (mesmo da F02): origem obrigatória, invariante 9, schema. Contradição entre documentos ou com o brief vira pergunta ao PI com recomendação (M8-F03), não correção silenciosa.
6. Gate `PRD_ACCEPTED`: os três documentos, a lista de `proposto` por documento e as pendências. Aceite grava hashes + identidade, commit documental `prd-aprovado`, etapa `prd-aceito`.

## Regras

- Falha de pesquisa: `BLOCKED_EXTERNAL` com os cinco campos da CONVENTION §4; **PRD e Convention não são bloqueados por ela** — só o Landscape fica pendente, e o gate `PRD_ACCEPTED` exibe o bloqueio (decisão do PI 2026-09-03).
- Regerar sobre o mesmo brief e a mesma evidência pode produzir texto diferente; **a revisão é o hash do conteúdo**, e o PI aceita uma revisão exata. Regenerar depois de aceitar cria revisão nova e reabre o gate — nunca substitui a aceita.
- Rota de assinatura e bloqueio antes de rota paga, como na F02.

## Critérios de aceite

1. Nenhum requisito do PRD sem origem; origem `brief` aponta para afirmação existente na revisão aceita.
2. Afirmação sobre terceiro no Landscape sem `evidencia` extraída não passa no validador.
3. Termo de pesquisa é editável pelo PI antes da chamada; pesquisa não roda sem confirmação.
4. Sem credencial Tavily, PRD e Convention são gerados e o Landscape declara bloqueio com retomada.
5. Convention não contém regra de outro projeto (teste da M8-F04 mantido) e não contém `proposto` não listado.
6. Contradição detectada vira pergunta; nenhuma é resolvida sem resposta.
7. Aceite grava a revisão exata dos três; regenerar após o aceite não altera a revisão aceita.
8. Commit documental automático no aceite; falha de commit preserva SQLite e oferece retomada (M8-F01).

## Testes e evidência

Fixtures de brief completo/contraditório; evidência ausente/hostil (M8-F04); validador de origem e invariante 9; Playwright do termo → gate com propostos por documento. Smoke real com Tavily e Claude Code CLI fora da suíte, com teto de créditos. Relatório `SPEC-Jornada-03`.

## Perguntas resolvidas pelo PI (2026-09-03)

1. **PRD pode ser aceito sem pesquisa de mercado.** O PRD depende do brief, não do mercado; o Landscape fica pendente e visível como bloqueio até ser gerado. Descartado o bloqueio total da M8-F04 (sem Tavily não haveria aceite). — decidido.
2. **Termo de pesquisa é proposto pela IA a partir do brief; o PI edita e confirma.** A pesquisa não roda sem confirmação. Descartado o campo livre vazio de hoje. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Síntese sobre evidência é permitida; fonte fabricada não.** O limite da M8-F04 ("síntese seria conclusão sem evidência") é substituído por síntese **com** as evidências citadas por afirmação, verificáveis pelo verificador da M6-F06.
- **Origem `brief` é âncora, não texto**: o PRD referencia o id da afirmação do brief, para que "todo requisito material possui origem" (critério 1 da SPEC-Planejamento-04) seja checável por máquina.

## Emenda E1 — contradição vira pergunta respondível (decisões do PI, 2026-09-06)

Achado pelo PI ao gerar o PRD em 2026-09-06 (issue [#307](https://github.com/RodReis/rrb-jarvisOS/issues/307)): as contradições apareciam como cartões só de leitura, sem lugar para responder. O item 5 de § Geração já manda que contradição *"vira pergunta ao PI com recomendação (M8-F03)"*; esta emenda fixa o que faltava decidir.

1. **A contradição é uma pergunta no contrato da M8-F03**: título, enunciado, 2–3 opções excludentes com impacto, recomendada primeiro com justificativa, texto livre quando couber, "Decide por mim" quando delegável. Ela é respondida **no pop-up** do wizard — uma por vez —, nunca num formulário inline. O modelo gera a pergunta inteira; pergunta fora do contrato é recusada pelo validador e a etapa `contradicoes` falha (fail closed).
2. **A resposta é uma `Decision` gravada** (`etapa: 'prd'`), pelo mesmo canal das decisões do refinamento, e entra no pedido de geração como decisão citável (origem `decisao`). "Decide por mim" grava com o agente como autor e **não aprova o gate**. *Correção [#316](https://github.com/RodReis/rrb-jarvisOS/issues/316) (2026-09-06): a mesma lista de decisões entra também na **detecção** de contradições — conflito que uma decisão já tomada resolve não é contradição e não volta como pergunta. Sem isso o brief aceito seguia afirmando um lado, o PRD novo o outro, e o laço deste item nunca convergia.*
3. **Ao responder a última contradição, os três documentos são gerados de novo, sozinhos**, com o termo de pesquisa confirmado — criando uma revisão nova candidata (critério 7 mantido: o aceite é por revisão exata). A regeração **parcial** (só as afirmações afetadas) fica para uma entrega posterior.
4. **O aceite continua sendo o clique do PI**, com o gate travado enquanto a revisão vigente tiver contradição.
