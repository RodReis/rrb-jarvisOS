/**
 * A validação dos protótipos (SPEC-Planejamento-05 § Validação).
 *
 * O que estes testes protegem, e que a leitura do código não garante:
 *  - **todo achado é pergunta + recomendação**, porque a spec pede literalmente isso;
 *  - **asset quebrado impede a arquitetura, tela ausente só pergunta** — a distinção é o
 *    critério 4 (a arquitetura não promete fluxo ausente) contra o critério 2 (o problema é
 *    mostrado ao PI, não decidido por nós);
 *  - **referência remota não vira achado**: apontar para CDN é escolha do PI, e alarmar por isso
 *    ensinaria a ignorar a lista.
 */

import { describe, expect, it } from 'vitest'
import type { ReferenciaDoPrototipo, RenderDoPrototipo } from './validacao-de-prototipo'
import {
  ESTADOS_EXIGIDOS,
  SINAIS_DO_ESTADO,
  achadosQueImpedem,
  analisarPrototipo,
  jornadasCobertas
} from './validacao-de-prototipo'

/** Um render saudável: carregou, tem conteúdo e cobre os quatro estados exigidos. */
function renderOk(jornadas: readonly string[] = []): RenderDoPrototipo {
  return {
    carregou: true,
    errosDeConsole: [],
    elementosVisiveis: 12,
    jornadas: ['Lista vazia', 'Carregando', 'Erro ao salvar', 'Acesso bloqueado', ...jornadas]
  }
}

function ref(
  alvo: string,
  overrides: Partial<ReferenciaDoPrototipo> = {}
): ReferenciaDoPrototipo {
  return { alvo, tipo: 'asset', resolvido: true, remota: false, ...overrides }
}

describe('analisarPrototipo — protótipo que não abre', () => {
  it('devolve um único achado e não lista mais nada', () => {
    const r = analisarPrototipo(
      'home.html',
      [ref('logo.png', { resolvido: false })],
      { carregou: false, errosDeConsole: ['ERR_FILE_NOT_FOUND'], elementosVisiveis: 0, jornadas: [] },
      ['Login']
    )

    // Um protótipo que não abre não tem jornada a comparar: listar "faltou o estado de erro"
    // logo abaixo seria ruído sobre a única coisa que importa.
    expect(r.achados).toHaveLength(1)
    expect(r.achados[0]?.severidade).toBe('impede-arquitetura')
    expect(r.achados[0]?.evidencia).toContain('ERR_FILE_NOT_FOUND')
    expect(r.jornadasCobertas).toEqual([])
  })
})

describe('analisarPrototipo — tela em branco', () => {
  it('distingue "abriu vazio" de "não abriu"', () => {
    const r = analisarPrototipo(
      'home.html',
      [],
      { carregou: true, errosDeConsole: ['Uncaught TypeError'], elementosVisiveis: 0, jornadas: [] },
      []
    )

    const branco = r.achados.find((a) => a.id.endsWith('tela-em-branco'))
    expect(branco?.severidade).toBe('impede-arquitetura')
    expect(branco?.evidencia).toContain('Uncaught TypeError')
  })
})

describe('analisarPrototipo — referências', () => {
  it('asset local faltando impede a arquitetura', () => {
    const r = analisarPrototipo('home.html', [ref('css/app.css', { resolvido: false })], renderOk(), [])
    const achado = r.achados.find((a) => a.id.includes('ref-quebrada'))
    expect(achado?.severidade).toBe('impede-arquitetura')
    expect(achado?.evidencia).toContain('css/app.css')
  })

  /**
   * Tela referenciada e não anexada é **pergunta**, não bloqueio: ela pode legitimamente estar
   * fora do escopo desta revisão, e quem decide isso é o PI (critério 2).
   */
  it('navegação para tela não anexada é pergunta, não bloqueio', () => {
    const r = analisarPrototipo(
      'home.html',
      [ref('detalhe.html', { tipo: 'navegacao', resolvido: false })],
      renderOk(),
      []
    )
    const achado = r.achados.find((a) => a.id.includes('ref-quebrada'))
    expect(achado?.severidade).toBe('pergunta')
  })

  it('referência remota não vira achado', () => {
    const r = analisarPrototipo(
      'home.html',
      [ref('https://cdn.exemplo.com/f.css', { resolvido: false, remota: true })],
      renderOk(),
      []
    )
    expect(r.achados.filter((a) => a.id.includes('ref-quebrada'))).toEqual([])
  })

  it('referência resolvida não vira achado', () => {
    const r = analisarPrototipo('home.html', [ref('css/app.css')], renderOk(), [])
    expect(r.achados.filter((a) => a.id.includes('ref-quebrada'))).toEqual([])
  })
})

