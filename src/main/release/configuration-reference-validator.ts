import { createHmac } from 'node:crypto'
import type { ConfigurationEnvironment, ConfigurationState } from '@shared/domain/release'

/**
 * Contrato de configuração entre ambientes (SPEC-Release-02). Trabalha só com **nomes** e
 * **fingerprints**: o valor nasce e morre dentro da sonda (`ConfigurationProbe`), que devolve
 * "existe?" e o HMAC dele. Nada daqui lê, devolve ou persiste o valor.
 */

export interface ReferenceCheck {
  readonly name: string
  readonly environment: ConfigurationEnvironment
  readonly fingerprint?: string
  readonly state: ConfigurationState
}

export type ConfigurationProbe = (
  environment: ConfigurationEnvironment,
  name: string
) => { readonly present: boolean; readonly fingerprint?: string }

export interface ConfigurationValidation {
  readonly ok: boolean
  readonly referencias: readonly ReferenceCheck[]
  readonly bloqueios: readonly {
    readonly name: string
    readonly environment: ConfigurationEnvironment
  }[]
}

export class ExemploComValorError extends Error {
  constructor(name: string) {
    super(`O arquivo de exemplo só guarda nomes: a chave ${name} traz valor.`)
    this.name = 'ExemploComValorError'
  }
}

/** `.env.example` versionado: só `NOME=` (valor vazio) e comentários. Valor presente é recusado. */
export function lerNomesDoExemplo(texto: string): string[] {
  const nomes: string[] = []
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha || linha.startsWith('#')) continue
    const igual = linha.indexOf('=')
    const nome = (igual === -1 ? linha : linha.slice(0, igual)).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome))
      throw new TypeError(`Nome de chave inválido: ${nome}`)
    if (igual !== -1 && linha.slice(igual + 1).trim() !== '') throw new ExemploComValorError(nome)
    nomes.push(nome)
  }
  return nomes
}

/**
 * HMAC do valor, com chave própria da instalação: sem ela o fingerprint não se compara entre
 * máquinas nem se testa por força bruta contra um dicionário. Rotação muda o valor e, portanto, o
 * fingerprint — o anterior deixa de valer.
 */
export function fingerprintDeConfiguracao(chave: string, nome: string, valor: string): string {
  return createHmac('sha256', chave).update(nome).update('\0').update(valor).digest('hex')
}

export function validarReferencias(entrada: {
  readonly nomes: readonly string[]
  readonly ambientes: readonly ConfigurationEnvironment[]
  readonly probe: ConfigurationProbe
}): ConfigurationValidation {
  const referencias: ReferenceCheck[] = []
  const bloqueios: { name: string; environment: ConfigurationEnvironment }[] = []
  for (const name of entrada.nomes) {
    let base: string | undefined
    for (const environment of entrada.ambientes) {
      const lido = entrada.probe(environment, name)
      if (!lido.present || !lido.fingerprint) {
        referencias.push({ name, environment, state: 'missing' })
        bloqueios.push({ name, environment })
        continue
      }
      // O primeiro ambiente configurado é a base; os demais comparam com ele. Valor diferente
      // é permitido (cada ambiente tem o seu), só fica registrado como `divergent`.
      base ??= lido.fingerprint
      referencias.push({
        name,
        environment,
        fingerprint: lido.fingerprint,
        state: lido.fingerprint === base ? 'configured' : 'divergent'
      })
    }
  }
  return { ok: bloqueios.length === 0, referencias, bloqueios }
}
