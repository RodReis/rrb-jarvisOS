/**
 * O pacote de evidência (SPEC-Conectores-06, critérios 1 a 4 e 6).
 *
 * O que estes testes provam é o que separa evidência de citação: que o hash detecta a fonte ter
 * mudado, que a deduplicação **não** funde conteúdo divergente, e que uma afirmação sem
 * extração não passa por sustentada.
 *
 * O verificador é a forma que os critérios 1 e 6 tomam nesta fatia (decisão do PI de
 * 2026-08-29): o consumidor real — a geração do `LANDSCAPE.md` — é a M8-F04, que declara
 * depender desta fatia. O que se prova aqui é a capacidade que ela vai chamar, não um documento
 * que ainda não existe.
 */

import { describe, expect, it } from 'vitest'
import type { EvidenceItem, TavilyExtractData } from '@shared/domain/tavily'
import {
  conteudoMudou,
  deduplicar,
  hashDoConteudo,
  montarEvidencia,
  trechoConfere,
  verificarEvidencia,
  type Afirmacao
} from './evidencia'

const COLETA = '2026-08-29T12:00:00.000Z'

function evidencia(url: string, conteudo: string, trecho?: string): EvidenceItem {
  return montarEvidencia({ url, conteudo, ...(trecho === undefined ? {} : { trecho }) }, COLETA)
}

function pacote(
  evidencias: readonly EvidenceItem[],
  falhas: TavilyExtractData['falhas'] = []
): TavilyExtractData {
  return { evidencias, falhas, duplicadasDescartadas: 0 }
}

describe('hash — reprodutível, e sensível ao que importa', () => {
  it('o mesmo conteúdo produz o mesmo hash', () => {
    // Reprodutibilidade é o ponto: qualquer pessoa com o mesmo conteúdo chega ao mesmo hash.
    // É por isso que aqui é `createHash` sem chave, e não o HMAC da cadeia de auditoria — um
    // segredo nosso tornaria a evidência não verificável por terceiros.
    expect(hashDoConteudo('texto')).toBe(hashDoConteudo('texto'))
    expect(hashDoConteudo('texto')).toHaveLength(64)
  })

  it('conteúdo diferente produz hash diferente', () => {
    expect(hashDoConteudo('a')).not.toBe(hashDoConteudo('b'))
  })

  it('ignora CRLF e espaço das pontas — diferença de transporte não é mudança de conteúdo', () => {
    // Sem isto, o mesmo documento baixado por dois caminhos (um servindo CRLF, outro LF) daria
    // hashes diferentes, e "a fonte mudou" dispararia por diferença que não existe no texto.
    expect(hashDoConteudo('linha 1\r\nlinha 2')).toBe(hashDoConteudo('linha 1\nlinha 2'))
    expect(hashDoConteudo('  texto  ')).toBe(hashDoConteudo('texto'))
  })

  it('não ignora espaço interno — ele pode ser conteúdo', () => {
    expect(hashDoConteudo('a b')).not.toBe(hashDoConteudo('ab'))
  })
})

describe('montagem — URL canônica e original, sempre as duas', () => {
  it('guarda a canônica para deduplicar e a original para reproduzir', () => {
    // O critério 3 da F05 exige normalizar **sem perder** o original. Guardar só a canônica
    // impediria reproduzir a chamada; só a original impediria deduplicar.
    const item = evidencia('https://WWW.Exemplo.com/a/?utm_source=x', 'conteúdo')

    expect(item.url).toBe('https://exemplo.com/a')
    expect(item.urlOriginal).toBe('https://WWW.Exemplo.com/a/?utm_source=x')
    expect(item.dominio).toBe('exemplo.com')
    expect(item.coletadoEm).toBe(COLETA)
  })

  it('sem trecho, não há hash de trecho', () => {
    const item = evidencia('https://a.com', 'conteúdo')

    expect(item.trecho).toBeUndefined()
    expect(item.hashTrecho).toBeUndefined()
    expect(item.hashConteudo).toBe(hashDoConteudo('conteúdo'))
  })

  it('com trecho, os dois hashes existem e são distintos', () => {
    // Dois hashes porque respondem perguntas diferentes: o do conteúdo detecta que **a fonte
    // mudou**; o do trecho prova que **a citação corresponde** ao extraído. Com um só, os dois
    // alarmes seriam o mesmo.
    const item = evidencia('https://a.com', 'o conteúdo inteiro do documento', 'conteúdo inteiro')

    expect(item.hashConteudo).toBeDefined()
    expect(item.hashTrecho).toBeDefined()
    expect(item.hashTrecho).not.toBe(item.hashConteudo)
  })

  it('trecho em branco não vira trecho', () => {
    const item = evidencia('https://a.com', 'conteúdo', '   ')

    expect(item.trecho).toBeUndefined()
    expect(item.hashTrecho).toBeUndefined()
  })
})

