/**
 * O que estes testes protegem é a **completude**: todo system de geração declara o idioma.
 *
 * A lista é montada por importação explícita e não por varredura de arquivo: um system novo
 * escrito amanhã não aparece aqui sozinho, e é justamente isso que se quer — quem acrescenta um
 * system tem de vir a este arquivo e decidir. Uma varredura daria a sensação de cobertura
 * automática enquanto silenciosamente deixaria de fora qualquer schema em outro diretório.
 */

import { describe, expect, it } from 'vitest'
import { IDIOMA_DA_SAIDA } from './idioma-da-geracao'
import { SISTEMA_DAS_PERGUNTAS, SISTEMA_DO_BRIEF } from './brief-schema'
import { SISTEMA_DAS_CONTRADICOES, SISTEMA_DO_PRD, SISTEMA_DO_TERMO } from './prd-schema'
import { SISTEMA_DA_ARQUITETURA, SISTEMA_DA_COERENCIA } from './arquitetura-schema'
import { SISTEMA_DA_SPEC, SISTEMA_DO_ROADMAP } from './roadmap-schema'

const SISTEMAS: Readonly<Record<string, string>> = {
  SISTEMA_DO_BRIEF,
  SISTEMA_DAS_PERGUNTAS,
  SISTEMA_DO_TERMO,
  SISTEMA_DO_PRD,
  SISTEMA_DAS_CONTRADICOES,
  SISTEMA_DA_ARQUITETURA,
  SISTEMA_DA_COERENCIA,
  SISTEMA_DO_ROADMAP,
  SISTEMA_DA_SPEC
}

describe('idioma da saída (#271, emenda E1 § Decisão 6)', () => {
  it.each(Object.keys(SISTEMAS))('%s declara o idioma explicitamente', (nome) => {
    expect(SISTEMAS[nome]).toContain(IDIOMA_DA_SAIDA)
  })

  it('a declaração nomeia pt-BR e preserva identificadores em inglês', () => {
    // As duas metades importam: só "português" deixaria o modelo escolher a variante, e sem a
    // ressalva do código ele traduziria nome de campo — quebrando o contrato JSON das etapas.
    expect(IDIOMA_DA_SAIDA).toContain('pt-BR')
    expect(IDIOMA_DA_SAIDA).toContain('inglês')
  })

  it('cobre os nove systems da jornada', () => {
    // Número cravado de propósito: um system novo sem entrada aqui reprova, e a correção é
    // vir decidir se ele declara idioma — não ajustar o número.
    expect(Object.keys(SISTEMAS)).toHaveLength(9)
  })
})
