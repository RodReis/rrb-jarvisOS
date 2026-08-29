/**
 * O vault contra o SQLite real (SPEC-Providers-01, categoria Banco).
 *
 * Cobre os critérios de comportamento **pelo efeito**, não pela intenção: o segredo não está
 * em claro porque os bytes do disco não o contêm; o escopo não mistura porque a leitura do
 * outro espaço devolve outro valor; a auditoria não vaza porque nenhum evento da cadeia
 * contém a string da chave. A cifra é dublada (`safeStorage` real exige o Electron rodando e
 * a chave do usuário do SO) — pelo mesmo motivo e da mesma forma que em `token-vault.spec.ts`.
 *
 * A dublagem não enfraquece o critério 2: o que ela substitui é o *algoritmo*, não o
 * *caminho*. O teste continua provando que o valor passa pela cifra antes de tocar o disco e
 * que a coluna não guarda o texto original — que é a garantia que o critério pede.
 */

import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { CredentialRepository } = await import('./credential-repository')
const { CredentialService } = await import('./credential-service')

/**
 * Cifra dublada: XOR com uma máscara fixa + base64.
 *
 * Deliberadamente **não** é identidade nem base64 puro. Uma dublagem que devolvesse o texto
 * (ou algo de onde ele saia por decodificação trivial) faria a asserção "o disco não contém o
 * segredo" passar por acidente do encoding, provando nada. Com XOR, o byte gravado não é o
 * byte original — que é a propriedade que o teste precisa exercitar.
 */
const MASCARA = 0x5a
const cipherFalso = {
  encrypt(plaintext: string): Buffer {
    const bytes = Buffer.from(plaintext, 'utf8')
    return Buffer.from(bytes.map((b) => b ^ MASCARA))
  },
  decrypt(ciphertext: Buffer): string {
    return Buffer.from(ciphertext.map((b) => b ^ MASCARA)).toString('utf8')
  }
}

const CHAVE_HMAC = 'chave-de-teste'
const SEGREDO = 'sk-ant-api03-valor-super-secreto-do-usuario'

let dir: string
let dbPath: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let policy: InstanceType<typeof PolicyService>
let repo: InstanceType<typeof CredentialRepository>
let vault: InstanceType<typeof CredentialService>
let env: NodeJS.ProcessEnv

function montar(ambiente: NodeJS.ProcessEnv = {}): void {
  env = ambiente
  repo = new CredentialRepository(db, cipherFalso)
  vault = new CredentialService(repo, audit, policy, env)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-vault-'))
  dbPath = join(dir, 'teste.db')
  db = openDatabase(dbPath)
  audit = new AuditRepository(db, CHAVE_HMAC)
  policy = new PolicyService(audit, () => 'u-1')
  montar()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('escopo por usuário + espaço (critério 1)', () => {
  it('a mesma key tem valores distintos em noa e jarvis sem se misturar', () => {
    vault.set('u-1', 'noa', 'openai', 'chave-do-noa', 'usuario')
    vault.set('u-1', 'jarvis', 'openai', 'chave-do-jarvis', 'usuario')

    expect(vault.resolve('u-1', 'noa', 'openai')?.value).toBe('chave-do-noa')
    expect(vault.resolve('u-1', 'jarvis', 'openai')?.value).toBe('chave-do-jarvis')
  })

  it('a credencial de um usuário não é alcançável por outro', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    expect(vault.resolve('u-2', 'jarvis', 'openai')).toBeUndefined()
    expect(vault.listStatus('u-2', 'jarvis').find((c) => c.key === 'openai')?.status).toBe(
      'missing'
    )
  })

  it('regravar a mesma key substitui o valor em vez de acumular linhas', () => {
    vault.set('u-1', 'jarvis', 'openai', 'valor-antigo', 'usuario')
    vault.set('u-1', 'jarvis', 'openai', 'valor-novo', 'usuario')

    expect(vault.resolve('u-1', 'jarvis', 'openai')?.value).toBe('valor-novo')

    const linhas = db
      .prepare('SELECT COUNT(*) AS total FROM credential_ref WHERE key = ?')
      .get('openai') as { total: number }
    expect(linhas.total).toBe(1)
  })
})

