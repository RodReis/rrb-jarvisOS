import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carregarEnv, parseEnv } from './env'
import { readSupabaseConfig } from './auth/supabase-client'

/**
 * Carga do `.env` (FIX #43).
 *
 * Categoria **Banco**: `carregarEnv` lê disco. A régua da categoria é "integração com storage
 * local", como registrado na F06 do MVP-001 — não é sobre SQLite.
 *
 * O teste que importa é o último: `.env` no disco ⇒ `readSupabaseConfig()` devolve config. É a
 * ligação que faltava e que nenhuma peça isolada provava — cada uma delas estava correta, e o
 * app mesmo assim dizia "credenciais ausentes".
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jos-env-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Escreve um `.env` no diretório temporário e devolve o caminho. */
function escrever(conteudo: string): string {
  const caminho = join(dir, '.env')
  writeFileSync(caminho, conteudo, 'utf8')
  return caminho
}

describe('parseEnv', () => {
  it('lê pares, ignorando comentários e linhas vazias', () => {
    expect(
      parseEnv(['# comentário', '', 'A=1', '  B=2  ', '', '# outro', 'C=3'].join('\n'))
    ).toEqual({ A: '1', B: '2', C: '3' })
  })

  it('remove aspas envolventes, mas preserva as internas', () => {
    expect(parseEnv('A="valor"\nB=\'outro\'\nC="meio"fim"')).toEqual({
      A: 'valor',
      B: 'outro',
      // Abre com aspa e fecha com aspa, mas o conteúdo tem aspas no meio — o corte de
      // delimitador continua sendo só o primeiro e o último caractere.
      C: 'meio"fim'
    })
  })

  it('preserva `=` e `#` dentro do valor', () => {
    // Chave em base64 termina em `=`, e `#` aparece em cor hex. Cortar no primeiro `=` ou
    // tratar `#` como comentário no meio da linha truncaria credencial em silêncio — o valor
    // ficaria *quase* certo, que é a pior forma de errar.
    expect(parseEnv('KEY=abc==\nCOR=#FF5C00\nURL=https://x.co/a?b=c')).toEqual({
      KEY: 'abc==',
      COR: '#FF5C00',
      URL: 'https://x.co/a?b=c'
    })
  })

  it('descarta linha sem `=` e chave vazia em vez de inventar entrada', () => {
    expect(parseEnv('lixo\n=semchave\nA=1')).toEqual({ A: '1' })
  })

  it('aceita valor vazio — a chave existe e está em branco', () => {
    // Distinto de ausente: `SUPABASE_URL=` declara a variável sem valor, e quem consome
    // (`readSupabaseConfig`) trata o vazio como não configurado. O parser não decide isso.
    expect(parseEnv('A=')).toEqual({ A: '' })
  })
})

describe('carregarEnv (critério 1)', () => {
  it('aplica ao ambiente as chaves do arquivo', () => {
    const env: NodeJS.ProcessEnv = {}
    const aplicadas = carregarEnv(escrever('SUPABASE_URL=https://x.supabase.co\nOUTRA=2'), env)

    expect(env.SUPABASE_URL).toBe('https://x.supabase.co')
    expect(env.OUTRA).toBe('2')
    expect(aplicadas).toEqual(['SUPABASE_URL', 'OUTRA'])
  })

  it('devolve os **nomes** das chaves, nunca os valores (critério 5)', () => {
    const env: NodeJS.ProcessEnv = {}
    const aplicadas = carregarEnv(escrever('SEGREDO=nao-pode-vazar'), env)

    // O retorno vai para o log. Um retorno com valores despejaria credencial em disco a cada
    // boot — e o log é o lugar de onde ela sairia sem ninguém notar.
    expect(aplicadas).toEqual(['SEGREDO'])
    expect(JSON.stringify(aplicadas)).not.toContain('nao-pode-vazar')
  })
})

