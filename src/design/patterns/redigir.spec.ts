import { describe, expect, it } from 'vitest'
import { REDIGIDO, redigirLinhas, redigirTexto } from './redigir'

/**
 * Redaction de texto (SPEC-DesignSystem-04b, critério 3).
 *
 * Categoria **Regras** e não Tela: é função pura, e o ambiente `node` prova que ela não depende
 * de DOM. O `LogViewer` que a consome tem o seu próprio teste de componente.
 *
 * A suíte tem três partes, e a terceira é a que importa mais: **o que esta função não pega**.
 * Uma regex de segurança sem os seus limites escritos vira promessa falsa — alguém lê "redaction
 * aplicada" e para de olhar para o problema.
 */

describe('formatos reconhecidos', () => {
  it('apaga o valor do cabeçalho Authorization, preservando o nome', () => {
    // Preservar o nome é deliberado: o operador precisa saber *que* havia um Authorization ali.
    expect(redigirTexto('GET /x — Authorization: Bearer abc123def456')).toBe(
      `GET /x — Authorization: ${REDIGIDO}`
    )
  })

  it('apaga `Bearer <token>` solto, sem o nome do cabeçalho', () => {
    expect(redigirTexto('falhou com Bearer eyJhbGciOiJIUzI1NiJ9xxxx')).toBe(
      `falhou com ${REDIGIDO}`
    )
  })

  it('apaga chaves com prefixo conhecido em qualquer posição', () => {
    expect(redigirTexto('key=sk-ant-api03-AbCdEfGh12345678')).toContain(REDIGIDO)
    expect(redigirTexto('usando sb_publishable_ACJWlzQHlZjBrEguHvfOxg')).toContain(REDIGIDO)
    expect(redigirTexto('gh: ghp_ABCDEFGHIJKLMNOP1234567890')).toContain(REDIGIDO)
    expect(redigirTexto('google AIzaSyA1bC2dE3fG4hI5jK6lM7')).toContain(REDIGIDO)
  })

  it('apaga campo sensível nomeado, em JSON ou query string', () => {
    expect(redigirTexto('{"apiKey":"abc123","user":"rod"}')).toBe(
      `{"apiKey":${REDIGIDO},"user":"rod"}`
    )
    expect(redigirTexto('POST /login?password=hunter2&next=/')).toBe(
      `POST /login?password=${REDIGIDO}&next=/`
    )
    expect(redigirTexto('refresh_token: 1//0gXyZ-abc')).toBe(`refresh_token: ${REDIGIDO}`)
  })

  it('apaga JWT pela forma, sem depender de nome de campo', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r'
    expect(redigirTexto(`sessao restaurada ${jwt}`)).toBe(`sessao restaurada ${REDIGIDO}`)
  })

  it('cobre a linha inteira quando há mais de um segredo', () => {
    const linha = 'req apiKey=abc12345 e Authorization: Bearer xyz98765'
    const saida = redigirTexto(linha)
    expect(saida).not.toContain('abc12345')
    expect(saida).not.toContain('xyz98765')
  })
})

describe('o que a redaction preserva', () => {
  it('não toca em texto sem segredo', () => {
    const linha = '[info] ui · Espaço alternado {"para":"noa","auditSeq":12}'
    expect(redigirTexto(linha)).toBe(linha)
  })

  it('preserva o nome do campo — apagar a linha inteira seria inútil para diagnóstico', () => {
    // O log continua servindo ao operador: ele vê que houve uma apiKey, e o resto do contexto.
    const saida = redigirTexto('erro no provider {"apiKey":"segredo","provider":"anthropic"}')
    expect(saida).toContain('apiKey')
    expect(saida).toContain('anthropic')
    expect(saida).not.toContain('segredo')
  })

  it('não confunde palavra parecida com campo sensível', () => {
    // `tokenizer` contém "token" mas não é um: exigir a fronteira `\b` e o separador evita o
    // falso positivo que apagaria texto legítimo de diagnóstico.
    const linha = 'tokenizer carregado com 5000 entradas'
    expect(redigirTexto(linha)).toBe(linha)
  })

  it('processa lista de linhas preservando a ordem e a contagem', () => {
    const entrada = ['linha limpa', 'apiKey=abc12345', 'outra limpa']
    const saida = redigirLinhas(entrada)
    expect(saida).toHaveLength(3)
    expect(saida[0]).toBe('linha limpa')
    expect(saida[1]).toContain(REDIGIDO)
    expect(saida[2]).toBe('outra limpa')
  })
})

/**
 * Os limites, escritos.
 *
 * Estes testes **documentam falhas conhecidas** em vez de escondê-las. Nenhum deles é um bug a
 * corrigir com mais regex: um segredo sem nome, sem prefixo e sem forma reconhecível é
 * indistinguível de um identificador qualquer — e uma regra que o pegasse apagaria metade do log.
 *
 * O que fecha esse buraco não é esta função: é o `redact()` do main, que impede o segredo de
 * **chegar** ao arquivo. Esta camada é rede de segurança de exibição, e é assim que ela deve ser
 * lida por quem confiar nela.
 */
describe('limites conhecidos — o que esta camada NÃO pega', () => {
  it('não reconhece segredo sem nome, sem prefixo e sem forma', () => {
    // Um hex de 32 caracteres é tão parecido com um hash de commit ou um id quanto com uma chave.
    const linha = 'valor 9f8e7d6c5b4a39281706f5e4d3c2b1a0'
    expect(redigirTexto(linha)).toBe(linha)
  })

  it('não reconhece segredo quebrado em várias linhas', () => {
    // A função opera linha a linha, como o `LogViewer` a consome. Um valor multilinha escapa.
    const saida = redigirLinhas(['apiKey=', 'abc12345678'])
    expect(saida[1]).toBe('abc12345678')
  })

  it('não reconhece nome de campo em idioma não previsto', () => {
    // `senha` está na lista; `contraseña` não. Ampliar a lista é fácil — prever todas, não.
    const linha = 'contraseña=hunter2'
    expect(redigirTexto(linha)).toBe(linha)
  })
})
