#!/usr/bin/env node
/**
 * Smoke real do sandbox do executor (SPEC-Entrega-03 § Testes e evidência).
 *
 * O que os testes de integração não podem provar: que a **mecânica** funciona. O dublê do Docker
 * responde o que eu escrevi que ele responde; aqui o Docker responde o que ele responde. É a
 * diferença entre "o preflight decidiu certo" e "o container montado assim de fato serve".
 *
 * **Este smoke achou dois defeitos com 25 testes verdes**, e é por isso que ele existe:
 *
 *  1. reescrever o `commondir` do worktree **derruba o Git do host** — é um arquivo só, e host e
 *     container precisam de caminhos diferentes nele. Nenhum teste de unidade via: o preflight
 *     continuava devolvendo `liberado`;
 *  2. o checkout com CRLF (padrão do Windows) faz o Git do container (Linux) ler **toda** a
 *     árvore como modificada, o que faria o gate de escopo acusar fuga em todo arquivo.
 *
 * **Não cria efeito externo** — nem rede, nem repositório remoto: só um repositório Git temporário
 * e um container que é removido no fim. Pode rodar à vontade. Exige Docker no ar.
 *
 * Uso:
 *   node scripts/smoke-sandbox.mjs
 *
 * Sai com código 1 se qualquer passo falhar, para servir de gate manual antes de fechar fatia.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const IMAGEM = process.env.SANDBOX_SMOKE_IMAGE ?? 'alpine/git:latest'
const NOME = `jarvisos-smoke-${process.pid}`

let falhas = 0

function passo(titulo, fn) {
  try {
    const detalhe = fn()
    console.log(`  ok   ${titulo}${detalhe ? ` — ${detalhe}` : ''}`)
  } catch (erro) {
    falhas += 1
    console.error(`  FALHA ${titulo}\n        ${erro.message.split('\n')[0]}`)
  }
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

/** `docker run` descartável sobre o sandbox, com as montagens que o preflight monta. */
function montarArgs(args, { worktree, gitMeta, gitCommon }) {
  return [
    'run',
    '--rm',
    '--volume',
    `${worktree}:/work`,
    '--volume',
    `${gitMeta}:/work/.gitmeta:ro`,
    '--volume',
    `${gitCommon}:/gitcommon:ro`,
    '--workdir',
    '/work',
    '--env',
    'GIT_DIR=/work/.gitmeta',
    '--env',
    'GIT_WORK_TREE=/work',
    '--env',
    'ANTHROPIC_BASE_URL=http://host.docker.internal:9999',
    ...args
  ]
}

