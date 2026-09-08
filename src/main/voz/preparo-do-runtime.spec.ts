import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  prepararRuntime,
  runtimeUsavel,
  RELATIVO_DA_MARCA,
  RELATIVO_DO_PYTHON,
  TAR_DO_WINDOWS,
  type DepsDoPreparo
} from './preparo-do-runtime'

/**
 * O preparo do runtime da voz (SPEC-Voz-01 § Dentro e decisão 5; regressão do FIX #345).
 *
 * **O defeito que estes testes prendem:** o download gravava `runtime/python.tar.gz` e as wheels,
 * nada os abria, e a prontidão — que perguntava se o arquivo baixado existia — respondia
 * `pronta: true` com o tarball fechado. A tela então oferecia transcrever com um sidecar
 * impossível de subir.
 *
 * Por isso o teste central é o **contrafactual do estado real do PI**: tarball no disco, `python/`
 * ausente. Antes da correção esse disco passava por pronto; aqui ele reprova.
 */

/** Um disco de mentira: o conjunto de caminhos que "existem". */
function disco(caminhos: readonly string[]) {
  const presentes = new Set(caminhos)
  const executados: { comando: string; args: readonly string[] }[] = []

  const deps: DepsDoPreparo = {
    diretorioDaVoz: (...partes) => join('/userData/voz', ...partes),
    existe: (c) => presentes.has(c),
    wheels: () => [],
    executar: async (comando, args) => {
      executados.push({ comando, args })
    },
    registrar: () => {}
  }

  return { deps, presentes, executados }
}

const PYTHON = join('/userData/voz', RELATIVO_DO_PYTHON)
const MARCA = join('/userData/voz', RELATIVO_DA_MARCA)
const TARBALL = join('/userData/voz', 'runtime', 'python.tar.gz')

describe('prontidão do runtime da voz', () => {
  it('recusa o disco do PI: tarball baixado, runtime nunca extraído', () => {
    // O estado exato que produziu "Não foi possível transcrever" com a tela dizendo pronta.
    const { deps } = disco([TARBALL])

    expect(runtimeUsavel(deps)).toBe(false)
  })

  it('recusa o runtime extraído sem as dependências instaladas', () => {
    // Extrair não basta: o sidecar importa `faster_whisper`, e sem as wheels ele sobe e morre no
    // import — falha mais confusa que a ausência do interpretador, porque o `python.exe` existe.
    const { deps } = disco([TARBALL, PYTHON])

    expect(runtimeUsavel(deps)).toBe(false)
  })

  it('aceita o runtime extraído com as dependências instaladas', () => {
    const { deps } = disco([TARBALL, PYTHON, MARCA])

    expect(runtimeUsavel(deps)).toBe(true)
  })
})

describe('preparo do runtime da voz', () => {
  it('extrai o tarball com o tar do Windows quando o interpretador não existe', async () => {
    const { deps, presentes, executados } = disco([TARBALL])
    // A extração faz o interpretador aparecer; o dublê reflete isso para o passo seguinte.
    const comExtracao: DepsDoPreparo = {
      ...deps,
      executar: async (comando, args) => {
        executados.push({ comando, args })
        presentes.add(PYTHON)
      }
    }

    const r = await prepararRuntime(comExtracao)

    expect(r).toEqual({ estado: 'ok' })
    expect(executados).toHaveLength(1)
    expect(executados[0].comando).toBe(TAR_DO_WINDOWS)
    expect(executados[0].args).toEqual(['-xf', TARBALL, '-C', join('/userData/voz', 'runtime')])
  })

  it('falha nomeando o problema quando a extração não produz o interpretador', async () => {
    // Código zero não prova layout: um release que abrisse noutra pasta deixaria a prontidão
    // mentindo de novo, uma camada adiante. Aqui vira falha com nome.
    const { deps } = disco([TARBALL])

    const r = await prepararRuntime(deps)

    expect(r.estado).toBe('falhou')
    expect(r.estado === 'falhou' && r.motivo).toContain('não está onde o sidecar o procura')
  })

  it('instala as wheels offline, sem índice e sem resolver dependências', async () => {
    const { deps, executados } = disco([TARBALL, PYTHON])
    const comWheels: DepsDoPreparo = {
      ...deps,
      wheels: () => ['/userData/voz/wheels/faster_whisper-1.2.1-py3-none-any.whl']
    }

    const r = await prepararRuntime(comWheels)

    expect(r).toEqual({ estado: 'ok' })
    expect(executados).toHaveLength(1)
    expect(executados[0].comando).toBe(PYTHON)
    // `--no-index` mantém a instalação offline: sem ele o pip iria à rede e um pacote entraria
    // sem passar pelo SHA-256 pinado, que é a garantia do critério 4.
    expect(executados[0].args).toContain('--no-index')
    expect(executados[0].args).toContain('--no-deps')
  })

  it('não faz nada quando o runtime já está pronto', async () => {
    // Reabrir o app não pode reextrair 200 MB nem reinstalar 28 wheels.
    const { deps, executados } = disco([TARBALL, PYTHON, MARCA])
    const comWheels: DepsDoPreparo = { ...deps, wheels: () => ['/w/a.whl'] }

    const r = await prepararRuntime(comWheels)

    expect(r).toEqual({ estado: 'nada-a-fazer' })
    expect(executados).toEqual([])
  })

  it('retoma um preparo interrompido depois da extração', async () => {
    // Cenário real: a instalação leva ~22 s e o usuário fecha o app no meio. A execução seguinte
    // não reextrai o que já está lá, e conclui o que falta.
    const { deps, executados } = disco([TARBALL, PYTHON])
    const comWheels: DepsDoPreparo = { ...deps, wheels: () => ['/w/a.whl'] }

    await prepararRuntime(comWheels)

    expect(executados).toHaveLength(1)
    expect(executados[0].comando).toBe(PYTHON)
  })

  it('não chama o tar quando o tarball ainda não foi baixado', async () => {
    // Download que não aconteceu não é falha do preparo. Chamar `tar` num arquivo ausente daria
    // um erro sobre a ferramenta, escondendo que o que falta é o artefato.
    const { deps, executados } = disco([])

    const r = await prepararRuntime(deps)

    expect(r).toEqual({ estado: 'nada-a-fazer' })
    expect(executados).toEqual([])
  })

  it('devolve falha tratada quando o tar sai com erro', async () => {
    const { deps } = disco([TARBALL])
    const comFalha: DepsDoPreparo = {
      ...deps,
      executar: async () => {
        throw new Error('tar: Error opening archive')
      }
    }

    const r = await prepararRuntime(comFalha)

    expect(r.estado).toBe('falhou')
    expect(r.estado === 'falhou' && r.motivo).toContain('tar: Error opening archive')
  })

  it('usa o tar do System32, não o que estiver no PATH', () => {
    // Um `tar` de terceiro no PATH (o do Git, por exemplo) é ambiente do usuário; o produto
    // garante o do sistema.
    expect(TAR_DO_WINDOWS.toLowerCase()).toContain('system32')
    expect(TAR_DO_WINDOWS.toLowerCase()).toContain('tar.exe')
  })
})
