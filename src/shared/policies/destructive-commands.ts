/**
 * Denylist de padrões destrutivos — **o seed** (SPEC-ExecucaoReal-02, 2ª barreira).
 *
 * Isto é **dado**, não lógica, pela mesma razão que `taxonomy.ts`: o que conta como
 * destrutivo é decisão de produto, e mudá-la deve ser editar uma linha aqui — nunca o
 * `matchDestructivePattern`. É a regra "sem hardcode" do `CLAUDE.md`.
 *
 * **O que esta lista faz não é bloquear.** Um comando que casa aqui é elevado a
 * `requires-approval` e pausa pelo fluxo da F01 — o usuário decide. Quem bloqueia é a
 * allowlist de binário (1ª barreira), e ela roda antes. Confundir as duas levaria a barrar
 * `rm` de vez, e aí a lista viraria uma segunda allowlist às avessas.
 *
 * **Postura ampla, por decisão do PI (2026-08-28).** Na dúvida, pede aprovação. A assimetria
 * de custo é o argumento inteiro: um falso positivo custa um clique; um falso negativo apaga
 * dados sem perguntar. Por isso casamos `rm` inteiro em vez de só `rm -rf`, e qualquer
 * `--force` em vez de enumerar quais são perigosos — o comando que só *parece* destrutivo
 * ainda executa, depois de o humano olhar.
 *
 * Como não há shell (`shell: false`, spec § command-runner), cada padrão é avaliado contra o
 * **binário canônico** e contra os **argumentos**, individualmente. Não há linha a re-parsear:
 * a UI já entregou os campos separados, e é justamente por isso que `;`/`&&`/`|` não precisam
 * de padrão aqui — sem shell eles não encadeiam nada.
 */

/** Uma entrada do seed: o padrão, o que ele pega e uma descrição curta em pt-BR (UI/audit). */
export interface DestructivePattern {
  readonly id: string
  /** Casa o binário canônico (já sem diretório/extensão). */
  readonly binary?: RegExp
  /** Casa **algum** dos argumentos. Combinado com `binary`, ambos precisam casar. */
  readonly arg?: RegExp
  readonly descricao: string
}

/**
 * Binários cuja mera execução já é destrutiva o bastante para pedir aprovação,
 * independentemente dos argumentos. Aqui a postura ampla é mais visível: `rm` sem `-rf` ainda
 * apaga arquivo, e apagar arquivo é exatamente o que o RF-019 quer que passe por um humano.
 */
const BINARIOS_DESTRUTIVOS: readonly DestructivePattern[] = [
  {
    id: 'remocao',
    binary: /^(rm|rmdir|del|erase|unlink|shred)$/,
    descricao: 'Remove arquivos ou diretórios'
  },
  {
    id: 'formatacao',
    binary: /^(mkfs(\..+)?|format|diskpart|fdisk|parted)$/,
    descricao: 'Formata ou reparticiona disco'
  },
  {
    id: 'escrita-em-bloco',
    binary: /^dd$/,
    descricao: 'Escreve diretamente em dispositivo de bloco'
  },
  {
    id: 'desligamento',
    binary: /^(shutdown|reboot|halt|poweroff|init)$/,
    descricao: 'Desliga ou reinicia a máquina'
  },
  {
    id: 'encerramento-de-processo',
    binary: /^(kill|killall|pkill|taskkill)$/,
    descricao: 'Encerra processos do sistema'
  },
  {
    id: 'permissao',
    binary: /^(chmod|chown|chgrp|icacls|takeown|attrib)$/,
    descricao: 'Altera permissões ou dono de arquivos'
  },
  {
    id: 'movimentacao',
    binary: /^(mv|move|ren|rename)$/,
    descricao: 'Move ou renomeia arquivos (sobrescreve destino)'
  },
  {
    id: 'registro-do-windows',
    binary: /^(reg|regedit)$/,
    descricao: 'Altera o registro do Windows'
  },
  {
    id: 'gerenciador-de-pacotes-do-so',
    binary: /^(apt|apt-get|yum|dnf|pacman|brew|choco|winget)$/,
    descricao: 'Instala ou remove pacotes do sistema'
  }
]

