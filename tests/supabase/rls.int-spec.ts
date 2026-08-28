/**
 * Isolamento por RLS no Supabase local (SPEC-Execucao-01, critérios 3 e 4).
 *
 * **Por que role `authenticated` e não a conexão do owner:** o Postgres *pula* RLS para
 * superuser e para o dono da tabela. Rodar estas asserções como `postgres`/`service_role`
 * faria tudo passar sem provar nada — o mesmo cuidado registrado no CI do `rrb-proplan`.
 * Aqui cada consulta viaja pelo PostgREST com um JWT de usuário final, que é exatamente o
 * caminho que o sync usará no Corte 3.
 *
 * O JWT é assinado localmente com o segredo de dev (HS256, `node:crypto`) em vez de fazer
 * login: o fluxo OAuth de dev vive no projeto cloud (ADR-002), e o Supabase local é o lado
 * de dados/RLS. Assinar aqui é o que permite provar o isolamento sem depender da rede.
 *
 * Requer a stack local no ar (`supabase start`). Sem ela, os testes são pulados em vez de
 * falharem: quem clona o repo sem Docker não deve ver vermelho por isso — o README da
 * pasta `supabase/` diz como subir.
 */

import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Valores padrão do `supabase start` (idênticos em qualquer máquina) — por isso podem ser
 * constantes de teste, não segredo. A URL e a chave publicável reais de dev vêm do `.env`.
 */
const API_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const PUBLISHABLE_KEY =
  process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const JWT_SECRET =
  process.env.SUPABASE_LOCAL_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

/**
 * Container do Postgres local. O nome deriva do `project_id` do `config.toml` — **não pode
 * ser fixo**: a máquina do PI roda outros stacks Supabase ao mesmo tempo (`supabase_db_rrb-adv`,
 * `…-escola`, `…-organize`), e um nome chutado apontaria para o banco do projeto errado.
 */
const CONTAINER_DB = `supabase_db_${lerProjectId()}`

function lerProjectId(): string {
  const config = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
  const achado = /^project_id\s*=\s*"([^"]+)"/m.exec(config)

  if (!achado?.[1]) throw new Error('project_id não encontrado em supabase/config.toml')

  return achado[1]
}

/** Os dois usuários do `supabase/seed.sql`. Ids fixos: o reset recria exatamente estes. */
const USUARIO_A = '00000000-0000-4000-a000-000000000001'
const USUARIO_B = '00000000-0000-4000-a000-000000000002'

const base64url = (valor: Buffer | string): string => Buffer.from(valor).toString('base64url')

