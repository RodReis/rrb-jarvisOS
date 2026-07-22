-- Seed de desenvolvimento (SPEC-Execucao-01).
--
-- Existe por causa da regra do CLAUDE.md: "sem hardcode e sem mock — dado local de
-- desenvolvimento entra via seed". São **dois** usuários de propósito: com um só, o teste
-- de RLS não teria como provar que a linha do outro não retorna (critério 3).
--
-- Os UUIDs são fixos para que o teste de isolamento possa referenciá-los sem consultar o
-- banco antes — `supabase db reset` recria exatamente estes ids.

-- ---------------------------------------------------------------------------------------
-- Usuários. Inseridos direto em `auth.users` porque o seed roda sem passar pelo fluxo de
-- signup (o OAuth de dev vive no projeto cloud, ADR-002 — o local é o lado de dados/RLS).
-- `encrypted_password` é hash de senha inexistente: estas contas nunca fazem login.
-- ---------------------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  (
    '00000000-0000-4000-a000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'noa.dev@exemplo.local',
    '', now(), now(), now(),
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{"name":"Usuária de dev A"}'::jsonb
  ),
  (
    '00000000-0000-4000-a000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'jarvis.dev@exemplo.local',
    '', now(), now(), now(),
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{"name":"Usuário de dev B"}'::jsonb
  );

insert into public.user_profile (id, name, email, locale, theme)
values
  ('00000000-0000-4000-a000-000000000001', 'Usuária de dev A', 'noa.dev@exemplo.local', 'pt-BR', 'sistema'),
  ('00000000-0000-4000-a000-000000000002', 'Usuário de dev B', 'jarvis.dev@exemplo.local', 'en-US', 'escuro');

-- Cada usuário tem os dois espaços: eles são fixos do produto, não criados sob demanda.
insert into public.workspace (user_id, workspace_id)
values
  ('00000000-0000-4000-a000-000000000001', 'noa'),
  ('00000000-0000-4000-a000-000000000001', 'jarvis'),
  ('00000000-0000-4000-a000-000000000002', 'noa'),
  ('00000000-0000-4000-a000-000000000002', 'jarvis');

-- Eventos de auditoria com hash-chain plausível. Os hashes são de fachada — a cadeia real
-- é gerada e verificada no local (ADR-004); aqui só ocupam a forma da coluna para o teste
-- de RLS ter linha de cada usuário.
insert into public.audit_event (id, user_id, workspace_id, type, payload, created_at, seq, prev_hash, hash)
values
  (
    '00000000-0000-4000-b000-000000000001',
    '00000000-0000-4000-a000-000000000001', 'jarvis', 'workspace-switch',
    '{"de":"noa","para":"jarvis"}'::jsonb, now(), 1,
    'genesis', 'seed-hash-a1'
  ),
  (
    '00000000-0000-4000-b000-000000000002',
    '00000000-0000-4000-a000-000000000002', 'noa', 'workspace-switch',
    '{"de":"jarvis","para":"noa"}'::jsonb, now(), 1,
    'genesis', 'seed-hash-b1'
  );
