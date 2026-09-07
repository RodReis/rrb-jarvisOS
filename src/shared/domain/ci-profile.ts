/**
 * O perfil de validação de CI de um projeto-alvo (SPEC-Pipeline-01 R2, seções 4 e 5).
 *
 * A razão de existir: `ci-workflow.ts` gera um workflow que **presume Node**, `ubuntu-latest`,
 * `npm ci` e quatro passos em sequência. Isso serve o jarvisOS e mais nada. Um projeto Python
 * receberia `npm ci` e falharia por um motivo que o pacote dele nunca declarou — fallback
 * silencioso de stack, que a spec proíbe em letra (§3).
 *
 * O perfil move a decisão para o pacote aprovado do projeto: runtime, sistema, shell, instalação,
 * validações, dependências entre elas e grupos de paralelismo. O gerador vira função do perfil, e
 * "genérico" passa a significar *declarado*, não *adivinhado*.
 *
 * **O que este módulo deliberadamente não faz:** não lê disco, não fala com o GitHub, não decide
 * quando escrever workflow. Ele é `src/shared` — compilado também para o renderer, onde `fs` não
 * existe. Efeito externo é do `EntregaService`, e essa fronteira é o que permite testar validação
 * e geração sem sandbox.
 */

/** A versão do schema. Perfil de outra versão é recusado, não convertido por adivinhação. */
export const VERSAO_DO_SCHEMA_DO_PERFIL = 1

/**
 * A versão do gerador.
 *
 * Entra no manifesto do workflow gerado porque o critério 4 exige bytes iguais para o mesmo
 * perfil **e a mesma versão de geração**. Sem registrar a versão, uma melhoria no gerador
 * reescreveria o arquivo de todo projeto no run seguinte, que é a migração automática que a
 * spec recusa (§6).
 */
export const VERSAO_DO_GERADOR = 1

/**
 * O nome do job agregado, fixo.
 *
 * O mesmo `validacao` de `ci-workflow.ts`, e pela mesma razão: é o *context* que a proteção da
 * branch-base exige. A spec (§4, "Context obrigatório") manda não renomeá-lo para `gate` só
 * porque o jarvisOS chama assim o dele.
 */
export const NOME_DO_JOB_AGREGADO = 'validacao'

/** Os runtimes que a R2 prova. Runtime fora desta lista é incompatibilidade, não fallback. */
export const RUNTIMES_SUPORTADOS = ['node', 'python'] as const
export type RuntimeDoPerfil = (typeof RUNTIMES_SUPORTADOS)[number]

/**
 * Os sistemas de runner.
 *
 * Windows é o ambiente primário do PI e prova obrigatória (§3, decisão 2 do PI). Linux continua
 * possível, mas **só quando o perfil o declara** — não há plataforma inferida.
 */
export const SISTEMAS_SUPORTADOS = ['windows', 'linux'] as const
export type SistemaDoPerfil = (typeof SISTEMAS_SUPORTADOS)[number]

/** Os shells. `pwsh` é o do Windows; `bash` o do Linux. A combinação é verificada. */
export const SHELLS_SUPORTADOS = ['pwsh', 'bash'] as const
export type ShellDoPerfil = (typeof SHELLS_SUPORTADOS)[number]

/** Uma unidade de validação declarada pelo pacote. */
export interface ValidacaoDoPerfil {
  /** Estável, único no perfil. É por ele que dependência e evidência se referem à validação. */
  readonly id: string
  /** O rótulo do passo no workflow. */
  readonly nome: string
  /** O comando em argv. Nunca uma string de shell — ver `comoArgumento`. */
  readonly argv: readonly string[]
  /** Relativo à raiz do checkout. Não pode escapar dele. */
  readonly cwd?: string
  /** IDs de validações que precisam terminar antes desta. */
  readonly dependeDe?: readonly string[]
  /**
   * O grupo de execução.
   *
   * Validações de grupos diferentes podem correr em paralelo; do mesmo grupo, ficam no mesmo job
   * e portanto em sequência. É assim que "banco do jarvisOS continua serial internamente" (§5.5)
   * se declara sem o gerador precisar saber o que é um banco.
   */
  readonly grupo: string
  /** Obrigatória por padrão. Opcional não impede o agregado de ter sucesso. */
  readonly obrigatoria?: boolean
}

/** Como o projeto instala dependências antes de validar. */
export interface InstalacaoDoPerfil {
  readonly argv: readonly string[]
  readonly cwd?: string
}

