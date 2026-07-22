# `supabase/` — ambiente local de sync (dev)

Stack Supabase local via Docker, como **alvo de sincronização** de desenvolvimento
(SPEC-Execucao-01, issue [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15)).

**O que este ambiente é e o que não é.** É o *lado de dados e RLS*: schema espelho,
políticas de isolamento e seed. **Não** é fonte de verdade — o SQLite local continua sendo
(ADR-001) — e **não** roda o OAuth de dev, que vive no projeto Supabase na nuvem (ADR-002).
Nesta fatia **nada da aplicação escreve aqui**: o alvo existe schema-ready e ocioso até o
sync ser construído (Corte 3).

## Subir e derrubar

```bash
supabase start     # sobe a stack (Postgres + PostgREST + Studio + Auth) via Docker
supabase status    # URLs e chaves locais
supabase stop      # derruba, preservando os dados dos volumes
supabase stop --no-backup   # derruba e descarta os dados
supabase db reset  # recria o banco: aplica migrations + seed (reprodutível)
```

Pré-requisito: **Docker Desktop rodando**. Sem ele, `supabase start` falha com
`failed to connect to the docker API` — e os testes de RLS se pulam sozinhos em vez de
ficarem vermelhos (ver abaixo).

## Portas

Os valores padrão do Supabase CLI, **mantidos como estão**: a faixa `5432x` não colide com
as portas remapeadas do projeto (Postgres `5433`, Redis `6380` — `CLAUDE.md` § Regras de
trabalho), que pertencem a outro stack.

| Serviço | URL local |
|---|---|
| API (PostgREST) | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Inbucket/Mailpit (e-mails de teste) | `http://127.0.0.1:54324` |

> A máquina de desenvolvimento roda **outros stacks Supabase** em paralelo (`rrb-adv`,
> `rrb-escola`, `rrb-organize`). O que separa este dos demais é o `project_id` do
> `config.toml` (`rrb-jarvisOS`), que nomeia os containers — por isso o teste deriva o nome
> do container desse campo em vez de fixá-lo.

## Conteúdo

| Arquivo | O que é |
|---|---|
| `config.toml` | Configuração da stack local (portas, auth, storage). |
| `migrations/` | Schema versionado. **Só se acrescenta ao fim** — migration publicada não se edita. |
| `seed.sql` | Dados de desenvolvimento. Dois usuários **de propósito**: com um só, o teste de RLS não teria como provar que a linha do outro não retorna. |

## Schema starter

Espelho estrutural das entidades cloud-mirrored da fundação: `user_profile`, `workspace`,
`audit_event`, com os campos de escopo (`user_id`, `workspace_id`).

Duas regras governam o schema inteiro:

1. **Nenhum segredo espelha.** Não há tabela de sessão nem coluna de token/refresh —
   credencial vive só local, cifrada no `safeStorage` (SPEC-Fundacao-03). Há teste que lê
   as migrations e falha se alguma dessas palavras aparecer.
2. **RLS é o isolamento, não a consulta.** Toda tabela liga RLS e casa `user_id` com
   `auth.uid()`. Consulta que esqueça de filtrar não vaza: o banco recusa a linha.

`audit_event` é **append-only também aqui** (ADR-004), em duas camadas: não existe policy
de `update`/`delete` (o verbo fica negado por ausência de permissão) e um trigger aborta a
operação caso alguma seja adicionada no futuro.

## Testes

`tests/supabase/rls.int-spec.ts` (categoria **Banco** do relatório, ADR-003).

Rodar: `npx vitest run --project banco tests/supabase/rls.int-spec.ts`

Dois detalhes que fazem esses testes valerem alguma coisa:

- **Role de aplicação, não owner.** O Postgres *pula* RLS para superuser e para o dono da
  tabela; rodar as asserções como `postgres` faria tudo passar sem provar nada. As consultas
  viajam pelo PostgREST com um JWT de usuário final (assinado localmente com o segredo de
  dev), que é o caminho que o sync usará.
- **Sem a stack no ar, os testes se pulam.** Quem clona o repo sem Docker não vê vermelho
  por isso. A exceção é a asserção de "nenhum segredo no schema", que lê o arquivo de
  migration e por isso vale sempre.

> **Ausência de policy não devolve erro — devolve zero linhas.** RLS filtra as linhas
> *antes* do UPDATE/DELETE, então o comando afeta 0 linhas e a resposta é 204, não 403.
> Testar "esperava erro" aí testaria uma mecânica que o Postgres não tem. O que se afirma é
> o efeito: a linha continua exatamente como estava.
