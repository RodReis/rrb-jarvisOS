/**
 * A validação dos protótipos anexados (SPEC-Planejamento-05 § Validação).
 *
 * A pergunta que este arquivo responde: **o que este protótipo tem de errado, e o que o PI faz a
 * respeito?**
 *
 * A spec pede verificar links e assets, telas versus PRD, navegação, estados
 * (vazio/loading/erro/bloqueio), consistência e contradições — e que *"problemas viram perguntas
 * com recomendação"*. Essa última frase é a forma inteira do módulo: o resultado não é uma lista
 * de erros para o app corrigir, é um `Achado` que **pergunta** e **recomenda**, porque quem
 * decide o que fazer com o protótipo é o PI. Um validador que consertasse sozinho substituiria o
 * ato de anexar, que é o que o gate mede.
 *
 * **Nenhum achado bloqueia o gate de anexos.** O gate mede presença (o PI anexou?), e a validação
 * mede coerência (o que anexou está consistente?). Fundir os dois faria um link quebrado impedir
 * o anexo de contar — e o critério 2 pede o oposto: que o problema seja **mostrado ao PI**. O que
 * a validação alimenta é a arquitetura (critério 4: ela não promete fluxo ausente dos
 * protótipos), não a contagem do gate.
 *
 * **O que este arquivo não faz:** não lê arquivo, não parseia HTML e não abre navegador. Recebe o
 * que o main extraiu (referências e jornadas encontradas) e decide o que isso significa. É o que
 * o torna testável sem disco e sem Chromium.
 */

/**
 * Uma referência que o protótipo faz a outro arquivo — `<img src>`, `<link href>`, `<script
 * src>`, `<a href>` local.
 *
 * `resolvido` é a resposta do main: o arquivo existe sob o projeto? Referência remota (`http`)
 * não é resolvida e não vira achado de asset — protótipo que aponta para CDN é escolha do PI,
 * não arquivo faltando.
 */
export interface ReferenciaDoPrototipo {
  /** O valor literal do atributo, como está no HTML. */
  readonly alvo: string
  readonly tipo: 'asset' | 'navegacao'
  /** `false` quando o arquivo referenciado não existe sob o projeto. */
  readonly resolvido: boolean
  /** Remota (http/https/data). Não conta como asset faltando. */
  readonly remota: boolean
}

/**
 * O que o protótipo mostrou quando foi carregado no navegador.
 *
 * Vem do `BrowserWindow` oculto do main: só render de verdade responde se a página tem conteúdo
 * ou se um script quebrou. Um parser estático diria que o HTML está lá e não perceberia a tela
 * em branco.
 */
export interface RenderDoPrototipo {
  /** O protótipo carregou sem erro fatal de navegação. */
  readonly carregou: boolean
  /** Erros de console e de recurso capturados durante o carregamento. */
  readonly errosDeConsole: readonly string[]
  /** Quantos elementos com texto visível a página produziu. Zero = tela em branco. */
  readonly elementosVisiveis: number
  /** Os textos das seções/telas que o protótipo declarou (headings, `[data-jornada]`). */
  readonly jornadas: readonly string[]
}

/**
 * Os estados que a spec exige que o protótipo cubra.
 *
 * Fechado e nomeado porque a spec os nomeia: *"estados vazio/loading/erro/bloqueio"*. Deixá-los
 * como texto livre faria a checagem depender de quem escreveu o protótipo ter usado a mesma
 * palavra que quem escreveu o validador.
 */
export const ESTADOS_EXIGIDOS = ['vazio', 'loading', 'erro', 'bloqueio'] as const

export type EstadoExigido = (typeof ESTADOS_EXIGIDOS)[number]

/**
 * Como cada estado é reconhecido no texto do protótipo. **Dado, não lógica** — mesma postura do
 * `MENSAGEM_DO_MARCO`: acrescentar sinônimo é editar uma linha, nunca o validador.
 *
 * Os termos são pt-BR e en, porque protótipo de design costuma vir com rótulo em inglês, e um
 * achado falso ("faltou o estado de loading") num protótipo que tem "Loading…" ensinaria o PI a
 * ignorar a lista.
 */
