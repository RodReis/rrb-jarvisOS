import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ACENTO_PADRAO, contraste, CONTRASTE_MINIMO, PALETA_ACENTO } from './acento'
import { atmosfera, identidade, IDENTIDADES, TILE_MASCOTE } from './identidade'
import { FundoDaIdentidade, ProvedorDeTema, variaveisDoTema } from './provider'
import { bordaRgb, papeis, STATUS, type ModoUi, type Modulo } from './semantic'
import { VoiceMascot } from '../ui/VoiceMascot'

/**
 * Identidades NOA e JARVIS (SPEC-DesignSystem-05, critérios 1–7).
 *
 * A tese sob teste é **"base única, 2 identidades"**, e ela só é provável pela negativa: o que
 * demonstra a base única não é que os dois módulos renderizam — é que renderizam **pelo mesmo
 * caminho de código**, com a diferença inteira vindo de dado. Por isso vários testes abaixo
 * afirmam sobre *igualdade* (mesmo componente, mesmas semânticas) em vez de sobre diferença.
 */

const MODULOS: readonly Modulo[] = ['jarvis', 'noa']
const MODOS: readonly ModoUi[] = ['dark', 'light']

/** Tema-base para `variaveisDoTema`, com o acento default de cada módulo. */
function tema(
  modulo: Modulo,
  uiTheme: ModoUi = 'dark',
  sobrepor: Partial<Parameters<typeof variaveisDoTema>[0]> = {}
) {
  return variaveisDoTema({
    uiTheme,
    accentJarvis: ACENTO_PADRAO.jarvis,
    accentNoa: ACENTO_PADRAO.noa,
    modulo,
    superficie: modulo,
    ...sobrepor
  })
}

describe('contrato de identidade', () => {
  it('as duas identidades existem e não compartilham mascote nem tom (spec §Escopo)', () => {
    expect(Object.keys(IDENTIDADES).sort()).toEqual(['jarvis', 'noa'])
    expect(identidade('jarvis').tom).toBe('tatico')
    expect(identidade('noa').tom).toBe('calmo')
    expect(identidade('jarvis').mascote).not.toBe(identidade('noa').mascote)
  })

  it('NOA nasce sem voz e JARVIS com voz (decisão do PI, spec §Perguntas resolvidas 2)', () => {
    expect(identidade('noa').vozPadrao).toBe(false)
    expect(identidade('jarvis').vozPadrao).toBe(true)
  })
})

describe('critério 1 — o mesmo componente serve as duas identidades', () => {
  /**
   * O ponto não é "renderizou nos dois". É que **o mesmo elemento** de código produziu os dois,
   * com a única diferença vindo da prop. Se algum dia alguém criar um `VoiceMascotNoa`, este
   * teste continuaria passando — por isso o segundo teste, sobre a superfície de exportação, é
   * o que de fato tranca o guardrail.
   */
  it('VoiceMascot renderiza NOA e JARVIS trocando só a prop `modulo`', () => {
    const { rerender } = render(<VoiceMascot modulo="jarvis" />)
    expect(screen.getByAltText('JARVIS OS')).toBeInTheDocument()

    rerender(<VoiceMascot modulo="noa" />)
    expect(screen.getByAltText('NOA')).toBeInTheDocument()
    // O JARVIS saiu de cena — não são dois mascotes coexistindo, é um trocando de identidade.
    expect(screen.queryByAltText('JARVIS OS')).not.toBeInTheDocument()
  })

  it('o DS não exporta nenhum componente com nome de módulo (guardrail anti-duplicação)', async () => {
    const ui = await import('../ui/index')
    const duplicados = Object.keys(ui).filter((nome) => /noa|jarvis/i.test(nome))
    expect(duplicados).toEqual([])
  })
})

describe('critério 2 — acento default por módulo, sem vazamento entre eles', () => {
  it('cada módulo aplica o seu acento de fábrica', () => {
    expect(tema('jarvis')['--jos-cor-acento']).toBe('#C4C4C4')
    expect(tema('noa')['--jos-cor-acento']).toBe('#C4C4C4')
  })

  it('trocar o acento de um módulo não afeta o outro', () => {
    // O JARVIS recebe um acento que **não** é o seu default; o NOA nem é mencionado na troca.
    const outro = PALETA_ACENTO.find((c) => c !== ACENTO_PADRAO.jarvis)
    if (outro === undefined) throw new Error('paleta com uma cor só — cenário impossível')

    const comTrocaNoJarvis = { accentJarvis: outro }

    expect(tema('jarvis', 'dark', comTrocaNoJarvis)['--jos-cor-acento']).toBe(outro)
    // O NOA, lido sob exatamente o mesmo estado, segue no seu default.
    expect(tema('noa', 'dark', comTrocaNoJarvis)['--jos-cor-acento']).toBe(ACENTO_PADRAO.noa)
  })
})