/** O perfil completo, como vive no `ci-profile.json` do pacote aprovado. */
export interface PerfilDeCi {
  readonly schemaVersion: number
  readonly profileId: string
  readonly runtime: RuntimeDoPerfil
  /** A versão do runtime, como o setup-* do provedor a entende. Ex.: `'24'`, `'3.12'`. */
  readonly versaoDoRuntime: string
  readonly sistema: SistemaDoPerfil
  readonly shell: ShellDoPerfil
  readonly instalacao: InstalacaoDoPerfil
  readonly validacoes: readonly ValidacaoDoPerfil[]
  /** Minutos por job. Positivo. */
  readonly timeoutEmMinutos: number
  /**
   * Perfil de compatibilidade.
   *
   * `true` marca a representação explícita de um pacote legado (§4, "Compatibilidade"). Registrar
   * `legacy` é o oposto de alegar descoberta automática da stack: diz que o ambiente veio do
   * pacote antigo, não que alguém o inspecionou.
   */
  readonly legacy?: boolean
}

/** O que impede um perfil de virar workflow. */
export type ProblemaDoPerfil =
  | 'schema-incompativel'
  | 'campo-ausente'
  | 'runtime-incompativel'
  | 'sistema-incompativel'
  | 'shell-incompativel'
  | 'id-repetido'
  | 'dependencia-ausente'
  | 'auto-dependencia'
  | 'ciclo'
  | 'argv-vazio'
  | 'cwd-fora-do-checkout'
  | 'limite-invalido'
  | 'sem-validacao-obrigatoria'

export interface ProblemaNoPerfil {
  readonly problema: ProblemaDoPerfil
  /** Os IDs envolvidos. No ciclo, na ordem em que ele se fecha. */
  readonly envolvidos: readonly string[]
  readonly mensagem: string
}

/**
 * As combinações de sistema e shell que existem.
 *
 * `pwsh` no Linux e `bash` no Windows são tecnicamente instaláveis, mas a R2 não os prova, e
 * "não provado" não vira suportado por omissão. Combinação fora daqui é incompatibilidade
 * explícita antes de escrever qualquer arquivo (critério 3).
 */
const SHELL_POR_SISTEMA: Readonly<Record<SistemaDoPerfil, ShellDoPerfil>> = {
  windows: 'pwsh',
  linux: 'bash'
}

/** `cwd` escapa do checkout? Absoluto, `..` que sobe, ou raiz do Windows. */
function escapaDoCheckout(cwd: string): boolean {
  if (cwd.startsWith('/') || cwd.startsWith('\\') || /^[A-Za-z]:/.test(cwd)) return true

  let profundidade = 0
  for (const parte of cwd.split(/[/\\]/)) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') {
      profundidade -= 1
      if (profundidade < 0) return true
      continue
    }
    profundidade += 1
  }
  return false
}

/**
 * Valida o perfil (critério 3).
 *
 * Devolve **todos** os problemas, não o primeiro — mesma razão de `validarDag`: um perfil com
 * dois erros corrigido um de cada vez faz o dono do projeto descobrir o segundo só na tentativa
 * seguinte. E a lista vazia é o que autoriza gerar; qualquer problema barra antes de escrita,
 * push ou alteração remota.
 */
