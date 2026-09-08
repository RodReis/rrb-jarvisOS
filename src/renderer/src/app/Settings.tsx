import { useTranslation } from 'react-i18next'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import {
  LOCALES,
  THEME_PREFERENCES,
  type AccentColor,
  type Locale,
  type ThemePreference,
  type UserPreferences,
  type WorkspaceId
} from '@shared/domain/entities'
import { Field, InlineAlert, RadioGroup, Select, TabPanel, Tabs } from '@design/ui'
import { AccentSwatchSelector } from '@design/patterns'
import { identidade } from '@design/tokens/identidade'
import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { Modulo } from '@design/tokens/semantic'
import { CredenciaisDoWorkspace } from './CredenciaisDoWorkspace'
import { OrcamentoDoWorkspace } from './OrcamentoDoWorkspace'
import { ConectorGitHub } from './ConectorGitHub'
import { CredenciaisDeConector } from './CredenciaisDeConector'
import { ProvidersDoWorkspace } from './ProvidersDoWorkspace'
import { DiretoriosPermitidos } from './DiretoriosPermitidos'
import { ChamadaDeIa } from './ChamadaDeIa'
import { PreferenciasDeVoz } from './PreferenciasDeVoz'
import { PersonaDoJarvis } from './PersonaDoJarvis'

/**
 * Tela de configurações (SPEC-Fundacao-05 + SPEC-CHOICE-01 crit. 5), reorganizada em **cinco
 * abas** por decisão do PI (2026-08-30): a tela acumulou oito seções de três MVPs num scroll
 * único, e "muita informação numa tela" era a queixa literal.
 *
 * O agrupamento segue o **escopo do dado**, que é a divisão que o app já pratica por baixo:
 *
 *  - **Geral** e **Permissões** são do *usuário* — idioma, tema, acento e a allowlist de
 *    diretórios não mudam com o espaço.
 *  - **IA**, **Roteamento** e **Conectores** são do par *usuário + espaço* — trocar de espaço
 *    troca o que estas abas mostram.
 *
 * Roteamento é aba própria, separada de IA (escolha do PI entre as opções apresentadas): é a
 * seção mais densa da tela — status por provider, ordem por tipo de tarefa — e dentro de IA ela
 * empurrava o orçamento, que o operador consulta antes de cada chamada, para baixo da dobra.
 *
 * A tela também foi **re-plataformada no DS** nesta reforma: o `<select>` cru de idioma e os
 * botões crus de tema eram anteriores ao MVP-003 e nunca migraram — eram os "combos quebrados"
 * da queixa. Idioma usa `Select`, tema usa `RadioGroup`, erro usa `InlineAlert`.
 */

interface SettingsProps {
  readonly preferencias: PreferencesSnapshot
  readonly erro: string | null
  readonly onSalvar: (mudanca: UserPreferences) => void
  /** `uiTheme` do shell — o grupo de acento acompanha o tema da tela, não força escuro. */
  readonly uiTheme: 'light' | 'dark'
  /**
   * Espaço ativo, para as abas escopadas (SPEC-Providers-01).
   *
   * Entra como prop em vez de o Settings ler `window.jarvis.getWorkspace()`: quem já sabe qual
   * espaço está ativo é o shell — duplicar a leitura criaria uma segunda fonte que pode
   * divergir da que pinta o resto da tela.
   */
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

const ROTULO_IDIOMA: Readonly<Record<Locale, string>> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)'
}

