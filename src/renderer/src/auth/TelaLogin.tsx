import { useTranslation } from 'react-i18next'
import type { AuthSnapshot } from '@shared/contracts/auth'
import { ProvedorDeTema } from '@design/tokens/provider'
import { Button, InlineAlert, Input, PasswordInput, VoiceMascot } from '@design/ui'
import carbono from '@design/assets/carbono.jpg'
import { AtmosferaDeMarca } from '../app/AtmosferaDeMarca'

/**
 * Tela de entrada (SPEC-Fundacao-03, critérios 1 e 6; protótipo `data-screen-label="Login"`).
 *
 * Porte fiel do protótipo, com o design system do MVP-003 aplicado. A versão anterior era um
 * placeholder da F03 — um botão `sky-600` num card cinza — e o próprio arquivo declarava o
 * motivo: *"sem design system formal, que é o MVP-003"*. O MVP-003 fechou; a dívida venceu
 * (card [FIX] #57).
 *
 * **Google é a única entrada.** O mockup mostra usuário/senha, GitHub e "cadastre-se", mas
 * `auth-service.ts` só faz `signInWithOAuth({ provider: 'google' })` e a spec é explícita:
 * *"Login Google real via Supabase Auth"*. Renderizar campo de senha que não autentica seria a
 * tela mentindo sobre o que o sistema faz — pior que a divergência visual que este card corrige.
 * Senha e GitHub são fatia nova, com spec própria (decisão do PI, 2026-07-24).
 *
 * A mensagem de falha vem pronta do main e é exibida **como veio**: o critério 6 proíbe stack
 * trace na UI, e a forma de garantir isso é o renderer não ter acesso ao erro cru.
 */

interface TelaLoginProps {
  readonly auth: AuthSnapshot
  readonly onEntrar: () => void
}

/**
 * Ids dos campos da maquete.
 *
 * Constantes, e não `useId()`: os campos são estáticos e desabilitados — não há duas instâncias
 * desta tela na mesma página, que é o problema que o `useId` resolve.
 */
const ID_USUARIO = 'login-usuario'
const ID_SENHA = 'login-senha'

/**
 * O acento desta tela — prata fixa, fora da paleta do usuário (decisão do PI, 2026-07-24).
 *
 * `#C4C4C4` é uma das oito cores de `PALETA_ACENTO` (README §2.4). Aqui ela entra como **cor de
 * marca da porta de entrada**, não como acento de um módulo: quem está no login ainda não
 * escolheu espaço nem cor, e pintar anel, glow e dot com o acento de um módulo ainda não aberto
 * anteciparia uma identidade que o usuário não selecionou.
 *
 * O valor é literal, e não `ACENTO_PADRAO.jarvis`, **de propósito** — mesmo agora que o token
 * também vale `#C4C4C4` (o PI o alterou em 2026-07-24, alinhando ao que a SPEC-CHOICE-01 pedia).
 * Ler o token amarraria a porta de entrada ao default de um módulo: no dia em que o JARVIS
 * voltar a ter acento próprio, o login o herdaria em silêncio. A coincidência de valor hoje não
 * é a mesma decisão — uma é "o default do JARVIS", a outra é "a tela de entrada não tem acento".
 */
const ACENTO_DA_MARCA = '#C4C4C4' as const

/**
 * Handler vazio dos campos de maquete.
 *
 * O `Input` exige `onMudar`; campo desabilitado não dispara `change`, então isto nunca roda. Fora
 * do componente para não recriar a função a cada render.
 */
const NAO_FAZ_NADA = (): void => undefined

