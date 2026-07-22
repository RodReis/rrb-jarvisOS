-- SPEC-Execucao-01 — schema starter do espelho de sync + RLS.
--
-- O que este schema é: o **espelho estrutural** das entidades cloud-mirrored da fundação
-- (`UserProfile`, `Workspace`, `AuditEvent`). O que ele NÃO é: fonte de verdade. O SQLite
-- local continua sendo (ADR-001); nada da aplicação escreve aqui nesta fatia — o alvo
-- existe schema-ready e ocioso até o sync ser construído (Corte 3).
--
-- Duas regras estruturam o arquivo inteiro:
--
-- 1. **Nenhum segredo espelha.** Não há tabela `session` nem coluna de token/refresh —
--    credencial vive só local, cifrada no safeStorage (SPEC-Fundacao-03). Um segredo no
--    cloud seria um segredo a mais para vazar, sem nada a ganhar.
-- 2. **RLS é o isolamento, não a consulta.** Toda tabela liga RLS e casa `user_id` com
--    `auth.uid()`. Consulta esquecida de filtrar não vaza: o banco recusa a linha.

-- ---------------------------------------------------------------------------------------
-- user_profile — espelho de UserProfile (src/shared/domain/entities.ts).
--
-- `id` referencia `auth.users`: no cloud a identidade é a do Supabase Auth (ADR-002), não
-- um id inventado pelo app. `ON DELETE CASCADE` para que apagar a conta leve o perfil junto.
-- ---------------------------------------------------------------------------------------
create table public.user_profile (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text        not null,
  email      text        not null,
  locale     text        not null default 'pt-BR' check (locale in ('pt-BR', 'en-US')),
  theme      text        not null default 'sistema' check (theme in ('claro', 'escuro', 'sistema')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- workspace — os espaços do usuário.
--
-- `workspace_id` é o enum fechado do domínio (`noa`/`jarvis`), não um uuid: são espaços
-- fixos do produto, não linhas criadas pelo usuário (ADR-001). A PK composta com `user_id`
-- é o que permite cada usuário ter os seus dois sem colidir com os de outro.
-- ---------------------------------------------------------------------------------------
create table public.workspace (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  workspace_id text        not null check (workspace_id in ('noa', 'jarvis')),
  created_at   timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

-- ---------------------------------------------------------------------------------------
-- audit_event — espelho da cadeia de auditoria (ADR-004).
--
-- Os três campos da hash-chain (`seq`/`prev_hash`/`hash`) espelham byte a byte o que o
-- SQLite gravou. Espelhar sem eles tornaria o espelho não-verificável: `verifyChain()` no
-- destino é o que prova que o transporte não adulterou nada.
--
-- `UNIQUE (user_id, seq)` repete a garantia do local: o seq é monotônico por usuário no
-- storage, não só no código.
-- ---------------------------------------------------------------------------------------
create table public.audit_event (
  id           uuid        primary key,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  workspace_id text        check (workspace_id in ('noa', 'jarvis')),
  type         text        not null,
  payload      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null,
  seq          integer     not null,
  prev_hash    text        not null,
  hash         text        not null,
  unique (user_id, seq)
);

create index idx_audit_event_user_seq on public.audit_event (user_id, seq);

-- ---------------------------------------------------------------------------------------
-- ADR-004 no lado cloud: append-only também aqui.
--
-- O espelho de uma cadeia tamper-evident que aceitasse UPDATE/DELETE ofereceria um caminho
-- mais fácil de adulteração do que o original — a evidência valeria pelo elo mais fraco.
-- RLS sozinha não cobre isso: ela decide *quais linhas* alguém alcança, não *qual verbo*
-- pode usar sobre elas. Sem policy de update/delete o verbo já fica negado; o trigger
-- garante que continue negado mesmo se alguém escrever uma policy permissiva depois.
-- ---------------------------------------------------------------------------------------
create function public.audit_event_append_only () returns trigger
  language plpgsql
  -- `search_path` fixo: sem isso um schema malicioso no path poderia sequestrar a resolução
  -- de nomes dentro da função (function hijacking em SECURITY DEFINER e afins).
  set search_path = ''
as $$
begin
  raise exception 'audit_event é append-only: % bloqueado (ADR-004)', tg_op;
end;
$$;

create trigger audit_event_sem_update
  before update on public.audit_event
  for each row execute function public.audit_event_append_only ();

create trigger audit_event_sem_delete
  before delete on public.audit_event
  for each row execute function public.audit_event_append_only ();

-- ---------------------------------------------------------------------------------------
-- RLS — o isolamento por usuário.
--
-- Policies separadas por verbo (não um `for all`) para que a de `audit_event` possa omitir
-- update/delete: o que não tem policy fica negado. Isso alinha a permissão ao ADR-004 em
-- vez de contar só com o trigger.
--
-- `(select auth.uid())` e não `auth.uid()` direto: o planner avalia o select uma vez por
-- consulta em vez de uma vez por linha — a diferença aparece em varredura de tabela grande.
-- ---------------------------------------------------------------------------------------
alter table public.user_profile enable row level security;
alter table public.workspace    enable row level security;
alter table public.audit_event  enable row level security;

create policy user_profile_select on public.user_profile
  for select to authenticated using (id = (select auth.uid()));

create policy user_profile_insert on public.user_profile
  for insert to authenticated with check (id = (select auth.uid()));

create policy user_profile_update on public.user_profile
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy workspace_select on public.workspace
  for select to authenticated using (user_id = (select auth.uid()));

create policy workspace_insert on public.workspace
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy workspace_delete on public.workspace
  for delete to authenticated using (user_id = (select auth.uid()));

create policy audit_event_select on public.audit_event
  for select to authenticated using (user_id = (select auth.uid()));

create policy audit_event_insert on public.audit_event
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Sem policies de update/delete em `audit_event`: append-only por ausência de permissão,
-- antes mesmo do trigger. Duas camadas, como no SQLite (ADR-004).
