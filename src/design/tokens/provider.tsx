import { createContext, useContext, useMemo } from 'react'
import {
  ACENTO_PADRAO,
  acentoParaLeitura,
  contrasteSobre,
  semanticaParaLeitura,
  type CorAcento
} from './acento'
import {
  CAMADA,
  CURVA,
  DURACAO,
  ESPACAMENTO_LETRA,
  ESPACO,
  FONTE,
  PESO,
  RAIO,
  SOMBRA,
  TAMANHO,
  TOAST,
  TEXTO
} from './base'
import { atmosfera, fundoDeReferencia } from './identidade'
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
    // `modo`, não `uiTheme`: numa superfície de marca com `uiTheme='light'` a borda tem de vir
    // do escuro, como todo o resto. Passar a preferência crua aqui daria a uma tela de marca a
    // borda clara sobre fundo escuro — invisível.
    '--jos-borda-rgb': bordaRgb(modulo, modo),

    // Acento do usuário. Duas variáveis, de propósito: a de marca **preserva** o tom escolhido
    // (borda, glow, fill, dot) e a de leitura tem só a luminância ajustada quando o contraste
    // falha. Uma variável só forçaria escolher entre identidade e legibilidade — a decisão do
    // PI (2026-07-21) é ter as duas.
    '--jos-cor-acento': acento,
    '--jos-cor-acento-leitura': acentoParaLeitura(acento, p.surface),
    // Rótulo sobre preenchimento sólido no acento (botão primário): calculado contra o próprio
    // acento, não contra o fundo da tela. Sem isto, o botão primário sólido herdaria a cor de
    // texto da tela e ficaria ilegível com acento claro.
    '--jos-cor-acento-contraste': contrasteSobre(acento),
    // Atmosfera de fundo da identidade (SPEC-DesignSystem-05, critério 4). Só o JARVIS tem — o
    // glow radial do acento no topo do conteúdo, mantido do protótipo por decisão do PI. No NOA
    // vale `none`, que é a forma de o CSS dizer "sem imagem de fundo": o tom calmo do NOA é
    // fundo chapado por identidade, não por funcionalidade faltando.
    '--jos-atmosfera': atmosfera(modulo) ?? 'none',
    // Véu por trás de modal/gaveta. Preto translúcido, igual nos dois modos: o overlay escurece
    // o conteúdo para focar no modal, e um véu que clareasse no modo claro não separaria nada.
    '--jos-cor-backdrop': 'color-mix(in srgb, #000 60%, transparent)',
    // Cores do Toast — **sempre escuras**, não invertem no modo claro (README §2.6, o toast é
    // superfície de marca como Login/Choice). Ficam aqui como tokens em vez de soltas no
    // componente para a régua do critério 5 valer também para a marca. O gradiente é o card
    // glass do README §5.2.
    '--jos-toast-fundo': 'linear-gradient(135deg,rgba(14,16,20,.92),rgba(8,9,12,.94))',
    '--jos-toast-texto': '#eef1f5',
    '--jos-toast-texto-suave': '#9aa3b2',
    '--jos-toast-sombra': '0 20px 46px -18px rgba(0,0,0,1), inset 0 1px 0 rgba(255,255,255,.05)',
    '--jos-toast-topo': TOAST.topo,
    '--jos-toast-direita': TOAST.direita,
    '--jos-toast-largura': TOAST.largura,
    '--jos-toast-icone': TOAST.icone,
    '--jos-toast-barra-lateral': TOAST.barraLateral,
    '--jos-toast-barra-progresso': TOAST.barraProgresso,

    // Semânticas — a **cor de marca** não inverte nem é retematizável (PRD §15).
    '--jos-cor-ok': STATUS.ok,
    '--jos-cor-warn': STATUS.warn,
    '--jos-cor-err': STATUS.err,
    '--jos-cor-info': STATUS.info,
    '--jos-cor-violet': STATUS.violet,

    // …mas como **texto** elas foram desenhadas para fundo escuro: no claro, as cinco falham
    // 4.5:1 (`info` chega a 1.54:1). Estas variantes ajustam só a luminância, preservando o
    // matiz — a mesma solução que o acento já usava. Borda, glow e preenchimento continuam
    // usando a cor de marca acima; só o texto lê daqui.
    //
    // O ajuste é contra `fundoDeReferencia(cor, modo)` — o **mais exigente** dos dois fundos de
    // identidade — e não contra `p.surface`. Usar a superfície do módulo ativo fazia a mesma
    // semântica render cores diferentes no NOA e no JARVIS, e o `violet` do JARVIS caía a
    // 4.45:1 quando lido sobre o fundo do NOA. Ver `fundoDeReferencia` (SPEC-05, critério 5).
    '--jos-cor-ok-leitura': semanticaParaLeitura(STATUS.ok, fundoDeReferencia(STATUS.ok, modo)),
    '--jos-cor-warn-leitura': semanticaParaLeitura(
      STATUS.warn,
      fundoDeReferencia(STATUS.warn, modo)
    ),
    '--jos-cor-err-leitura': semanticaParaLeitura(STATUS.err, fundoDeReferencia(STATUS.err, modo)),
    '--jos-cor-info-leitura': semanticaParaLeitura(
      STATUS.info,
      fundoDeReferencia(STATUS.info, modo)
    ),
    '--jos-cor-violet-leitura': semanticaParaLeitura(
      STATUS.violet,
      fundoDeReferencia(STATUS.violet, modo)
    ),

    // Primitivos que não dependem do modo.
    '--jos-raio-rail': RAIO.rail,
    '--jos-raio-card': RAIO.card,
    '--jos-raio-modal': RAIO.modal,
    '--jos-raio-toast': RAIO.toast,
    '--jos-raio-chip-largo': RAIO.chipLargo,
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

    // Escala tipográfica e de caixa (Fatia 03a). Como variáveis, e não só como constantes TS,
    // porque componente e CSS precisam do mesmo valor — e um `text-[14px]` digitado à mão em
    // sete arquivos é onde a escala se desfaz sem ninguém perceber.
    '--jos-texto-micro': TEXTO.micro,
    '--jos-texto-mini': TEXTO.mini,
    '--jos-texto-acao': TEXTO.acao,
    '--jos-texto-corpo': TEXTO.corpo,
    '--jos-texto-realce': TEXTO.realce,
    '--jos-texto-secao': TEXTO.secao,
    '--jos-texto-tela': TEXTO.tela,
    '--jos-tamanho-controle': TAMANHO.controle,
    '--jos-tamanho-alvo-minimo': TAMANHO.alvoMinimo,
    '--jos-tamanho-marcador': TAMANHO.marcador,
    '--jos-tamanho-icone': TAMANHO.icone,
    '--jos-tamanho-icone-mini': TAMANHO.iconeMini,
    '--jos-tracking-label': ESPACAMENTO_LETRA.label,
    '--jos-tracking-acao': ESPACAMENTO_LETRA.titulo,
    // O peso participa da hierarquia de ação (F03a): primária e perigo são mais pesadas que
    // secundária, e peso sobrevive a qualquer acento — cor sozinha não sobrevive.
    '--jos-peso-medio': PESO.medio,
    '--jos-peso-forte': PESO.forte,
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