describe('deduplicação — por URL canônica E hash (critério 4)', () => {
  it('funde a mesma URL com o mesmo conteúdo, guardando a primeira', () => {
    const { unicos, descartados } = deduplicar([
      evidencia('https://exemplo.com/a', 'igual'),
      evidencia('https://WWW.Exemplo.com/a/', 'igual')
    ])

    expect(unicos).toHaveLength(1)
    expect(descartados).toBe(1)
    expect(unicos[0]?.urlOriginal).toBe('https://exemplo.com/a')
  })

  it('NÃO funde a mesma URL com conteúdo divergente', () => {
    // O critério 4 nomeado: deduplicar só por URL apagaria o fato de a fonte ter mudado entre
    // as duas coletas — justamente o que o hash existe para revelar.
    const { unicos, descartados } = deduplicar([
      evidencia('https://exemplo.com/a', 'versão de ontem'),
      evidencia('https://exemplo.com/a', 'versão de hoje')
    ])

    expect(unicos).toHaveLength(2)
    expect(descartados).toBe(0)
  })

  it('não funde URLs distintas com o mesmo conteúdo', () => {
    // Duas fontes independentes dizendo a mesma coisa é confirmação, não duplicata — e fundi-las
    // transformaria duas confirmações numa só.
    const { unicos } = deduplicar([
      evidencia('https://a.com/x', 'mesmo texto'),
      evidencia('https://b.com/y', 'mesmo texto')
    ])

    expect(unicos).toHaveLength(2)
  })

  it('lista vazia não descarta nada', () => {
    expect(deduplicar([])).toEqual({ unicos: [], descartados: 0 })
  })
})

describe('mudança de conteúdo entre revisões (critério 2)', () => {
  it('acusa quando o conteúdo atual difere do hasheado', () => {
    const item = evidencia('https://a.com', 'como estava')

    expect(conteudoMudou(item, 'como estava')).toBe(false)
    expect(conteudoMudou(item, 'como ficou')).toBe(true)
  })

  it('não acusa por diferença de quebra de linha', () => {
    const item = evidencia('https://a.com', 'linha 1\nlinha 2')

    expect(conteudoMudou(item, 'linha 1\r\nlinha 2')).toBe(false)
  })
})

describe('conferência do trecho — hash E presença', () => {
  it('confere quando o trecho está no conteúdo e o hash bate', () => {
    const item = evidencia('https://a.com', 'o documento inteiro fala de X', 'fala de X')

    expect(trechoConfere(item)).toBe(true)
  })

  it('recusa trecho que não saiu do conteúdo, mesmo com hash íntegro', () => {
    // A metade que só o hash não pegaria: um trecho coerente consigo mesmo, mas que nunca
    // pertenceu àquela fonte. É a diferença entre "não foi editado" e "veio de lá".
    const item = evidencia('https://a.com', 'o documento fala de X', 'inventado')

    expect(hashDoConteudo(item.trecho ?? '')).toBe(item.hashTrecho)
    expect(trechoConfere(item)).toBe(false)
  })

  it('recusa quando o trecho foi editado depois de hasheado', () => {
    const original = evidencia('https://a.com', 'o documento fala de X', 'fala de X')
    const adulterado: EvidenceItem = { ...original, trecho: 'fala de Y' }

    expect(trechoConfere(adulterado)).toBe(false)
  })

  it('item sem trecho confere por vacuidade', () => {
    expect(trechoConfere(evidencia('https://a.com', 'conteúdo'))).toBe(true)
  })
})