export function validarPerfilDeCi(perfil: PerfilDeCi): readonly ProblemaNoPerfil[] {
  const problemas: ProblemaNoPerfil[] = []
  const relatar = (
    problema: ProblemaDoPerfil,
    envolvidos: readonly string[],
    mensagem: string
  ): void => {
    problemas.push({ problema, envolvidos, mensagem })
  }

  if (perfil.schemaVersion !== VERSAO_DO_SCHEMA_DO_PERFIL) {
    relatar(
      'schema-incompativel',
      [perfil.profileId],
      `O perfil declara schemaVersion ${perfil.schemaVersion}; esta pipeline lê ${VERSAO_DO_SCHEMA_DO_PERFIL}.`
    )
  }

  if (perfil.profileId.trim() === '') {
    relatar('campo-ausente', [], 'O perfil não tem profileId.')
  }

  if (!RUNTIMES_SUPORTADOS.includes(perfil.runtime)) {
    relatar(
      'runtime-incompativel',
      [perfil.profileId],
      `Runtime "${perfil.runtime}" não é suportado. Suportados: ${RUNTIMES_SUPORTADOS.join(', ')}.`
    )
  }

  if (perfil.versaoDoRuntime.trim() === '') {
    relatar('campo-ausente', [perfil.profileId], 'O perfil não declara a versão do runtime.')
  }

  if (!SISTEMAS_SUPORTADOS.includes(perfil.sistema)) {
    relatar(
      'sistema-incompativel',
      [perfil.profileId],
      `Sistema "${perfil.sistema}" não é suportado. Suportados: ${SISTEMAS_SUPORTADOS.join(', ')}.`
    )
  } else if (SHELL_POR_SISTEMA[perfil.sistema] !== perfil.shell) {
    relatar(
      'shell-incompativel',
      [perfil.profileId],
      `O shell "${perfil.shell}" não é o provado para ${perfil.sistema}; esperado "${SHELL_POR_SISTEMA[perfil.sistema]}".`
    )
  }

  if (perfil.instalacao.argv.length === 0) {
    relatar('argv-vazio', [perfil.profileId], 'A instalação não declara comando.')
  }
  if (perfil.instalacao.cwd !== undefined && escapaDoCheckout(perfil.instalacao.cwd)) {
    relatar(
      'cwd-fora-do-checkout',
      [perfil.profileId],
      `O cwd da instalação ("${perfil.instalacao.cwd}") sai do checkout.`
    )
  }

  if (!Number.isFinite(perfil.timeoutEmMinutos) || perfil.timeoutEmMinutos <= 0) {
    relatar(
      'limite-invalido',
      [perfil.profileId],
      `O timeout precisa ser um número positivo de minutos; veio ${perfil.timeoutEmMinutos}.`
    )
  }

  if (perfil.validacoes.length === 0) {
    relatar('campo-ausente', [perfil.profileId], 'O perfil não declara nenhuma validação.')
  }

  const vistos = new Set<string>()
  for (const v of perfil.validacoes) {
    if (vistos.has(v.id)) {
      relatar('id-repetido', [v.id], `Duas validações usam o id "${v.id}".`)
    }
    vistos.add(v.id)

    if (v.argv.length === 0) {
      relatar('argv-vazio', [v.id], `A validação "${v.id}" não declara comando.`)
    }
    if (v.cwd !== undefined && escapaDoCheckout(v.cwd)) {
      relatar('cwd-fora-do-checkout', [v.id], `O cwd de "${v.id}" ("${v.cwd}") sai do checkout.`)
    }
    if (v.grupo.trim() === '') {
      relatar('campo-ausente', [v.id], `A validação "${v.id}" não declara grupo.`)
    }
  }

  // Nenhuma obrigatória é perfil que não prova nada: o agregado teria sucesso sem validar. É a
  // "ausência que termina verde" que o critério 16 recusa, adiantada para o momento do perfil.
  if (perfil.validacoes.length > 0 && !perfil.validacoes.some((v) => v.obrigatoria !== false)) {
    relatar(
      'sem-validacao-obrigatoria',
      [perfil.profileId],
      'Todas as validações são opcionais: o agregado teria sucesso sem provar nada.'
    )
  }

  problemas.push(...problemasDoGrafo(perfil.validacoes))

  return problemas
}

/**
 * Dependência ausente, auto-dependência e ciclo.
 *
 * DFS com marcação tri-estado (branco/cinza/preto), como `validarDag`: encontrar um nó *cinza* é
 * voltar a um ancestral do caminho atual, que é a definição de ciclo. Um `visitado` booleano
 * confundiria "já visitei por outro caminho" com "está no caminho atual" e acusaria ciclo onde há
 * só um losango — duas validações que dependem da mesma terceira.
 */
function problemasDoGrafo(validacoes: readonly ValidacaoDoPerfil[]): readonly ProblemaNoPerfil[] {
  const problemas: ProblemaNoPerfil[] = []
  const porId = new Map(validacoes.map((v) => [v.id, v]))

  for (const v of validacoes) {
    for (const dep of v.dependeDe ?? []) {
      if (dep === v.id) {
        problemas.push({
          problema: 'auto-dependencia',
          envolvidos: [v.id],
          mensagem: `A validação "${v.id}" depende de si mesma.`
        })
        continue
      }
      if (!porId.has(dep)) {
        problemas.push({
          problema: 'dependencia-ausente',
          envolvidos: [v.id, dep],
          mensagem: `A validação "${v.id}" depende de "${dep}", que não existe no perfil.`
        })
      }
    }
  }

  const cor = new Map<string, 'cinza' | 'preto'>()
  const caminho: string[] = []
  const ciclosVistos = new Set<string>()

  const visitar = (id: string): void => {
    const atual = cor.get(id)
    if (atual === 'preto') return
    if (atual === 'cinza') {
      const inicio = caminho.indexOf(id)
      const ciclo = [...caminho.slice(inicio), id]
      // Normaliza para não reportar o mesmo ciclo uma vez por ponto de entrada.
      const chave = [...ciclo].slice(0, -1).sort().join('>')
      if (!ciclosVistos.has(chave)) {
        ciclosVistos.add(chave)
        problemas.push({
          problema: 'ciclo',
          envolvidos: ciclo,
          mensagem: `Ciclo de dependência entre validações: ${ciclo.join(' → ')}.`
        })
      }
      return
    }

    cor.set(id, 'cinza')
    caminho.push(id)
    for (const dep of porId.get(id)?.dependeDe ?? []) {
      // Auto-dependência já foi reportada acima, com categoria própria. Deixá-la seguir aqui a
      // acusaria de novo como `ciclo` — o mesmo fato com dois nomes.
      if (dep !== id && porId.has(dep)) visitar(dep)
    }
    caminho.pop()
    cor.set(id, 'preto')
  }

  for (const v of validacoes) visitar(v.id)

  return problemas
}
