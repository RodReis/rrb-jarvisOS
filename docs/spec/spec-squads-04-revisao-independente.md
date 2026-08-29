# SPEC-Squads-04 — Revisão independente

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 04).
- Status: **revisão-pi** — implementação não autorizada.
- Depende de: F03 aprovada e entregue.

## Objetivo

Transformar revisão de código e design em tarefas independentes, baseadas no delta exato e no histórico de falhas, sem permitir que o revisor corrija por conta própria.

## Dentro

- Revisores distintos do writer; executor cruzado quando elegível.
- Entrada com SPEC, políticas relevantes, diff/manifesto, testes e achados anteriores ainda abertos.
- Achado estruturado: assinatura, categoria, severidade, localização, evidência, impacto e correção esperada.
- Deduplicação e ciclo de vida `open`, `accepted`, `fixed`, `dismissed`, `superseded`.
- Conflito entre revisores resolvido por evidência/teste ou escalado ao PI quando altera requisito.
- Instruções de `docs/REVIEW.md` com prioridade máxima dentro do escopo permitido.

## Fora

- Revisor escrever código, commit, push ou alterar severidade sem justificativa.
- Reabrir achado resolvido sem novo delta material.
- Inventar requisito, LGPD, consentimento, risco ou aceite não fornecido pelo PI.

## Regras

1. Relatórios anteriores entram para avaliar apenas o novo delta e regressões reais.
2. Severidade segue `docs/REVIEW.md`; ausência de regra não autoriza inventar bloqueio.
3. Achado fora da SPEC é observação separada e não bloqueia a fatia automaticamente.
4. Só o writer consome correções aceitas.

## Critérios de aceite

1. Mesmo problema no mesmo delta gera uma assinatura, não múltiplas falhas.
2. Achado corrigido some ou muda de estado após revalidação objetiva.
3. Revisor não recebe permissão de escrita/Git e não consegue adquiri-la por prompt.
4. Executor cruzado é usado quando disponível; indisponibilidade fica explícita.
5. Conflito sem evidência conclusiva não é resolvido por voto ou autoridade do agente.

## Testes e evidência

- fixtures de achado novo/repetido/corrigido;
- revisão hostil e tentativa de expansão de regra;
- executor cruzado disponível/indisponível;
- relatório versionado por SPEC.

## Perguntas abertas ao PI

Nenhuma. Aguarda aprovação desta revisão exata.