function noContainer(args, montagem) {
  return execFileSync(
    'docker',
    montarArgs(args, montagem),
    // `stderr: 'pipe'` **e** juntado ao retorno: a recusa de escrita do `sh` sai no stderr dele,
    // e o `2>&1` de dentro do comando não a alcança — o redirecionamento é montado antes de o
    // `sh` tentar abrir o arquivo. Ler só o stdout fazia este smoke reprovar com o Docker
    // fazendo exatamente a coisa certa.
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
}

/** Como `noContainer`, mas devolve stdout **e** stderr — para os passos que afirmam sobre recusa. */
function noContainerComErro(args, montagem) {
  const resultado = spawnSync('docker', montarArgs(args, montagem), { encoding: 'utf8' })
  return `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`.trim()
}

const base = mkdtempSync(join(tmpdir(), 'jarvis-smoke-sandbox-'))
const repo = join(base, 'projeto')
const raiz = join(base, 'operacional')
mkdirSync(raiz, { recursive: true })

try {
  console.log('Preparando repositório temporário…')
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' })
  git(['config', 'user.email', 'smoke@exemplo.com'], repo)
  git(['config', 'user.name', 'Smoke'], repo)
  // O pior caso de propósito: é o padrão do Windows, e foi ele que revelou o defeito 2.
  git(['config', 'core.autocrlf', 'true'], repo)
  mkdirSync(join(repo, 'src', 'main'), { recursive: true })
  writeFileSync(join(repo, 'README.md'), '# projeto\nlinha\n')
  writeFileSync(join(repo, 'src', 'main', 'a.ts'), 'export const x = 1\n')
  git(['add', '.'], repo)
  git(['commit', '-m', 'inicial'], repo)
  const sha = git(['rev-parse', 'HEAD'], repo)

  // Exatamente o que o preflight faz: checkout sem conversão de fim de linha…
  const worktree = join(raiz, NOME)
  git(['-c', 'core.autocrlf=false', 'worktree', 'add', '-b', `feat/${NOME}`, worktree, sha], repo)

  // …e o metadado do Git **copiado**, nunca reescrito no original.
  const gitMeta = join(worktree, '.gitmeta')
  cpSync(join(repo, '.git', 'worktrees', NOME), gitMeta, { recursive: true })
  writeFileSync(join(gitMeta, 'commondir'), '/gitcommon\n', 'utf8')

  const montagem = { worktree, gitMeta, gitCommon: join(repo, '.git') }

  console.log(`\nSmoke do sandbox (imagem ${IMAGEM}):`)

  passo('a árvore nasce limpa dentro do container (defeito do CRLF)', () => {
    const saida = noContainer([IMAGEM, 'status', '--short'], montagem)
    const sujos = saida.split('\n').filter((l) => l.trim() !== '' && !l.includes('.gitmeta'))
    if (sujos.length > 0) throw new Error(`árvore suja no container: ${sujos.join(', ')}`)
    return 'sem arquivo modificado'
  })

  passo('o histórico é legível (exige o .git principal montado)', () => {
    const saida = noContainer([IMAGEM, 'log', '--oneline', '-1'], montagem)
    if (!saida.startsWith(sha.slice(0, 7))) throw new Error(`log inesperado: ${saida}`)
    return saida
  })

  passo('a escrita no .git principal é rejeitada pelo Docker', () => {
    // `2>&1` **dentro** do shell do container: a recusa do `sh` vai para o stderr dele, e sem
    // o redirecionamento ela não chega ao stdout que este script lê. Foi assim que a primeira
    // versão deste passo reprovou com o Docker fazendo a coisa certa.
    const saida = noContainerComErro(
      ['--entrypoint', 'sh', IMAGEM, '-c', 'echo x > /gitcommon/HACK'],
      montagem
    )
    if (!/read-only/i.test(saida)) throw new Error(`esperava recusa de escrita, veio: ${saida}`)
    return 'read-only file system'
  })

  passo('nenhum segredo no ambiente do container (critério 9)', () => {
    const saida = noContainer(
      [
        '--entrypoint',
        'sh',
        IMAGEM,
        '-c',
        'env | grep -Ei "key|token|secret|claude" || echo NENHUM_SEGREDO'
      ],
      montagem
    )
    if (!saida.includes('NENHUM_SEGREDO')) throw new Error(`ambiente carrega: ${saida}`)
    return 'só ANTHROPIC_BASE_URL'
  })

  passo('o Git do host continua funcionando no worktree (defeito do commondir)', () => {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree)
    if (branch !== `feat/${NOME}`) throw new Error(`branch inesperada: ${branch}`)
    return branch
  })

  passo('round-trip: executor escreve, host vê e commita', () => {
    noContainer(
      ['--entrypoint', 'sh', IMAGEM, '-c', 'echo "export const y = 2" > src/main/b.ts'],
      montagem
    )
    const conteudo = readFileSync(join(worktree, 'src', 'main', 'b.ts'), 'utf8')
    if (!conteudo.includes('const y = 2')) throw new Error('o host não viu o arquivo do executor')
    git(['add', 'src/main/b.ts'], worktree)
    git(
      ['-c', 'user.email=app@exemplo.com', '-c', 'user.name=App', 'commit', '-m', 'do executor'],
      worktree
    )
    return git(['log', '--oneline', '-1'], worktree)
  })

  // O furo declarado da fatia, medido e não escondido: hoje o egress NÃO é restrito (#222).
  passo('LIMITE CONHECIDO (#222): o egress ainda não é restrito', () => {
    try {
      execFileSync(
        'docker',
        ['run', '--rm', IMAGEM, 'ls-remote', 'https://github.com/RodReis/rrb-jarvisOS.git', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }
      )
      return 'container alcança o GitHub — critério 12 em aberto, como registrado'
    } catch {
      return 'container NÃO alcançou o GitHub — conferir se #222 foi entregue e atualizar este passo'
    }
  })

  git(['worktree', 'remove', '--force', worktree], repo)
} finally {
  try {
    execFileSync('docker', ['rm', '--force', NOME], { stdio: 'ignore' })
  } catch {
    // o container só existe se algum passo o tiver criado com --name; ausente é o normal
  }
  rmSync(base, { recursive: true, force: true })
}

console.log(
  falhas === 0 ? '\nSmoke do sandbox: tudo verde.' : `\nSmoke do sandbox: ${falhas} falha(s).`
)
process.exit(falhas === 0 ? 0 : 1)
