/**
 * Identidades NOA e JARVIS OS (SPEC-DesignSystem-05).
 *
 * **Base única, duas identidades.** Nenhum componente é reescrito "versão NOA" / "versão
 * JARVIS": a diferença inteira vive aqui, como dado, e chega aos componentes por CSS variable.
 * O guardrail da spec é o que este arquivo existe para tornar verificável — se um componente
 * precisasse saber qual módulo está ativo para se desenhar, a tese teria falhado.
 *
 * O que já existia na Fatia 02 **não se repete aqui**: `papeis()` (fundo/texto por módulo e
 * modo), `bordaRgb()` (hairlines) e `ACENTO_PADRAO` já carregam parte da identidade. Este
 * módulo acrescenta o que faltava — atmosfera (o glow do JARVIS), mascote e tom — e os reúne
 * num registro único, para que "o que difere entre os módulos" tenha **uma** resposta legível
 * em vez de estar espalhado por três arquivos.
 */

import { ACENTO_PADRAO, contraste, type CorAcento } from './acento'
import { papeis, type ModoUi, type Modulo } from './semantic'

/**
 * Tom de voz da identidade — `NOA.md §1` / `JARVISOS.md §1`.
 *
 * Não é decorativo: decide a redação de rótulo e mensagem nas telas de produto (Corte 3+). Fica
 * no contrato para que a escolha seja consultável em vez de recontada em cada tela.
 */
export type TomDeIdentidade = 'calmo' | 'tatico'

/**
 * Atmosfera de fundo do conteúdo.
 *
 * Só o JARVIS tem — o glow radial do acento no topo (`JARVISOS.md §1`, mantido por decisão do
 * PI em 2026-07-21). O NOA é fundo chapado por identidade, não por omissão: o tom calmo do
 * `NOA.md §1` é o oposto da atmosfera tática. `null` diz "esta identidade não tem atmosfera",
 * que é diferente de "ainda não implementamos".
 */
export type Atmosfera = string | null

export interface Identidade {
  readonly modulo: Modulo
  readonly tom: TomDeIdentidade
  readonly acentoPadrao: CorAcento
  /** Imagem do mascote — servida do bundle, nunca de rede (CSP do renderer, ADR-001). */
  readonly mascote: string
  /** Rótulo humano da identidade, para `aria-label` e títulos. */
  readonly nome: string
  /**
   * Voz habilitada por padrão.
   *
   * `false` no NOA por decisão do PI (spec § Perguntas resolvidas, item 2): o espaço pessoal
   * não fala sem ser chamado. Aqui é só o **default** do componente — o motor de voz é Corte 4;
   * nesta fatia o mascote é visual e os estados chegam por prop.
   */
  readonly vozPadrao: boolean
}

/**
 * Glow radial do JARVIS — `JARVISOS.md §1`, transcrito do protótipo.
 *
 * `color-mix` em vez de concatenar alfa hex ao acento: o acento chega como CSS variable
 * (`--jos-cor-acento`), e string hex não pode ser concatenada dentro do CSS. Os 6% e o
 * `transparent 65%` são os valores do protótipo — a atmosfera é fraca de propósito, senão
 * competiria com o conteúdo.
 */
const GLOW_JARVIS =
  'radial-gradient(1200px 500px at 70% 0%, color-mix(in srgb, var(--jos-cor-acento) 6%, transparent), transparent 65%)'

/**
 * As duas identidades, como dado.
 *
 * Registro fechado (`Record<Modulo, …>`): acrescentar um terceiro espaço quebraria o tipo, o
 * que é o comportamento desejado — `Desenvolvimento` não é workspace de usuário e `Agentic OS`
 * é área interna do JARVIS (CLAUDE.md § Regras técnicas invioláveis).
 */
export const IDENTIDADES: Readonly<Record<Modulo, Identidade>> = {
  jarvis: {
    modulo: 'jarvis',
    tom: 'tatico',
    acentoPadrao: ACENTO_PADRAO.jarvis,
    mascote: 'jarvis-cabeca.jpg',
    nome: 'JARVIS OS',
    vozPadrao: true
  },
  noa: {
    modulo: 'noa',
    tom: 'calmo',
    acentoPadrao: ACENTO_PADRAO.noa,
    mascote: 'noa-cabeca.png',
    nome: 'NOA',
    vozPadrao: false
  }
}

