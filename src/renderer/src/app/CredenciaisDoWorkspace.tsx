import { useEffect, useState } from 'react'
import {
  CREDENTIAL_KEYS,
  type CredentialKey,
  type CredentialStatusView
} from '@shared/domain/credentials'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  ProviderSetup,
  RemoveCredentialDialog,
  StatusOperacional,
  type EstadoOperacional
} from '@design/patterns'
import { Button } from '@design/ui'
import { log } from '../lib/log'

/**
 * Credenciais de IA do espaço ativo (SPEC-Providers-01, critérios 4 e 8).
 *
 * A tela toda é construída sobre componentes que o design system já tinha — `ProviderSetup`,
 * `RemoveCredentialDialog` e a `MENSAGEM_BYOK` nasceram na SPEC-DS-04b **para esta tela** e
 * nunca haviam sido usados. Reusá-los é o que mantém a mensagem obrigatória do PRD §12.5
 * literal e o campo de chave com o comportamento certo (`autoComplete="off"`, estado local
 * limpo no submit).
 *
 * O que esta tela **não** faz, e é o critério 2: não recebe, não guarda e não exibe o valor de
 * credencial nenhuma. Depois de salva, o único caminho de volta seria um método na ponte que
 * devolvesse o segredo — e ele não existe. Por isso não há `MaskedCredentialSummary` aqui:
 * mostrar "•••• 3f9a" exigiria que os últimos quatro caracteres atravessassem o IPC, e a
 * `CredentialStatusView` não tem campo onde eles caibam.
 *
 * **Escopada pelo espaço ativo**: NOA e JARVIS têm credenciais próprias. O cabeçalho diz de
 * qual espaço a lista é — sem isso, o usuário configuraria a chave num espaço achando que
 * configurou nos dois.
 */

