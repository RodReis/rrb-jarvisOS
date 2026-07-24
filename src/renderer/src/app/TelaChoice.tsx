import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as IconeTema } from 'lucide-react'
import type { ThemePreference, WorkspaceId } from '@shared/domain/entities'
import { ProvedorDeTema } from '@design/tokens/provider'
import { identidade } from '@design/tokens/identidade'
import { ACENTO_PADRAO, type CorAcento } from '@design/tokens/acento'
import type { Modulo } from '@design/tokens/semantic'
import { AccentSwatchSelector } from '@design/patterns'
import { Button, VoiceMascot } from '@design/ui'
import carbono from '@design/assets/carbono.jpg'
import { AtmosferaDeMarca } from './AtmosferaDeMarca'

/**
 * Tela CHOICE — a porta de entrada de cada sessão (SPEC-CHOICE-01; protótipo
 * `data-screen-label="Escolha de ambiente"`).
 *
 * É onde, depois do login, o usuário escolhe **em qual espaço a sessão começa** — NOA ou JARVIS,
 * lado a lado — e ajusta o **acento** de cada identidade e o **tema**. A troca de espaço no meio
 * da sessão **não** passa por aqui: continua no rail (opção A da spec; a SPEC-Fundacao-02 fica
 * intacta). A CHOICE decide só o espaço de entrada.
 *
 * **Sempre escura.** Como Login e Toast, é superfície de marca (README §2.6): `superficie='choice'`
 * trava o escuro mesmo com `uiTheme='light'`, e por isso o seletor de tema aqui é **prévia** — ele
 * escreve a preferência que vale ao entrar no espaço, sem inverter a própria CHOICE.
 *
 * Porte da prova visual (`src/design/prova/jornada/Choice.tsx`) para o app, com o que a prova não
 * tinha: a atmosfera de marca (reusada do login), o painel TEMA flutuante e o seletor de tema.
 */

interface TelaChoiceProps {
  readonly acentoNoa: CorAcento
  readonly acentoJarvis: CorAcento
  /** Preferência de tema vigente — o seletor da CHOICE a edita como prévia. */
  readonly tema: ThemePreference
  readonly onEscolherAcento: (modulo: Modulo, cor: CorAcento) => void
  readonly onEscolherTema: (tema: ThemePreference) => void
  /** Entrar num espaço — dispara a transição e a troca auditada no main. */
  readonly onEntrar: (workspace: WorkspaceId) => void
}

export function TelaChoice({
  acentoNoa,
  acentoJarvis,
  tema,
  onEscolherAcento,
  onEscolherTema,
  onEntrar
}: TelaChoiceProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    /*
     * O acento de cada módulo entra no provider raiz para que o painel TEMA — que fica fora dos
     * cards — leia a cor certa em cada rótulo (o "NOA" e o "JARVIS" do painel usam
     * `var(--jos-cor-acento)` de cada identidade). Cada card reabre o provider com o seu módulo;
     * ver `CardDeIdentidade`.
     */
    <ProvedorDeTema
      superficie="choice"
      modulo="jarvis"
      uiTheme="dark"
      accentJarvis={acentoJarvis}
      accentNoa={acentoNoa}
    >
      {/*
       * `fixed inset-0`, e não `h-full`: o `ProvedorDeTema` insere um `<div>` de bloco que colapsa
       * para a altura do conteúdo, e `h-full` herdaria o valor colapsado — o fundo pararia no meio
       * da janela. Mesma armadilha resolvida no login (#57); medida no app real, não pega em jsdom.
       */}
      <div
        data-jos-tela="choice"
        className="fixed inset-0 flex items-center justify-center gap-9 overflow-hidden bg-[#060708] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)] motion-safe:animate-[riseIn_var(--jos-duracao-lenta)_ease_both]"
      >
        <AtmosferaDeMarca imagem={carbono} />

        <PainelDeTema
          acentoNoa={acentoNoa}
          acentoJarvis={acentoJarvis}
          tema={tema}
          onEscolherAcento={onEscolherAcento}
          onEscolherTema={onEscolherTema}
        />

        <h1 className="sr-only">{t('choice.titulo')}</h1>

        {/*
         * Os dois cards são **o mesmo componente** recebendo módulos diferentes — a tese da base
         * única, provada por estarem lado a lado. NOA primeiro (pessoal antes de profissional),
         * como o protótipo.
         */}
        {(['noa', 'jarvis'] as const).map((modulo) => (
          <CardDeIdentidade
            key={modulo}
            modulo={modulo}
            acento={modulo === 'noa' ? acentoNoa : acentoJarvis}
            onEntrar={() => onEntrar(modulo)}
          />
        ))}
      </div>
    </ProvedorDeTema>
  )
}

/**
 * Um card por identidade. Reabre o provider com o **seu** módulo, então mascote, acento, anel e
 * botão vêm da identidade certa sem nenhum `if` de cor aqui dentro.
 */
