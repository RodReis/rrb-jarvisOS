import { describe, expect, it } from 'vitest'
import {
  ReferenciaMutavelError,
  assertReferenciaImutavel,
  digestDaReferencia,
  ehDigestOci,
  referenciaPorDigest
} from './release-artifact'

const DIGEST = `sha256:${'a'.repeat(64)}`

describe('digest OCI', () => {
  it('aceita sha256 com 64 hex minúsculos e recusa o resto', () => {
    expect(ehDigestOci(DIGEST)).toBe(true)
    for (const ruim of [
      'latest',
      'sha256:abc',
      `sha256:${'A'.repeat(64)}`,
      `sha1:${'a'.repeat(40)}`
    ])
      expect(ehDigestOci(ruim)).toBe(false)
  })

  it('monta a referência por digest e a devolve intacta', () => {
    const ref = referenciaPorDigest('ghcr.io/dono/projeto-backend', DIGEST)
    expect(ref).toBe(`ghcr.io/dono/projeto-backend@${DIGEST}`)
    expect(digestDaReferencia(ref)).toBe(DIGEST)
  })

  it('recusa digest inválido ao montar a referência', () => {
    expect(() => referenciaPorDigest('ghcr.io/dono/projeto', 'latest')).toThrow(TypeError)
  })
})

describe('referência imutável (contrafactual: deploy por tag mutável)', () => {
  it.each(['ghcr.io/dono/projeto:latest', 'ghcr.io/dono/projeto:v1', 'ghcr.io/dono/projeto'])(
    'recusa %s',
    (ref) => {
      expect(() => assertReferenciaImutavel(ref)).toThrow(ReferenciaMutavelError)
    }
  )

  it('recusa tag colada ao digest, que ainda é leitura humana e não identidade', () => {
    expect(() => assertReferenciaImutavel(`ghcr.io/dono/projeto:v1@${DIGEST}`)).toThrow(
      ReferenciaMutavelError
    )
  })

  it.each([
    `--flag@${DIGEST}`,
    `GHCR.io/Dono/Img@${DIGEST}`,
    `ghcr.io/dono/img @${DIGEST}`,
    `ghcr.io/dono/img"@${DIGEST}`,
    `ghcr.io//img@${DIGEST}`
  ])('recusa referência que poderia virar opção ou fugir da gramática: %s', (ref) => {
    expect(() => assertReferenciaImutavel(ref)).toThrow(ReferenciaMutavelError)
  })

  it('aceita host com porta', () => {
    expect(() => assertReferenciaImutavel(`localhost:55790/smoke/backend@${DIGEST}`)).not.toThrow()
  })

  it('aceita repositório@digest', () => {
    expect(() => assertReferenciaImutavel(`ghcr.io/dono/projeto@${DIGEST}`)).not.toThrow()
  })
})
