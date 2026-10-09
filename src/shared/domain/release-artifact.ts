/**
 * Identidade de artefato OCI (SPEC-Release-02). Imagem implantável é referenciada por digest,
 * nunca por tag: a tag é mutável, o digest não. Tag pode existir para leitura humana, mas
 * nenhuma execução a usa como identidade.
 */

const DIGEST_OCI = /^sha256:[a-f0-9]{64}$/
// Componentes OCI em minúsculas, sem `-` inicial: a referência vira argumento posicional do Docker.
const COMPONENTE = '[a-z0-9]+(?:[._-][a-z0-9]+)*'
const REFERENCIA_POR_DIGEST = new RegExp(
  `^${COMPONENTE}(?::\\d{1,5})?(?:/${COMPONENTE})*@(sha256:[a-f0-9]{64})$`
)

export class ReferenciaMutavelError extends Error {
  constructor(referencia: string) {
    super(`Referência mutável recusada: use repositório@sha256:<digest> (recebido: ${referencia}).`)
    this.name = 'ReferenciaMutavelError'
  }
}

export function ehDigestOci(valor: string): boolean {
  return DIGEST_OCI.test(valor)
}

export function referenciaPorDigest(repositorio: string, digest: string): string {
  if (!ehDigestOci(digest)) throw new TypeError('Digest OCI inválido: esperado sha256:<64 hex>.')
  return `${repositorio}@${digest}`
}

/** Só `repositório@sha256:<digest>` passa; tag, inclusive colada ao digest, é recusada. */
export function assertReferenciaImutavel(referencia: string): void {
  if (!REFERENCIA_POR_DIGEST.test(referencia)) throw new ReferenciaMutavelError(referencia)
}

export function digestDaReferencia(referencia: string): string {
  assertReferenciaImutavel(referencia)
  return referencia.slice(referencia.indexOf('@') + 1)
}
