import { describe, expect, it } from 'vitest'
import {
  conferirEvidencia,
  contestar,
  decidirTriagem,
  incorporarAchados,
  lerParecer,
  revalidar,
  textoDaAssinaturaDoAchado,
  transicaoDoAchadoPermitida,
  veredito,
  type AchadoDeclarado,
  type AchadoRegistrado
} from './squad-achado'

const assinar = (texto: string): string => `sig:${texto}`

const declarado = (extra: Partial<AchadoDeclarado> = {}): AchadoDeclarado => ({
  categoria: 'corretude',
  severidade: 'P1',
  titulo: 'O parser perde o último item',
  arquivo: 'src/a.ts',
  trecho: 'items.slice(0, -1)',
  impacto: 'Dado perdido em listas com vírgula final.',
  correcao: 'Usar items.slice().',
  foraDaSpec: false,
  ...extra
})

const parecerBruto = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'parecer-de-revisao@1',
  parecer: 'FIX_REQUIRED',
  achados: [declarado()],
  observacoes: [],
  contestacoes: [],
  ...extra
})

const registrado = (extra: Partial<AchadoRegistrado> = {}): AchadoRegistrado => ({
  ...declarado(),
  assinatura: assinar(textoDaAssinaturaDoAchado(declarado())),
  estado: 'open',
  vistoPor: ['rev-1'],
  contestadoPor: [],
  deltaDaPrimeiraVista: 'd1',
  deltaDaUltimaVista: 'd1',
  ...extra
})

describe('lerParecer', () => {
  it('aceita o parecer bem formado', () => {
    const lido = lerParecer(parecerBruto())

    expect(lido.ok).toBe(true)
    if (lido.ok) {
      expect(lido.parecer.parecer).toBe('FIX_REQUIRED')
      expect(lido.parecer.achados).toHaveLength(1)
    }
  })

  it('recusa chave que o esquema não tem', () => {
    const lido = lerParecer(parecerBruto({ assinatura: 'forjada' }))

    expect(lido).toEqual({ ok: false, motivo: expect.stringContaining('assinatura') })
  })

  it('recusa o achado que traz chave extra: a assinatura é do kernel', () => {
    const lido = lerParecer(parecerBruto({ achados: [{ ...declarado(), assinatura: 'x' }] }))

    expect(lido.ok).toBe(false)
  })

  it.each([
    ['sem parecer', { parecer: undefined }],
    ['parecer fora do vocabulário', { parecer: 'APROVADO' }],
    ['severidade fora de P0..P3', { achados: [{ ...declarado(), severidade: 'P9' }] }],
    ['categoria desconhecida', { achados: [{ ...declarado(), categoria: 'gosto' }] }],
    ['achado sem trecho', { achados: [{ ...declarado(), trecho: '' }] }],
    ['achado sem arquivo', { achados: [{ ...declarado(), arquivo: '' }] }],
    ['schema trocado', { schema: 'achados@1' }]
  ])('recusa %s', (_nome, extra) => {
    expect(lerParecer(parecerBruto(extra)).ok).toBe(false)
  })

  it('recusa arquivo que sai da raiz', () => {
    const lido = lerParecer(parecerBruto({ achados: [{ ...declarado(), arquivo: '../fora.ts' }] }))

    expect(lido.ok).toBe(false)
  })

  it('não é objeto: recusa', () => {
    expect(lerParecer('texto').ok).toBe(false)
    expect(lerParecer(null).ok).toBe(false)
  })
})

describe('assinatura do achado', () => {
  it('o mesmo problema dito de outro jeito dá o mesmo texto', () => {
    const a = textoDaAssinaturaDoAchado(declarado())
    const b = textoDaAssinaturaDoAchado(
      declarado({
        titulo: 'Perda do último item',
        severidade: 'P2',
        impacto: 'outro texto',
        trecho: '  ITEMS.slice(0,  -1) '
      })
    )

    expect(b).toBe(a)
  })

  it.each([
    ['arquivo', { arquivo: 'src/b.ts' }],
    ['categoria', { categoria: 'integridade' as const }],
    ['trecho', { trecho: 'items.pop()' }]
  ])('muda com o %s', (_nome, extra) => {
    expect(textoDaAssinaturaDoAchado(declarado(extra))).not.toBe(
      textoDaAssinaturaDoAchado(declarado())
    )
  })
})

