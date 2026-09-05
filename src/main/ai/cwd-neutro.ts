/**
 * O diretório de trabalho **neutro** de um run de CLI (emenda E1 à SPEC-Fases-03, § Regras).
 *
 * A pergunta que este arquivo responde: **de onde o CLI enxerga o mundo enquanto gera?**
 *
 * Até aqui a resposta era `process.cwd()`, e o comentário que a defendia — "o diretório do app,
 * nunca o do usuário" — estava errado nas duas metades. Em desenvolvimento, o diretório do app
 * **é** o repositório do JarvisOS, com `CLAUDE.md`, `.claude/`, regras, hooks, skills e MCPs: o
 * CLI carregava a governança deste projeto para gerar o documento de **outro**. No app
 * empacotado, `process.cwd()` é o que o atalho do Windows decidir — que pode ser qualquer coisa.
 *
 * O custo medido foi 230.444 tokens de entrada numa geração de refinamento com prompt pequeno.
 *
 * ## O que este diretório é
 *
 * Vazio, novo a cada geração, e removido no fim. Sem `CLAUDE.md`, sem `.claude/`, sem
 * `AGENTS.md`, sem `.git`. Vive sob o `userData` do Electron e **não** dentro do workspace do
 * JarvisOS: qualquer lugar dentro do workspace herdaria a governança de um diretório acima,
 * porque os CLIs sobem a árvore procurando configuração — o isolamento seria desfeito por um
 * arquivo que ninguém colocou ali de propósito.
 *
 * ## Por que a remoção não lança
 *
 * O diretório é limpeza, não produto. Uma falha ao removê-lo (antivírus segurando o handle no
 * Windows, disco ocupado) não pode derrubar uma geração que já terminou — inverteria a mesma
 * ordem que a spec crava para o console: o documento é o produto. O que sobra é um diretório
 * vazio no `userData`, que a geração seguinte não usa e que o SO limpa.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** O nome do diretório que guarda um run por geração. */
export const PASTA_DOS_RUNS = 'cli-runs'

/** O que o adapter recebe: onde o run mora e como apagá-lo. */
export interface RunNeutro {
  readonly caminho: string
  readonly remover: () => void
}

/**
 * Cria o diretório do run e devolve o caminho, com a função que o remove.
 *
 * Devolve o par em vez de só o caminho para que o adapter não precise reconstruir a mesma
 * expressão de path no `finally` — reconstruir seria a chance de errar e apagar outra coisa.
 *
 * O nome é um UUID próprio e **não** o `traceId` do console: o trace nasce no ponto único e nem
 * toda chamada tem um (o painel de teste do Settings não abre console). Amarrar o diretório a
 * um identificador que às vezes não existe faria o isolamento depender do console — que é
 * evidência, não produto. O que o diretório precisa é ser único, e disso o UUID dá conta.
 *
 * `recursive: true` cobre a primeira geração (a pasta `cli-runs` ainda não existe) sem uma
 * checagem de existência que seria uma corrida entre duas gerações simultâneas.
 */
export function abrirRunNeutro(userDataDir: string): RunNeutro {
  const caminho = join(userDataDir, PASTA_DOS_RUNS, randomUUID())
  mkdirSync(caminho, { recursive: true })

  return {
    caminho,
    remover: () => {
      try {
        rmSync(caminho, { recursive: true, force: true })
      } catch {
        // Limpeza, não produto. Ver o cabeçalho.
      }
    }
  }
}