describe('analisarPrototipo — estados exigidos', () => {
  it('não acusa nada quando os quatro estados aparecem', () => {
    const r = analisarPrototipo('home.html', [], renderOk(), [])
    expect(r.achados.filter((a) => a.id.includes('estado-ausente'))).toEqual([])
  })

  it('acusa cada estado ausente como pergunta', () => {
    const r = analisarPrototipo(
      'home.html',
      [],
      { carregou: true, errosDeConsole: [], elementosVisiveis: 5, jornadas: ['Dashboard'] },
      []
    )
    const ausentes = r.achados.filter((a) => a.id.includes('estado-ausente'))
    expect(ausentes).toHaveLength(ESTADOS_EXIGIDOS.length)
    expect(ausentes.every((a) => a.severidade === 'pergunta')).toBe(true)
  })

  /**
   * Protótipo de design costuma vir com rótulo em inglês. Um achado falso ("faltou loading")
   * num protótipo que mostra "Loading…" ensinaria o PI a ignorar a lista inteira.
   */
  it('reconhece o sinal em inglês', () => {
    const r = analisarPrototipo(
      'home.html',
      [],
      {
        carregou: true,
        errosDeConsole: [],
        elementosVisiveis: 5,
        jornadas: ['Empty state', 'Loading', 'Error', 'Blocked']
      },
      []
    )
    expect(r.achados.filter((a) => a.id.includes('estado-ausente'))).toEqual([])
  })

  it('reconhece o sinal com acento e caixa diferentes', () => {
    const r = analisarPrototipo(
      'home.html',
      [],
      {
        carregou: true,
        errosDeConsole: [],
        elementosVisiveis: 5,
        jornadas: ['NENHUM resultado', 'CARREGANDO', 'ERRO', 'Sem Permissão']
      },
      []
    )
    expect(r.achados.filter((a) => a.id.includes('estado-ausente'))).toEqual([])
  })
})

describe('analisarPrototipo — telas do PRD', () => {
  it('acusa tela do PRD sem par no protótipo', () => {
    const r = analisarPrototipo('home.html', [], renderOk(['Início']), ['Relatórios'])
    const achado = r.achados.find((a) => a.id.includes('tela-sem-prototipo'))
    expect(achado?.severidade).toBe('pergunta')
    expect(achado?.evidencia).toContain('Relatórios')
  })

  it('não acusa tela que o protótipo cobre, mesmo com acento e caixa diferentes', () => {
    const r = analisarPrototipo('home.html', [], renderOk(['Relatorios mensais']), ['Relatórios'])
    expect(r.achados.filter((a) => a.id.includes('tela-sem-prototipo'))).toEqual([])
  })
})

describe('forma dos achados', () => {
  it('todo achado carrega pergunta, recomendação e evidência', () => {
    const r = analisarPrototipo(
      'home.html',
      [ref('a.png', { resolvido: false }), ref('b.html', { tipo: 'navegacao', resolvido: false })],
      { carregou: true, errosDeConsole: [], elementosVisiveis: 3, jornadas: ['Home'] },
      ['Perfil']
    )

    expect(r.achados.length).toBeGreaterThan(3)
    for (const a of r.achados) {
      expect(a.pergunta.trim()).not.toBe('')
      expect(a.recomendacao.trim()).not.toBe('')
      expect(a.evidencia.trim()).not.toBe('')
      // A spec pede pergunta, não veredito.
      expect(a.pergunta).toContain('?')
    }
  })

  it('ordena o que impede antes do que pergunta', () => {
    const r = analisarPrototipo(
      'home.html',
      [ref('a.png', { resolvido: false })],
      { carregou: true, errosDeConsole: [], elementosVisiveis: 3, jornadas: ['Home'] },
      []
    )
    const primeiro = r.achados[0]
    expect(primeiro?.severidade).toBe('impede-arquitetura')
  })
})

describe('agregações entre protótipos', () => {
  it('jornadasCobertas deduplica por texto normalizado', () => {
    const a = analisarPrototipo('a.html', [], renderOk(['Relatórios']), [])
    const b = analisarPrototipo('b.html', [], renderOk(['relatorios']), [])
    const todas = jornadasCobertas([a, b])
    expect(todas.filter((j) => j.toLowerCase().startsWith('relat'))).toHaveLength(1)
  })

  it('achadosQueImpedem devolve só os bloqueantes, de todos os protótipos', () => {
    const a = analisarPrototipo('a.html', [ref('x.png', { resolvido: false })], renderOk(), [])
    const b = analisarPrototipo('b.html', [], renderOk(), ['Ausente'])
    const impedem = achadosQueImpedem([a, b])
    expect(impedem.every((x) => x.severidade === 'impede-arquitetura')).toBe(true)
    expect(impedem.some((x) => x.prototipo === 'a.html')).toBe(true)
    expect(impedem.some((x) => x.prototipo === 'b.html')).toBe(false)
  })
})

describe('contratos fechados', () => {
  it('todo estado exigido tem ao menos um sinal', () => {
    for (const estado of ESTADOS_EXIGIDOS) {
      expect(SINAIS_DO_ESTADO[estado].length).toBeGreaterThan(0)
    }
  })
})