/** JWT HS256 mínimo com as claims que o PostgREST/GoTrue leem para resolver `auth.uid()`. */
function assinarJwt(sub: string): string {
  const agora = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      sub,
      aud: 'authenticated',
      role: 'authenticated',
      iat: agora,
      exp: agora + 3600
    })
  )

  const assinatura = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${assinatura}`
}

/** Cliente que fala como o usuário informado — sujeito a RLS, como o app em produção. */
function clienteComo(userId: string): SupabaseClient {
  const token = assinarJwt(userId)

  return createClient(API_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
}

let stackNoAr = false

beforeAll(async () => {
  try {
    const resposta = await fetch(`${API_URL}/rest/v1/`, {
      headers: { apikey: PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(2000)
    })
    stackNoAr = resposta.ok
  } catch {
    stackNoAr = false
  }

  // **No CI, pular é falha.** O workflow sobe a stack de propósito (ADR-003, critério 6);
  // se ela não responder, o `skip` transformaria a ausência de prova em verde — o CI
  // reportaria RLS coberta sem ter tocado no banco. Localmente o skip continua valendo:
  // quem clona o repo sem Docker não deve ver vermelho por isso.
  if (!stackNoAr && process.env.CI) {
    throw new Error(
      `Supabase local não respondeu em ${API_URL}. No CI a stack é obrigatória — ` +
        'verifique o step "Subir o Supabase local" do workflow.'
    )
  }
})

describe('RLS do Supabase local', () => {
  it('perfil: cada usuário só enxerga o próprio', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    const { data, error } = await clienteComo(USUARIO_A).from('user_profile').select('id, email')

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.id).toBe(USUARIO_A)
  })

  it('perfil: filtrar pelo id do outro usuário devolve vazio, não a linha', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    // Consulta explícita pela linha alheia: é o cenário que RLS existe para recusar.
    const { data, error } = await clienteComo(USUARIO_A)
      .from('user_profile')
      .select('id')
      .eq('id', USUARIO_B)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('workspace: só os espaços do próprio user_id retornam', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    const { data, error } = await clienteComo(USUARIO_B).from('workspace').select('user_id')

    expect(error).toBeNull()
    // O seed dá dois espaços a cada usuário; ver quatro significaria RLS desligada.
    expect(data).toHaveLength(2)
    expect(data?.every((linha) => linha.user_id === USUARIO_B)).toBe(true)
  })

  it('auditoria: o evento do outro usuário não retorna', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    const { data, error } = await clienteComo(USUARIO_A).from('audit_event').select('user_id, seq')

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.user_id).toBe(USUARIO_A)
  })

  it('auditoria: escrever no evento alheio é recusado (with check do insert)', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    const { error } = await clienteComo(USUARIO_A).from('audit_event').insert({
      id: '00000000-0000-4000-b000-000000000099',
      user_id: USUARIO_B,
      type: 'workspace-switch',
      created_at: new Date().toISOString(),
      seq: 2,
      prev_hash: 'seed-hash-b1',
      hash: 'forjado'
    })

    // Gravar em nome de outro usuário é a via mais direta de poluir a cadeia dele.
    expect(error).not.toBeNull()
  })

  it('auditoria é append-only também no cloud (ADR-004)', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    const cliente = clienteComo(USUARIO_A)

    await cliente.from('audit_event').update({ hash: 'adulterado' }).eq('user_id', USUARIO_A)
    await cliente.from('audit_event').delete().eq('user_id', USUARIO_A)

    // **A ausência de policy não devolve erro — devolve zero linhas.** RLS filtra as linhas
    // *antes* do UPDATE/DELETE: sem policy do verbo, nenhuma linha é visível para ele, o
    // comando afeta 0 linhas e o PostgREST responde 204. Esperar exceção aqui testaria uma
    // mecânica que o Postgres não tem — e passaria a falhar se alguém adicionasse a policy
    // (aí o trigger é que barraria, com erro). O que vale nos dois caminhos é o efeito:
    // a linha continua exatamente como estava.
    const { data } = await cliente.from('audit_event').select('hash')
    expect(data).toHaveLength(1)
    expect(data?.[0]?.hash).toBe('seed-hash-a1')
  })

  it('o trigger barra o UPDATE de quem escapa da RLS (segunda camada)', async ({ skip }) => {
    skip(!stackNoAr, 'stack local fora do ar — rode `supabase start`')

    // O teste acima prova a camada 1 (ausência de policy ⇒ 0 linhas). Esta prova a camada 2.
    //
    // O **owner do banco pula RLS** — é justamente o caminho pelo qual a camada 1 não
    // protege: uma migration, um script de manutenção, um cliente psql com a credencial de
    // serviço. Aí só o trigger resta. Sem esta asserção ele seria código nunca exercitado,
    // e a "segunda camada" do ADR-004 valeria como intenção, não como garantia.
    let saida: string
    try {
      saida = execFileSync(
        'docker',
        [
          'exec',
          CONTAINER_DB,
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-c',
          `update public.audit_event set hash = 'adulterado' where user_id = '${USUARIO_A}';`
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (erro) {
      // psql sai com código != 0 quando o comando aborta: a mensagem vem no stderr.
      saida = String((erro as { stderr?: string }).stderr ?? erro)
    }

    expect(saida).toContain('append-only')
  })
})

describe('nenhum segredo espelha no schema cloud (critério 4)', () => {
  // Sem `skip`: esta asserção lê o arquivo de migration, não o container — vale (e deve
  // falhar) mesmo em quem clonou o repo sem Docker. É a regra "nunca espelhar segredo",
  // e ela não pode depender de o ambiente estar de pé para ser cobrada.
  it('não existe tabela de sessão nem coluna de token', () => {
    // Lê o schema pelo próprio arquivo de migration: é a fonte que governa o banco, e a
    // asserção continua válida em quem clonou o repo (não depende do estado do container).
    const dir = join(process.cwd(), 'supabase', 'migrations')
    const sql = readdirSync(dir)
      .filter((arquivo) => arquivo.endsWith('.sql'))
      .map((arquivo) => readFileSync(join(dir, arquivo), 'utf8'))
      .join('\n')
      .toLowerCase()

    for (const proibido of [
      'access_token',
      'refresh_token',
      'encrypted_password',
      'create table public.session'
    ]) {
      expect(sql).not.toContain(proibido)
    }
  })
})