describe('valor cifrado em disco (critério 2)', () => {
  it('o arquivo do banco não contém o segredo em claro', () => {
    vault.set('u-1', 'jarvis', 'anthropic', SEGREDO, 'usuario')
    // Fecha para garantir que o WAL foi aplicado ao arquivo antes de ler os bytes crus.
    db.close()

    const bytes = readFileSync(dbPath)

    // A prova é sobre o disco, não sobre a API: quem abrir este arquivo com um cliente SQLite
    // qualquer não encontra a chave. É o mesmo tipo de garantia que os triggers do ADR-004
    // dão à auditoria — a regra vive no storage, não na disciplina de quem chama.
    expect(bytes.includes(Buffer.from(SEGREDO, 'utf8'))).toBe(false)
    // E o nome lógico continua legível: o que se esconde é o valor, não a existência da
    // credencial — sem isso a UI não teria como listar o que falta.
    expect(bytes.includes(Buffer.from('anthropic', 'utf8'))).toBe(true)

    db = openDatabase(dbPath)
  })

  it('a coluna secret guarda bytes cifrados, e o ciclo grava→lê→decifra fecha', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    const row = db.prepare('SELECT secret FROM credential_ref WHERE key = ?').get('openai') as {
      secret: Buffer
    }

    expect(row.secret.toString('utf8')).not.toBe(SEGREDO)
    expect(vault.resolve('u-1', 'jarvis', 'openai')?.value).toBe(SEGREDO)
  })

  it('valor ilegível vira ausente em vez de derrubar a chamada', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    // Simula cofre indecifrável (troca de usuário do SO, banco copiado de outra máquina):
    // a decifragem estoura e o desfecho correto é "credencial ausente", não exceção — é o
    // mesmo estado que a camada de cima já sabe tratar.
    const repoQuebrado = new CredentialRepository(db, {
      encrypt: cipherFalso.encrypt,
      decrypt: () => {
        throw new Error('cofre de outra máquina')
      }
    })

    expect(repoQuebrado.readSecret('u-1', 'jarvis', 'openai')).toBeUndefined()
  })
})

describe('duas fontes e precedência (critério 3)', () => {
  it('credencial só no .env aparece como source env e present', () => {
    montar({ JARVIS_CREDENTIAL_OPENAI: 'chave-do-env' })

    const status = vault.listStatus('u-1', 'jarvis').find((c) => c.key === 'openai')
    expect(status?.status).toBe('present')
    expect(status?.source).toBe('env')
    expect(vault.resolve('u-1', 'jarvis', 'openai')).toEqual({
      key: 'openai',
      source: 'env',
      value: 'chave-do-env'
    })
  })

  it('credencial adicionada pela UI aparece como source vault', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    const status = vault.listStatus('u-1', 'jarvis').find((c) => c.key === 'openai')
    expect(status?.status).toBe('present')
    expect(status?.source).toBe('vault')
  })

  it('com as duas fontes, o vault vence — e resolve devolve o valor do vault', () => {
    montar({ JARVIS_CREDENTIAL_OPENAI: 'chave-do-env' })
    vault.set('u-1', 'jarvis', 'openai', 'chave-do-vault', 'usuario')

    // A precedência não é preferência estética: se o env vencesse, o usuário salvaria a chave
    // no Settings, veria "salvo", e o app seguiria falando com o provider pela chave do
    // arquivo — divergência silenciosa entre o que a tela mostra e o que a rede usa.
    expect(vault.resolve('u-1', 'jarvis', 'openai')?.value).toBe('chave-do-vault')
    expect(vault.listStatus('u-1', 'jarvis').find((c) => c.key === 'openai')?.source).toBe('vault')
  })

  it('remover do vault com env presente devolve a credencial para o env', () => {
    montar({ JARVIS_CREDENTIAL_OPENAI: 'chave-do-env' })
    vault.set('u-1', 'jarvis', 'openai', 'chave-do-vault', 'usuario')

    const depois = vault.remove('u-1', 'jarvis', 'openai', 'usuario')
    const status = depois.find((c) => c.key === 'openai')

    // É por isso que `envDisponivel` existe na view: a UI precisa poder avisar antes do clique
    // que remover não deixa a credencial ausente.
    expect(status?.status).toBe('present')
    expect(status?.source).toBe('env')
    expect(vault.resolve('u-1', 'jarvis', 'openai')?.value).toBe('chave-do-env')
  })

  it('variável de ambiente declarada sem valor conta como ausente', () => {
    montar({ JARVIS_CREDENTIAL_OPENAI: '' })

    expect(vault.listStatus('u-1', 'jarvis').find((c) => c.key === 'openai')?.status).toBe(
      'missing'
    )
    expect(vault.resolve('u-1', 'jarvis', 'openai')).toBeUndefined()
  })
})

