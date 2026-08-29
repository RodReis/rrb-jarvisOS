import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, ErrorState, InlineAlert, LoadingState, Tag } from '@design/ui'
import { log } from '../lib/log'

/**
 * Diretórios permitidos (SPEC-ExecucaoReal-03).
 *
 * A tela que faltava: os canais da allowlist existiam desde o MVP-002 e nenhuma tela os
 * usava, então pelo aplicativo o usuário não conseguia permitir pasta nenhuma — e sem isso o
 * terminal recusa todo cwd, porque ele sempre cai fora da lista.
 *
 * Mora em **Settings** (decisão 1 do PI) porque a allowlist governa filesystem e terminal ao
 * mesmo tempo; a allowlist de **comandos** ficou no painel do terminal por ser só dele.
 *
 * Duas garantias moram na fronteira, não aqui:
 *  - **O renderer nunca toca o filesystem.** Até escolher a pasta acontece no main: este
 *    componente chama `pickAllowedDirectory()` e recebe a lista de volta. Não há caminho por
 *    onde um handle de arquivo chegue à tela.
 *  - **A tela nunca canoniza nem valida path.** Ela exibe o que o main gravou — que é o
 *    ponto do critério 7: o usuário vê exatamente o caminho canônico que permitiu, não o que
 *    o seletor mostrou.
 */

export function DiretoriosPermitidos(): React.JSX.Element {
  const { t } = useTranslation()
  const [diretorios, setDiretorios] = useState<readonly string[]>([])
  const [appDir, setAppDir] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  /**
   * Dois erros, não um — é a distinção que o DS faz entre `ErrorState` e `InlineAlert`.
   *
   * Falhar ao **carregar** significa que a lista não existe: o conteúdo é substituído, porque
   * mostrar uma lista vazia ao lado do aviso diria "nenhuma pasta permitida" quando o certo é
   * "não sabemos quais são" — e o botão de permitir agiria às cegas sobre um estado desconhecido.
   *
   * Falhar numa **ação** é outra coisa: a lista está na tela e continua correta, só a operação
   * não foi. Aí o aviso é uma faixa sobre o conteúdo, que permanece.
   */
  const [erroAoCarregar, setErroAoCarregar] = useState<string | null>(null)
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null)
  /** Trava o botão enquanto o diálogo nativo está aberto — ele é modal, mas a tela não. */
  const [ocupado, setOcupado] = useState(false)

  /*
   * Uma carga só, com a flag `ativo` do mesmo desenho do `CredenciaisDoWorkspace`: sem ela,
   * desmontar durante a promise deixaria um `setState` em componente já fora da árvore.
   *
   * As duas leituras vão juntas num `Promise.all` porque a lista sozinha não basta — sem o
   * `appDir` a tela não sabe qual item é o fixo, e renderizar a lista antes dele faria o
   * rótulo "Fixo" aparecer num segundo passo, piscando.
   */
  useEffect(() => {
    let ativo = true

    Promise.all([window.jarvis.listAllowedDirectories(), window.jarvis.getAppDirectory()])
      .then(([lista, dirDoApp]) => {
        if (!ativo) return
        setDiretorios(lista)
        setAppDir(dirDoApp)
        setErroAoCarregar(null)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        setErroAoCarregar(t('settings.diretoriosErro'))
        log.ui.error('Falha ao listar diretórios permitidos', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [t])

  async function permitir(): Promise<void> {
    setOcupado(true)
    try {
      // Cancelar o diálogo cai aqui também: o main devolve a lista inalterada, e reatribuí-la
      // é um no-op. É o critério 3 — não há ramo de "cancelou" a tratar na tela.
      setDiretorios(await window.jarvis.pickAllowedDirectory())
      setErroDaAcao(null)
    } catch (error) {
      setErroDaAcao(t('settings.diretoriosErroAdicionar'))
      log.ui.error('Falha ao permitir diretório', { error })
    } finally {
      setOcupado(false)
    }
  }

  async function remover(caminho: string): Promise<void> {
    try {
      setDiretorios(await window.jarvis.removeAllowedDirectory(caminho))
      setErroDaAcao(null)
    } catch (error) {
      setErroDaAcao(t('settings.diretoriosErroRemover'))
      log.ui.error('Falha ao remover diretório', { error })
    }
  }

  const botaoPermitir = (
    <Button variante="secundaria" onClick={() => void permitir()} desabilitado={ocupado}>
      {t('settings.diretoriosAdicionar')}
    </Button>
  )

  // Só o `appDir` na lista é o vazio real desta tela: tem uma linha, mas o usuário ainda não
  // permitiu nada, e é exatamente o estado em que o terminal recusa tudo.
  const semEscolhaDoUsuario = diretorios.length === 1 && diretorios[0] === appDir

  return (
    <section aria-label={t('settings.diretorios')} className="flex flex-col gap-3">
      <p className="text-sm font-medium" id="settings-diretorios-titulo">
        {t('settings.diretorios')}
      </p>
      <p className="text-xs opacity-70">{t('settings.diretoriosDescricao')}</p>

      {erroDaAcao !== null && <InlineAlert tom="err" titulo={erroDaAcao} />}

      {carregando ? (
        <LoadingState rotulo={t('settings.diretoriosCarregando')} />
      ) : erroAoCarregar !== null ? (
        <ErrorState titulo={erroAoCarregar} descricao={t('settings.diretoriosErroDescricao')} />
      ) : semEscolhaDoUsuario ? (
        <EmptyState
          titulo={t('settings.diretoriosVazio')}
          descricao={t('settings.diretoriosVazioDescricao')}
          acao={botaoPermitir}
        />
      ) : (
        <>
          <ul aria-labelledby="settings-diretorios-titulo" className="flex flex-col gap-2 pt-1">
            {diretorios.map((caminho) => {
              const fixo = caminho === appDir

              return (
                <li
                  key={caminho}
                  data-jos-diretorio={caminho}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-current/15 p-3"
                >
                  {/* `break-all`: caminho longo não tem espaço onde quebrar, e sem isso ele
                      estoura a largura da seção em vez de continuar na linha de baixo. */}
                  <span className="break-all text-sm">{caminho}</span>

                  {fixo ? (
                    <Tag>{t('settings.diretoriosFixo')}</Tag>
                  ) : (
                    <Button
                      variante="perigo"
                      onClick={() => void remover(caminho)}
                      /* O nome acessível carrega o caminho: numa lista de botões "Remover"
                         idênticos, o leitor de tela não diria qual pasta cada um remove. */
                      aria-label={t('settings.diretoriosRemoverDe', { caminho })}
                    >
                      {t('settings.diretoriosRemover')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>

          <p className="text-xs opacity-70">{t('settings.diretoriosFixoMotivo')}</p>
          <div>{botaoPermitir}</div>
        </>
      )}
    </section>
  )
}
