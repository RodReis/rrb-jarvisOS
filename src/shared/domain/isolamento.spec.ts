import { describe, expect, it } from 'vitest'
import {
  ESTADOS_DO_RECURSO,
  FAIXA_DE_PORTAS,
  argsDeLabel,
  comandoDeLimpezaDoInventario,
  escanearSandbox,
  runOuUnidadeAtiva,
  escolherPorta,
  labelsDoRecurso,
  portasDaSaidaDoDocker,
  transicaoValida
} from './isolamento'

describe('labelsDoRecurso', () => {
  it('etiqueta o recurso com run, fatia, tentativa, projeto e a marca de gerido', () => {
    const labels = labelsDoRecurso({
      runId: 'run-1',
      sliceId: 'F03',
      projectId: 'proj-1',
      tentativa: 2
    })

    expect(labels).toEqual({
      'jarvisos.gerido': 'true',
      'jarvisos.run': 'run-1',
      'jarvisos.fatia': 'F03',
      'jarvisos.projeto': 'proj-1',
      'jarvisos.tentativa': '2'
    })
  })

  it('assume a tentativa 1 quando o run não declara outra', () => {
    expect(
      labelsDoRecurso({ runId: 'r', sliceId: 's', projectId: 'p' })['jarvisos.tentativa']
    ).toBe('1')
  })

  it('vira argumentos --label um a um, sem shell', () => {
    expect(argsDeLabel({ 'jarvisos.run': 'r1', 'jarvisos.gerido': 'true' })).toEqual([
      '--label',
      'jarvisos.run=r1',
      '--label',
      'jarvisos.gerido=true'
    ])
  })
})

describe('transicaoValida', () => {
  it('só avança planejado → criado → parado → removido', () => {
    expect(transicaoValida('planejado', 'criado')).toBe(true)
    expect(transicaoValida('criado', 'parado')).toBe(true)
    expect(transicaoValida('parado', 'removido')).toBe(true)
  })

  it('aceita remover direto de planejado e de criado (crash antes de parar)', () => {
    expect(transicaoValida('planejado', 'removido')).toBe(true)
    expect(transicaoValida('criado', 'removido')).toBe(true)
  })

  it('nunca volta nem sai de removido', () => {
    expect(transicaoValida('removido', 'criado')).toBe(false)
    expect(transicaoValida('criado', 'planejado')).toBe(false)
    expect(transicaoValida('removido', 'removido')).toBe(false)
  })

  it('declara os quatro estados', () => {
    expect(ESTADOS_DO_RECURSO).toEqual(['planejado', 'criado', 'parado', 'removido'])
  })
})

describe('portasDaSaidaDoDocker', () => {
  it('lê a porta do host em cada binding publicado', () => {
    const saida = '0.0.0.0:20001->5432/tcp, [::]:20001->5432/tcp, 127.0.0.1:20002->6379/tcp'
    expect(portasDaSaidaDoDocker(saida)).toEqual([20001, 20002])
  })

  it('ignora porta exposta mas não publicada', () => {
    expect(portasDaSaidaDoDocker('5432/tcp')).toEqual([])
  })

  it('lê uma lista de HostPort separada por espaço (docker inspect)', () => {
    expect(portasDaSaidaDoDocker('20010 20011 \n20012')).toEqual([20010, 20011, 20012])
  })

  it('devolve vazio para saída vazia', () => {
    expect(portasDaSaidaDoDocker('')).toEqual([])
  })

  it('expande a faixa publicada (8000-8002->80-82/tcp)', () => {
    expect(portasDaSaidaDoDocker('0.0.0.0:8000-8002->80-82/tcp')).toEqual([8000, 8001, 8002])
  })

  it('lê uma faixa de HostPort do inspect (20010-20012)', () => {
    expect(portasDaSaidaDoDocker('20010-20012 ')).toEqual([20010, 20011, 20012])
  })

  it('uma faixa enorme também é lida inteira: ignorá-la liberaria porta que o container tem', () => {
    expect(portasDaSaidaDoDocker('1-65535')).toHaveLength(65_535)
  })

  it('faixa invertida ou fora de 1–65535 não gera porta', () => {
    expect(portasDaSaidaDoDocker('9000-8000 0-5 70000-70005')).toEqual([])
  })
})

