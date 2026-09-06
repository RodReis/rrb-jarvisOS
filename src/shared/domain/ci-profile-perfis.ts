/**
 * Os perfis que a R2 prova, e a ponte do pacote legado (SPEC-Pipeline-01 R2, §3 e §4).
 *
 * A spec exige provar **dois** perfis de stack distintos, Node/npm e Python/pip, ambos exercitados
 * em Windows/PowerShell. Eles moram aqui como funções, não como JSON solto num teste, por dois
 * motivos: o teste prova o que a pipeline realmente produziria, e um projeto novo recebe um ponto
 * de partida válido em vez de um arquivo para copiar e errar.
 *
 * `perfilLegado` é a peça do critério 2. Ela **não descobre** a stack: recebe os quatro comandos
 * que o pacote antigo já declarava e os representa como perfil, marcados `legacy`. A diferença
 * importa — descoberta automática inventaria um ambiente que ninguém aprovou; representação diz
 * apenas "isto é o que o pacote antigo mandava rodar, agora legível pelo gerador novo".
 */

import type { ComandosDeValidacao } from './ci-workflow'
import type { PerfilDeCi } from './ci-profile'
import { VERSAO_DO_SCHEMA_DO_PERFIL } from './ci-profile'

/**
 * O perfil Node/npm em Windows/PowerShell.
 *
 * Os três grupos existem para provar o paralelismo do critério 6: `qualidade` e `testes` não
 * dependem um do outro e viram jobs paralelos; `build` declara dependência de `qualidade` e espera.
 */
export function perfilNodeEmWindows(profileId: string): PerfilDeCi {
  return {
    schemaVersion: VERSAO_DO_SCHEMA_DO_PERFIL,
    profileId,
    runtime: 'node',
    versaoDoRuntime: '24',
    sistema: 'windows',
    shell: 'pwsh',
    instalacao: { argv: ['npm', 'ci'] },
    timeoutEmMinutos: 30,
    validacoes: [
      { id: 'lint', nome: 'lint', argv: ['npm', 'run', 'lint'], grupo: 'qualidade' },
      { id: 'typecheck', nome: 'typecheck', argv: ['npm', 'run', 'typecheck'], grupo: 'qualidade' },
      { id: 'test', nome: 'test', argv: ['npm', 'test'], grupo: 'testes' },
      {
        id: 'build',
        nome: 'build',
        argv: ['npm', 'run', 'build'],
        grupo: 'build',
        dependeDe: ['typecheck']
      }
    ]
  }
}

/**
 * O perfil Python/pip em Windows/PowerShell.
 *
 * O ponto do critério 1 é que este perfil **não recebe `npm ci`**. Ele instala com pip e valida com
 * ruff, mypy e pytest porque o perfil diz isso — não porque o gerador reconheceu uma linguagem.
 */
export function perfilPythonEmWindows(profileId: string): PerfilDeCi {
  return {
    schemaVersion: VERSAO_DO_SCHEMA_DO_PERFIL,
    profileId,
    runtime: 'python',
    versaoDoRuntime: '3.12',
    sistema: 'windows',
    shell: 'pwsh',
    instalacao: { argv: ['pip', 'install', '-r', 'requirements.txt'] },
    timeoutEmMinutos: 30,
    validacoes: [
      { id: 'ruff', nome: 'lint', argv: ['ruff', 'check', '.'], grupo: 'qualidade' },
      { id: 'mypy', nome: 'typecheck', argv: ['mypy', '.'], grupo: 'qualidade' },
      { id: 'pytest', nome: 'test', argv: ['pytest', '-q'], grupo: 'testes' }
    ]
  }
}

/**
 * A representação explícita do pacote legado (critério 2).
 *
 * Um grupo só, e por isso sequencial: o pacote antigo nunca declarou independência entre os quatro
 * comandos, e o gerador não a infere. Paralelizar aqui seria a "migração tácita" que o critério 2
 * recusa — ganho de tempo obtido presumindo uma garantia que ninguém deu.
 *
 * `linux`/`bash` porque é o que o workflow legado realmente usava (`ubuntu-latest`). Mudar para
 * Windows nesta conversão seria migrar o ambiente de um projeto por iniciativa própria.
 */
export function perfilLegado(profileId: string, comandos: ComandosDeValidacao): PerfilDeCi {
  const passo = (id: string, argv: readonly string[]): PerfilDeCi['validacoes'][number] => ({
    id,
    nome: id,
    argv,
    grupo: 'legacy'
  })

  return {
    schemaVersion: VERSAO_DO_SCHEMA_DO_PERFIL,
    profileId,
    runtime: 'node',
    versaoDoRuntime: '24',
    sistema: 'linux',
    shell: 'bash',
    instalacao: { argv: ['npm', 'ci'] },
    timeoutEmMinutos: 30,
    legacy: true,
    validacoes: [
      passo('lint', comandos.lint),
      passo('typecheck', comandos.typecheck),
      passo('test', comandos.test),
      passo('build', comandos.build)
    ]
  }
}
