# SPEC-Contínuo-05 — Jornada multi-MVP

- MVP: `docs/mvp/mvp-013-execucao-continua.md` (Fatia 05) — **fecha o MVP-013 e a Pipeline V2**.
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F04 aprovada e entregue.

## Objetivo

Provar que a pipeline atravessa várias fatias e mais de um MVP já aprovados até drenar o DAG autorizado ou produzir bloqueio preciso, sem deploy e sem substituir o PI.

## Dentro

- Repositório exclusivo com roadmap de múltiplos MVPs/fatias, incluindo ramos independentes e dependentes.
- Execução por Claude/Codex, Squads limitados, até duas fatias concorrentes e merges serializados.
- Cenários de quota, fallback autorizado, pausa, reinício, cancelamento seletivo e gate ainda não aprovado.
- Validação de Git automático, CI no head SHA, `EffectJournal`, retenção e projeções.
- Relatório final do DAG: mergeados, pendentes de aceite, bloqueados, fora do autorizado, consumo e evidências.
- Critério operacional de `drained` para todo nó autorizado tecnicamente concluído.

## Fora

- Deploy/staging/produção e rollback de ambiente.
- Fechamento automático de issues ou aceite dos MVPs.
- Gasto real não habilitado; suíte comum usa fakes e smokes reais são limitados/opt-in.

## Regras

1. A jornada não recebe permissões maiores que uma execução real.
2. Gate não aprovado interrompe somente o ramo dependente e permanece visível.
3. Falha explicável deve identificar causa, fonte, impacto e ação necessária; “agente falhou” não basta.
4. Resultado final depende de estado reconciliado, não apenas de logs felizes.

## Critérios de aceite

1. A pipeline atravessa ao menos dois MVPs e múltiplas fatias sem reapresentar aprovação já válida.
2. Duas fatias provadamente independentes executam juntas; merges permanecem serializados.
3. Reinício e efeito ambíguo não duplicam run, branch, PR, gasto ou merge.
4. Ramo com gate pendente para; outro ramo aprovado continua quando independente.
5. Cancelamento preserva trabalho remoto e merge confirmado nunca é revertido automaticamente.
6. Relatório final permite reconstruir decisões, revisões, executores, consumo, checks, SHAs e bloqueios.
7. Nenhuma ação de deploy ocorre e nenhuma issue é fechada sem PI.

## Testes e evidência

- suíte determinística com adapters/serviços fake;
- fault injection em todas as fronteiras duráveis;
- smokes reais explícitos dos CLIs e GitHub em repositório exclusivo;
- Playwright da jornada e relatório final versionado.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
