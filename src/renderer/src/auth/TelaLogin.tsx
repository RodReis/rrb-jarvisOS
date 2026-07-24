import { useTranslation } from 'react-i18next'
import type { AuthSnapshot } from '@shared/contracts/auth'
import { ACENTO_PADRAO } from '@design/tokens/acento'
import { ProvedorDeTema } from '@design/tokens/provider'
import { Button, InlineAlert, VoiceMascot } from '@design/ui'
import carbono from '@design/assets/carbono.jpg'

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
     */
    <ProvedorDeTema
      uiTheme="dark"
      modulo="jarvis"
      superficie="login"
      accentJarvis={ACENTO_PADRAO.jarvis}
      accentNoa={ACENTO_PADRAO.noa}
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
        <Atmosfera />

        <main
          aria-labelledby="login-titulo"
          className="relative z-10 flex w-[340px] max-w-[calc(100%-2rem)] flex-col items-center gap-[22px] rounded-[16px] border border-[rgba(var(--jos-borda-rgb),0.14)] px-[34px] py-[38px] backdrop-blur-[10px] motion-safe:animate-[riseIn_var(--jos-duracao-lenta)_ease_both]"
          style={{
            background: 'linear-gradient(165deg, rgba(16,18,22,.82), rgba(8,9,11,.86))',
            boxShadow: '0 30px 80px -30px rgba(0,0,0,.9), 0 0 60px -30px var(--jos-cor-acento)'
          }}
        >
          {/*
           * O mascote do DS, não uma imagem solta: ele já traz os dois anéis girando, o glow
           * pulsante e o `bob` do protótipo — e o texto de estado para leitor de tela. `voz`
           * fica em `false` porque não há motor de voz nesta tela; um mascote "ouvindo" antes
           * do login seria estado falso.
           *
           * `medio` (96px) e não `grande` (160px): o protótipo desenha o mascote a 112px, e o
           * `grande` ocupava metade da altura do card — o rosto passava a ser a tela, em vez de
           * anunciá-la. Dos dois tamanhos que o DS oferece, `medio` é o que fica na medida do
           * protótipo; introduzir um terceiro tamanho só para esta tela seria alargar a API do
           * design system para acomodar um consumidor.
           */}
          <VoiceMascot modulo="jarvis" tamanho="medio" voz={false} />

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
           * `secundaria`, não `primaria`, e a razão é o protótipo: o "ACESSAR" é **contornado**
           * com fundo translúcido, não um bloco sólido. Provado na captura do app real — com o
           * preenchimento sólido, o acento de fábrica do JARVIS (`#FF5C00`) tomava a tela e as
           * quatro cores do logo do Google brigavam com o laranja atrás delas. O botão passava
           * a ser o assunto da tela; no protótipo, o assunto é o mascote.
           *
           * O realce do acento entra por **composição**, no wrapper abaixo, e não por uma
           * variante nova: o `Button` tem superfície fechada (decisão 4 da F03a) e uma variante
           * `primaria-contornada` existiria para um único consumidor. A borda e o glow são
           * decoração da moldura; o botão continua sendo o alvo de clique e de foco inteiro.
           */}
          <div
            className="group w-full rounded-[var(--jos-raio-card)] border border-[color-mix(in_srgb,var(--jos-cor-acento)_50%,transparent)] transition-[box-shadow] duration-[var(--jos-duracao-rapida)] focus-within:shadow-[0_0_24px_-6px_var(--jos-cor-acento)] hover:shadow-[0_0_24px_-6px_var(--jos-cor-acento)]"
            style={{
              background:
                'linear-gradient(90deg, color-mix(in srgb, var(--jos-cor-acento) 14%, transparent), transparent 80%)'
            }}
          >
            <Button
              variante="secundaria"
              larguraTotal
              onClick={onEntrar}
              carregando={autenticando}
              iconeInicial={autenticando ? undefined : <LogoGoogle />}
              iconeFinal={autenticando ? undefined : <SetaEntrar />}
            >
              {autenticando
                ? t('auth.entrando')
                : houveFalha
                  ? t('auth.tentarNovamente')
                  : t('auth.entrar')}
            </Button>
          </div>
        </main>

        <Rodape />
      </div>
    </ProvedorDeTema>
  )
}

/**
 * Fundo do protótipo: carbono com Ken Burns, véu radial, brilho diagonal e pontos pulsantes.
 *
 * Tudo `aria-hidden` — é atmosfera, não informação. Cada camada sob `motion-safe`, então
 * `prefers-reduced-motion` entrega a mesma composição estática, e não uma tela vazia: o fundo
 * **é** a identidade da marca, e removê-lo junto com o movimento puniria quem pediu menos
 * movimento com menos design.
 */
function Atmosfera(): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={carbono}
        alt=""
        draggable={false}
        // 112% e offset de -6%: o `kb` faz zoom e pan, e a sobra evita que a borda da imagem
        // entre em quadro no fim do ciclo.
        className="absolute -top-[6%] -left-[6%] h-[112%] w-[112%] object-cover motion-safe:animate-[kb_28s_ease-in-out_infinite_alternate]"
        style={{ filter: 'brightness(.62) contrast(1.08)' }}
      />
      {/* Véu radial: escurece as bordas para o card ganhar o centro sem competir com a textura. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 46%, rgba(6,7,8,0) 0%, rgba(6,7,8,.55) 58%, rgba(6,7,8,.92) 100%)'
        }}
      />
      <div
        className="absolute inset-y-0 w-[46%] motion-safe:animate-[sheen_9s_ease-in-out_infinite]"
        style={{
          background:
            'linear-gradient(100deg, rgba(200,204,212,0) 20%, rgba(200,204,212,.05) 50%, rgba(200,204,212,0) 80%)'
        }}
      />
      {/* Três pontos em ciclos primos entre si — nunca pulsam juntos, que é o que os faz ler
          como sinais independentes em vez de uma animação só. */}
      <span className="absolute top-[24%] left-[18%] size-[3px] rounded-full bg-[rgba(200,204,212,.7)] motion-safe:animate-[dotpulse_3.2s_ease-in-out_infinite]" />
      <span className="absolute top-[64%] right-[22%] size-[2px] rounded-full bg-[var(--jos-cor-acento)] opacity-80 motion-safe:animate-[dotpulse_4.1s_ease-in-out_infinite]" />
      <span className="absolute top-[18%] right-[30%] size-[2px] rounded-full bg-[rgba(200,204,212,.5)] motion-safe:animate-[dotpulse_5s_ease-in-out_infinite]" />
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
    <footer
      className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-6 border-t border-[rgba(var(--jos-borda-rgb),0.09)] px-[34px] py-4 backdrop-blur-[6px] motion-safe:animate-[riseIn_800ms_ease_300ms_both]"
      style={{ background: 'linear-gradient(180deg, rgba(6,7,8,0), rgba(6,7,8,.6))' }}
    >
      <div className="flex items-center gap-[11px]">
        <span
          aria-hidden
          className="size-[6px] rounded-full bg-[var(--jos-cor-acento)] motion-safe:animate-[dotpulse_3.4s_ease-in-out_infinite]"
          style={{ boxShadow: '0 0 8px 1px var(--jos-cor-acento)' }}
        />
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] tracking-[1px] text-[var(--jos-cor-texto-suave)]">
          {t('auth.copyright')}
        </span>
      </div>

      <div className="flex items-center gap-[26px]">
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
        <span aria-hidden className="h-4 w-px bg-[rgba(var(--jos-borda-rgb),0.16)]" />
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] tracking-[4px] text-[var(--jos-cor-texto-suave)]">
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
