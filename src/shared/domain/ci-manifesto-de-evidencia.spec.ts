/**
 * A evidência que pode gerar PASS (SPEC-Pipeline-01 §8, critério 13).
 *
 * O caso central é o que a Prova 0 do relatório deste repositório já ensinou (issue #232): sem
 * uma lista do que era **esperado**, a evidência incompleta concorda consigo mesma. Os testes
 * abaixo cobram justamente as ausências, que nenhuma asserção sobre o que chegou detectaria.
 */

import { describe, expect, it } from 'vitest'

import {
  validarEvidencia,
  type ArtefatoRecebido,
  type IdentidadeDaExecucao,
  type ManifestoDeEvidencia
} from './ci-manifesto-de-evidencia'

const IDENTIDADE: IdentidadeDaExecucao = {
  runId: 'run-1',
  testedSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  revisaoDoPerfil: 'perfil-v1',
  tentativa: 1
}

const MANIFESTO: ManifestoDeEvidencia = {
  identidade: IDENTIDADE,
  esperados: [
    { nome: 'regras.json', categoria: 'regras' },
    { nome: 'banco.json', categoria: 'banco' },
    { nome: 'tela.json', categoria: 'tela' }
  ]
}

function recebido(over: Partial<ArtefatoRecebido> = {}): ArtefatoRecebido {
  return {
    nome: 'regras.json',
    categoria: 'regras',
    hash: 'abc123',
    bytes: 100,
    identidade: IDENTIDADE,
    jobConcluiuBem: true,
    ...over
  }
}

/** Os três esperados, todos bem-formados. */
function completa(): readonly ArtefatoRecebido[] {
  return [
    recebido(),
    recebido({ nome: 'banco.json', categoria: 'banco' }),
    recebido({ nome: 'tela.json', categoria: 'tela' })
  ]
}

const problemas = (recebidos: readonly ArtefatoRecebido[]): readonly string[] =>
  validarEvidencia(MANIFESTO, recebidos).map((p) => p.problema)

describe('validarEvidencia — o caminho que autoriza PASS', () => {
  it('evidência completa e da mesma execução não tem problema', () => {
    expect(validarEvidencia(MANIFESTO, completa())).toEqual([])
  })

  it('artefato declarado opcional pode faltar sem invalidar a prova', () => {
    const manifesto: ManifestoDeEvidencia = {
      ...MANIFESTO,
      esperados: [
        ...MANIFESTO.esperados,
        { nome: 'cobertura.json', categoria: 'regras', obrigatorio: false }
      ]
    }
    expect(validarEvidencia(manifesto, completa())).toEqual([])
  })
})

describe('validarEvidencia — artefato ausente (critério 13)', () => {
  it('um esperado que não chegou impede o PASS', () => {
    // Este é o defeito que nenhuma asserção sobre o conteúdo detecta: os dois que chegaram estão
    // perfeitos, e a execução mesmo assim não provou o que prometeu.
    const p = validarEvidencia(MANIFESTO, completa().slice(0, 2))
    expect(p.map((x) => x.problema)).toContain('artefato-ausente')
    expect(p[0]?.artefato).toBe('tela.json')
  })

  it('nomeia todos os ausentes, não só o primeiro', () => {
    const p = validarEvidencia(MANIFESTO, [recebido()])
    expect(p.filter((x) => x.problema === 'artefato-ausente')).toHaveLength(2)
  })

  it('evidência vazia acusa todos os obrigatórios', () => {
    expect(
      validarEvidencia(MANIFESTO, []).filter((x) => x.problema === 'artefato-ausente')
    ).toHaveLength(3)
  })

  it('a mensagem diz que código zero não prova escrita', () => {
    // O modo de falha da §8: worker morre, o processo principal retorna zero, e o relatório sai
    // verde sobre uma execução incompleta.
    const p = validarEvidencia(MANIFESTO, completa().slice(0, 2))
    expect(p[0]?.mensagem).toContain('código zero')
  })
})

describe('validarEvidencia — mistura de execuções (critério 13)', () => {
  it('artefato de outra tentativa não serve como prova desta', () => {
    const outraTentativa = recebido({
      nome: 'tela.json',
      categoria: 'tela',
      identidade: { ...IDENTIDADE, tentativa: 2 }
    })
    const p = problemas([...completa().slice(0, 2), outraTentativa])
    expect(p).toContain('execucao-diferente')
  })

  it('artefato de outro head não serve, mesmo com o nome certo', () => {
    const outroHead = recebido({ identidade: { ...IDENTIDADE, testedSha: 'f'.repeat(40) } })
    expect(problemas([outroHead])).toContain('execucao-diferente')
  })

  it('artefato de outra revisão do perfil não serve', () => {
    const outroPerfil = recebido({ identidade: { ...IDENTIDADE, revisaoDoPerfil: 'perfil-v2' } })
    expect(problemas([outroPerfil])).toContain('execucao-diferente')
  })

  it('artefato de outra execução NÃO preenche a vaga do esperado', () => {
    // O ponto sutil: se ele contasse como presente, uma execução poderia ser "completada" por
    // sobras de outra, e o relatório descreveria algo que nunca aconteceu.
    const p = problemas([
      recebido(),
      recebido({ nome: 'banco.json', categoria: 'banco' }),
      recebido({
        nome: 'tela.json',
        categoria: 'tela',
        identidade: { ...IDENTIDADE, tentativa: 9 }
      })
    ])
    expect(p).toContain('execucao-diferente')
    expect(p).toContain('artefato-ausente')
  })
})

describe('validarEvidencia — artefato que não prova', () => {
  it('hash vazio impede o PASS', () => {
    expect(problemas([recebido({ hash: '   ' }), ...completa().slice(1)])).toContain('hash-vazio')
  })

  it('artefato de job falho impede o PASS, mesmo bem-formado', () => {
    expect(problemas([recebido({ jobConcluiuBem: false }), ...completa().slice(1)])).toContain(
      'job-falho'
    )
  })

  it('artefato que ninguém esperava é acusado, não ignorado', () => {
    // Pode ser resto de outra execução no mesmo diretório; somá-lo descreveria o que não houve.
    expect(problemas([...completa(), recebido({ nome: 'sobra.json' })])).toContain(
      'artefato-inesperado'
    )
  })

  it('devolve todos os problemas, não só o primeiro', () => {
    const p = validarEvidencia(MANIFESTO, [recebido({ hash: '', jobConcluiuBem: false })])
    expect(p.length).toBeGreaterThanOrEqual(3) // hash, job falho e dois ausentes
  })
})