function CardDeIdentidade({
  modulo,
  acento,
  onEntrar
}: {
  readonly modulo: Modulo
  readonly acento: CorAcento
  readonly onEntrar: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = identidade(modulo)

  return (
    <ProvedorDeTema
      superficie="choice"
      modulo={modulo}
      uiTheme="dark"
      accentJarvis={modulo === 'jarvis' ? acento : ACENTO_PADRAO.jarvis}
      accentNoa={modulo === 'noa' ? acento : ACENTO_PADRAO.noa}
    >
      {/*
       * Card do protótipo: 340px, contornado, com glow do acento na sombra. Clicar no card inteiro
       * entra — o `Button` embaixo repete a ação com um alvo nomeado (não é redundância inútil:
       * teclado e leitor de tela precisam do botão; o mouse ganha a área maior).
       */}
      <div
        data-jornada-card={modulo}
        className="relative flex w-[340px] max-w-[calc(100%-2rem)] flex-col items-center gap-5 rounded-[16px] border border-[rgba(var(--jos-borda-rgb),0.14)] px-[34px] pb-[30px] pt-[38px] backdrop-blur-[10px] transition-[transform,border-color] duration-[var(--jos-duracao-media)] hover:-translate-y-1.5 hover:border-[color-mix(in_srgb,var(--jos-cor-acento)_70%,transparent)]"
        style={{
          background: 'linear-gradient(165deg, rgba(16,18,22,.82), rgba(8,9,11,.86))',
          boxShadow:
            '0 30px 80px -30px rgba(0,0,0,.9), 0 0 60px -30px color-mix(in srgb, var(--jos-cor-acento) 50%, transparent)'
        }}
      >
        <Emblema modulo={modulo} />

        <div className="flex flex-col items-center gap-2">
          {/*
           * `choice.<modulo>.nome` e não `identidade().nome`: o card do protótipo mostra só a
           * marca curta ("NOA" / "JARVIS"), enquanto `identidade().nome` traz o nome completo do
           * espaço ("JARVIS OS"). São dois usos legítimos do mesmo dado — aqui vale a marca.
           */}
          <span className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-tela)] tracking-[6px] text-[var(--jos-cor-texto)]">
            {t(`choice.${modulo}.nome`)}
          </span>
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[3px] text-[var(--jos-cor-acento-leitura)]">
            {t(`choice.${modulo}.tagline`)}
          </span>
          <p className="text-center text-[length:var(--jos-texto-mini)] leading-relaxed text-[var(--jos-cor-texto-secundario)]">
            {t(`choice.${modulo}.descricao`)}
          </p>
        </div>

        {/*
         * `Button` do DS, não um `<button>` local: o critério 1 exige a jornada composta só de
         * componentes públicos. O rótulo visível é "Entrar"; o nome acessível diz em qual espaço
         * ("Entrar em NOA"), como o protótipo — visível curto, acessível inteiro.
         */}
        <Button larguraTotal onClick={onEntrar} iconeFinal={<SetaEntrar />}>
          <span aria-hidden>{t('choice.entrar')}</span>
          <span className="sr-only">{t('choice.entrarEm', { espaco: id.nome })}</span>
        </Button>
      </div>
    </ProvedorDeTema>
  )
}

/**
 * O emblema do card — 112px, a medida do protótipo, com o mascote do DS por dentro.
 *
 * Mesma composição do login (#57): a **moldura** (anel externo tracejado com folga + glow) mora
 * aqui, e o `VoiceMascot` continua sendo o componente do DS lá dentro — sem prop nova, sem tamanho
 * novo. O anel gira em 20s; o glow respira em `corepulse`, ambos no acento da identidade.
 */
function Emblema({ modulo }: { readonly modulo: Modulo }): React.JSX.Element {
  return (
    <div className="relative grid size-[112px] shrink-0 place-items-center">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-[color-mix(in_srgb,var(--jos-cor-acento)_35%,transparent)] motion-safe:animate-[spin_20s_linear_infinite]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-1.5 rounded-full motion-safe:animate-[corepulse_3.4s_ease-in-out_infinite]"
        style={{
          boxShadow: '0 0 34px 4px color-mix(in srgb, var(--jos-cor-acento) 35%, transparent)'
        }}
      />
      {/* `voz={false}`: não há motor de voz na CHOICE; um mascote "ouvindo" aqui seria estado falso. */}
      <VoiceMascot modulo={modulo} tamanho="medio" voz={false} />
    </div>
  )
}

/**
 * Painel TEMA flutuante — o botão engrenagem no canto abre a paleta de acento (NOA + JARVIS) e o
 * seletor de tema. Fechado por padrão, como o protótipo.
 *
 * Não é modal: é um popover leve que não bloqueia a escolha do espaço. `<details>`/`<summary>`
 * nativos dariam o toggle de graça, mas o gatilho precisa ser um ícone posicionado e o conteúdo,
 * um painel absoluto — então o estado é `useState` e o gatilho, um `<button>` com `aria-expanded`.
 */