export function Settings({
  preferencias,
  erro,
  onSalvar,
  uiTheme,
  workspace,
  nomeDoEspaco
}: SettingsProps): React.JSX.Element {
  const { t } = useTranslation()

  const rotuloTema: Readonly<Record<ThemePreference, string>> = {
    claro: t('settings.temaClaro'),
    escuro: t('settings.temaEscuro'),
    sistema: t('settings.temaSistema')
  }

  return (
    <section aria-label={t('settings.titulo')} className="flex max-w-4xl flex-col gap-6">
      {erro && <InlineAlert tom="err" titulo={t(erro)} />}

      <Tabs
        padrao="geral"
        rotulo={t('settings.titulo')}
        abas={[
          { valor: 'geral', rotulo: t('settings.abaGeral') },
          { valor: 'permissoes', rotulo: t('settings.abaPermissoes') },
          { valor: 'ia', rotulo: t('settings.abaIa') },
          { valor: 'roteamento', rotulo: t('settings.abaRoteamento') },
          { valor: 'conectores', rotulo: t('settings.abaConectores') },
          { valor: 'voz', rotulo: t('settings.abaVoz') }
        ]}
      >
        <TabPanel valor="geral">
          {/*
           * Prosa e controles de preferência têm teto de medida próprio, mais estreito que o da
           * tela: um select de idioma com a largura de quatro colunas parece um campo de busca.
           */}
          <div className="flex max-w-md flex-col gap-8">
            <Field rotulo={t('settings.idioma')} descricao={t('settings.idiomaDescricao')}>
              {(atributos) => (
                <Select
                  {...atributos}
                  valor={preferencias.locale}
                  onMudar={(valor) => onSalvar({ locale: valor as Locale })}
                  opcoes={LOCALES.map((locale) => ({
                    valor: locale,
                    rotulo: ROTULO_IDIOMA[locale]
                  }))}
                />
              )}
            </Field>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium" id="settings-tema-titulo">
                {t('settings.tema')}
              </p>
              <p className="text-xs opacity-70">{t('settings.temaDescricao')}</p>
              <RadioGroup
                rotulo={t('settings.tema')}
                orientacao="horizontal"
                valor={preferencias.theme}
                onMudar={(valor) => onSalvar({ theme: valor as ThemePreference })}
                opcoes={THEME_PREFERENCES.map((tema) => ({
                  valor: tema,
                  rotulo: rotuloTema[tema]
                }))}
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium" id="settings-acento-titulo">
                {t('settings.acento')}
              </p>
              <p className="text-xs opacity-70">{t('settings.acentoDescricao')}</p>
              {/*
               * Um grupo por módulo, cada um reabrindo o provider com o seu acento — o mesmo
               * desenho da CHOICE. Reabrir é o que faz o swatch selecionado ler a identidade
               * certa sem `if` de cor aqui.
               */}
              <div aria-labelledby="settings-acento-titulo" className="flex flex-col gap-4 pt-1">
                {(['noa', 'jarvis'] as const).map((modulo) => (
                  <SeletorDeAcentoDoModulo
                    key={modulo}
                    modulo={modulo}
                    uiTheme={uiTheme}
                    valor={
                      (modulo === 'noa'
                        ? preferencias.accentNoa
                        : preferencias.accentJarvis) as CorAcento
                    }
                    onEscolher={(cor) =>
                      onSalvar(
                        modulo === 'noa'
                          ? { accentNoa: cor as AccentColor }
                          : { accentJarvis: cor as AccentColor }
                      )
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </TabPanel>

        {/* Permissões: a allowlist de diretórios é do usuário, como as preferências — o
            filesystem da máquina é o mesmo nos dois espaços. Aba própria, e não seção do Geral,
            porque permitir pasta é decisão de segurança, não de aparência. */}
        <TabPanel valor="permissoes">
          <DiretoriosPermitidos />
        </TabPanel>

        {/* Daqui para baixo, tudo é escopado ao espaço ativo. O orçamento vem antes do painel
            de chamada: quem vai disparar precisa ver o teto primeiro — depois, o número
            apareceria como explicação de um bloqueio já sofrido em vez de aviso antes dele. */}
        {/* A persona é do par usuário+espaço, como credenciais e orçamento — por isso mora aqui e
            não na aba `voz`, que é do usuário (SPEC-Voz-03). Vem primeiro porque é o que o
            operador ajusta com mais frequência; credencial e orçamento se configuram uma vez. */}
        <TabPanel valor="ia">
          <PersonaDoJarvis
            workspace={workspace}
            nomeDoEspaco={nomeDoEspaco}
            janela={preferencias.conversaJanela}
            onSalvarJanela={(conversaJanela) => onSalvar({ conversaJanela })}
          />
          <CredenciaisDoWorkspace workspace={workspace} nomeDoEspaco={nomeDoEspaco} />
          <OrcamentoDoWorkspace workspace={workspace} nomeDoEspaco={nomeDoEspaco} />
          <ChamadaDeIa workspace={workspace} nomeDoEspaco={nomeDoEspaco} />
        </TabPanel>

        <TabPanel valor="roteamento">
          <ProvidersDoWorkspace workspace={workspace} nomeDoEspaco={nomeDoEspaco} />
        </TabPanel>

        {/* A credencial vem antes do fluxo que a usa: quem chega aqui para configurar a Tavily
            precisa do campo de chave, não de um conector que recusa por falta dela. */}
        <TabPanel valor="conectores">
          <CredenciaisDeConector workspace={workspace} nomeDoEspaco={nomeDoEspaco} />
          <ConectorGitHub workspace={workspace} nomeDoEspaco={nomeDoEspaco} />
        </TabPanel>

        {/* Voz é do **usuário**, como Geral e Permissões: o microfone e o runtime são da
            máquina, e trocar de espaço não troca a voz de quem fala com ela. Por isso vem
            depois das abas escopadas, e não entre elas. */}
        <TabPanel valor="voz">
          <PreferenciasDeVoz preferencias={preferencias} onSalvar={onSalvar} />
        </TabPanel>
      </Tabs>
    </section>
  )
}

/**
 * Um seletor de acento por módulo, com o provider reaberto na identidade.
 *
 * Fora do componente principal porque monta o seu próprio `ProvedorDeTema` — o Settings roda no
 * shell (que já tem provider), mas cada grupo precisa do acento **do seu módulo** para o estado
 * selecionado do swatch aparecer na cor certa.
 */
function SeletorDeAcentoDoModulo({
  modulo,
  valor,
  uiTheme,
  onEscolher
}: {
  readonly modulo: Modulo
  readonly valor: CorAcento
  readonly uiTheme: 'light' | 'dark'
  readonly onEscolher: (cor: CorAcento) => void
}): React.JSX.Element {
  const id = identidade(modulo)

  return (
    <ProvedorDeTema
      modulo={modulo}
      uiTheme={uiTheme}
      accentJarvis={modulo === 'jarvis' ? valor : '#C4C4C4'}
      accentNoa={modulo === 'noa' ? valor : '#C4C4C4'}
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium opacity-80">{id.nome}</span>
        <AccentSwatchSelector
          valor={valor}
          onEscolher={onEscolher}
          rotulo={`Acento de ${id.nome}`}
        />
      </div>
    </ProvedorDeTema>
  )
}