/**
 * Fundo do conteúdo com a atmosfera da identidade (SPEC-DesignSystem-05, critério 4).
 *
 * Existe separado do `ProvedorDeTema` porque o provider só **declara** as variáveis — ele não
 * sabe (nem deve saber) se está envolvendo a tela inteira ou um pedaço dela. Um provider que
 * pintasse fundo faria toda subárvore montada com tema ganhar um glow, inclusive dentro de um
 * modal ou de um card.
 *
 * Quem monta o shell (Fatia 04a) usa isto na região de conteúdo. No NOA a variável vale `none`
 * e o elemento fica visualmente idêntico a um `div` comum — o componente não precisa saber qual
 * identidade está ativa, que é justamente o ponto do guardrail anti-duplicação.
 */
export function FundoDaIdentidade({
  children,
  className,
  'data-prova-identidade': provaIdentidade,
  'data-jos-appshell': appShell
}: {
  readonly children?: React.ReactNode
  readonly className?: string
  /**
   * Marcadores de recorte, para prova visual e teste.
   *
   * Declarados **um a um** em vez de um `...rest` aberto — mesma decisão da F03a sobre
   * `PropsDeComposicao`: o DS não repassa atributo arbitrário, senão o consumidor injeta
   * `onClick`, `style` ou `role` por aqui e a superfície fechada deixa de ser fechada.
   *
   * `data-prova-identidade` nasceu na F05: as nove asserções de navegador falharam achando zero
   * elementos porque o atributo era descartado em silêncio. `data-jos-appshell` é o mesmo na
   * F04a — sem ele o teste não tem como perguntar "qual identidade este shell está pintando".
   */
  readonly 'data-prova-identidade'?: string
  readonly 'data-jos-appshell'?: string
}): React.JSX.Element {
  return (
    <div
      data-atmosfera
      data-prova-identidade={provaIdentidade}
      data-jos-appshell={appShell}
      className={className}
      style={{
        backgroundColor: 'var(--jos-cor-superficie)',
        backgroundImage: 'var(--jos-atmosfera)'
      }}
    >
      {children}
    </div>
  )
}
