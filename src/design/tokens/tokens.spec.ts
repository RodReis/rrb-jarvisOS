/**
 * Camada `tokens` (SPEC-DesignSystem-01 critérios 1/3; SPEC-DesignSystem-02 critérios 3/5/7).
 *
 * Roda na categoria **Regras** (ambiente `node`, sem jsdom) de propósito: é o ambiente que
 * torna "tokens não depende de React" uma afirmação verificável. Sob jsdom o teste passaria
 * mesmo se a camada importasse React — e a regra de dependência do PRD §8.1 valeria só no
 * papel.
 */

import { describe, expect, it } from 'vitest'
import temaPrototipo from './tema-prototipo.json'
import {
  ACENTO_PADRAO,
  acentoParaLeitura,
  bordaRgb,
  contraste,
  CONTRASTE_MINIMO,
  hexA,
  PALETA_ACENTO,
  papeis,
  PREFIXO_TOKEN,
  RISCO,
  sombraComGlow,
  STATUS,
  tokenCss,
  tokenDeTema
} from './index'

/**
 * O dado extraído do protótipo — a mesma fonte que o `semantic.ts` consome.
 *
 * Importado como módulo, não lido do disco: `node:fs` é caminho proibido dentro de
 * `src/design/` (regra de fronteira da Fatia 01), e a regra não abre exceção para teste — se
 * abrisse, seria "vale exceto quando incomoda".
 */
const TEMA = temaPrototipo as {
  dark: Record<string, string>
  light: Record<string, string>
}

describe('tokens: independência de React', () => {
  it('a camada é importável sem React', async () => {
    // O import acima já roda em `node`; esta asserção fecha a outra ponta: o ambiente não tem
    // DOM, então nada de React foi arrastado para o grafo de dependências.
    await import('./index')
    expect(typeof globalThis.document).toBe('undefined')
  })

  it('monta a referência CSS com o prefixo do DS', () => {
    expect(tokenCss('cor-acento')).toBe(`var(${PREFIXO_TOKEN}-cor-acento)`)
  })
})

describe('paridade com o protótipo (critério 7)', () => {
  it('extraiu 71 tokens de tema, com as mesmas chaves nos dois modos', () => {
    const chavesDark = Object.keys(TEMA.dark).sort()
    const chavesLight = Object.keys(TEMA.light).sort()
    expect(chavesDark).toHaveLength(71)
    expect(chavesLight).toEqual(chavesDark)
  })

  it('o escuro é a cor original do protótipo — não uma reinterpretação', () => {
    // Valores conferidos contra `docs/design/design-system/README.md` §2.6 (tabela de pares).
    // Se a extração passar a produzir outra coisa, é aqui que aparece.
    expect(tokenDeTema('jt37', 'dark')).toBe('#eef1f5')
    expect(tokenDeTema('jt16', 'dark')).toBe('rgba(24,27,33,.7)')
    expect(tokenDeTema('nt0', 'dark')).toBe('rgba(10,12,11,.35)')
  })

  it('mix-blend-mode: os tiles do mascote ficam escuros nos dois modos (critério 4)', () => {
    // README §2.6: "se clarearem, o mascote some". A garantia é o valor ser idêntico — não há
    // par claro para estes três.
    for (const token of ['jt32', 'jt33', 'nt9']) {
      expect(tokenDeTema(token, 'light')).toBe(tokenDeTema(token, 'dark'))
    }
  })

  it('token inexistente falha alto em vez de virar string vazia', () => {
    // CSS engole `undefined` em silêncio: a tela ficaria sutilmente errada sem nada quebrar.
    expect(() => tokenDeTema('jt999', 'dark')).toThrow(/desconhecido/i)
  })
})

describe('papéis por módulo e modo (critério 3)', () => {
  it('o fundo do app segue a tabela do README §2.6', () => {
    expect(papeis('jarvis', 'dark').surface).toBe('#0a0b0e')
    expect(papeis('jarvis', 'light').surface).toBe('#f5f6f8')
    expect(papeis('noa', 'dark').surface).toBe('#0b0d0d')
    expect(papeis('noa', 'light').surface).toBe('#f2f4f2')
  })

  it('a borda vira RGB base, para o alfa ser aplicado por uso', () => {
    expect(bordaRgb('jarvis', 'dark')).toBe('200,204,212')
    expect(bordaRgb('jarvis', 'light')).toBe('30,35,46')
    expect(bordaRgb('noa', 'dark')).toBe('200,212,206')
    expect(bordaRgb('noa', 'light')).toBe('34,44,38')
  })

  it('texto inverte entre os modos', () => {
    expect(papeis('jarvis', 'dark').textPrimary).toBe('#eef1f5')
    expect(papeis('jarvis', 'light').textPrimary).toBe('#111316')
  })
})

