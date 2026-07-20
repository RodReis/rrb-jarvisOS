# ADR-002: Projeto Supabase de desenvolvimento na nuvem para OAuth

- Status: aceito.
- Data: 19 de julho de 2026.
- Decisor: PI.
- Relacionado: ADR-001 (local-first); SPEC-Fundacao-03.

## Problema

O plano da fatia Fundação (`docs/plan/plano-especificacao-fundacao.md`) deixou aberta a escolha do ambiente Supabase para o fluxo OAuth Google em desenvolvimento: Supabase local via Docker com provider Google configurado, ou um projeto Supabase de desenvolvimento na nuvem. Essa decisão trava a SPEC-Fundacao-03.

## Decisão

**Projeto Supabase de desenvolvimento na nuvem** para auth/OAuth durante a Fundação.

Razões: redirect URLs estáveis e provider Google configurado no dashboard, sem fricção de configurar OAuth no stack Docker local. O Supabase local via Docker **continua no plano** — entra na fase de persistência/RLS (Corte 2), onde é ele que importa (migrações, RLS, seeds), não o OAuth.

## Consequências

- Primeiro login em dev exige internet — coerente com ADR-001 (primeiro login online, sessão cacheada depois).
- O projeto dev na nuvem não guarda dado de produto: só auth. Metadados/RLS ficam para o Supabase local na fase de persistência.
- Custos: projeto free tier; sem segredo commitado — credenciais via env local.
- Quando o sync cloud real entrar (Corte 3+), decidir se o projeto dev evolui ou é substituído por projeto dedicado.
