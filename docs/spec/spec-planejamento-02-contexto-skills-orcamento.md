# SPEC-Planejamento-02 — Contexto, skills e orçamento

- MVP/Fatia: MVP-008 · M8-F02.
- Issue: [#95](https://github.com/RodReis/rrb-jarvisOS/issues/95).
- Status: **aprovada-pi** (2026-08-29) — modelo de orçamento em rota de assinatura e papel do Context7 resolvidos pelo PI nesta data.
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
- O **app** pesquisa mercado e web geral pelo ResearchAdapter (Tavily). **Documentação técnica não é consultada por este MVP**: o Context7 é ferramenta do **agente construtor** no MVP-009, não capacidade do aplicativo — ver perguntas resolvidas.

## Skills

Resolver por capacidade e disponibilidade. A ausência de `brainstorming`, Caveman, Graphify ou equivalente não bloqueia: o fluxo aplica perguntas, escopo, compressão e revisão diretamente.

## Orçamento

Registrar limite por etapa, consumo estimado/real, créditos externos e justificativa de expansão. Estouro interrompe nova chamada, preserva o progresso e solicita decisão quando não houver alternativa dentro do teto.

**Rota de assinatura versus rota paga.** A rota de assinatura (plano Claude MAX pelo Claude Code CLI, M5-F04) **não tem custo por chamada**: o ledger registra uso — chamadas, tokens e tempo — **sem valor monetário**, e a `BudgetPolicy` não a barra. O gate de USD vale apenas para rota **paga** (Claude API/BYOK). Créditos de conector (Tavily) continuam no ledger de créditos da SPEC-Conectores-02, independente dos dois.

## Critérios de aceite

1. Nenhuma geração ocorre sem ContextPack e orçamento.
1a. Rota de assinatura registra uso **sem valor monetário** e não é barrada pela `BudgetPolicy`; rota paga é estimada e barrada normalmente. Teste dos dois caminhos.
2. Manifesto permite reproduzir quais revisões foram enviadas.
3. Whole-repo exige exceção visível.
4. Falha já resolvida não reaparece como descoberta nova.
5. Ausência de skill não remove o gate correspondente.
6. Expansão de tokens fica atribuída a uma causa.
7. Segredos não entram no contexto.

## Testes e evidência

Unitários de seleção, hash, deduplicação e budget; fixtures com relatório antigo/novo; teste de ausência de skills. Relatório `SPEC-Planejamento-02`; custo externo zero nas suítes comuns.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Orçamento do planejamento:** o PI opera pelo **plano Claude MAX via Claude Code**, que **não tem custo por chamada**. Logo a rota de assinatura **registra uso sem valor monetário** (chamadas, tokens, tempo) e a `BudgetPolicy` **gateia apenas rota paga** (Claude API/BYOK). Descartado converter uso do MAX em USD estimado: seria número inventado, e a `BudgetPolicy` barraria com base nele. **Emenda registrada** nas SPECs Providers-03 e Providers-04. — decidido.
2. **Context7:** o **aplicativo não chama Context7**. A pesquisa deste MVP é de mercado/web geral, via Tavily. Documentação técnica é consultada durante a **construção** (MVP-009), onde o Claude Code já dispõe do Context7 como MCP. O roteamento por intenção herdado do MVP-006 **não é fatia deste MVP** — foi realocado ao MVP-009. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **O `ContextPack` registra a rota usada** (assinatura ou paga), para que o manifesto reproduza não só o conteúdo enviado mas o caminho pelo qual foi.
- **Ausência de skill não remove gate** já é critério; o corolário cravado é que **nenhuma skill vira dependência de build**.