describe('escolherPorta', () => {
  const faixa = { inicio: 20000, fim: 20004 }

  it('escolhe a primeira porta livre da faixa', () => {
    expect(escolherPorta(faixa, new Set())).toBe(20000)
  })

  it('pula as indisponíveis', () => {
    expect(escolherPorta(faixa, new Set([20000, 20001, 20003]))).toBe(20002)
  })

  it('devolve undefined quando a faixa inteira está tomada', () => {
    expect(escolherPorta(faixa, new Set([20000, 20001, 20002, 20003, 20004]))).toBeUndefined()
  })

  it('a faixa padrão fica fora das portas bem conhecidas e dos serviços locais do projeto', () => {
    expect(FAIXA_DE_PORTAS.inicio).toBeGreaterThan(10_000)
    for (const porta of [3311, 5180, 5433, 6380, 8080]) {
      expect(porta < FAIXA_DE_PORTAS.inicio || porta > FAIXA_DE_PORTAS.fim).toBe(true)
    }
  })
})

describe('escanearSandbox', () => {
  const limpo = {
    env: ['PATH=/usr/bin', 'GIT_DIR=/work/.gitmeta', 'ANTHROPIC_BASE_URL=http://172.20.0.2:8080'],
    montagens: [
      { origem: 'C:/raiz/jarvisos-run-a', destino: '/work', somenteLeitura: false },
      { origem: 'C:/repo/.git', destino: '/gitcommon', somenteLeitura: true }
    ],
    comando: ['sleep', 'infinity'],
    arquivos: ['/work/src/index.ts']
  }

  it('não acusa um sandbox como o do preflight', () => {
    expect(escanearSandbox(limpo)).toEqual([])
  })

  it('acusa variável de ambiente com nome de credencial, sem devolver o valor', () => {
    const achados = escanearSandbox({ ...limpo, env: [...limpo.env, 'GITHUB_TOKEN=ghp_abc'] })
    expect(achados).toHaveLength(1)
    expect(achados[0]?.origem).toBe('env')
    expect(achados[0]?.referencia).toBe('GITHUB_TOKEN')
    expect(JSON.stringify(achados)).not.toContain('ghp_abc')
  })

  it('acusa valor com formato de segredo mesmo sob um nome inocente', () => {
    const achados = escanearSandbox({
      ...limpo,
      env: [...limpo.env, 'ALGO=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123']
    })
    expect(achados.map((a) => a.origem)).toContain('env')
  })

  it('não acusa ANTHROPIC_BASE_URL: é só o endereço do sidecar', () => {
    expect(escanearSandbox(limpo).some((a) => a.referencia === 'ANTHROPIC_BASE_URL')).toBe(false)
  })

  it('acusa montagem de diretório de credencial do host', () => {
    for (const origem of [
      'C:/Users/x/.claude',
      'C:/Users/x/.codex',
      '/home/x/.ssh',
      '/home/x/.aws',
      '/home/x/.config/gh',
      '/var/run/docker.sock'
    ]) {
      const achados = escanearSandbox({
        ...limpo,
        montagens: [...limpo.montagens, { origem, destino: '/x', somenteLeitura: true }]
      })
      expect(
        achados.some((a) => a.origem === 'montagem'),
        origem
      ).toBe(true)
    }
  })

  it('acusa arquivo com nome proibido dentro do container', () => {
    const achados = escanearSandbox({ ...limpo, arquivos: ['/work/.env', '/work/src/a.ts'] })
    expect(achados).toEqual([
      expect.objectContaining({ origem: 'arquivo', referencia: '/work/.env' })
    ])
  })

  it('acusa credencial no comando de entrada', () => {
    const achados = escanearSandbox({
      ...limpo,
      comando: ['run', '--token', 'ghp_' + 'a'.repeat(30)]
    })
    expect(achados.some((a) => a.origem === 'comando')).toBe(true)
  })
})

describe('comandoDeLimpezaDoInventario', () => {
  const inventario = { redes: new Set(['jarvisos-egress-a']) }

  it('autoriza docker network rm de uma rede do inventário', () => {
    expect(
      comandoDeLimpezaDoInventario('docker', ['network', 'rm', 'jarvisos-egress-a'], inventario)
    ).toBe(true)
  })

  it('recusa rede fora do inventário', () => {
    expect(comandoDeLimpezaDoInventario('docker', ['network', 'rm', 'bridge'], inventario)).toBe(
      false
    )
  })

  it('recusa qualquer outra forma do comando', () => {
    expect(
      comandoDeLimpezaDoInventario(
        'docker',
        ['network', 'rm', 'jarvisos-egress-a', 'bridge'],
        inventario
      )
    ).toBe(false)
    expect(comandoDeLimpezaDoInventario('docker', ['network', 'prune'], inventario)).toBe(false)
    expect(
      comandoDeLimpezaDoInventario('docker', ['rm', '-f', 'jarvisos-egress-a'], inventario)
    ).toBe(false)
    expect(
      comandoDeLimpezaDoInventario(
        'docker',
        ['network', 'rm', '-f', 'jarvisos-egress-a'],
        inventario
      )
    ).toBe(false)
  })

  it('recusa binário que não é o docker', () => {
    expect(comandoDeLimpezaDoInventario('rm', ['-rf', 'jarvisos-egress-a'], inventario)).toBe(false)
  })
})

