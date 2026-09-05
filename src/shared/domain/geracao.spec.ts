import { describe, expect, it } from 'vitest'
import {
  ETAPAS_DA_GERACAO,
  LIMITE_ARGUMENTO_DESCONHECIDO,
  LIMITE_RESUMO_BYTES,
  progressoDaGeracao,
  resumoDoArgumento,
  truncarBytes
} from './geracao'
import type { EstadoDaEtapa, EtapaDaGeracao } from './geracao'

describe('truncarBytes', () => {
  it('devolve o texto inteiro quando cabe no limite', () => {
    const { resumo, tamanhoOriginal } = truncarBytes('curto')

    expect(resumo).toBe('curto')
    expect(tamanhoOriginal).toBe(5)
  })

  it('trunca no limite e reporta o tamanho original (critério 4)', () => {
    const grande = 'a'.repeat(LIMITE_RESUMO_BYTES + 500)

    const { resumo, tamanhoOriginal } = truncarBytes(grande)

    expect(resumo).toHaveLength(LIMITE_RESUMO_BYTES)
    expect(tamanhoOriginal).toBe(LIMITE_RESUMO_BYTES + 500)
  })

  it('mede bytes e não caracteres — acentuação ocupa mais', () => {
    // 'é' são 2 bytes em UTF-8: 3 caracteres cabem em 5 bytes, o quarto não.
    const { resumo, tamanhoOriginal } = truncarBytes('éééé', 5)

    expect(tamanhoOriginal).toBe(8)
    expect(resumo).toBe('éé')
  })

  it('nunca produz caractere partido ao cortar no meio de uma sequência', () => {
    // Corta em 3 bytes: 'é' (2) cabe, o segundo 'é' fica pela metade e é descartado.
    const { resumo } = truncarBytes('éé', 3)

    expect(resumo).toBe('é')
    expect(resumo).not.toContain('�')
  })
})

describe('resumoDoArgumento', () => {
  it('usa o caminho para Read', () => {
    expect(resumoDoArgumento('Read', { file_path: '/tmp/a.ts', offset: 10 })).toBe('/tmp/a.ts')
  })

  it('usa o comando para Bash', () => {
    expect(resumoDoArgumento('Bash', { command: 'ls -la', description: 'lista' })).toBe('ls -la')
  })

  it('usa o termo para WebSearch e a URL para WebFetch', () => {
    expect(resumoDoArgumento('WebSearch', { query: 'electron ipc' })).toBe('electron ipc')
    expect(resumoDoArgumento('WebFetch', { url: 'https://exemplo.dev' })).toBe(
      'https://exemplo.dev'
    )
  })

  it('cai no JSON cortado para ferramenta desconhecida', () => {
    const resumo = resumoDoArgumento('FerramentaNova', { alvo: 'x'.repeat(400) })

    expect(resumo).toHaveLength(LIMITE_ARGUMENTO_DESCONHECIDO)
    expect(resumo.startsWith('{"alvo":"xxx')).toBe(true)
  })

  it('cai no genérico quando a ferramenta conhecida veio sem o campo esperado', () => {
    // Contrato de terceiro muda: o resumo fica pobre, mas não lança nem mente.
    expect(resumoDoArgumento('Read', { outro: 'coisa' })).toBe('{"outro":"coisa"}')
  })

  it('não lança com argumento que não é objeto', () => {
    expect(resumoDoArgumento('Read', undefined)).toBe('')
    expect(resumoDoArgumento('Read', null)).toBe('null')
    expect(resumoDoArgumento('Bash', 'texto solto')).toBe('"texto solto"')
  })
})

describe('progressoDaGeracao', () => {
  it('é zero quando nada terminou', () => {
    expect(progressoDaGeracao(new Map())).toBe(0)
  })

  it('conta só as etapas concluídas — a que está em curso não vale meio passo', () => {
    const etapas = new Map<EtapaDaGeracao, EstadoDaEtapa>([
      ['pesquisa', 'concluida'],
      ['documentos', 'iniciada']
    ])

    // 1 de 5, não 1,5 de 5: quanto da etapa em curso já passou é desconhecido, e supor
    // metade faria a barra andar por chute.
    expect(progressoDaGeracao(etapas)).toBe(20)
  })

  it('não conta a etapa que falhou como progresso', () => {
    const etapas = new Map<EtapaDaGeracao, EstadoDaEtapa>([
      ['pesquisa', 'concluida'],
      ['documentos', 'falhou']
    ])

    expect(progressoDaGeracao(etapas)).toBe(20)
  })

  it('chega a 100 só com todas as etapas concluídas', () => {
    const etapas = new Map<EtapaDaGeracao, EstadoDaEtapa>(
      ETAPAS_DA_GERACAO.map((e) => [e, 'concluida'])
    )

    expect(progressoDaGeracao(etapas)).toBe(100)
  })

  it('ignora chave que não é etapa conhecida', () => {
    // Um evento de versão futura não pode inflar a barra além do que o app sabe medir.
    const etapas = new Map([
      ['pesquisa', 'concluida'],
      ['inventada', 'concluida']
    ] as readonly (readonly [EtapaDaGeracao, EstadoDaEtapa])[])

    expect(progressoDaGeracao(etapas)).toBe(20)
  })
})
