/**
 * Integração do logger com o disco (categoria "Banco" do ADR-003).
 *
 * O que se prova aqui não dá para provar em unidade: que o arquivo escrito **não contém** o
 * segredo, que cada nível vai para o seu próprio arquivo (a retenção é por nível) e que a
 * poda apaga também o `.gz`. É a diferença entre "a função redige" e "o disco está limpo".
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LogRecord } from '@shared/contracts/logging'
import { closeLogger, initLogger, log, setCurrentWorkspace, writeLog } from './logger'

let logsDir: string

/** Winston escreve de forma assíncrona; o teste espera o arquivo aparecer em vez de dormir. */
async function aguardarArquivos(prefixo: string, tentativas = 50): Promise<string[]> {
  for (let i = 0; i < tentativas; i += 1) {
    const encontrados = readdirSync(logsDir).filter((nome) => nome.startsWith(prefixo))
    if (encontrados.length > 0) return encontrados
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return []
}

async function lerRegistros(prefixo: string): Promise<LogRecord[]> {
  const arquivos = await aguardarArquivos(prefixo)

  return arquivos.flatMap((nome) =>
    readFileSync(join(logsDir, nome), 'utf8')
      .split('\n')
      .filter((linha) => linha.trim().length > 0)
      .map((linha) => JSON.parse(linha) as LogRecord)
  )
}

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), 'jarvis-logs-'))
  initLogger(logsDir)
})

afterEach(async () => {
  closeLogger()
  // O winston fecha os streams de forma assíncrona: apagar o diretório em seguida faz o
  // flush pendente falhar com ENOENT e derruba o teste vizinho. Espera-se o fechamento.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(logsDir, { recursive: true, force: true })
})

describe('logger do main', () => {
  it('grava registro JSON com os campos mínimos do contrato', async () => {
    log.ipc.info('Metadados do app solicitados', { canal: 'app:info' })

    const [registro] = await lerRegistros('info-')

    expect(registro).toMatchObject({
      level: 'info',
      category: 'ipc',
      msg: 'Metadados do app solicitados',
      source: 'main',
      workspace: 'sistema',
      pid: process.pid
    })
    expect(registro?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(registro?.ctx).toEqual({ canal: 'app:info' })
  })

  it('não grava o valor de campo sensível no arquivo', async () => {
    // A prova é sobre o **arquivo**, não sobre a função: o critério de aceite 4 da spec
    // exige que o token não esteja no disco.
    log.auth.info('Login Google concluído', {
      userId: 'u-1',
      accessToken: 'ya29.token-secreto-que-nao-pode-vazar'
    })

    const arquivos = await aguardarArquivos('info-')
    const conteudo = arquivos.map((nome) => readFileSync(join(logsDir, nome), 'utf8')).join('')

    expect(conteudo).not.toContain('ya29.token-secreto-que-nao-pode-vazar')
    expect(conteudo).toContain('[redigido]')
    expect(conteudo).toContain('u-1')
  })

  it('separa os níveis em arquivos distintos, sem transbordo do mais severo', async () => {
    // `level: 'info'` no winston significa "info e tudo mais severo". Sem o filtro de nível
    // exato, os `error` cairiam também no arquivo de info e seriam podados em 3 dias em vez
    // de 10 — a retenção por nível deixaria de valer.
    log.sistema.info('Aplicação iniciada')
    log.sistema.warn('Degradação recuperável')
    log.sistema.error('Falha ao gravar')

    const info = await lerRegistros('info-')
    const warn = await lerRegistros('warn-')
    const error = await lerRegistros('error-')

    expect(info.map((r) => r.level)).toEqual(['info'])
    expect(warn.map((r) => r.level)).toEqual(['warn'])
    expect(error.map((r) => r.level)).toEqual(['error'])
  })

  it('etiqueta o registro com o workspace ativo', async () => {
    setCurrentWorkspace('noa')
    log.ui.info('Tela aberta')

    const [registro] = await lerRegistros('info-')

    expect(registro?.workspace).toBe('noa')
    setCurrentWorkspace('sistema')
  })

  it('marca como renderer o registro que chega pela ponte', async () => {
    writeLog({ level: 'info', category: 'ui', msg: 'Componente montado', source: 'renderer' })

    const [registro] = await lerRegistros('info-')

    expect(registro?.source).toBe('renderer')
  })

  it('preserva direction e correlationId para casar entrada e saída', async () => {
    writeLog({
      level: 'info',
      category: 'integracao',
      msg: 'Resposta da API recebida',
      direction: 'in',
      correlationId: 'op-42',
      source: 'main'
    })

    const [registro] = await lerRegistros('info-')

    expect(registro?.direction).toBe('in')
    expect(registro?.correlationId).toBe('op-42')
  })
})

describe('retenção por nível', () => {
  it('configura maxFiles em dias conforme a decisão do PI (info 3 / warn 7 / error 10)', () => {
    // A janela real (3, 7 e 10 dias) não é observável num teste: exigiria adiantar o relógio
    // por dias. O que se prova aqui é que o transport recebeu a janela certa, e o teste
    // seguinte prova que a poda apaga o `.gz` quando ela dispara.
    const logger = initLogger(logsDir)
    const janelas = logger.transports
      .filter((t) => 'filename' in t)
      .map((t) => {
        const transport = t as unknown as { filename: string; options: { maxFiles: string } }
        return [transport.filename.split('-%DATE%')[0], transport.options.maxFiles]
      })

    expect(Object.fromEntries(janelas)).toEqual({ info: '3d', warn: '7d', error: '10d' })
  })

  it('apaga o .gz junto do arquivo podado', async () => {
    // Gotcha registrado na spec: a poda do file-stream-rotator apaga `file.name`, que é o
    // nome sem `.gz`. O winston-daily-rotate-file@5 cobre isso no evento `logRemoved` —
    // este teste é o que prova que a versão instalada de fato cobre, em vez de assumir.
    const logger = initLogger(logsDir)
    const transport = logger.transports.find((t) => 'filename' in t) as unknown as {
      on(evento: string, ouvinte: (arquivo: string) => void): void
      logStream: { emit(evento: string, params: unknown): void }
    }

    const podado = join(logsDir, 'info-2020-01-01.log')
    writeFileSync(podado, '{}\n')
    writeFileSync(`${podado}.gz`, '')

    const removidos: string[] = []
    transport.on('logRemoved', (arquivo) => removidos.push(arquivo))
    transport.logStream.emit('logRemoved', { name: podado })

    expect(removidos).toEqual([`${podado}.gz`])
    expect(readdirSync(logsDir)).not.toContain('info-2020-01-01.log.gz')
  })
})