describe('critério 3 — par escuro/claro por identidade; uiTheme é global', () => {
  it('os fundos por identidade e modo são os do README §2.6', () => {
    expect(papeis('jarvis', 'dark').surface).toBe('#0a0b0e')
    expect(papeis('jarvis', 'light').surface).toBe('#f5f6f8')
    expect(papeis('noa', 'dark').surface).toBe('#0b0d0d')
    expect(papeis('noa', 'light').surface).toBe('#f2f4f2')
  })

  it('os hairlines por identidade e modo são os do README §2.6', () => {
    expect(bordaRgb('jarvis', 'dark')).toBe('200,204,212')
    expect(bordaRgb('jarvis', 'light')).toBe('30,35,46')
    expect(bordaRgb('noa', 'dark')).toBe('200,212,206')
    expect(bordaRgb('noa', 'light')).toBe('34,44,38')
  })

  it('`uiTheme` é global: o mesmo valor move as duas identidades juntas', () => {
    // Um `uiTheme` por identidade seria o bug que este teste existe para pegar — o toggle da
    // topbar é único (README §2.6) e não pode deixar um espaço claro e o outro escuro.
    for (const modo of MODOS) {
      for (const modulo of MODULOS) {
        expect(tema(modulo, modo)['--jos-cor-texto']).toBe(papeis(modulo, modo).textPrimary)
      }
    }
    expect(tema('jarvis', 'light')['--jos-cor-texto']).not.toBe(
      tema('jarvis', 'dark')['--jos-cor-texto']
    )
  })

  it('a identidade não troca o modo — só o token-set', () => {
    const claro = MODULOS.map((m) => tema(m, 'light')['--jos-cor-superficie'])
    const escuro = MODULOS.map((m) => tema(m, 'dark')['--jos-cor-superficie'])
    // Os dois módulos diferem entre si no mesmo modo…
    expect(claro[0]).not.toBe(claro[1])
    // …e cada um difere de si mesmo entre os modos. Nenhum ficou preso num modo.
    expect(claro[0]).not.toBe(escuro[0])
    expect(claro[1]).not.toBe(escuro[1])
  })
})

describe('critério 4 — glow radial do JARVIS', () => {
  it('a atmosfera existe no JARVIS e é `none` no NOA', () => {
    expect(atmosfera('jarvis')).toContain('radial-gradient')
    // Lê o acento por variável, não uma cor fixa: trocar o acento move o glow junto.
    expect(atmosfera('jarvis')).toContain('var(--jos-cor-acento)')
    expect(atmosfera('noa')).toBeNull()

    expect(tema('jarvis')['--jos-atmosfera']).toContain('radial-gradient')
    expect(tema('noa')['--jos-atmosfera']).toBe('none')
  })

  it('`FundoDaIdentidade` aplica a variável ao elemento', () => {
    // Sem este elo o critério 4 passaria "no papel": a variável existiria e nada a pintaria.
    render(
      <ProvedorDeTema modulo="jarvis">
        <FundoDaIdentidade>
          <span>conteudo</span>
        </FundoDaIdentidade>
      </ProvedorDeTema>
    )
    const fundo = screen.getByText('conteudo').parentElement
    expect(fundo).toHaveStyle({ backgroundImage: 'var(--jos-atmosfera)' })
  })
})

describe('critério 5 — semânticas são idênticas nos dois módulos e nos dois modos', () => {
  it('a cor de marca de status não muda com identidade nem com modo', () => {
    for (const modo of MODOS) {
      for (const modulo of MODULOS) {
        const t = tema(modulo, modo)
        expect(t['--jos-cor-ok']).toBe(STATUS.ok)
        expect(t['--jos-cor-warn']).toBe(STATUS.warn)
        expect(t['--jos-cor-err']).toBe(STATUS.err)
        expect(t['--jos-cor-info']).toBe(STATUS.info)
        expect(t['--jos-cor-violet']).toBe(STATUS.violet)
      }
    }
  })

  it('a variante de leitura difere por modo, mas nunca por identidade', () => {
    // A distinção que este teste guarda: a semântica **de marca** é imutável (teste acima), mas
    // a de **leitura** depende do fundo — e o fundo depende do modo. O que ela não pode fazer é
    // depender da identidade, porque aí "erro" pareceria diferente no NOA e no JARVIS.
    for (const modo of MODOS) {
      const j = tema('jarvis', modo)
      const n = tema('noa', modo)
      for (const chave of ['ok', 'warn', 'err', 'info', 'violet'] as const) {
        expect(n[`--jos-cor-${chave}-leitura`]).toBe(j[`--jos-cor-${chave}-leitura`])
      }
    }
  })

  it('a variante de leitura atinge 4.5:1 sobre os fundos das **duas** identidades', () => {
    // A igualdade acima, sozinha, passaria com duas cores igualmente ilegíveis. Esta asserção é
    // a que prova o conserto: foi um `violet` **igual em valor e reprovado sobre um dos fundos**
    // (4.45:1 no NOA) que motivou o `fundoDeReferencia`. Compartilhar a cor não basta — ela tem
    // de ser legível em qualquer espaço onde o usuário esteja.
    for (const modo of MODOS) {
      const t = tema('jarvis', modo)
      for (const chave of ['ok', 'warn', 'err', 'info', 'violet'] as const) {
        const cor = t[`--jos-cor-${chave}-leitura`]
        for (const modulo of MODULOS) {
          expect(contraste(cor, papeis(modulo, modo).surface)).toBeGreaterThanOrEqual(
            CONTRASTE_MINIMO
          )
        }
      }
    }
  })
})