interface CredenciaisProps {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

/** O estado operacional que o DS pinta a partir do status da credencial. */
function estadoDe(credencial: CredentialStatusView | undefined): EstadoOperacional {
  if (credencial === undefined || credencial.status === 'missing') return 'inativo'
  return 'ativo'
}

/**
 * O que a linha diz sobre a origem. `env` merece nota própria: a credencial está presente, mas
 * o usuário não a gerencia por aqui — e sem essa distinção ele tentaria remover uma chave que
 * o app não pode apagar.
 */
function descricaoDe(credencial: CredentialStatusView | undefined): string {
  if (credencial === undefined || credencial.status === 'missing') {
    return 'Nenhuma chave configurada para este espaço.'
  }
  return credencial.source === 'env'
    ? 'Definida por variável de ambiente (somente leitura).'
    : 'Guardada cifrada neste dispositivo.'
}

export function CredenciaisDoWorkspace({
  workspace,
  nomeDoEspaco
}: CredenciaisProps): React.JSX.Element {
  const [credenciais, setCredenciais] = useState<readonly CredentialStatusView[]>([])
  const [emEdicao, setEmEdicao] = useState<CredentialKey | null>(null)
  const [aRemover, setARemover] = useState<CredentialKey | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  /*
   * Recarrega ao trocar de espaço: a lista é do espaço ativo, e manter a anterior mostraria o
   * status do NOA sob o cabeçalho do JARVIS.
   *
   * Mesmo desenho do `AprovacoesPendentes`: a promise no corpo do efeito com uma flag `ativo`,
   * e não um `async` chamado de dentro dele. Sem a flag, trocar de espaço duas vezes rápido
   * deixaria a resposta da primeira consulta chegar depois da segunda e sobrescrever a lista
   * certa pela antiga.
   */
  useEffect(() => {
    let ativo = true

    window.jarvis
      .listCredentials(workspace)
      .then((lista) => {
        if (!ativo) return
        setErro(null)
        setCredenciais(lista)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        // Mensagem de produto, não `error.message`: o que quebrou aqui é o IPC, e o texto do
        // erro técnico não ajuda quem está tentando colar uma chave.
        setErro('Não foi possível ler as credenciais deste espaço.')
        log.ui.error('Falha ao listar credenciais', { workspace, error })
      })

    return () => {
      ativo = false
    }
  }, [workspace])

  async function salvar(key: CredentialKey, chave: string): Promise<void> {
    try {
      setCredenciais(await window.jarvis.setCredential(key, chave, workspace))
      setEmEdicao(null)
      setErro(null)
    } catch (error) {
      setErro('Não foi possível salvar a chave.')
      // Sem a chave no contexto: o log registra a falha e o provider, nunca o valor.
      log.ui.error('Falha ao salvar credencial', { key, workspace, error })
    }
  }

  async function remover(key: CredentialKey): Promise<void> {
    try {
      setCredenciais(await window.jarvis.removeCredential(key, workspace))
      setARemover(null)
      setErro(null)
    } catch (error) {
      setErro('Não foi possível remover a chave.')
      log.ui.error('Falha ao remover credencial', { key, workspace, error })
    }
  }

  const alvoDaRemocao = credenciais.find((c) => c.key === aRemover)

  return (
    <section aria-label="Credenciais de IA" className="flex flex-col gap-3">
      <p className="text-sm font-medium" id="settings-credenciais-titulo">
        Credenciais de IA
      </p>
      <p className="text-xs opacity-70">
        Chaves de {nomeDoEspaco}. Cada espaço tem as suas — configurar aqui não afeta o outro.
      </p>

      {erro && (
        <p role="alert" className="text-sm text-rose-400">
          {erro}
        </p>
      )}

      <ul aria-labelledby="settings-credenciais-titulo" className="flex flex-col gap-3 pt-1">
        {CREDENTIAL_KEYS.map((key) => {
          const credencial = credenciais.find((c) => c.key === key)
          const ausente = credencial === undefined || credencial.status === 'missing'
          const doEnv = credencial?.source === 'env'

          return (
            <li
              key={key}
              data-jos-credencial={key}
              className="flex flex-col gap-2 rounded-md border border-current/15 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{credencial?.provider ?? key}</span>
                <StatusOperacional
                  estado={estadoDe(credencial)}
                  rotulo={ausente ? 'Não configurada' : 'Configurada'}
                  descricao={descricaoDe(credencial)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variante="secundaria"
                  onClick={() => setEmEdicao(emEdicao === key ? null : key)}
                >
                  {emEdicao === key ? 'Cancelar' : ausente ? 'Configurar' : 'Substituir chave'}
                </Button>
                {/*
                 * Remover só aparece quando há algo no vault para remover. Com a credencial
                 * vindo só do `.env`, o botão prometeria uma ação que o app não faz — o env é
                 * read-only, e apagar linha de arquivo de configuração do usuário por trás
                 * dele não é comportamento desta tela.
                 */}
                {!ausente && !doEnv && (
                  <Button variante="perigo" onClick={() => setARemover(key)}>
                    Remover
                  </Button>
                )}
              </div>

              {emEdicao === key && (
                <ProviderSetup
                  provider={credencial?.provider ?? key}
                  onSalvar={(chave) => void salvar(key, chave)}
                />
              )}
            </li>
          )
        })}
      </ul>

      {aRemover !== null && (
        <RemoveCredentialDialog
          aberto
          provider={alvoDaRemocao?.provider ?? aRemover}
          /*
           * Zero, e não um número calculado: nesta fatia nada consome credencial ainda — os
           * adapters chegam na F02. O contrato do DS exige o número inclusive quando é zero,
           * porque "nenhuma execução será afetada" é informação, e omiti-la deixaria o usuário
           * supondo. Quando a F02 existir, é aqui que o número real entra.
           */
          execucoesAfetadas={0}
          onRemover={() => void remover(aRemover)}
          onCancelar={() => setARemover(null)}
        />
      )}

      {/*
       * Com a credencial vindo do `.env`, dizer que remover a devolve ao env seria confuso num
       * lugar onde o botão de remover nem aparece. A nota vive na descrição da linha.
       */}
    </section>
  )
}
