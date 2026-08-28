# SPEC-Planejamento-03 — Wizard orientado

- MVP/Fatia: MVP-008 · M8-F03.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M8-F01 e M8-F02.

## Objetivo

Conduzir o PI por uma decisão de cada vez até eliminar lacunas materiais, com recomendação, impacto, opção livre e “Decide por mim”.

## Contrato da pergunta

- título curto e pergunta objetiva;
- contexto suficiente sem texto excessivo;
- duas ou três opções mutuamente exclusivas;
- opção recomendada primeiro e justificativa;
- impacto/trade-off de cada opção;
- campo livre quando necessário;
- “Decide por mim” quando a decisão for delegável.

## Regras

- Autosalvar antes de avançar e permitir voltar.
- “Decide por mim” registra escolha, recomendação, justificativa e agente; não aprova gates.
- Contradição mostra decisão anterior, impacto e substituição proposta.
- Não criar LGPD, consentimento, aceite duplo, classificação de domínio ou requisito não informado.
- Pergunta irrelevante é omitida; decisão com impacto material não é escondida em default.
- Fechar/reabrir retorna à decisão pendente.

## Critérios de aceite

1. Uma pergunta por pop-up e foco previsível por teclado.
2. Recomendação é distinguível, mas não força a escolha.
3. Delegação deixa trilha auditável.
4. Revisão de resposta recalcula somente dependências afetadas.
5. Contradição nunca é corrigida silenciosamente.
6. Sessão interrompida retoma sem repetir decisões concluídas.
7. Wizard termina com resumo de decisões e lacunas zeradas ou bloqueio explicável.

## Testes e evidência

Unitários do grafo de perguntas; Playwright para escolha, delegação, voltar, contradição, autosave e retomada. Relatório `SPEC-Planejamento-03` com vídeo/screenshot apenas quando útil.