describe('missing sem revelar valor (critério 4)', () => {
  it('lista todas as chaves conhecidas, inclusive as que faltam, com nome do provider', () => {
    montar({ JARVIS_CREDENTIAL_ANTHROPIC: 'do-env' })
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    const status = vault.listStatus('u-1', 'jarvis')

    // Varre o enum e não a tabela: `missing` é a ausência de algo *esperado*, e listar só o
    // que está gravado responderia "o que eu tenho" quando a pergunta da tela é "o que falta".
    expect(status.map((c) => c.key).sort()).toEqual(['anthropic', 'gemini', 'openai'])
    expect(status.find((c) => c.key === 'gemini')?.status).toBe('missing')
    expect(status.find((c) => c.key === 'gemini')?.source).toBeUndefined()
    expect(status.find((c) => c.key === 'gemini')?.provider).toBe('Google Gemini')
  })

  it('nenhum campo do status carrega o segredo nem indício dele', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    const serializado = JSON.stringify(vault.listStatus('u-1', 'jarvis'))

    expect(serializado).not.toContain(SEGREDO)
    // Nem fragmento: um prefixo de 8 caracteres ainda é parte da credencial, e "mostrar só o
    // começo" é exatamente o vazamento que RF-010 proíbe.
    expect(serializado).not.toContain(SEGREDO.slice(0, 8))
  })
})

describe('ator distinguido (critério 5)', () => {
  it('usuário editando no Settings audita e não classifica — sem aprovação', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')

    const eventos = audit.list('u-1')

    // O dono agindo sobre o que é dele não pede aprovação a ninguém. A prova de que não há
    // gate é a ausência de `policy-decision` na cadeia: nenhuma política foi consultada.
    expect(eventos.filter((e) => e.type === 'policy-decision')).toHaveLength(0)
    expect(eventos.filter((e) => e.type === 'credential-change')).toHaveLength(1)
  })

  it('agente alterando credencial é classificado alto/requires-approval e auditado', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'agente')

    const decisao = audit.list('u-1').find((e) => e.type === 'policy-decision')
    expect(decisao).toBeDefined()
    expect(decisao?.payload).toMatchObject({
      action: 'secrets.change',
      tier: 'alto',
      outcome: 'requires-approval'
    })
  })

  it('report-only: a classificação do agente não barra a gravação (gate é MVP-004)', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'agente')

    // O efeito é a prova: apesar de `requires-approval`, o valor está gravado e legível. É o
    // mesmo padrão "report → gate" do Policy Engine e da allowlist, e é o que mantém o
    // MVP-005 independente do MVP-004.
    expect(vault.resolve('u-1', 'jarvis', 'openai')?.value).toBe(SEGREDO)
    expect(vault.listStatus('u-1', 'jarvis').find((c) => c.key === 'openai')?.status).toBe(
      'present'
    )
  })
})