export function TelaLogin({ auth, onEntrar }: TelaLoginProps): React.JSX.Element {
  const { t } = useTranslation()

  const autenticando = auth.state === 'autenticando'
  const expirada = auth.state === 'sessao-expirada'
  const falhou = auth.state === 'erro'
  const houveFalha = falhou || expirada

  return (
    /*
     * `superficie="login"` é o contrato que a F02 deixou pronto e nunca foi usado: a tela de
     * entrada é **superfície de marca** e permanece escura mesmo com `uiTheme='light'`
     * (README §2.6). Por isso não lê `usePreferences` — não há preferência a respeitar aqui.
     *
     * E o acento vai **fixo em prata** (decisão do PI, 2026-07-24): a tela de entrada antecede
     * a identidade. Quem está aqui ainda não escolheu espaço nem cor, e o laranja do JARVIS
     * (`#C4C4C4`, o default de fábrica) pintava anel, glow e dot de um módulo que o usuário
     * ainda não abriu — no protótipo esses elementos são metálicos.
     *
     * Passar o acento **ao provider**, em vez de trocar cor a cor, é o que faz um único ponto
     * governar a tela inteira: todo `var(--jos-cor-acento)` daqui para baixo lê prata, e um
     * elemento novo nasce neutro sem ninguém lembrar de neutralizá-lo.
     */
    <ProvedorDeTema
      uiTheme="dark"
      modulo="jarvis"
      superficie="login"
      accentJarvis={ACENTO_DA_MARCA}
      accentNoa={ACENTO_DA_MARCA}
    >
      {/*
       * `fixed inset-0`, e não `h-full`: o `ProvedorDeTema` insere um `<div>` de bloco entre
       * `#root` e esta tela, e esse `div` colapsa para a altura do conteúdo (medido: 538px numa
       * janela de 820px). `h-full` herdaria o valor colapsado, e o fundo pararia no meio da
       * janela com o `body` claro aparecendo embaixo. Medido no app real — os 562 testes de
       * componente passam porque jsdom não faz layout.
       *
       * O `AppShell` não sofre disso porque preenche o provider com uma tela inteira. Corrigir
       * aqui, e não no provider, mantém o DS intocado: o provider **declara variáveis**, e dar
       * altura a ele faria toda subárvore tematizada — inclusive dentro de um modal — herdar
       * altura de tela cheia.
       */}
      <div
        data-jos-tela="login"
        className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[#060708] font-[family-name:var(--jos-fonte-corpo)]"
      >
        <AtmosferaDeMarca imagem={carbono} />

        <main
          aria-labelledby="login-titulo"
          className="relative z-10 flex w-[340px] max-w-[calc(100%-2rem)] flex-col items-center gap-[22px] rounded-[16px] border border-[rgba(var(--jos-borda-rgb),0.14)] px-[34px] py-[38px] backdrop-blur-[10px] motion-safe:animate-[riseIn_var(--jos-duracao-lenta)_ease_both]"
          style={{
            background: 'linear-gradient(165deg, rgba(16,18,22,.82), rgba(8,9,11,.86))',
            boxShadow: '0 30px 80px -30px rgba(0,0,0,.9), 0 0 60px -30px var(--jos-cor-acento)'
          }}
        >
          <Emblema />

          {/*
           * O título é visualmente redundante com o mascote — o protótipo não desenha texto
           * aqui —, mas a tela precisa de um nome acessível: sem `h1`, quem navega por
           * cabeçalho não tem âncora e o `aria-labelledby` do `main` fica pendurado no nada.
           */}
          <h1 id="login-titulo" className="sr-only">
            {t('auth.titulo')}
          </h1>

          <p className="text-center text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            {autenticando ? t('auth.entrandoDescricao') : t('auth.subtitulo')}
          </p>

          {/*
           * O `role="alert"` vem do próprio `InlineAlert` nos tons `warn` e `err` — e é o que
           * esta tela precisa: a transição para erro ou expiração acontece depois de o usuário
           * sair daqui (o login termina no navegador), e tem de ser anunciada quando ele volta.
           * Envolver num `<div role="alert">` produziria **dois** alertas para a mesma
           * mensagem, e o leitor de tela a anunciaria duas vezes.
           */}
          {houveFalha && auth.mensagem !== undefined && (
            <div className="w-full">
              <InlineAlert tom={expirada ? 'warn' : 'err'} titulo={t('auth.falha')}>
                {auth.mensagem}
              </InlineAlert>
            </div>
          )}

          {/*
           * Os campos do protótipo — **maquete**, desabilitados (decisão do PI, 2026-07-24).
           *
           * Não há login por senha: `auth-service.ts` só faz `signInWithOAuth`. Renderizá-los
           * ativos convidaria o usuário a digitar credenciais que ninguém recebe — pior que não
           * tê-los. Desabilitados, dizem "vem aí" sem prometer que já funciona, e o aviso abaixo
           * fecha a lacuna para quem não interpreta o cinza (inclusive leitor de tela: o
           * `disabled` é anunciado).
           *
           * O rótulo é um `<label>` `sr-only` ligado pelo `id`, não um `aria-label`: o `Input`
           * do DS aceita `id` (via `AtributosDoControle`) mas não `aria-label`, e alargar a
           * superfície do componente por causa desta tela seria mudar o DS para acomodar um
           * consumidor. O `<label>` resolve com HTML padrão e sem tocar em nada.
           *
           * Rótulo invisível, e não ausente: o protótipo não o desenha, mas um campo sem nome
           * acessível é anunciado como "editar texto, desabilitado" — sem dizer qual campo é.
           * Placeholder não substitui rótulo (some ao digitar).
           */}
          <div className="flex w-full flex-col gap-[12px]">
            <div>
              <label htmlFor={ID_USUARIO} className="sr-only">
                {t('auth.usuario')}
              </label>
              <Input
                id={ID_USUARIO}
                valor=""
                onMudar={NAO_FAZ_NADA}
                desabilitado
                placeholder={t('auth.usuario')}
                autoComplete="username"
                icone={<IconeUsuario />}
              />
            </div>
            <div>
              <label htmlFor={ID_SENHA} className="sr-only">
                {t('auth.senha')}
              </label>
              <PasswordInput
                id={ID_SENHA}
                valor=""
                onMudar={NAO_FAZ_NADA}
                desabilitado
                placeholder={t('auth.senha')}
                autoComplete="current-password"
                icone={<IconeCadeado />}
              />
            </div>
          </div>

          <CredenciaisIndisponiveis />

          {/*
           * O "ACESSAR" do protótipo: contornado, **neutro fixo**, sem o acento do usuário
           * (decisão do PI, 2026-07-24). É a única superfície do app onde o acento escolhido não
           * aparece — e isso é deliberado: a tela de entrada antecede a preferência, e o
           * protótipo a desenha em cinza.
           *
           * Desabilitado porque não há credenciais a enviar: os campos acima são maquete até a
           * spec de senha existir. `aria-disabled` em vez de `disabled` deixaria o botão focável
           * anunciando que não funciona; aqui `desabilitado` é a verdade simples — não há ação.
           */}
          <Button variante="secundaria" larguraTotal desabilitado iconeFinal={<SetaEntrar />}>
            {t('auth.acessar')}
          </Button>

          <Divisor />

          {/*
           * Os dois provedores lado a lado, como o protótipo. **Só o Google funciona** — é o
           * único que `auth-service.ts` implementa (`signInWithOAuth({ provider: 'google' })`).
           * O GitHub fica desabilitado em vez de ausente: o PI pediu a maquete fiel, e um botão
           * desabilitado diz "existe, ainda não" — enquanto um botão que aceita clique e não
           * autentica diria "funciona", que é mentira.
           */}
          <div className="grid w-full grid-cols-2 gap-[10px]">
            {/*
             * O rótulo visível é só "Google", como o protótipo; o nome acessível é a frase
             * inteira ("Entrar com o Google"), completada por um trecho `sr-only` dentro do
             * botão.
             *
             * Por que não `aria-label`: o `Button` do DS tem superfície fechada (decisão 4 da
             * F03a) e não o aceita — e alargar o componente por causa desta tela seria mudar o
             * DS para acomodar um consumidor. O `sr-only` no conteúdo resolve com o que já
             * existe, e tem uma vantagem: `aria-label` **substitui** o conteúdo, então quem usa
             * comando de voz ("clicar em Google") perderia o rótulo visível como alvo.
             *
             * Enquanto autentica, o botão descreve o estado em vez da ação — mesma regra dos
             * outros dois rótulos: visível curto, nome acessível inteiro.
             */}
            <Button
              variante="secundaria"
              larguraTotal
              onClick={onEntrar}
              carregando={autenticando}
              iconeInicial={autenticando ? undefined : <LogoGoogle />}
            >
              {autenticando ? (
                <>
                  {/*
                   * Visível "Aguardando…", anunciado "Aguardando o navegador…".
                   *
                   * A frase inteira ocupava três linhas em metade da grade de dois provedores e
                   * empurrava o spinner para uma linha sozinha (visto na captura do app real).
                   * A reticência já diz que a espera continua; **onde** ela acontece está no
                   * parágrafo acima do card, visível para todos.
                   *
                   * Duas frases completas em vez de prefixo + complemento: concatenados, os
                   * dois trechos dariam "Aguardando… o navegador", com a pausa no meio. Por isso
                   * o rótulo curto vai `aria-hidden` e a frase inteira vive no `sr-only` — cada
                   * público recebe a versão que lhe serve, sem que uma estrague a outra.
                   */}
                  <span aria-hidden>{t('auth.aguardando')}</span>
                  <span className="sr-only">{t('auth.aguardandoNavegador')}</span>
                </>
              ) : (
                <>
                  {/*
                   * O texto visível é sempre "Google" — curto, como o protótipo. A frase do
                   * nome acessível muda com o estado: "Entrar com o Google" na primeira vez,
                   * "Tentar novamente com o Google" depois de falhar.
                   *
                   * Motivo de o rótulo visível **não** virar "Tentar novamente": ele não cabe
                   * em metade da grade de dois provedores — quebrava em duas linhas e
                   * desalinhava os dois botões (visto na captura do app real). O convite a
                   * repetir já está no `InlineAlert` logo acima, que é onde o usuário lê o que
                   * aconteceu.
                   */}
                  <span className="sr-only">
                    {houveFalha ? t('auth.tentarNovamenteCom') : t('auth.entrarCom')}
                  </span>
                  {` ${t('auth.google')}`}
                </>
              )}
            </Button>
            <Button variante="secundaria" larguraTotal desabilitado iconeInicial={<LogoGitHub />}>
              <span className="sr-only">{t('auth.entrarCom')}</span>
              {` ${t('auth.github')}`}
            </Button>
          </div>
        </main>

        <Rodape />
      </div>
    </ProvedorDeTema>
  )
}

/**
 * Aviso de que senha e GitHub ainda não autenticam.
 *
 * A maquete fiel ao protótipo cria uma promessa que o sistema não cumpre: três caminhos de
 * entrada visíveis, um só funcionando. O cinza do desabilitado comunica isso a quem enxerga bem
 * o contraste; esta frase comunica a todo mundo, e é o que separa "em construção" de "quebrado".
 *
 * Sem `role="alert"`: não é uma falha, é o estado normal da tela hoje. Alerta anunciaria urgência
 * onde não há — e competiria com o `role="alert"` real do erro de login, logo acima.
 */
function CredenciaisIndisponiveis(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p className="text-center text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
      {t('auth.senhaEmBreve')}
    </p>
  )
}

