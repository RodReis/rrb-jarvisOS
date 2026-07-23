import { createContext, useContext, useMemo } from 'react'
import { ACENTO_PADRAO, acentoParaLeitura, type CorAcento } from './acento'
import { CAMADA, CURVA, DURACAO, ESPACO, FONTE, RAIO, SOMBRA } from './base'
import {
  bordaRgb,
  modoEfetivo,
  papeis,
  STATUS,
  type ModoUi,
  type Modulo,
  type Superficie
} from './semantic'

/**
 * Provider de tema (SPEC-DesignSystem-02, § Contrato de aplicação).
 *
 * Recebe `{ uiTheme, accentJarvis, accentNoa }` **por props** e expõe os tokens como CSS
 * variables. O DS **não persiste** preferência: quem guarda é Settings (SPEC-Fundacao-05) e o
 * storage local (SPEC-Fundacao-04). Aqui só se lê e aplica — é o que mantém o design system
 * sem conhecimento de infraestrutura (PRD §8.1, regra de fronteira da Fatia 01).
 *
 * Trocar o tema troca **variável**, não classe: por isso `uiTheme` vira `style` no elemento
 * raiz em vez de um `className` condicional. Nenhum componente abaixo re-renderiza por causa
 * do tema — o navegador recalcula as variáveis.
 */

export interface TemaProps {
  /** A preferência do usuário. Só as telas internas a respeitam — ver `superficie`. */
  readonly uiTheme: ModoUi
  readonly accentJarvis: CorAcento
  readonly accentNoa: CorAcento
  /** Qual identidade está ativa — decide se valem os tokens `jt*` ou `nt*`. */
  readonly modulo: Modulo
  /**
   * Onde este tema está sendo aplicado (critério 2).
   *
   * Login, Choice, transição e Toast são **superfícies de marca**: ficam escuras mesmo com
   * `uiTheme='light'`. Declarar a superfície — em vez de simplesmente não montar o provider —
   * é o que torna a exceção verificável: a marca continua recebendo tokens, só que sempre os
   * escuros, e um teste pode afirmar isso.
   */
  readonly superficie: Superficie
}

const TemaContexto = createContext<TemaProps | null>(null)

/**
 * Lê o tema ativo.
 *
 * Lança fora do provider em vez de devolver um default: um componente que renderiza com tema
 * silenciosamente errado é pior de diagnosticar que um que não renderiza.
 */
export function useTema(): TemaProps {
  const tema = useContext(TemaContexto)
  if (tema === null) {
    throw new Error('useTema precisa de um <ProvedorDeTema> acima na árvore.')
  }
  return tema
}

/**
 * Monta as CSS variables do tema.
 *
 * Exportada e pura para que o teste de paridade possa afirmar sobre o **resultado** — as
 * variáveis que o escuro produz têm de ser as cores do protótipo, e isso se verifica sem
 * renderizar nada.
 */
export function variaveisDoTema({
  uiTheme,
  accentJarvis,
  accentNoa,
  modulo,
  superficie
}: TemaProps): Record<string, string> {
  // Superfície de marca ignora a preferência do usuário e lê sempre o escuro (critério 2).
  const modo = modoEfetivo(superficie, uiTheme)
  const p = papeis(modulo, modo)
  const acento = modulo === 'jarvis' ? accentJarvis : accentNoa

  return {
    // Papéis de superfície/texto/borda — variam com módulo e modo.
    '--jos-cor-superficie': p.surface,
    '--jos-cor-superficie-elevada': p.surfaceRaised,
    '--jos-cor-texto': p.textPrimary,
    '--jos-cor-texto-secundario': p.textSecondary,
    '--jos-cor-texto-suave': p.textMuted,
    '--jos-borda-rgb': bordaRgb(modulo, uiTheme),

    // Acento do usuário. Duas variáveis, de propósito: a de marca **preserva** o tom escolhido
    // (borda, glow, fill, dot) e a de leitura tem só a luminância ajustada quando o contraste
    // falha. Uma variável só forçaria escolher entre identidade e legibilidade — a decisão do
    // PI (2026-07-21) é ter as duas.
    '--jos-cor-acento': acento,
    '--jos-cor-acento-leitura': acentoParaLeitura(acento, p.surface),

    // Semânticas — não invertem, não são retematizáveis (PRD §15).
    '--jos-cor-ok': STATUS.ok,
    '--jos-cor-warn': STATUS.warn,
    '--jos-cor-err': STATUS.err,
    '--jos-cor-info': STATUS.info,
    '--jos-cor-violet': STATUS.violet,

    // Primitivos que não dependem do modo.
    '--jos-raio-rail': RAIO.rail,
    '--jos-raio-card': RAIO.card,
    '--jos-raio-modal': RAIO.modal,
    '--jos-raio-pill': RAIO.pill,
    '--jos-espaco-lista': ESPACO.lista,
    '--jos-espaco-form': ESPACO.form,
    '--jos-espaco-layout': ESPACO.layout,
    '--jos-sombra-card': SOMBRA.card,
    '--jos-duracao-rapida': DURACAO.rapida,
    '--jos-duracao-media': DURACAO.media,
    '--jos-duracao-lenta': DURACAO.lenta,
    '--jos-curva-padrao': CURVA.padrao,
    '--jos-fonte-display': FONTE.display,
    '--jos-fonte-corpo': FONTE.corpo,
    '--jos-fonte-mono': FONTE.mono,
    '--jos-camada-overlay': String(CAMADA.overlay),
    '--jos-camada-modal': String(CAMADA.modal),
    '--jos-camada-toast': String(CAMADA.toast)
  }
}

interface ProvedorDeTemaProps extends Partial<TemaProps> {
  readonly children: React.ReactNode
}

/**
 * Aplica o tema a uma subárvore.
 *
 * O default é `dark` (decisão do PI: fiel ao protótipo; o `system` do PRD §9.4 não entra no
 * MVP). O `data-modo` fica no DOM para que CSS possa reagir ao modo sem prop drilling — e para
 * que o teste consiga afirmar o modo ativo por atributo, não por cor calculada.
 */
export function ProvedorDeTema({
  uiTheme = 'dark',
  accentJarvis = ACENTO_PADRAO.jarvis,
  accentNoa = ACENTO_PADRAO.noa,
  modulo = 'jarvis',
  superficie = 'jarvis',
  children
}: ProvedorDeTemaProps): React.JSX.Element {
  const tema = useMemo<TemaProps>(
    () => ({ uiTheme, accentJarvis, accentNoa, modulo, superficie }),
    [uiTheme, accentJarvis, accentNoa, modulo, superficie]
  )

  const variaveis = useMemo(() => variaveisDoTema(tema), [tema])

  // `data-modo` carrega o modo **efetivo**, não a preferência: numa superfície de marca com
  // `uiTheme='light'` ele lê `dark`, que é o que de fato está pintado. Expor a preferência aqui
  // faria o CSS e o teste discordarem da tela.
  const modo = modoEfetivo(superficie, uiTheme)

  return (
    <TemaContexto.Provider value={tema}>
      <div
        data-modo={modo}
        data-modulo={modulo}
        data-superficie={superficie}
        style={variaveis as React.CSSProperties}
      >
        {children}
      </div>
    </TemaContexto.Provider>
  )
}
