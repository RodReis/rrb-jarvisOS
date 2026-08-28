# SPEC-Planejamento-02 — Contexto, skills e orçamento

- MVP/Fatia: MVP-008 · M8-F02.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M8-F01, MVP-005 e MVP-006.

## Objetivo

Preparar, antes da primeira geração, um `ContextPack` restrito e um orçamento explícito. Skills aceleram a disciplina, mas não são dependências rígidas.

## ContextPack

Contém SPEC/tarefa, arquivos e hashes selecionados, decisões aplicáveis, regras de domínio, falhas ainda abertas, resumo da tentativa anterior, origem das fontes, limites e motivo de expansão.

## Seleção

- Começar por índice, busca estrutural e arquivos explicitamente relacionados.
- Usar `rg`, mapa estrutural ou skill equivalente antes de ler áreas amplas.
- Leitura integral exige exceção registrada com motivo e teto.
- Relatórios resolvidos não voltam ao prompt; somente deltas e falhas relevantes.
- Context7 atende documentação técnica; ResearchAdapter atende mercado/web geral.

## Skills

Resolver por capacidade e disponibilidade. A ausência de `brainstorming`, Caveman, Graphify ou equivalente não bloqueia: o fluxo aplica perguntas, escopo, compressão e revisão diretamente.

## Orçamento

Registrar limite por etapa, consumo estimado/real, créditos externos e justificativa de expansão. Estouro interrompe nova chamada, preserva o progresso e solicita decisão quando não houver alternativa dentro do teto.

## Critérios de aceite

1. Nenhuma geração ocorre sem ContextPack e orçamento.
2. Manifesto permite reproduzir quais revisões foram enviadas.
3. Whole-repo exige exceção visível.
4. Falha já resolvida não reaparece como descoberta nova.
5. Ausência de skill não remove o gate correspondente.
6. Expansão de tokens fica atribuída a uma causa.
7. Segredos não entram no contexto.

## Testes e evidência

Unitários de seleção, hash, deduplicação e budget; fixtures com relatório antigo/novo; teste de ausência de skills. Relatório `SPEC-Planejamento-02`; custo externo zero nas suítes comuns.

