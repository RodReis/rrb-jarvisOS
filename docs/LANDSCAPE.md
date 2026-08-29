# LANDSCAPE.md — Mapa do território

Orientação rápida: o que existe, onde vive, e quem manda em quê. Detalhe técnico no `ARCHITECTURE.md`; processo no `CLAUDE.md`.

## Os três domínios

| Domínio | O que é | O que NÃO é |
|---|---|---|
| **Desenvolvimento** | Plataforma técnica compartilhada: Electron, runtime, IPC, Supabase, Policy Engine, auditoria, adapters, build/testes | Não é workspace de usuário; não contém rotina pessoal nem projetos de negócio reais |
| **NOA** | Espaço pessoal: Agenda, Conteúdo, Finanças, Saúde, Memória pessoal, Automações pessoais | Não contém harness de dev, squads, SEO pipeline, deploy |
| **JARVIS OS** | Espaço profissional: Agentic OS, Mission Control, Kanban, Workflows, Automations, SEO Content, Connectors, Providers, Analytics | Não acessa saúde/finanças/agenda/memória pessoal sem aprovação |

**Agentic OS** é área interna do JARVIS OS (grupos: Core, Harnesses, Teams, Governance, Knowledge). Usa o `workspace_id` do JARVIS OS. Nunca vira quarto workspace.

**Capacidades compartilhadas** (plataforma, consumidas pelos dois espaços com dados separados): auth, workspaces, permissões, auditoria, BudgetPolicy, conectores, providers, memória, notificações, voz, settings.

## Onde cada documento mora

| Caminho | Conteúdo | Dono da manutenção |
|---|---|---|
| `CLAUDE.md` (raiz) | Processo do trio, papéis, ciclo de vida | Cowork |
| `docs/DEVELOPMENT.md` | Ordem de execução e status por item dentro da fatia | **Code** |
| `docs/STATUS.md` | Kanban/roadmap curto + índice Fatia ↔ SPEC | Code (atualiza) / PI (aceita) |
| `docs/STATUS-ARQUIVO.md` | Histórico detalhado complementar | Code/Cowork |
| `docs/ARCHITECTURE.md` | Desenho, módulos, dados, resiliência | Cowork |
| `docs/DECISIONS.md` | Índice de ADRs | Cowork |
| `docs/CONVENTION.md` | Contrato de processo, domínio e dados | Cowork |
| `docs/REVIEW.md` | Contrato exclusivo dos revisores | Cowork |
| `docs/adr/` | ADRs individuais | Cowork |
| `docs/mvp/` | Épicos com checklist de fatias | Cowork |
| `docs/spec/` | Uma spec por fatia | Cowork (aprova: PI) |
| `docs/plan/` | Planos de especificação (pré-spec) | Cowork |
| `docs/iniciais/` | Documentos de origem (requisitos, plano de implementação, fronteiras, PRD DS) — **leitura; não editar** | congelado |

## Estado dos documentos de origem

- `requisitos-agent-os.md` — válido; RF-020 (Autonomous Remote) fora do MVP por ADR-001.
- `plano-implementacao-agent-os.md` — válido como plano de fases técnico.
- `fronteiras-desenvolvimento-noa-jarvisos.md` — válido; fonte da separação de domínios.
- `prd-design-system-plataforma.md` — **parcialmente superado**: decisões #3, #4 e #10 corrigidas pelo ADR-001; o processo de design system formal (Storybook, matriz de regressão, governança de 9 passos) está **suspenso** para o time solo + IA.

## Roadmap macro (cortes do produto)

1. **Fundação** (MVP-001, atual) — shell, auth, workspaces, dados mínimos, settings.
2. Execução local controlada — Supabase local/RLS, Policy Engine, terminal allowlisted, BudgetPolicy.
3. Integrações reais — providers, conectores obrigatórios, memória híbrida + RAG rastreável.
4. Voz e automação — STT/TTS online, crons, squads com aprovação, Power Guard.
5. Evolução offline e multiplataforma — voz offline, macOS/Linux, roteamento local.

Detalhe por corte: `docs/iniciais/requisitos-agent-os.md` § MVP Proposto; fases técnicas: `docs/iniciais/plano-implementacao-agent-os.md`.

> **Split e evolução do Corte 3 (2026-07-24; atualizado em 2026-08-28).** “Integrações reais” foi partido em **MVP-005 Providers + Vault + BudgetPolicy**, **MVP-006 Conectores Essenciais** e **MVP-007 Memória Contextual + RAG**. O MVP-006 agora contém o framework de conectores, GitHub App e Tavily; Google Workspace, ElevenLabs, sync Supabase e Obsidian voltaram ao backlog sem número. O MVP-007 permanece proposto e não bloqueia **MVP-008 Planejamento Governado** nem **MVP-009 Entrega Autônoma**. O sync bidirecional continua diferido pela questão 3 do ADR-001.

## Pesquisa competitiva da pipeline

O `LANDSCAPE.md` de cada projeto criado pela pipeline é produzido antes da arquitetura. Tavily Search+Extract cobre concorrentes, alternativas gratuitas, abordagens descontinuadas e fontes gerais; Context7 cobre documentação técnica atual. Toda afirmação material guarda URL, data, trecho/hash e incerteza. Falha externa bloqueia a conclusão da pesquisa, não autoriza preencher evidência com memória do modelo.

Gatilhos de revisão: mudança relevante em GitHub Apps/Device Flow, contrato ou preço do Tavily, nova ferramenta gratuita que substitua capacidade planejada, alteração material nas CLIs de agentes, ou evidência de que a estratégia de contexto não reduz custo total medido.


> **Remapeamento de MVPs (2026-07-21).** Por decisão do PI, o slot **MVP-003** foi redefinido para **Design System da Plataforma** (`docs/mvp/mvp-003-design-system-plataforma.md`) e a "Execução real (terminal + allowlisted)" foi renumerada para **MVP-004** (`docs/mvp/mvp-004-execucao-real.md`). O Design System adota **peso leve solo+IA** — coerente com a suspensão registrada acima (Storybook, regressão visual e governança de 9 passos seguem **fora**); o protótipo `docs/design/design-system/` entra como **referência visual** e a direção do PRD como **implementação tipada** (claro/escuro, WCAG 2.2 AA). Board: renumeração da issue #10 pendente (ver `STATUS.md`).