/**
 * O divisor "ou cadastre-se com" do protótipo.
 *
 * As duas linhas são gradientes que se dissolvem na direção do texto — o protótipo não usa régua
 * sólida. `aria-hidden` nelas: separador decorativo não é informação.
 */
function Divisor(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex w-full items-center gap-3">
      <span
        aria-hidden
        className="h-px flex-1"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(var(--jos-borda-rgb),0.2))'
        }}
      />
      <span className="whitespace-nowrap font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] tracking-[2px] text-[var(--jos-cor-texto-suave)]">
        {t('auth.ouCadastre')}
      </span>
      <span
        aria-hidden
        className="h-px flex-1"
        style={{
          background: 'linear-gradient(90deg, rgba(var(--jos-borda-rgb),0.2), transparent)'
        }}
      />
    </div>
  )
}

/** Ícone de usuário do protótipo. Decorativo — o `<label>` é quem nomeia o campo. */
function IconeUsuario(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      focusable="false"
    >
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c1.2-3.4 4-5 7-5s5.8 1.6 7 5" />
    </svg>
  )
}

/** Cadeado do campo de senha. Decorativo, como o de usuário. */
function IconeCadeado(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      focusable="false"
    >
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

/**
 * Logo do GitHub — monocromático, em `currentColor`.
 *
 * Diferente do Google, cujas diretrizes de marca exigem as quatro cores: o GitHub aceita a marca
 * em cor única, então ela acompanha o estado do botão (inclusive a opacidade do desabilitado).
 */
function LogoGitHub(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="shrink-0"
      focusable="false"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55 0-.27-.01-1.16-.02-2.1-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}

/**
 * O emblema do login — 112px, a medida do protótipo.
 *
 * **Por que não é o `VoiceMascot` puro.** O protótipo monta o emblema em três camadas
 * *irmãs*: um anel tracejado de 112px girando, um glow, e por dentro um tile de 94px com a
 * imagem. O `VoiceMascot` é uma peça só, com `overflow-hidden` e os anéis em `inset-0` —
 * colados na borda da imagem. É o desenho certo para o rail e para o card do Choice, onde o
 * mascote é um avatar; não é o do login, onde ele é a marca e o anel precisa de ar em volta.
 *
 * Então a **moldura** (o anel externo com folga) mora aqui, e o mascote continua sendo o
 * componente do DS lá dentro — sem prop nova, sem tamanho novo, sem `overflow` afrouxado. O
 * DS segue dono do rosto, dos estados e do texto para leitor de tela; a tela é dona do
 * enquadramento, que é decisão de composição desta tela.
 *
 * A alternativa seria dar ao `VoiceMascot` um tamanho `emblema` e um modo sem `overflow` —
 * duas props para um único consumidor, exatamente o que a decisão 4 da F03a evita.
 */
function Emblema(): React.JSX.Element {
  return (
    <div className="relative grid size-[112px] shrink-0 place-items-center">
      {/*
       * O anel externo do protótipo: tracejado, no acento, girando em 20s. Fica **fora** do
       * tile — é a folga que o `VoiceMascot` sozinho não tem. `aria-hidden` porque o mascote
       * lá dentro já carrega o nome e o estado para tecnologia assistiva; anunciar a moldura
       * seria repetir.
       */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-[color-mix(in_srgb,var(--jos-cor-acento)_35%,transparent)] motion-safe:animate-[spin_20s_linear_infinite]"
      />
      {/*
       * **Sem glow próprio aqui.** A primeira versão somava um `box-shadow` pulsante ao que o
       * `VoiceMascot` já tem por dentro (`corepulse` + `0 0 34px -8px`), e os dois juntos
       * viravam um halo laranja sólido: o brilho competia com o rosto em vez de emoldurá-lo.
       * Visto na captura do app real. O glow do DS sozinho é o do protótipo — o que faltava
       * era só a folga do anel, e é isso que este wrapper acrescenta.
       */}
      {/*
       * `voz={false}`: não há motor de voz nesta tela, e um mascote "ouvindo" antes do login
       * seria estado falso — o componente recusa o estado em vez de confiar em quem o chama.
       */}
      <VoiceMascot modulo="jarvis" tamanho="medio" voz={false} />
    </div>
  )
}

/**
 * Rodapé institucional do protótipo.
 *
 * `<footer>` e não `<div>`: é informação de rodapé de página, e o papel `contentinfo` é o que
 * permite pular direto para ele. Os links são `<a>` reais com `href` — ainda sem destino, mas
 * a estrutura semântica não depende do destino existir.
 */
function Rodape(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    /*
     * Uma linha só, como o protótipo — daí `flex-wrap` ter saído daqui.
     *
     * Com wrap, a 924px o rodapé quebrava em duas linhas e passava a ocupar 95px de altura,
     * empurrando a composição e roubando do card o espaço vertical que ele precisa. O protótipo
     * mantém © à esquerda e links à direita na mesma linha, e é isso que a barra inferior
     * comunica: uma faixa fina, não um bloco.
     *
     * O que absorve a falta de espaço é o `min-w-0` + `truncate` no copyright: em janela
     * estreita ele encolhe e corta, em vez de empurrar os links para baixo. O texto legal é o
     * que menos perde em ser cortado — os links continuam alcançáveis, que é o que importa.
     */
    <footer
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-6 border-t border-[rgba(var(--jos-borda-rgb),0.09)] px-[34px] py-4 backdrop-blur-[6px] motion-safe:animate-[riseIn_800ms_ease_300ms_both]"
      style={{ background: 'linear-gradient(180deg, rgba(6,7,8,0), rgba(6,7,8,.6))' }}
    >
      {/* `flex-1` junto com `min-w-0`: sem ele o bloco cede espaço que ninguém pediu e o
          copyright trunca com a barra ainda vazia à direita (visto na captura). Com ele, o
          texto ocupa o que sobra e só corta quando falta de verdade. */}
      <div className="flex min-w-0 flex-1 items-center gap-[11px]">
        <span
          aria-hidden
          className="size-[6px] rounded-full bg-[var(--jos-cor-acento)] motion-safe:animate-[dotpulse_3.4s_ease-in-out_infinite]"
          style={{ boxShadow: '0 0 8px 1px var(--jos-cor-acento)' }}
        />
        <span className="truncate font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] tracking-[1px] text-[var(--jos-cor-texto-suave)]">
          {t('auth.copyright')}
        </span>
      </div>

      {/* `shrink-0`: quem cede espaço é o copyright (que trunca), não os links — texto legal
          cortado continua legal; link cortado deixa de ser alcançável. */}
      <div className="flex shrink-0 items-center gap-[26px]">
        <a
          href="#privacidade"
          className="text-[length:var(--jos-texto-corpo)] tracking-[.5px] text-[var(--jos-cor-texto-secundario)] no-underline transition-colors duration-[var(--jos-duracao-rapida)] hover:text-[var(--jos-cor-acento-leitura)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--jos-cor-acento)]"
        >
          {t('auth.privacidade')}
        </a>
        <a
          href="#termos"
          className="text-[length:var(--jos-texto-corpo)] tracking-[.5px] text-[var(--jos-cor-texto-secundario)] no-underline transition-colors duration-[var(--jos-duracao-rapida)] hover:text-[var(--jos-cor-acento-leitura)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--jos-cor-acento)]"
        >
          {t('auth.termos')}
        </a>
        {/*
         * A assinatura de origem some abaixo de 1100px — junto com o divisor que a antecede.
         *
         * Medido: numa janela de 924px o rodapé tem 856px úteis, o bloco de links consome 487
         * (o `tracking:4px` do `GOIÂNIA · BRASIL` sozinho pesa ~60) e sobram 344,9 para um
         * copyright que precisa de 345. Faltava menos de 1px, e o efeito era o texto legal
         * aparecer cortado (`…direitos reserv—`) com a barra visualmente vazia.
         *
         * Entre truncar o aviso de copyright e esconder a assinatura de origem, some a
         * assinatura: ela é a informação mais decorativa da barra, enquanto o texto legal
         * precisa ser lido inteiro. Em telas largas — onde o protótipo foi desenhado — os dois
         * cabem, e a composição é a original.
         */}
        <span
          aria-hidden
          className="hidden h-4 w-px bg-[rgba(var(--jos-borda-rgb),0.16)] min-[1100px]:block"
        />
        <span className="hidden font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] tracking-[4px] text-[var(--jos-cor-texto-suave)] min-[1100px]:inline">
          {t('auth.local')}
        </span>
      </div>
    </footer>
  )
}

/**
 * Logo do Google — cores oficiais, exigidas pelas diretrizes de marca do provedor.
 *
 * `aria-hidden`: o rótulo do botão já diz "Entrar com o Google". Um `title` aqui faria o leitor
 * de tela anunciar "Google" duas vezes.
 */
function LogoGoogle(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 48 48"
      className="shrink-0"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/** A seta do "ACESSAR" no protótipo. Decorativa: a direção do fluxo já está no rótulo. */
function SetaEntrar(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="shrink-0"
      focusable="false"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