export const SINAIS_DO_ESTADO: Readonly<Record<EstadoExigido, readonly string[]>> = {
  // `vazi` e não `vazio`: pt-BR flexiona ("lista vazia", "estado vazio"), e o sinal exato
  // acusaria falta num protótipo que mostra o estado — o achado falso que faz o PI ignorar a
  // lista inteira. Mesma razão para `carregand` e `bloquead`.
  vazio: ['vazi', 'sem resultado', 'nenhum', 'empty', 'no results'],
  loading: ['carregand', 'loading', 'aguarde', 'skeleton'],
  erro: ['erro', 'falhou', 'error', 'failed'],
  bloqueio: ['bloquei', 'bloquead', 'sem permiss', 'blocked', 'denied']
}

/**
 * A severidade de um achado.
 *
 * `impede-arquitetura` é o único que tem consequência estrutural: ele marca o que a arquitetura
 * **não pode prometer** (critério 4). `pergunta` é tudo o mais — a spec pede que problema vire
 * pergunta, não veredito.
 */
export type SeveridadeDoAchado = 'pergunta' | 'impede-arquitetura'

/**
 * Um problema encontrado, na forma que a spec pede: pergunta + recomendação.
 *
 * As duas são obrigatórias e não têm default, pela mesma razão que `origem` é obrigatória na
 * `AfirmacaoDoPacote`: um achado sem recomendação devolve ao PI o trabalho de descobrir o que
 * fazer, e a spec diz literalmente *"viram perguntas com recomendação"*.
 */
export interface AchadoDoPrototipo {
  readonly id: string
  /** O arquivo do protótipo onde o achado apareceu. */
  readonly prototipo: string
  readonly severidade: SeveridadeDoAchado
  /** A pergunta ao PI. Nunca uma ordem: ele decide. */
  readonly pergunta: string
  /** O que recomendamos. Concreto e executável. */
  readonly recomendacao: string
  /** O que sustenta o achado — o alvo quebrado, o estado ausente, a tela sem par no PRD. */
  readonly evidencia: string
}

/** O resultado de validar um protótipo. */
export interface ValidacaoDoPrototipo {
  readonly prototipo: string
  readonly achados: readonly AchadoDoPrototipo[]
  /** As jornadas que este protótipo cobre — o que a arquitetura pode prometer (critério 4). */
  readonly jornadasCobertas: readonly string[]
}

/** Normaliza para comparação: minúsculas, sem acento. */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Analisa um protótipo carregado.
 *
 * A ordem dos achados não é acidental: primeiro o que impede a arquitetura (tela em branco, asset
 * quebrado), depois o que é pergunta. A tela mostra na ordem em que chegam, e o PI lê o que
 * bloqueia antes do que sugere.
 */
