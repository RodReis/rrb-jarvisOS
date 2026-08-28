import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

/**
 * Vocabulário semântico dos componentes (SPEC-DesignSystem-03b, critério 4).
 *
 * Um tom (`ok`/`info`/`warn`/`err`) carrega **três** coisas juntas: cor, ícone e — no
 * consumidor — texto. Elas moram aqui para não divergirem: se cada componente escolhesse o
 * próprio ícone de erro, o `Panel` e o `Toast` acabariam com glifos diferentes para o mesmo
 * estado, e o usuário aprenderia dois vocabulários.
 *
 * O ícone é o que sobrevive ao alto contraste e ao daltonismo. É por isso que ele não é
 * opcional em nenhum componente com tom: cor sozinha nunca comunica estado (PRD §14).
 */

export type TomSemantico = 'ok' | 'info' | 'warn' | 'err'

/**
 * Glifos do protótipo (README §5.1): `✓` sucesso, `i` info, `!` atenção, `×` erro.
 *
 * Aqui viram ícones do Lucide — a biblioteca já adotada na F01 — mantendo o mesmo significado.
 * Caractere solto não escala nem herda `stroke-width`.
 */
export const ICONE_SEMANTICO = {
  ok: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
  err: AlertCircle
} as const

/**
 * Classe de **texto** por tom.
 *
 * Lê a variante `-leitura`, não a cor de marca: as cinco semânticas foram desenhadas para
 * fundo escuro e, como texto no modo claro, falham a régua de 4.5:1 (medido na F03a —
 * `info` chega a 1.54:1). Borda, ícone e preenchimento seguem usando a cor de marca.
 */
export const CLASSE_TEXTO_SEMANTICO: Readonly<Record<TomSemantico, string>> = {
  ok: 'text-[var(--jos-cor-ok-leitura)]',
  info: 'text-[var(--jos-cor-info-leitura)]',
  warn: 'text-[var(--jos-cor-warn-leitura)]',
  err: 'text-[var(--jos-cor-err-leitura)]'
}

/**
 * Classe de **borda** por tom.
 *
 * Mapas literais, e não `border-[var(--jos-cor-${tom})]` interpolado: o Tailwind descobre
 * classes **varrendo o texto do código-fonte**, então uma classe montada em runtime nunca
 * chega ao CSS gerado. Verificado nesta fatia — a versão interpolada produzia **zero**
 * ocorrências no bundle, contra 53 das classes escritas por extenso, e o painel com tom
 * renderizava sem borda colorida.
 *
 * É a mesma classe de defeito que a prova visual pegou na F03a (o `@source` faltando): CSS
 * que não existe não quebra nada — só não pinta.
 */
export const CLASSE_BORDA_SEMANTICA: Readonly<Record<TomSemantico, string>> = {
  ok: 'border-[var(--jos-cor-ok)]',
  info: 'border-[var(--jos-cor-info)]',
  warn: 'border-[var(--jos-cor-warn)]',
  err: 'border-[var(--jos-cor-err)]'
}

/** Classe de **preenchimento** por tom — usada em dot de status, barra e indicador. */
export const CLASSE_FUNDO_SEMANTICO: Readonly<Record<TomSemantico, string>> = {
  ok: 'bg-[var(--jos-cor-ok)]',
  info: 'bg-[var(--jos-cor-info)]',
  warn: 'bg-[var(--jos-cor-warn)]',
  err: 'bg-[var(--jos-cor-err)]'
}

/**
 * Nome do tom em pt-BR, para leitores de tela.
 *
 * O ícone é `aria-hidden` — quem informa o estado por voz é este texto. Sem ele, um painel de
 * erro seria anunciado como um painel qualquer.
 */
export const NOME_DO_TOM: Readonly<Record<TomSemantico, string>> = {
  ok: 'sucesso',
  info: 'informação',
  warn: 'atenção',
  err: 'erro'
}
