import { useEffect, useState } from 'react'
import {
  CONNECTOR_CREDENTIAL_KEYS,
  type ConnectorCredentialKey,
  type ConnectorCredentialStatusView
} from '@shared/domain/connectors'
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
 * Credenciais de **conector** do espaço ativo (SPEC-Conectores-05, critério 7).
 *
 * Seção própria e não linhas acrescentadas à `CredenciaisDoWorkspace`, pela mesma razão que as
 * chaves são um conjunto próprio (decisão do PI de 2026-08-29): as duas taxonomias respondem a
 * listas diferentes, e misturá-las faria a lista de IA anunciar conectores e vice-versa. O que se
 * reusa é o que deve ser reusado — os componentes do design system —, não a lista.
 *
 * O que esta tela **não** faz, e é a mesma garantia da M5-F01: não recebe, não guarda e não exibe
 * o valor de credencial nenhuma. Depois de salva, o caminho de volta seria um método na ponte que
 * devolvesse o segredo, e ele não existe — `ConnectorCredentialStatusView` não tem campo onde ele
 * caiba.
 *
 * **O GitHub aparece, mas sem campo de chave.** A credencial dele nasce do Device Flow (F03), e
 * um campo de texto ao lado convidaria o usuário a colar um valor que nada consumiria. Aparecer
 * na lista é o que importa: o critério pede que o estado seja *visível*, e omitir o conector
 * faria a tela mentir por ausência.
 */

interface CredenciaisDeConectorProps {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

function estadoDe(credencial: ConnectorCredentialStatusView | undefined): EstadoOperacional {
  return credencial === undefined || credencial.status === 'missing' ? 'inativo' : 'ativo'
}

function descricaoDe(credencial: ConnectorCredentialStatusView | undefined): string {
  if (credencial === undefined || credencial.status === 'missing') {
    return credencial?.gerenciavel === false
      ? 'Conecte a conta pelo fluxo do conector abaixo.'
      : 'Nenhuma chave configurada para este espaço.'
  }
  return 'Guardada cifrada neste dispositivo.'
}

export function CredenciaisDeConector({
  workspace,
  nomeDoEspaco
}: CredenciaisDeConectorProps): React.JSX.Element {
  const [credenciais, setCredenciais] = useState<readonly ConnectorCredentialStatusView[]>([])
  const [emEdicao, setEmEdicao] = useState<ConnectorCredentialKey | null>(null)
  const [aRemover, setARemover] = useState<ConnectorCredentialKey | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  /*
   * Recarrega ao trocar de espaço, com a flag `ativo` do mesmo desenho das outras telas: sem
   * ela, trocar de espaço duas vezes rápido deixaria a resposta da primeira consulta chegar
   * depois da segunda e sobrescrever a lista certa pela antiga.
   */
  useEffect(() => {
    let ativo = true

    window.jarvis
      .listConnectorCredentials(workspace)
      .then((lista) => {
        if (!ativo) return
        setErro(null)
        setCredenciais(lista)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        setErro('Não foi possível ler as credenciais de conector deste espaço.')
        log.ui.error('Falha ao listar credenciais de conector', { workspace, error })
      })

    return () => {
      ativo = false
    }
  }, [workspace])

  async function salvar(key: ConnectorCredentialKey, chave: string): Promise<void> {
    try {
      setCredenciais(await window.jarvis.setConnectorCredential(key, chave, workspace))
      setEmEdicao(null)
      setErro(null)
    } catch (error) {
      setErro('Não foi possível salvar a chave.')
      // Sem a chave no contexto: o log registra a falha e o conector, nunca o valor.
      log.ui.error('Falha ao salvar credencial de conector', { key, workspace, error })
    }
  }

  async function remover(key: ConnectorCredentialKey): Promise<void> {
    try {
      setCredenciais(await window.jarvis.removeConnectorCredential(key, workspace))
      setARemover(null)
      setErro(null)
    } catch (error) {
      setErro('Não foi possível remover a chave.')
      log.ui.error('Falha ao remover credencial de conector', { key, workspace, error })
    }
  }

  const alvoDaRemocao = credenciais.find((c) => c.key === aRemover)

  return (
    <section aria-label="Credenciais de conector" className="flex flex-col gap-3">
      <p className="text-sm font-medium" id="settings-conector-credenciais-titulo">
        Credenciais de conector
      </p>
      <p className="text-xs opacity-70">
        Chaves de serviços externos em {nomeDoEspaco}. Contam créditos próprios, separados do
        orçamento de IA.
      </p>

      {erro && (
        <p role="alert" className="text-sm text-rose-400">
          {erro}
        </p>
      )}

      <ul
        aria-labelledby="settings-conector-credenciais-titulo"
        className="flex flex-col gap-3 pt-1"
      >
        {CONNECTOR_CREDENTIAL_KEYS.map((key) => {
          const credencial = credenciais.find((c) => c.key === key)
          const ausente = credencial === undefined || credencial.status === 'missing'
          const gerenciavel = credencial?.gerenciavel ?? key !== 'github'

          return (
            <li
              key={key}
              data-jos-credencial-conector={key}
              className="flex flex-col gap-2 rounded-md border border-current/15 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{credencial?.conector ?? key}</span>
                <StatusOperacional
                  estado={estadoDe(credencial)}
                  rotulo={ausente ? 'Não configurada' : 'Configurada'}
                  descricao={descricaoDe(credencial)}
                />
              </div>

              {/*
               * Os botões só existem para a credencial cadastrável por chave. Para a que vem do
               * Device Flow, o caminho é o próprio fluxo do conector — e oferecer "Configurar"
               * aqui levaria a um campo de texto que grava por cima do par access/refresh.
               */}
              {gerenciavel && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variante="secundaria"
                    onClick={() => setEmEdicao(emEdicao === key ? null : key)}
                  >
                    {emEdicao === key ? 'Cancelar' : ausente ? 'Configurar' : 'Substituir chave'}
                  </Button>
                  {!ausente && (
                    <Button variante="perigo" onClick={() => setARemover(key)}>
                      Remover
                    </Button>
                  )}
                </div>
              )}

              {gerenciavel && emEdicao === key && (
                <ProviderSetup
                  provider={credencial?.conector ?? key}
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
          provider={alvoDaRemocao?.conector ?? aRemover}
          /*
           * Zero: nada nesta fatia mantém execução em andamento sobre um conector — a chamada é
           * síncrona do ponto de vista do usuário, e remover a chave afeta as próximas, não uma
           * fila. O contrato do DS exige o número inclusive quando é zero, porque "nenhuma
           * execução será afetada" é informação.
           */
          execucoesAfetadas={0}
          onRemover={() => void remover(aRemover)}
          onCancelar={() => setARemover(null)}
        />
      )}
    </section>
  )
}