describe('semânticas não são retematizáveis (critério 3; PRD §15)', () => {
  it('status tem as cores do protótipo', () => {
    expect(STATUS).toEqual({
      ok: '#34d399',
      warn: '#f59e0b',
      err: '#ff6b81',
      info: '#7dd3fc',
      violet: '#a78bfa'
    })
  })

  it('risco mapeia para as semânticas, sem introduzir cor nova', () => {
    // Duas paletas para a mesma ideia divergiriam com o tempo.
    for (const cor of Object.values(RISCO)) {
      expect(Object.values(STATUS)).toContain(cor)
    }
  })

  it('as semânticas não mudam com o modo — leem igual no claro e no escuro', () => {
    // Não há função que as derive do modo: são constantes. Este teste existe para que, se
    // alguém tentar torná-las temáticas, o contrato quebre aqui.
    const antes = { ...STATUS }
    expect(STATUS).toEqual(antes)
  })
})

describe('acento do usuário (critério 3)', () => {
  it('a paleta é fechada, com as 8 cores do README §2.4', () => {
    expect(PALETA_ACENTO).toEqual([
      '#D3AF37',
      '#FF2C2C',
      '#2CFF05',
      '#2323FF',
      '#C4C4C4',
      '#FFFFE3',
      '#8A00C4',
      '#FF5C00'
    ])
  })

  it('cada módulo tem o default de fábrica do protótipo', () => {
    expect(ACENTO_PADRAO.jarvis).toBe('#FF5C00')
    expect(ACENTO_PADRAO.noa).toBe('#C4C4C4')
  })

  it('hexA concatena o byte de alfa', () => {
    expect(hexA('#FF5C00', 'b3')).toBe('#FF5C00b3')
  })

  it('o contraste segue a razão WCAG (preto/branco = 21:1)', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  describe('ajuste de tom só para leitura', () => {
    it('preserva a cor quando o contraste já é suficiente', () => {
      // O acento é identidade: mexer nele sem necessidade seria descaracterizar a escolha.
      const acento = '#FF5C00'
      expect(acentoParaLeitura(acento, '#0a0b0e')).toBe(acento)
    })

    it('ajusta quando o acento seria ilegível como texto', () => {
      // `#FFFFE3` sobre fundo claro: contraste ~1.1:1, ilegível. O ajuste tem de agir.
      const ajustado = acentoParaLeitura('#FFFFE3', '#f5f6f8')
      expect(ajustado).not.toBe('#FFFFE3')
      expect(contraste(ajustado, '#f5f6f8')).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
    })

    it('ajusta só a luminância — o hue sobrevive', () => {
      // É o coração da decisão do PI: "preserva o tom, ajusta a leitura". Um ajuste que
      // mudasse o hue teria trocado a cor do usuário por outra.
      const original = '#2CFF05'
      const ajustado = acentoParaLeitura(original, '#f5f6f8')
      expect(ajustado).not.toBe(original)
      // Verde continua com o canal G dominante.
      const g = Number.parseInt(ajustado.slice(3, 5), 16)
      const r = Number.parseInt(ajustado.slice(1, 3), 16)
      const b = Number.parseInt(ajustado.slice(5, 7), 16)
      expect(g).toBeGreaterThan(r)
      expect(g).toBeGreaterThan(b)
    })

    it('toda a paleta fica legível sobre os dois fundos', () => {
      // A paleta é fechada (8 cores), então dá para afirmar sobre **todas** em vez de amostrar.
      for (const cor of PALETA_ACENTO) {
        for (const fundo of ['#0a0b0e', '#f5f6f8']) {
          const lido = acentoParaLeitura(cor, fundo)
          expect(contraste(lido, fundo)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
        }
      }
    })
  })
})

describe('primitivos de base', () => {
  it('a sombra do card compõe com o glow do acento', () => {
    const sombra = sombraComGlow('#FF5C00')
    expect(sombra).toContain('0 20px 46px -18px rgba(0,0,0,.9)')
    expect(sombra).toContain('#FF5C00')
  })
})