describe('conferirEvidencia', () => {
  it('vale quando o trecho está no arquivo, sem depender de espaço ou caixa', () => {
    const lerArquivo = (a: string) =>
      a === 'src/a.ts' ? 'const x = ITEMS.slice( 0, -1 )' : undefined

    expect(conferirEvidencia(declarado(), lerArquivo)).toBe(true)
  })

  it('não vale quando o arquivo não existe ou não tem o trecho', () => {
    expect(conferirEvidencia(declarado(), () => undefined)).toBe(false)
    expect(conferirEvidencia(declarado(), () => 'outra coisa')).toBe(false)
  })
})

describe('incorporarAchados', () => {
  it('dois revisores no mesmo problema, no mesmo delta, viram uma assinatura', () => {
    const lista = incorporarAchados(
      [],
      [
        { revisor: 'rev-1', achado: declarado() },
        { revisor: 'rev-2', achado: declarado({ titulo: 'Outro título, mesmo problema' }) }
      ],
      'd1',
      assinar
    )

    expect(lista).toHaveLength(1)
    expect(lista[0]?.vistoPor).toEqual(['rev-1', 'rev-2'])
  })

  it('o mesmo revisor repetindo não duplica o registro de quem viu', () => {
    const lista = incorporarAchados(
      [registrado()],
      [{ revisor: 'rev-1', achado: declarado() }],
      'd1',
      assinar
    )

    expect(lista[0]?.vistoPor).toEqual(['rev-1'])
  })

  it('não muda a severidade guardada sem justificativa', () => {
    const lista = incorporarAchados(
      [registrado({ severidade: 'P1' })],
      [{ revisor: 'rev-2', achado: declarado({ severidade: 'P3' }) }],
      'd1',
      assinar
    )

    expect(lista[0]?.severidade).toBe('P1')
  })

  it('muda a severidade com justificativa', () => {
    const lista = incorporarAchados(
      [registrado({ severidade: 'P1' })],
      [
        {
          revisor: 'rev-2',
          achado: declarado({ severidade: 'P0', justificativaDeSeveridade: 'corrompe o banco' })
        }
      ],
      'd1',
      assinar
    )

    expect(lista[0]?.severidade).toBe('P0')
  })

  it('achado resolvido não reaparece como novo no mesmo delta', () => {
    const fechado = registrado({ estado: 'fixed', deltaDoFechamento: 'd1' })

    const lista = incorporarAchados(
      [fechado],
      [{ revisor: 'rev-2', achado: declarado() }],
      'd1',
      assinar
    )

    expect(lista).toHaveLength(1)
    expect(lista[0]?.estado).toBe('fixed')
  })

  it('achado resolvido reabre com delta novo, e conta a reabertura', () => {
    const fechado = registrado({ estado: 'fixed', deltaDoFechamento: 'd1' })

    const lista = incorporarAchados(
      [fechado],
      [{ revisor: 'rev-2', achado: declarado() }],
      'd2',
      assinar
    )

    expect(lista[0]?.estado).toBe('open')
    expect(lista[0]?.reaberturas).toBe(1)
    expect(lista[0]?.deltaDaUltimaVista).toBe('d2')
  })

  it('achado superseded nunca reabre', () => {
    const lista = incorporarAchados(
      [registrado({ estado: 'superseded', deltaDoFechamento: 'd1' })],
      [{ revisor: 'rev-2', achado: declarado() }],
      'd9',
      assinar
    )

    expect(lista[0]?.estado).toBe('superseded')
  })

  it('não muda a lista recebida', () => {
    const antes = [registrado()]
    const copia = JSON.parse(JSON.stringify(antes)) as unknown

    incorporarAchados(antes, [{ revisor: 'rev-2', achado: declarado() }], 'd2', assinar)

    expect(antes).toEqual(copia)
  })
})