function PainelDeTema({
  acentoNoa,
  acentoJarvis,
  tema,
  onEscolherAcento,
  onEscolherTema
}: {
  readonly acentoNoa: CorAcento
  readonly acentoJarvis: CorAcento
  readonly tema: ThemePreference
  readonly onEscolherAcento: (modulo: Modulo, cor: CorAcento) => void
  readonly onEscolherTema: (tema: ThemePreference) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [aberto, setAberto] = useState(false)

  return (
    <div className="absolute right-7 top-6 z-30 flex flex-col items-end gap-3">
      <button
        type="button"
        aria-expanded={aberto}
        aria-label={t('choice.tema.abrir')}
        title={t('choice.tema.abrir')}
        onClick={() => setAberto((v) => !v)}
        className="grid size-11 place-items-center rounded-[12px] border border-[rgba(var(--jos-borda-rgb),0.18)] text-[var(--jos-cor-texto-secundario)] backdrop-blur-[10px] outline-none transition-[transform,border-color] duration-[var(--jos-duracao-media)] hover:rotate-[40deg] hover:border-[rgba(var(--jos-borda-rgb),0.42)] focus-visible:ring-2 focus-visible:ring-[var(--jos-cor-acento)]"
        style={{ background: 'linear-gradient(165deg, rgba(20,22,26,.85), rgba(8,9,11,.9))' }}
      >
        <IconeTema size={20} aria-hidden />
      </button>

      {aberto && (
        <div
          className="flex w-[286px] flex-col gap-[18px] rounded-[15px] border border-[rgba(var(--jos-borda-rgb),0.16)] p-5 backdrop-blur-[16px] motion-safe:animate-[riseIn_var(--jos-duracao-media)_ease_both]"
          style={{
            background: 'linear-gradient(165deg, rgba(18,20,24,.94), rgba(8,9,11,.95))',
            boxShadow: '0 34px 74px -26px rgba(0,0,0,.92)'
          }}
        >
          <p className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-mini)] tracking-[5px] text-[var(--jos-cor-texto)]">
            {t('choice.tema.titulo')}
          </p>

          {/* Acento por módulo — cada grupo reabre o provider para pintar o rótulo com o seu acento. */}
          {(['noa', 'jarvis'] as const).map((modulo) => (
            <ProvedorDeTema
              key={modulo}
              superficie="choice"
              modulo={modulo}
              uiTheme="dark"
              accentJarvis={modulo === 'jarvis' ? acentoJarvis : ACENTO_PADRAO.jarvis}
              accentNoa={modulo === 'noa' ? acentoNoa : ACENTO_PADRAO.noa}
            >
              <div className="flex flex-col gap-2.5">
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2.5px] text-[var(--jos-cor-acento)]">
                  {identidade(modulo).nome}
                </span>
                <AccentSwatchSelector
                  valor={modulo === 'noa' ? acentoNoa : acentoJarvis}
                  onEscolher={(cor) => onEscolherAcento(modulo, cor)}
                  rotulo={t('choice.tema.acentoDe', { espaco: identidade(modulo).nome })}
                />
              </div>
            </ProvedorDeTema>
          ))}

          <SeletorDeTema tema={tema} onEscolher={onEscolherTema} />
        </div>
      )}
    </div>
  )
}

/**
 * Seletor de tema na CHOICE — prévia do que vale ao entrar no espaço.
 *
 * O mesmo `radiogroup` do Settings (claro/escuro/sistema), reusando a chave de tradução
 * `settings.tema*` para não inventar rótulo paralelo. Escreve a preferência da SPEC-Fundacao-05;
 * a CHOICE em si não inverte.
 */
const TEMAS: readonly ThemePreference[] = ['claro', 'escuro', 'sistema']

function SeletorDeTema({
  tema,
  onEscolher
}: {
  readonly tema: ThemePreference
  readonly onEscolher: (tema: ThemePreference) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const rotulo: Readonly<Record<ThemePreference, string>> = {
    claro: t('settings.temaClaro'),
    escuro: t('settings.temaEscuro'),
    sistema: t('settings.temaSistema')
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span
        id="choice-tema-titulo"
        className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2.5px] text-[var(--jos-cor-texto-suave)]"
      >
        {t('settings.tema')}
      </span>
      <div role="radiogroup" aria-labelledby="choice-tema-titulo" className="flex gap-2">
        {TEMAS.map((opcao) => {
          const ativo = opcao === tema
          return (
            <button
              key={opcao}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => onEscolher(opcao)}
              className={
                ativo
                  ? 'flex-1 rounded-[9px] border border-[var(--jos-cor-acento)] bg-[rgba(var(--jos-borda-rgb),0.10)] px-2 py-1.5 text-[length:var(--jos-texto-micro)] font-[var(--jos-peso-medio)] text-[var(--jos-cor-texto)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--jos-cor-acento)]'
                  : 'flex-1 rounded-[9px] border border-[rgba(var(--jos-borda-rgb),0.18)] px-2 py-1.5 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)] outline-none transition-colors hover:border-[rgba(var(--jos-borda-rgb),0.42)] focus-visible:ring-2 focus-visible:ring-[var(--jos-cor-acento)]'
              }
            >
              {rotulo[opcao]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A seta do "ENTRAR" no protótipo. Decorativa: a direção do fluxo já está no rótulo. */
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