describe('runOuUnidadeAtiva', () => {
  const ativos = ['run-1', 'aaaa-bbbb']

  it('o run ativo é ativo', () => {
    expect(runOuUnidadeAtiva('run-1', ativos)).toBe(true)
  })

  it('a unidade de sandbox de um run ativo (<run>-<escritor>-<tarefa>-tN) é ativa', () => {
    expect(runOuUnidadeAtiva('run-1-api-tar-1-t2', ativos)).toBe(true)
    expect(runOuUnidadeAtiva('run-1-teste-t1', ativos)).toBe(true)
  })

  it('não confunde prefixo de texto com run: run-10 não é unidade de run-1', () => {
    expect(runOuUnidadeAtiva('run-10', ativos)).toBe(false)
  })

  it('run que não está entre os ativos não é ativo', () => {
    expect(runOuUnidadeAtiva('morto', ativos)).toBe(false)
    expect(runOuUnidadeAtiva('morto-api-t1', ativos)).toBe(false)
  })
})

describe('escanearSandbox: o que a revisão de segurança demonstrou escapar', () => {
  const limpo = {
    env: ['PATH=/usr/bin', 'ANTHROPIC_BASE_URL=http://172.20.0.2:8080', 'GIT_AUTHOR_NAME=Ana'],
    montagens: [{ origem: '/raiz/c', destino: '/work', somenteLeitura: false }],
    comando: ['sleep', 'infinity'],
    arquivos: [] as string[]
  }

  it('o sandbox limpo continua limpo, com GIT_AUTHOR_NAME e a URL do sidecar', () => {
    expect(escanearSandbox(limpo)).toEqual([])
  })

  it.each([
    'AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX',
    'SESSION_COOKIE=abc',
    'BEARER_VALUE=abc',
    'AUTH=abc',
    'MY_AUTH_HEADER=abc'
  ])('acusa a variável %s pelo nome', (linha) => {
    const nome = linha.split('=')[0]
    const achados = escanearSandbox({ ...limpo, env: [...limpo.env, linha] })
    expect(achados.map((a) => a.referencia)).toEqual([nome])
  })

  it.each([
    [['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_'), 'Stripe'],
    [['xoxb', '1234567890', 'abcdefghij'].join('-'), 'Slack'],
    [['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnop'].join('.'), 'JWT'],
    ['postgres://usuario:senha@host:5432/db', 'URL com usuário e senha']
  ])('acusa o valor %s (%s) sob um nome inocente', (valor) => {
    const achados = escanearSandbox({ ...limpo, env: [...limpo.env, `ALGO=${valor}`] })
    expect(achados.map((a) => a.referencia)).toEqual(['ALGO'])
    expect(JSON.stringify(achados)).not.toContain(valor)
  })

  it('URL sem usuário e senha não é credencial', () => {
    expect(
      escanearSandbox({ ...limpo, env: [...limpo.env, 'ALVO=http://host:8080/caminho'] })
    ).toEqual([])
  })

  it.each([
    '/root/.credentials.json',
    '/root/.git-credentials',
    '/root/.pgpass',
    '/root/.aws/credentials',
    '/root/.docker/config.json',
    '/home/x/.kube/config'
  ])('acusa o arquivo %s', (arquivo) => {
    const achados = escanearSandbox({ ...limpo, arquivos: [arquivo] })
    expect(achados.map((a) => a.referencia)).toEqual([arquivo])
  })

  it('não acusa um arquivo comum chamado config', () => {
    expect(escanearSandbox({ ...limpo, arquivos: ['/tmp/app/config.json'] })).toEqual([])
  })

  it.each(['//./pipe/docker_engine', 'C:/Users/x/.config/gcloud', 'C:/Users/x/.azure'])(
    'acusa a montagem %s',
    (origem) => {
      const achados = escanearSandbox({
        ...limpo,
        montagens: [...limpo.montagens, { origem, destino: '/x', somenteLeitura: true }]
      })
      expect(achados.some((a) => a.origem === 'montagem')).toBe(true)
    }
  )

  it('acusa credencial no config do Git montado em /gitcommon, sem devolver o conteúdo', () => {
    const config =
      '[remote "origin"]\n\turl = https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git\n'
    const achados = escanearSandbox({ ...limpo, configDoGit: config })

    expect(achados).toEqual([
      expect.objectContaining({ origem: 'arquivo', referencia: '/gitcommon/config' })
    ])
    expect(JSON.stringify(achados)).not.toContain('ghp_')
  })

  it('config do Git sem credencial no remote é limpo', () => {
    const config = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'

    expect(escanearSandbox({ ...limpo, configDoGit: config })).toEqual([])
  })
})