describe('revalidar', () => {
  it('achado cujo trecho sumiu do arquivo vira fixed, no delta que provou', () => {
    const lista = revalidar([registrado()], () => 'const x = items.slice()', 'd2')

    expect(lista[0]?.estado).toBe('fixed')
    expect(lista[0]?.deltaDoFechamento).toBe('d2')
  })

  it('achado cujo trecho continua no arquivo segue como está', () => {
    const lista = revalidar([registrado()], () => 'const x = items.slice(0, -1)', 'd2')

    expect(lista[0]?.estado).toBe('open')
  })

  it('arquivo apagado conta como trecho removido', () => {
    expect(revalidar([registrado()], () => undefined, 'd2')[0]?.estado).toBe('fixed')
  })

  it('só mexe em open e accepted', () => {
    const lista = revalidar(
      [registrado({ estado: 'dismissed', motivoDoEstado: 'falso positivo' })],
      () => '',
      'd2'
    )

    expect(lista[0]?.estado).toBe('dismissed')
  })
})

describe('ciclo de vida', () => {
  it.each([
    ['open', 'accepted', true],
    ['open', 'dismissed', true],
    ['open', 'fixed', true],
    ['open', 'superseded', true],
    ['accepted', 'fixed', true],
    ['accepted', 'dismissed', true],
    ['fixed', 'open', true],
    ['dismissed', 'open', true],
    ['fixed', 'accepted', false],
    ['dismissed', 'fixed', false],
    ['superseded', 'open', false],
    ['superseded', 'accepted', false]
  ] as const)('%s → %s: %s', (de, para, esperado) => {
    expect(transicaoDoAchadoPermitida(de, para)).toBe(esperado)
  })
})

describe('decidirTriagem', () => {
  it('aceita o bloqueante, dentro da SPEC, com evidência conferida', () => {
    const lista = decidirTriagem([registrado()], () => 'items.slice(0, -1)')

    expect(lista[0]?.estado).toBe('accepted')
  })

  it('P2 e P3 ficam registrados em open: não bloqueiam nem voltam ao escritor', () => {
    const lista = decidirTriagem([registrado({ severidade: 'P2' })], () => 'items.slice(0, -1)')

    expect(lista[0]?.estado).toBe('open')
  })

  it('fora da SPEC é observação: não vira correção aceita', () => {
    const lista = decidirTriagem([registrado({ foraDaSpec: true })], () => 'items.slice(0, -1)')

    expect(lista[0]?.estado).toBe('open')
  })

  it('evidência que o kernel não confere não é aceita', () => {
    const lista = decidirTriagem([registrado()], () => 'texto sem o trecho')

    expect(lista[0]?.estado).toBe('open')
  })
})

describe('contestar e veredito', () => {
  it('a contestação sem evidência conclusiva não muda o estado, e marca o conflito', () => {
    const lista = contestar(
      [registrado()],
      [{ revisor: 'rev-2', assinatura: registrado().assinatura, motivo: 'não é bug' }]
    )

    expect(lista[0]?.estado).toBe('open')
    expect(lista[0]?.contestadoPor).toEqual(['rev-2'])
  })

  it('conflito de bloqueante aberto vira BLOCKED: nem voto nem autoridade resolvem', () => {
    const lista = contestar(
      [registrado()],
      [{ revisor: 'rev-2', assinatura: registrado().assinatura, motivo: 'não é bug' }]
    )

    expect(veredito(lista, true)).toEqual({
      resultado: 'BLOCKED',
      motivo: 'conflito-entre-revisores'
    })
  })

  it('sem achado bloqueante aberto, PASS', () => {
    expect(veredito([registrado({ severidade: 'P3' })], true)).toEqual({ resultado: 'PASS' })
  })

  it('achado bloqueante aberto ou aceito pede correção', () => {
    expect(veredito([registrado({ estado: 'accepted' })], true)).toEqual({
      resultado: 'FIX_REQUIRED'
    })
  })

  it('achado fixed ou dismissed não pede correção', () => {
    expect(
      veredito([registrado({ estado: 'fixed' }), registrado({ estado: 'dismissed' })], true)
    ).toEqual({ resultado: 'PASS' })
  })

  it('sem parecer do revisor, BLOCKED', () => {
    expect(veredito([], false)).toEqual({ resultado: 'BLOCKED', motivo: 'revisao-sem-parecer' })
  })
})
