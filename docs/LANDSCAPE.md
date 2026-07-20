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
| `docs/STATUS.md` | Kanban/roadmap (visão de fatias e MVPs) | Code (atualiza) / PI (aceita) |
| `docs/ARCHITECTURE.md` | Desenho, módulos, dados, resiliência | Cowork |
| `docs/DECISIONS.md` | Índice de ADRs | Cowork |
| `docs/CONVENTION.md` | Contrato de processo + contrato de dados | Cowork |
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