describe('verificador — toda afirmação material tem evidência extraída (critérios 1 e 6)', () => {
  const COM_EVIDENCIA = pacote([
    evidencia('https://exemplo.com/a', 'conteúdo A'),
    evidencia('https://outro.com/b', 'conteúdo B')
  ])

  it('afirmação com fonte extraída está sustentada', () => {
    const afirmacoes: readonly Afirmacao[] = [
      { id: 'a1', texto: 'X custa Y', fontes: ['https://exemplo.com/a'] }
    ]

    const veredito = verificarEvidencia(afirmacoes, COM_EVIDENCIA)

    expect(veredito.completo).toBe(true)
    expect(veredito.lacunas).toEqual([])
  })

  it('casa a fonte pela URL canônica — a citação pode trazer utm e barra final', () => {
    const afirmacoes: readonly Afirmacao[] = [
      { id: 'a1', texto: 'X', fontes: ['https://WWW.Exemplo.com/a/?utm_source=news'] }
    ]

    expect(verificarEvidencia(afirmacoes, COM_EVIDENCIA).completo).toBe(true)
  })

  it('afirmação sem fonte nenhuma é lacuna', () => {
    const veredito = verificarEvidencia([{ id: 'a1', texto: 'X', fontes: [] }], COM_EVIDENCIA)

    expect(veredito.completo).toBe(false)
    expect(veredito.lacunas[0]?.motivo).toBe('sem-fonte')
  })

  it('afirmação que cita fonte não extraída é lacuna, e a fonte ausente é nomeada', () => {
    // O caso central da F06: snippet de busca **não** é evidência. Uma fonte que a busca
    // devolveu mas que ninguém extraiu não sustenta afirmação.
    const veredito = verificarEvidencia(
      [{ id: 'a1', texto: 'X', fontes: ['https://naoextraida.com/z'] }],
      COM_EVIDENCIA
    )

    expect(veredito.completo).toBe(false)
    expect(veredito.lacunas[0]?.motivo).toBe('fonte-sem-evidencia')
    expect(veredito.lacunas[0]?.fontesAusentes).toEqual(['https://naoextraida.com/z'])
  })

  it('uma fonte extraída entre várias sustenta a afirmação', () => {
    // Reforço que faltou não é lacuna: a afirmação apoiada em duas fontes, com uma extraída,
    // continua sustentada por aquela. Exigir todas transformaria "confirmação independente
    // ausente" em "sem evidência", que são coisas diferentes.
    const veredito = verificarEvidencia(
      [
        {
          id: 'a1',
          texto: 'X',
          fontes: ['https://exemplo.com/a', 'https://naoextraida.com/z']
        }
      ],
      COM_EVIDENCIA
    )

    expect(veredito.completo).toBe(true)
  })

  it('repassa as fontes que a extração não conseguiu ler (critério 3)', () => {
    const comFalha = pacote(COM_EVIDENCIA.evidencias, [
      { url: 'https://caiu.com', motivo: 'timeout' }
    ])

    const veredito = verificarEvidencia([], comFalha)

    // Sem afirmação, não há lacuna — mas as ausentes continuam identificadas. É o que permite
    // ao consumidor distinguir "nada a verificar" de "faltou fonte".
    expect(veredito.completo).toBe(true)
    expect(veredito.fontesAusentes).toEqual([{ url: 'https://caiu.com', motivo: 'timeout' }])
  })

  it('pacote vazio não sustenta nada', () => {
    const veredito = verificarEvidencia(
      [{ id: 'a1', texto: 'X', fontes: ['https://exemplo.com/a'] }],
      pacote([])
    )

    expect(veredito.completo).toBe(false)
  })

  it('sem afirmações, o veredito é completo', () => {
    expect(verificarEvidencia([], COM_EVIDENCIA).completo).toBe(true)
  })
})
