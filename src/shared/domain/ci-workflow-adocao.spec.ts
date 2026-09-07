/**
 * A decisão sobre escrever, preservar ou propor adoção (SPEC-Pipeline-01, critérios 4 e 10).
 *
 * O que estes testes guardam é a diferença entre "é igual ao que eu faria" e "fui eu que fiz". A
 * vertical 1 confundia as duas ao decidir por uma substring do cabeçalho, e os dois primeiros
 * casos abaixo são exatamente os que aquela heurística errava.
 */

import { describe, expect, it } from 'vitest'

import { decidirSobreWorkflow, diffDeLinhas, type EntradaDaDecisao } from './ci-workflow-adocao'

const DESEJADO = 'name: validacao\njobs:\n  q:\n    steps:\n      - run: npm test\n'
const HASH_DESEJADO = 'hash-do-desejado'
const HASH_PERFIL = 'hash-do-perfil'

function entrada(over: Partial<EntradaDaDecisao> = {}): EntradaDaDecisao {
  return {
    conteudoDesejado: DESEJADO,
    hashDesejado: HASH_DESEJADO,
    hashDoPerfil: HASH_PERFIL,
    profileId: 'alvo',
    versaoDoGerador: 1,
    ...over
  }
}

describe('decidirSobreWorkflow — criar e manter', () => {
  it('cria quando o arquivo não existe', () => {
    expect(decidirSobreWorkflow(entrada())).toEqual({ acao: 'criar' })
  })

  it('mantém o arquivo que a pipeline escreveu e já está idêntico ao desejado', () => {
    const d = decidirSobreWorkflow(
      entrada({
        conteudoAtual: DESEJADO,
        hashAtual: 'hash-em-disco',
        manifesto: {
          profileId: 'alvo',
          hashDoPerfil: HASH_PERFIL,
          hashDoConteudo: 'hash-em-disco',
          versaoDoGerador: 1
        }
      })
    )
    expect(d).toEqual({ acao: 'manter' })
  })
})

describe('decidirSobreWorkflow — critério 10, preservação', () => {
  it('preserva arquivo sem manifesto: parecido com o gerado não prova que foi gerado', () => {
    // O caso que a heurística do cabeçalho errava por excesso de confiança: outro tooling pode
    // escrever um arquivo com a nossa primeira linha, e ele seria sobrescrito.
    const d = decidirSobreWorkflow(entrada({ conteudoAtual: 'name: ci-do-time\n', hashAtual: 'h' }))
    expect(d.acao).toBe('propor-adocao')
    if (d.acao !== 'propor-adocao') throw new Error('esperava propor-adocao')
    expect(d.causa).toBe('procedencia-desconhecida')
  })

  it('preserva arquivo nosso que alguém editou depois — mesmo mantendo o cabeçalho', () => {
    // O caso que a heurística errava por falta: a edição humana some porque o cabeçalho ficou lá.
    const d = decidirSobreWorkflow(
      entrada({
        conteudoAtual: DESEJADO + '      - run: npm run extra\n',
        hashAtual: 'hash-depois-da-edicao',
        manifesto: {
          profileId: 'alvo',
          hashDoPerfil: HASH_PERFIL,
          hashDoConteudo: 'hash-de-quando-escrevemos',
          versaoDoGerador: 1
        }
      })
    )
    expect(d.acao).toBe('propor-adocao')
    if (d.acao !== 'propor-adocao') throw new Error('esperava propor-adocao')
    expect(d.causa).toBe('editado-externamente')
  })

  it('a adoção inconclusiva traz diff, não veredicto', () => {
    const d = decidirSobreWorkflow(entrada({ conteudoAtual: 'name: outro\n', hashAtual: 'h' }))
    if (d.acao !== 'propor-adocao') throw new Error('esperava propor-adocao')
    expect(d.diff.length).toBeGreaterThan(0)
    expect(d.diff.some((l) => l.tipo === 'acrescentar')).toBe(true)
  })

  it('edição externa vence perfil mudado: mudar o perfil não licencia sobrescrever', () => {
    const d = decidirSobreWorkflow(
      entrada({
        conteudoAtual: 'editado à mão\n',
        hashAtual: 'hash-editado',
        hashDoPerfil: 'perfil-novo',
        manifesto: {
          profileId: 'alvo',
          hashDoPerfil: 'perfil-velho',
          hashDoConteudo: 'hash-de-quando-escrevemos',
          versaoDoGerador: 1
        }
      })
    )
    expect(d.acao).toBe('propor-adocao')
  })
})