export function analisarPrototipo(
  prototipo: string,
  referencias: readonly ReferenciaDoPrototipo[],
  render: RenderDoPrototipo,
  telasDoPrd: readonly string[]
): ValidacaoDoPrototipo {
  const achados: AchadoDoPrototipo[] = []

  // (1) Não carregou. Nada mais faz sentido checar — um protótipo que não abre não tem jornada
  // a comparar, e listar "faltou o estado de erro" logo abaixo seria ruído.
  if (!render.carregou) {
    return {
      prototipo,
      jornadasCobertas: [],
      achados: [
        {
          id: `${prototipo}:nao-carrega`,
          prototipo,
          severidade: 'impede-arquitetura',
          pergunta: 'Este protótipo não abriu. Ele está completo?',
          recomendacao:
            'Abra o arquivo num navegador para confirmar, corrija e anexe a versão que carrega.',
          evidencia:
            render.errosDeConsole.length > 0
              ? render.errosDeConsole.join(' · ')
              : 'A navegação falhou sem erro reportado.'
        }
      ]
    }
  }

  // (2) Carregou em branco. Distinto de "não carregou": o HTML é válido e a tela não mostra
  // nada — normalmente script quebrado ou CSS ausente, e é exatamente o caso que só o render
  // pega.
  if (render.elementosVisiveis === 0) {
    achados.push({
      id: `${prototipo}:tela-em-branco`,
      prototipo,
      severidade: 'impede-arquitetura',
      pergunta: 'Este protótipo abriu sem mostrar conteúdo. Falta algum arquivo?',
      recomendacao: 'Anexe os assets (CSS/JS) que o protótipo referencia e valide de novo.',
      evidencia: `Nenhum elemento com texto visível${
        render.errosDeConsole.length > 0 ? `: ${render.errosDeConsole.join(' · ')}` : '.'
      }`
    })
  }

  // (3) Assets locais que não existem. Remoto não conta: apontar para CDN é escolha do PI.
  for (const ref of referencias) {
    if (ref.remota || ref.resolvido) continue
    const eNavegacao = ref.tipo === 'navegacao'
    achados.push({
      id: `${prototipo}:ref-quebrada:${ref.alvo}`,
      prototipo,
      severidade: eNavegacao ? 'pergunta' : 'impede-arquitetura',
      pergunta: eNavegacao
        ? `A tela "${ref.alvo}" é referenciada mas não foi anexada. Ela faz parte do escopo?`
        : `O arquivo "${ref.alvo}" é usado pelo protótipo mas não foi anexado. Ele existe?`,
      recomendacao: eNavegacao
        ? 'Anexe o protótipo dessa tela, ou confirme que ela fica fora do escopo desta revisão.'
        : 'Anexe o asset pelo seletor, no mesmo ato que copia e hasheia os demais.',
      evidencia: `Referência não resolvida sob o projeto: ${ref.alvo}`
    })
  }

  // (4) Estados exigidos pela spec. `pergunta`, nunca bloqueio: um protótipo de uma tela só pode
  // legitimamente não ter estado de bloqueio, e cabe ao PI dizer isso.
  const texto = normalizar([...render.jornadas].join(' '))
  for (const estado of ESTADOS_EXIGIDOS) {
    if (SINAIS_DO_ESTADO[estado].some((sinal) => texto.includes(normalizar(sinal)))) continue
    achados.push({
      id: `${prototipo}:estado-ausente:${estado}`,
      prototipo,
      severidade: 'pergunta',
      pergunta: `Este protótipo não mostra o estado "${estado}". Ele acontece nesta tela?`,
      recomendacao: `Acrescente o estado "${estado}" ao protótipo, ou confirme que ele não ocorre aqui.`,
      evidencia: `Nenhum sinal de "${estado}" entre as seções do protótipo.`
    })
  }

  // (5) Telas do PRD sem par no protótipo. É o critério 4 pela raiz: a arquitetura não promete
  // fluxo ausente dos protótipos, e para não prometer é preciso saber qual falta.
  const cobertas = render.jornadas.map(normalizar)
  for (const tela of telasDoPrd) {
    if (cobertas.some((j) => j.includes(normalizar(tela)))) continue
    achados.push({
      id: `${prototipo}:tela-sem-prototipo:${tela}`,
      prototipo,
      severidade: 'pergunta',
      pergunta: `O PRD menciona "${tela}", que não aparece neste protótipo. Ela foi prototipada?`,
      recomendacao:
        'Anexe o protótipo dessa tela, ou confirme que a arquitetura não deve prometê-la nesta revisão.',
      evidencia: `Presente no PRD, ausente das seções do protótipo: ${tela}`
    })
  }

  return {
    prototipo,
    achados: [...achados].sort((a, b) =>
      a.severidade === b.severidade ? 0 : a.severidade === 'impede-arquitetura' ? -1 : 1
    ),
    jornadasCobertas: render.jornadas
  }
}

/**
 * As jornadas cobertas por todos os protótipos — o que a arquitetura pode prometer (critério 4).
 *
 * Deduplica por texto normalizado: duas telas com o mesmo nome em protótipos diferentes são a
 * mesma jornada, e listá-las duas vezes inflaria a cobertura sem acrescentar cobertura.
 */
export function jornadasCobertas(validacoes: readonly ValidacaoDoPrototipo[]): readonly string[] {
  const vistas = new Map<string, string>()
  for (const v of validacoes) {
    for (const jornada of v.jornadasCobertas) {
      const chave = normalizar(jornada)
      if (chave !== '' && !vistas.has(chave)) vistas.set(chave, jornada)
    }
  }
  return [...vistas.values()]
}

/**
 * Os achados que impedem a arquitetura de sair.
 *
 * Separado de `achados` porque a decisão é distinta: a tela mostra tudo, e o serviço de
 * arquitetura consulta só estes. Sem a separação, o serviço filtraria por severidade em cada
 * chamada e a regra viveria em quem chama, não em quem sabe.
 */
export function achadosQueImpedem(
  validacoes: readonly ValidacaoDoPrototipo[]
): readonly AchadoDoPrototipo[] {
  return validacoes.flatMap((v) => v.achados.filter((a) => a.severidade === 'impede-arquitetura'))
}