/**
 * Binários inofensivos em geral, destrutivos sob certos argumentos. O par (binário, argumento)
 * precisa casar — `git push` normal executa direto; `git push --force` pede aprovação.
 */
const ARGUMENTOS_DESTRUTIVOS: readonly DestructivePattern[] = [
  {
    id: 'git-force',
    binary: /^git$/,
    arg: /^(--force|-f|--force-with-lease|--hard|-D)$/,
    descricao: 'Operação de git que descarta histórico ou trabalho'
  },
  {
    id: 'git-limpeza',
    binary: /^git$/,
    arg: /^(clean|reset)$/,
    descricao: 'Descarta alterações locais não commitadas'
  },
  {
    id: 'publicacao-de-pacote',
    binary: /^(npm|pnpm|yarn|cargo|pip|twine)$/,
    arg: /^(publish|upload)$/,
    descricao: 'Publica pacote em registro público'
  },
  {
    id: 'remocao-de-pacote',
    binary: /^(npm|pnpm|yarn|pip|cargo)$/,
    arg: /^(uninstall|remove|rm|prune)$/,
    descricao: 'Remove dependências do projeto'
  },
  {
    id: 'docker-remocao',
    binary: /^(docker|podman|kubectl)$/,
    arg: /^(rm|rmi|prune|down|delete|destroy)$/,
    descricao: 'Remove containers, imagens ou recursos'
  },
  {
    id: 'terraform-aplicacao',
    binary: /^(terraform|pulumi)$/,
    arg: /^(apply|destroy)$/,
    descricao: 'Aplica ou destrói infraestrutura'
  }
]

/**
 * Argumentos destrutivos **em qualquer binário**. `--force` num comando allowlistado que não
 * previmos é exatamente o caso que a postura ampla existe para pegar: não sabemos o que aquele
 * binário força, e é por não saber que o humano decide.
 */
const ARGUMENTOS_UNIVERSAIS: readonly DestructivePattern[] = [
  {
    id: 'forcado',
    arg: /^(--force|--hard|--purge|--no-preserve-root)$/,
    descricao: 'Argumento que força uma operação irreversível'
  },
  {
    id: 'recursivo-destrutivo',
    arg: /^-[a-z]*[rf][a-z]*f[a-z]*$|^-[a-z]*f[a-z]*[rf][a-z]*$/,
    descricao: 'Combinação recursiva e forçada (-rf)'
  },
  {
    id: 'dispositivo-de-bloco',
    arg: /^(of=)?\/dev\/(sd|nvme|hd|disk)/,
    descricao: 'Aponta para um dispositivo de bloco'
  },
  {
    id: 'raiz-do-sistema',
    arg: /^(\/|[a-z]:[\\/]|\/\*)$/i,
    descricao: 'Alvo é a raiz do sistema de arquivos'
  }
]

/** O seed inteiro. Congelado: denylist é dado de leitura, não estado mutável. */
export const DESTRUCTIVE_PATTERNS: readonly DestructivePattern[] = [
  ...BINARIOS_DESTRUTIVOS,
  ...ARGUMENTOS_DESTRUTIVOS,
  ...ARGUMENTOS_UNIVERSAIS
]

/**
 * O comando casa algum padrão destrutivo? Devolve a **primeira** entrada que casou (para a
 * auditoria e a UI dizerem *por quê* a aprovação foi pedida), ou `undefined`.
 *
 * Devolver a entrada em vez de um booleano é deliberado: "pediu aprovação" sem motivo legível
 * é a caixa-preta que o RF-019 quer evitar — o usuário precisa saber o que o sistema achou
 * perigoso para poder discordar com fundamento.
 *
 * `binary` deve chegar **canônico** (`canonicalizeBinary`). Os argumentos são comparados como
 * vieram: sem shell, eles são exatamente o que o processo receberá.
 */
export function matchDestructivePattern(
  binary: string,
  args: readonly string[]
): DestructivePattern | undefined {
  return DESTRUCTIVE_PATTERNS.find((pattern) => {
    const binaryCasa = pattern.binary ? pattern.binary.test(binary) : true
    if (!binaryCasa) return false

    // Sem `arg`, basta o binário casar — são os destrutivos por natureza.
    if (!pattern.arg) return pattern.binary !== undefined

    return args.some((arg) => pattern.arg?.test(arg) === true)
  })
}
