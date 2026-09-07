/**
 * O registro de módulos — a fonte do menu (SPEC-Shell-01, regra 1).
 *
 * A sidebar **não tem lista de itens**. Cada módulo entregue se declara aqui, e a tela renderiza
 * o que o registro devolve. É o que faz "o item aparece na fatia que entrega o módulo" não virar
 * uma edição do AppShell a cada fatia: a M9-F06 acende o Mission Control registrando um módulo,
 * sem tocar em nenhum arquivo desta fatia.
 *
 * ## Por que a disponibilidade é função, e não booleano
 *
 * `disponivel()` é chamada a cada projeção. Um booleano fixado no import responderia sobre o
 * momento em que o módulo foi carregado, e há itens cuja existência depende de estado que muda
 * em execução — o grupo HARNESSES (regra 3) é o caso concreto: ele existe se há executor
 * registrado, o que não se sabe na hora do import.
 *
 * ## Por que o item oculto não vira rota
 *
 * `rotasDoSubModulo` filtra por `disponivel` antes de listar. Rota de módulo oculto seria rota
 * navegável que cai no cabeçalho de placeholder — exatamente o que o critério 2 proíbe.
 */

import type { SubModuloJarvis } from './navegacao'

/** Os grupos do protótipo (JARVISOS §2). Identificadores em inglês/ASCII; rótulo vem do i18n. */
export type GrupoDoMenu =
  | 'COMANDO'
  | 'AGENTS_OS'
  | 'OPERACOES'
  | 'INTEL'
  | 'NEGOCIOS'
  | 'SISTEMA'
  | 'CORE'
  | 'HARNESSES'
  | 'TEAMS'
  | 'GOVERNANCE'
  | 'KNOWLEDGE'

/**
 * A ordem dos grupos em cada sub-módulo, do protótipo.
 *
 * Mora aqui e não no módulo registrado porque é fato sobre o **menu**, não sobre o módulo: dois
 * módulos do mesmo grupo não podem discordar sobre onde o grupo aparece, e um campo `ordemDoGrupo`
 * em cada registro permitiria exatamente essa divergência.
 */
export const GRUPOS_POR_SUB_MODULO: Readonly<Record<SubModuloJarvis, readonly GrupoDoMenu[]>> = {
  command: ['COMANDO', 'AGENTS_OS', 'OPERACOES', 'INTEL', 'NEGOCIOS', 'SISTEMA'],
  agents: ['CORE', 'HARNESSES', 'TEAMS', 'GOVERNANCE', 'KNOWLEDGE']
}

/** Um módulo que se declara ao menu. */
export interface ModuloRegistrado {
  /** Identificador do módulo; também a chave i18n do rótulo (`navegacao.<id>`). */
  readonly id: string
  readonly subModulo: SubModuloJarvis
  readonly grupo: GrupoDoMenu
  /** Posição dentro do grupo. Só ordena entre irmãos — a ordem dos grupos é do menu. */
  readonly ordem: number
  readonly rota: string
  /** Se o módulo existe **agora**. Item indisponível não vira menu nem rota. */
  readonly disponivel: () => boolean
}

/** Um grupo com os itens que ele mostra. */
export interface GrupoVisivel {
  readonly grupo: GrupoDoMenu
  readonly itens: readonly ModuloRegistrado[]
}

/** Os módulos visíveis de um sub-módulo, ordenados dentro do grupo. */
export function itensVisiveis(
  registro: readonly ModuloRegistrado[],
  sub: SubModuloJarvis
): readonly ModuloRegistrado[] {
  return registro
    .filter((m) => m.subModulo === sub && m.disponivel())
    .sort((a, b) => a.ordem - b.ordem)
}

/**
 * Os grupos que têm ao menos um item visível, na ordem do protótipo (critério 3).
 *
 * Grupo vazio não é renderizado: um cabeçalho sozinho anunciaria uma seção que não leva a lugar
 * nenhum, que é a mesma promessa vazia que o placeholder fazia.
 */
export function gruposVisiveis(
  registro: readonly ModuloRegistrado[],
  sub: SubModuloJarvis
): readonly GrupoVisivel[] {
  const visiveis = itensVisiveis(registro, sub)

  return GRUPOS_POR_SUB_MODULO[sub]
    .map((grupo) => ({ grupo, itens: visiveis.filter((m) => m.grupo === grupo) }))
    .filter((g) => g.itens.length > 0)
}

/**
 * As rotas de um sub-módulo, na ordem em que o menu as mostra.
 *
 * A primeira é a rota inicial do sub-módulo (regra 6) — e por isso a ordem aqui é a **do menu**
 * (grupo e depois posição), não a do registro. Uma rota inicial que dependesse da ordem dos
 * imports mudaria sozinha quando alguém reordenasse um `import`.
 */
export function rotasDoSubModulo(
  registro: readonly ModuloRegistrado[],
  sub: SubModuloJarvis
): readonly string[] {
  return gruposVisiveis(registro, sub).flatMap((g) => g.itens.map((m) => m.rota))
}