describe('critério 6 — o mascote não invoca API de voz', () => {
  it('nem `speechSynthesis` nem `SpeechRecognition` são tocados ao renderizar falando', () => {
    // Espiona o objeto global: se o componente tentar falar, o acesso aparece aqui. Afirmar
    // sobre a *ausência de chamada* é o que separa "não implementamos voz" de "implementamos e
    // deixamos desligado" — só o primeiro é o contrato desta fatia.
    const falar = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak: falar, cancel: vi.fn(), getVoices: () => [] })
    const reconhecer = vi.fn()
    vi.stubGlobal('SpeechRecognition', reconhecer)
    vi.stubGlobal('webkitSpeechRecognition', reconhecer)

    render(<VoiceMascot modulo="jarvis" falando ouvindo />)

    expect(falar).not.toHaveBeenCalled()
    expect(reconhecer).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reflete `falando` e `ouvindo` por prop, e anuncia o estado', () => {
    const { rerender } = render(<VoiceMascot modulo="jarvis" />)
    expect(screen.getByText('JARVIS OS em repouso')).toBeInTheDocument()

    rerender(<VoiceMascot modulo="jarvis" falando />)
    expect(screen.getByText('JARVIS OS está falando')).toBeInTheDocument()

    rerender(<VoiceMascot modulo="jarvis" ouvindo />)
    expect(screen.getByText('JARVIS OS está ouvindo')).toBeInTheDocument()
  })

  it('no NOA os estados de fala são recusados, não apenas omitidos', () => {
    // A decisão do PI vira comportamento: passar `falando` num mascote sem voz **não** produz
    // estado de fala. Se fosse só um default de prop, quem chamasse com `falando` furaria a
    // decisão sem perceber.
    render(<VoiceMascot modulo="noa" falando ouvindo />)
    expect(screen.getByText('NOA em repouso')).toBeInTheDocument()
    expect(screen.queryByText(/está falando|está ouvindo/)).not.toBeInTheDocument()
  })

  it('a voz pode ser ligada por prop no NOA — o default não é uma parede', () => {
    render(<VoiceMascot modulo="noa" voz falando />)
    expect(screen.getByText('NOA está falando')).toBeInTheDocument()
  })
})

describe('critério 7 — o tile do mascote permanece escuro no tema claro', () => {
  it('o fundo do tile é a cor fixa da identidade, não a superfície que inverte', () => {
    const { rerender } = render(
      <ProvedorDeTema uiTheme="light" modulo="jarvis">
        <VoiceMascot modulo="jarvis" />
      </ProvedorDeTema>
    )

    // O container do mascote — o elemento que carrega o tile.
    const tile = screen.getByAltText('JARVIS OS').closest('[data-mascote]')
    expect(tile).toHaveStyle({ backgroundColor: TILE_MASCOTE.jarvis })

    rerender(
      <ProvedorDeTema uiTheme="light" modulo="noa">
        <VoiceMascot modulo="noa" />
      </ProvedorDeTema>
    )
    expect(screen.getByAltText('NOA').closest('[data-mascote]')).toHaveStyle({
      backgroundColor: TILE_MASCOTE.noa
    })
  })

  it('o tile é escuro de fato — não apenas diferente da superfície', () => {
    // Uma asserção de "difere de `--jos-cor-superficie`" passaria com um tile branco. O que o
    // `mix-blend-mode: screen` exige é **escuridão**: sobre fundo claro a imagem some.
    for (const modulo of MODULOS) {
      const canais = TILE_MASCOTE[modulo].slice(1)
      const soma = [0, 2, 4].reduce((t, i) => t + Number.parseInt(canais.slice(i, i + 2), 16), 0)
      // Bem abaixo de 3×128: os valores do protótipo somam ~18 e ~22.
      expect(soma).toBeLessThan(60)
    }
  })
})