describe('auditoria encadeada e sem segredo (critério 6)', () => {
  it('set e remove geram credential-change com key, escopo, ator e operação', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')
    vault.remove('u-1', 'jarvis', 'openai', 'usuario')

    const eventos = audit.list('u-1').filter((e) => e.type === 'credential-change')

    expect(eventos).toHaveLength(2)
    expect(eventos[0]?.payload).toEqual({ op: 'set', key: 'openai', actor: 'usuario' })
    expect(eventos[0]?.workspace_id).toBe('jarvis')
    expect(eventos[1]?.payload).toEqual({ op: 'remove', key: 'openai', actor: 'usuario' })
  })

  it('nenhum evento da cadeia contém o valor da credencial', () => {
    vault.set('u-1', 'noa', 'anthropic', SEGREDO, 'usuario')
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'agente')
    vault.remove('u-1', 'noa', 'anthropic', 'usuario')

    // Serializa a cadeia inteira — inclusive o `detail` que a classificação do agente gera.
    // ADR-004: "o log de auditoria não é lugar de credencial", e a asserção é sobre tudo que
    // ficou gravado, não só sobre o payload que este código escreveu de propósito.
    const cadeia = JSON.stringify(audit.list('u-1'))
    expect(cadeia).not.toContain(SEGREDO)
  })

  it('a cadeia continua íntegra depois das mudanças de credencial', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')
    vault.set('u-1', 'jarvis', 'gemini', 'outra-chave', 'agente')
    vault.remove('u-1', 'jarvis', 'openai', 'usuario')

    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('remover o que não está no vault é no-op e não audita', () => {
    vault.remove('u-1', 'jarvis', 'openai', 'usuario')

    // Auditar um no-op poluiria a evidência com eventos que não correspondem a decisão real —
    // mesma regra da allowlist de diretórios e de comandos.
    expect(audit.list('u-1').filter((e) => e.type === 'credential-change')).toHaveLength(0)
  })

  it('remover credencial que só existe no env não audita — o env é read-only', () => {
    montar({ JARVIS_CREDENTIAL_OPENAI: 'chave-do-env' })

    const depois = vault.remove('u-1', 'jarvis', 'openai', 'usuario')

    // Uma remoção que apagasse linha de `.env` faria o app editar arquivo de configuração do
    // usuário por trás dele. O status permanece `present` via env — e nada foi registrado,
    // porque nada mudou.
    expect(depois.find((c) => c.key === 'openai')?.source).toBe('env')
    expect(audit.list('u-1').filter((e) => e.type === 'credential-change')).toHaveLength(0)
  })
})

describe('redaction no log (critério 7)', () => {
  it('nenhuma chamada ao logger recebe o valor da credencial', () => {
    vault.set('u-1', 'jarvis', 'openai', SEGREDO, 'usuario')
    vault.remove('u-1', 'jarvis', 'openai', 'usuario')

    // A primeira barreira é não passar o segredo adiante: o `redact()` do ADR-005 é a rede de
    // segurança, não a estratégia. Serializa tudo que chegou ao logger (mensagem + contexto).
    const registrado = JSON.stringify([
      ...logCat.info.mock.calls,
      ...logCat.warn.mock.calls,
      ...logCat.error.mock.calls
    ])

    expect(registrado).not.toContain(SEGREDO)
    expect(registrado).not.toContain(SEGREDO.slice(0, 8))
  })

  it('o detail da classificação do agente é apagado pela redaction (sensitivity credential)', async () => {
    const { redact } = await import('@shared/contracts/logging-redaction')

    // O `PolicyService` recebe `sensitivity: 'credential'` no contexto, e é isso que faz o
    // `redact()` apagar o objeto **inteiro** em vez de só o rótulo — se apagasse apenas o
    // campo `sensitivity`, o valor rotulado passaria, que é o oposto do que a regra quer.
    const contexto = {
      workspace: 'jarvis',
      sensitivity: 'credential',
      detail: { op: 'set', alvo: 'credential_ref', key: 'openai' }
    }

    expect(redact(contexto)).toBe('[redigido]')
  })
})