describe('decidirSobreWorkflow — critério 4, diferença material', () => {
  it('atualiza quando o perfil mudou e ninguém tocou no arquivo', () => {
    const d = decidirSobreWorkflow(
      entrada({
        conteudoAtual: 'name: antigo\n',
        hashAtual: 'hash-nosso',
        hashDoPerfil: 'perfil-novo',
        manifesto: {
          profileId: 'alvo',
          hashDoPerfil: 'perfil-velho',
          hashDoConteudo: 'hash-nosso',
          versaoDoGerador: 1
        }
      })
    )
    expect(d.acao).toBe('atualizar')
  })

  it('versão nova do gerador NÃO migra sozinha: propõe adoção em vez de reescrever', () => {
    const d = decidirSobreWorkflow(
      entrada({
        conteudoAtual: 'name: antigo\n',
        hashAtual: 'hash-nosso',
        versaoDoGerador: 2,
        manifesto: {
          profileId: 'alvo',
          hashDoPerfil: HASH_PERFIL,
          hashDoConteudo: 'hash-nosso',
          versaoDoGerador: 1
        }
      })
    )
    expect(d.acao).toBe('propor-adocao')
  })

  it('mesmo perfil e mesma versão com conteúdo diferente acusa geração não determinística', () => {
    const d = decidirSobreWorkflow(
      entrada({
        conteudoAtual: 'name: outro\n',
        hashAtual: 'hash-nosso',
        manifesto: {
          profileId: 'alvo',
          hashDoPerfil: HASH_PERFIL,
          hashDoConteudo: 'hash-nosso',
          versaoDoGerador: 1
        }
      })
    )
    if (d.acao !== 'propor-adocao') throw new Error('esperava propor-adocao')
    expect(d.mensagem).toContain('determinística')
  })
})

describe('diffDeLinhas', () => {
  it('inserir uma linha no topo não reporta o arquivo inteiro como alterado', () => {
    // O motivo de haver LCS aqui em vez de comparação posicional: com ela, todas as linhas
    // apareceriam deslocadas e o humano receberia ruído no lugar da informação.
    const d = diffDeLinhas('a\nb\nc', 'novo\na\nb\nc')
    expect(d.filter((l) => l.tipo === 'acrescentar')).toHaveLength(1)
    expect(d.filter((l) => l.tipo === 'remover')).toHaveLength(0)
  })

  it('texto idêntico não produz alteração nenhuma', () => {
    expect(diffDeLinhas('a\nb', 'a\nb').every((l) => l.tipo === 'igual')).toBe(true)
  })

  it('reconstrói o texto novo a partir das linhas mantidas e acrescentadas', () => {
    const d = diffDeLinhas('a\nb\nc', 'a\nx\nc')
    const reconstruido = d
      .filter((l) => l.tipo !== 'remover')
      .map((l) => l.texto)
      .join('\n')
    expect(reconstruido).toBe('a\nx\nc')
  })

  it('arquivo muito grande cai no resumo em vez de estourar a tabela quadrática', () => {
    const grande = Array.from({ length: 2100 }, (_, i) => `linha ${i}`).join('\n')
    const d = diffDeLinhas(grande, 'a')
    expect(d).toHaveLength(2)
    expect(d[0]?.texto).toContain('2100 linhas')
  })
})
