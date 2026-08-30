/**
 * O **único** caminho de Git desta fatia (SPEC-Planejamento-01, decisão 2 do PI).
 *
 * Git é o `git` do sistema, executado pelo **terminal controlado do MVP-004** — não uma
 * biblioteca JS embarcada. A decisão não é sobre preferência de implementação: uma lib de Git
 * em processo escreveria no disco por dentro do main, fora do Policy Engine, sem `AuditEvent` e
 * sem timeout — abrindo um **segundo caminho de escrita** que escaparia exatamente do
 * enforcement que o MVP-004 entregou. Este módulo existe para que esse segundo caminho não
 * exista: quem quiser rodar Git no app passa por aqui, e daqui só se sai pelo `TerminalEngine`.
 *
 * O que este arquivo **não** faz, deliberadamente: não valida allowlist, não classifica, não
 * audita a execução. Tudo isso é do `TerminalEngine`, e repetir aqui criaria uma segunda fonte
 * de política — que divergiria da primeira no dia em que uma das duas mudasse.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { CommandExecution } from '@shared/domain/terminal'
import type { TerminalEngine } from '../execution/terminal-engine'

/** O binário. Constante nomeada porque é o valor que precisa estar pinado na allowlist. */
export const BINARIO_GIT = 'git'

/**
 * Mensagem da ausência de `git` (spec § Regras: `BLOCKED_EXTERNAL` com **ação concreta**,
 * nunca fallback silencioso para outra implementação).
 *
 * A ação concreta é literal aqui e não genérica ("algo deu errado com o Git") porque o usuário
 * precisa saber qual dos dois problemas ele tem: o binário não está na máquina, ou está e não
 * foi permitido. São remédios diferentes, e uma mensagem só para os dois mandaria metade dos
 * usuários procurar no lugar errado.
 */
export const GIT_FORA_DA_ALLOWLIST =
  'O comando `git` não está permitido neste espaço. Permita-o em Terminal Controlado → comandos permitidos para que o projeto possa versionar sua documentação.'

export const GIT_NAO_INSTALADO =
  'O `git` não foi encontrado nesta máquina. Instale o Git (https://git-scm.com/downloads) e reabra o app para que o projeto possa versionar sua documentação.'

/**
 * Uma execução de Git, na forma que o serviço de projeto consome.
 *
 * `ok` é derivado, não um segundo estado: o `CommandExecution` já diz tudo, e este campo evita
 * que cada call site repita a mesma comparação — repetida errado uma vez, um comando falho
 * passaria por bem-sucedido.
 */
export interface GitOutcome {
  readonly ok: boolean
  readonly execucao: CommandExecution
  /** Saída padrão já redigida e sem espaços nas pontas — o que o chamador costuma querer. */
  readonly saida: string
}

/**
 * Roda um comando Git pelo terminal controlado.
 *
 * Note o que **não** está aqui: nenhum `spawn`, nenhum `exec`, nenhuma string de linha de
 * comando. Argumentos entram como array e saem como array — sem shell, o `;` de um nome de
 * branch é o caractere `;`, não um encadeamento.
 */
export class GitRunner {
  constructor(private readonly terminal: TerminalEngine) {}

  run(args: readonly string[], cwd: string, workspaceId: WorkspaceId): GitOutcome {
    const execucao = this.terminal.run({ binary: BINARIO_GIT, args, cwd }, workspaceId)

    return {
      ok: execucao.state === 'concluido',
      execucao,
      saida: execucao.stdout.trim()
    }
  }

  /**
   * A mensagem certa para um Git que não rodou.
   *
   * Traduz o `CommandReason` do terminal para o remédio do usuário. Vive aqui, e não no serviço,
   * porque é conhecimento sobre **Git no terminal controlado** — quem chamar o runner de outra
   * fatia deve receber a mesma explicação, não escrever a própria.
   */
  static explicarFalha(execucao: CommandExecution): string {
    switch (execucao.reason) {
      case 'binario-fora-da-allowlist':
        return GIT_FORA_DA_ALLOWLIST
      case 'falha-na-execucao':
        // `spawnSync` devolve `ENOENT` quando o binário não existe no PATH. É a única forma de
        // distinguir "não instalado" de "instalado e falhou", e a distinção importa: os dois
        // desfechos têm ações opostas.
        return execucao.stderr.includes('ENOENT') ? GIT_NAO_INSTALADO : execucao.stderr
      case 'cwd-fora-da-allowlist':
        return 'O diretório do projeto não está na lista de diretórios permitidos. Permita-o em Diretórios Permitidos.'
      case 'timeout-excedido':
        return 'O comando Git demorou demais e foi encerrado. Tente novamente.'
      default:
        return execucao.stderr.trim() || 'O comando Git não pôde ser executado.'
    }
  }
}