/** A identidade de um módulo. */
export function identidade(modulo: Modulo): Identidade {
  return IDENTIDADES[modulo]
}

/**
 * A atmosfera de fundo de um módulo.
 *
 * Devolve `null` para o NOA — quem consome pinta `background-image: none`. Devolver string
 * vazia pareceria equivalente e não é: o CSS aceita vazio em silêncio, e um teste que afirmasse
 * sobre a string não distinguiria "sem atmosfera" de "atmosfera que falhou ao montar".
 */
export function atmosfera(modulo: Modulo): Atmosfera {
  return modulo === 'jarvis' ? GLOW_JARVIS : null
}

/**
 * Superfície escura fixa dos tiles do mascote — README §2.6 e `JARVISOS.md §1`.
 *
 * `jt32`/`jt33` (JARVIS) e `nt9` (NOA) valem `#040507`/`#05070a` e **não invertem** no modo
 * claro: o mascote é desenhado com `mix-blend-mode: screen`, que sobre fundo claro apagaria a
 * imagem. É a mesma família de exceção das superfícies de marca (Login/Choice/Toast) — a
 * diferença é que ali a razão é identidade e aqui é o modo de composição.
 */
export const TILE_MASCOTE: Readonly<Record<Modulo, string>> = {
  jarvis: '#040507',
  noa: '#05070a'
}

/**
 * Máscara radial que dissolve a borda do mascote — README §7.
 *
 * O `#000` **não é cor**: numa `mask-image`, só o canal alfa é lido, e preto opaco significa
 * "mantém o pixel". Trocá-lo por outra cor não mudaria um pixel do resultado. Mora aqui, e não
 * inline no componente, porque a regra do critério 5 barra cor literal em `ui/` — e a exceção
 * certa para "isto não é cor" é o valor viver na camada de tokens, não a regra ganhar um furo.
 */
export const MASCARA_MASCOTE = 'radial-gradient(circle, #000 62%, transparent 78%)'

/**
 * Fundo de referência para a **variante de leitura das semânticas** (critério 5).
 *
 * As semânticas são compartilhadas por contrato: "erro" tem de ser a mesma cor nos dois espaços.
 * Mas a variante de leitura é calculada **contra o fundo**, e os fundos por identidade diferem —
 * no claro, `#f5f6f8` (JARVIS) contra `#f2f4f2` (NOA). Ajustar cada uma contra o seu próprio
 * fundo produzia **cores diferentes para a mesma semântica**.
 *
 * Só o `violet` divergia, porque as outras quatro têm folga: o ajuste para no primeiro passo que
 * cruza 4.5:1, e onde a margem é apertada os dois fundos param em passos diferentes. E não era
 * inconsistência estética — o `#7a4ff5` que o JARVIS produzia media **4.45:1 sobre o fundo do
 * NOA**, abaixo da régua. Uma semântica compartilhada legível em só um dos espaços não está
 * compartilhada.
 *
 * A referência é o **mais exigente** dos dois fundos, por modo: o valor que serve ao pior caso
 * serve aos dois. Não é média nem escolha de módulo — é o limite inferior, e por isso o
 * resultado sobra nos dois lados (violet: 5.10 no JARVIS, 4.98 no NOA).
 *
 * Mora aqui, e não em `semantic.ts`, por dependência: precisa de `contraste` (de `acento.ts`),
 * que por sua vez importa tipos de `semantic.ts` — pôr a função lá fecharia um ciclo em runtime.
 * Este módulo já é o lugar onde "o que difere entre os módulos" é resolvido.
 */
export function fundoDeReferencia(cor: string, modo: ModoUi): string {
  const superficieJarvis = papeis('jarvis', modo).surface
  const superficieNoa = papeis('noa', modo).surface
  return contraste(cor, superficieJarvis) < contraste(cor, superficieNoa)
    ? superficieJarvis
    : superficieNoa
}
