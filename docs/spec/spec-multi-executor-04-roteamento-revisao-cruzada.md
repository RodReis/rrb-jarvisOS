# SPEC-Multi-Executor-04 — Roteamento, fallback e revisão cruzada

- MVP: `docs/mvp/mvp-010-multi-executor.md` (Fatia 04).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F03 aprovada e entregue.

## Objetivo

Escolher executor e revisor por regra explícita de projeto/tarefa, usando disponibilidade e cobrança sem duplicar implementação nem repetir efeito confirmado.

## Dentro

- Preferência ordenada de executor por projeto e tipo de tarefa.
- Elegibilidade por health, capacidade, modo de cobrança, teto, contexto e política.
- Fallback somente entre rotas previamente autorizadas.
- Um `writer_lease` por fatia; troca de executor exige reconciliação do delta, sessão e efeitos.
- Revisão cruzada pelo executor não escritor quando disponível; fallback para revisão independente no mesmo executor quando não houver alternativa.
- Achados com assinatura, severidade, evidência, revisão analisada e estado de resolução.
- Auditoria da seleção, exclusão, fallback, espera e revisor.

## Fora

- Duas implementações da mesma fatia para comparação.
- Fallback silencioso de assinatura para crédito/API.
- Revisor alterando worktree, Git ou escopo.
- Squads e múltiplos workers; MVP-011.

## Regras

1. Falha do writer não libera segundo writer até reconciliar o worktree e o `EffectJournal`.
2. O revisor recebe o delta canônico e falhas anteriores abertas, não o repositório inteiro por padrão.
3. Achado já resolvido não retorna como novo sem novo delta material.
4. Ausência do executor cruzado não bloqueia quando a política admite revisão independente alternativa.
5. Nenhuma rota monetária é inferida pela indisponibilidade da assinatura.

## Critérios de aceite

1. Mesma fatia executa por Claude ou Codex sem mudança no kernel.
2. Indisponibilidade do preferido escolhe apenas rota elegível e registra o motivo.
3. Crédito/API desautorizado produz espera ou bloqueio, nunca cobrança.
4. Troca após falha não repete efeito `confirmed` nem cria writer concorrente.
5. Quando ambos estão disponíveis, executor diferente revisa o delta do writer.
6. Revisão usa o head/revisão exatos e deduplica histórico de falhas.

## Testes e evidência

- matriz de seleção/fallback/cobrança;
- crash entre escrita e troca de executor;
- revisão cruzada com achado novo, repetido e resolvido;
- auditoria completa da decisão.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