describe('precedência: ambiente vence arquivo (critério 2)', () => {
  it('não sobrescreve variável já presente no ambiente', () => {
    const env: NodeJS.ProcessEnv = { SUPABASE_URL: 'https://do-ci.supabase.co' }
    const aplicadas = carregarEnv(escrever('SUPABASE_URL=https://do-arquivo.supabase.co'), env)

    // Se o arquivo vencesse, um `.env` esquecido no disco derrubaria em silêncio a
    // configuração do CI — surpresa cara e difícil de rastrear.
    expect(env.SUPABASE_URL).toBe('https://do-ci.supabase.co')
    expect(aplicadas).toEqual([])
  })

  it('aplica só as chaves ausentes, deixando as demais intactas', () => {
    const env: NodeJS.ProcessEnv = { JA_EXISTE: 'do-ambiente' }
    const aplicadas = carregarEnv(escrever('JA_EXISTE=do-arquivo\nNOVA=do-arquivo'), env)

    expect(env.JA_EXISTE).toBe('do-ambiente')
    expect(env.NOVA).toBe('do-arquivo')
    expect(aplicadas).toEqual(['NOVA'])
  })

  it('string vazia no ambiente conta como definida e não é sobrescrita', () => {
    // `SUPABASE_URL=` exportado no shell é uma decisão de quem exportou: "quero esta variável
    // vazia". A guarda é `!== undefined`, não truthiness — trocá-la por `!env[chave]` faria o
    // arquivo repovoar uma variável deliberadamente esvaziada.
    const env: NodeJS.ProcessEnv = { VAZIA: '' }
    carregarEnv(escrever('VAZIA=do-arquivo'), env)

    expect(env.VAZIA).toBe('')
  })
})

describe('ausência do arquivo não derruba nada (critério 3)', () => {
  it('arquivo inexistente devolve lista vazia sem lançar', () => {
    const env: NodeJS.ProcessEnv = {}
    // Rodar sem `.env` é caminho suportado: o app sobe com o usuário local e só o login fica
    // indisponível (`.env.example`). Lançar aqui derrubaria o boot de quem clona o repo.
    expect(() => carregarEnv(join(dir, 'nao-existe'), env)).not.toThrow()
    expect(carregarEnv(join(dir, 'nao-existe'), env)).toEqual([])
    expect(env).toEqual({})
  })

  it('diretório no lugar do arquivo também é tolerado', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(carregarEnv(dir, env)).toEqual([])
  })
})

describe('o elo que faltava: arquivo no disco habilita o login', () => {
  it('com `.env` carregado, readSupabaseConfig() devolve a configuração', () => {
    const env: NodeJS.ProcessEnv = {}
    carregarEnv(
      escrever(
        [
          '# Supabase',
          'SUPABASE_URL=https://projeto.supabase.co',
          'SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc123'
        ].join('\n')
      ),
      env
    )

    // Este é o bug do #43 na sua forma mais direta. Antes da correção, `readSupabaseConfig`
    // devolvia `undefined` com o arquivo preenchido — e o app exibia "credenciais ausentes",
    // indistinguível de quem nunca configurou nada.
    expect(readSupabaseConfig(env)).toEqual({
      url: 'https://projeto.supabase.co',
      publishableKey: 'sb_publishable_abc123'
    })
  })

  it('sem arquivo, readSupabaseConfig() segue devolvendo undefined', () => {
    const env: NodeJS.ProcessEnv = {}
    carregarEnv(join(dir, 'nao-existe'), env)

    // O contorno importa tanto quanto o caso feliz: a degradação graciosa continua de pé.
    expect(readSupabaseConfig(env)).toBeUndefined()
  })

  it('`.env` com chave declarada e vazia não habilita o login', () => {
    const env: NodeJS.ProcessEnv = {}
    carregarEnv(escrever('SUPABASE_URL=\nSUPABASE_PUBLISHABLE_KEY='), env)

    // Meio-preenchido é pior que vazio: o app tentaria falar com uma URL em branco e falharia
    // no provedor, com mensagem errada. `readSupabaseConfig` já trata o vazio — o teste trava
    // a combinação das duas peças.
    expect(readSupabaseConfig(env)).toBeUndefined()
  })
})
