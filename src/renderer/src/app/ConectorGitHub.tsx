import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ConnectorError } from '@shared/domain/connectors'
import type { GithubAuthSnapshot, GithubDeviceFlowView } from '@shared/domain/github-auth'
import { StatusOperacional, type EstadoOperacional } from '@design/patterns'
import { Button, Field, Input, InlineAlert, Panel, Tag } from '@design/ui'
import { log } from '../lib/log'

/**
 * Conexão com o GitHub por Device Flow (SPEC-Conectores-03, critério 9).
 *
 * A UI mínima que a spec pede: mostra URL, código, expiração e progresso do polling; permite
 * cancelar; e informa o estado do conector sem exibir token. **Não** existe caminho por onde o
 * token chegasse aqui — a ponte não tem método que o devolva, e `GithubAuthSnapshot` não tem
 * campo onde ele caiba. A garantia é da forma dos tipos, não da disciplina desta tela.
 *
 * O código de usuário é o **único** dado de destaque, e por isso ele é o maior elemento do
 * painel: o usuário vai lê-lo de relance e digitá-lo noutro dispositivo. Errar um caractere
 * custa um fluxo inteiro, então ele ganha `tabular-nums`, tracking largo e um botão de copiar —
 * as três coisas que reduzem erro de transcrição. É a exceção deliberada à densidade do resto
 * do Settings, e ela dura só enquanto o fluxo está aberto.
 *
 * **Escopado pelo espaço ativo**, como as credenciais de IA: a credencial do GitHub é do
 * JARVIS OS, e no NOA ela simplesmente aparece como não conectada — sem erro e sem bloqueio
 * (spec § decisões cravadas).
 */

interface ConectorGitHubProps {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

/** O desfecho de uma chamada da ponte que pode devolver erro normalizado. */
function ehErro(valor: unknown): valor is ConnectorError {
  return typeof valor === 'object' && valor !== null && (valor as { ok?: unknown }).ok === false
}

const ESTADO_VISUAL: Readonly<
  Record<GithubAuthSnapshot['estado'], { operacional: EstadoOperacional; rotulo: string }>
> = {
  present: { operacional: 'ativo', rotulo: 'Conectado' },
  expirado: { operacional: 'degradado', rotulo: 'Sessão expirada' },
  missing: { operacional: 'inativo', rotulo: 'Não conectado' }
}

/** Quanto falta, em minutos — o número que decide se dá tempo de ir buscar o telefone. */
function minutosRestantes(expiraEm: string, agora: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiraEm) - agora) / 60_000))
}

export function ConectorGitHub({
  workspace,
  nomeDoEspaco
}: ConectorGitHubProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GithubAuthSnapshot | null>(null)
  const [fluxo, setFluxo] = useState<GithubDeviceFlowView | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [clientId, setClientId] = useState('')
  const [copiado, setCopiado] = useState(false)
  /**
   * O relógio da contagem regressiva, em estado.
   *
   * Estado e não `Date.now()` lido no render, por duas razões que se somam: ler o relógio
   * durante o render é impuro (o mesmo render produziria saídas diferentes), e o valor precisa
   * mudar sozinho para a contagem andar. O inicializador é preguiçoso — `useState(() => …)` —
   * então o relógio é lido **uma vez**, na montagem, e não a cada render.
   */
  const [agora, setAgora] = useState(() => Date.now())

  /*
   * Mesma flag `ativo` do `CredenciaisDoWorkspace`: trocar de espaço duas vezes rápido deixaria
   * a resposta da primeira consulta chegar depois da segunda e sobrescrever o estado certo pelo
   * antigo.
   */
  const carregar = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await window.jarvis.getGithubAuthStatus(workspace))
    } catch (error) {
      setErro('Não foi possível ler o estado da conexão com o GitHub.')
      log.ui.error('Falha ao ler status do GitHub', { workspace, error })
    }
  }, [workspace])

  useEffect(() => {
    let ativo = true

    window.jarvis
      .getGithubAuthStatus(workspace)
      .then((estado) => {
        if (!ativo) return
        setErro(null)
        setSnapshot(estado)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        setErro('Não foi possível ler o estado da conexão com o GitHub.')
        log.ui.error('Falha ao ler status do GitHub', { workspace, error })
      })

    return () => {
      ativo = false
      // Trocar de espaço encerra o fluxo em andamento: o código pertence ao escopo em que foi
      // aberto, e deixá-lo na tela sob outro cabeçalho faria o usuário autorizar no lugar
      // errado. No **cleanup** e não no corpo do efeito: ali seria `setState` síncrono num
      // render, e o efeito de limpeza é justamente o lugar onde "o espaço anterior acabou" é o
      // fato que está acontecendo.
      setFluxo(null)
    }
  }, [workspace])

  /*
   * O relógio só corre enquanto há fluxo aberto. Um intervalo permanente redesenharia o painel
   * a cada minuto para sempre, e o que ele mede — o prazo do código — só existe durante o fluxo.
   */
  useEffect(() => {
    if (fluxo === null) return

    // O carimbo é gerado **dentro** do callback do intervalo, nunca no corpo do efeito: é o
    // que mantém o efeito livre de `setState` síncrono (cascata de render) sem deixar a
    // contagem parada.
    const id = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [fluxo])

  async function conectar(): Promise<void> {
    setOcupado(true)
    setErro(null)
    setCopiado(false)

    try {
      const abertura = await window.jarvis.startGithubAuth(workspace)

      if (ehErro(abertura)) {
        setErro(abertura.mensagem)
        return
      }

      setFluxo(abertura)

      // A espera é longa por natureza (o usuário vai ao navegador). O `await` continua aqui e o
      // painel segue interativo — o botão Cancelar é o que dá saída, e ele não depende deste
      // await ter terminado.
      const desfecho = await window.jarvis.awaitGithubAuth(workspace)
      setFluxo(null)

      if (ehErro(desfecho)) {
        setErro(desfecho.mensagem)
        await carregar()
        return
      }

      setSnapshot(desfecho)
    } catch (error) {
      setFluxo(null)
      setErro('A conexão com o GitHub falhou.')
      log.ui.error('Falha no Device Flow do GitHub', { workspace, error })
    } finally {
      setOcupado(false)
    }
  }

  async function cancelar(): Promise<void> {
    try {
      await window.jarvis.cancelGithubAuth(workspace)
    } catch (error) {
      log.ui.error('Falha ao cancelar o Device Flow', { workspace, error })
    }
  }

  async function desconectar(): Promise<void> {
    setOcupado(true)
    try {
      setSnapshot(await window.jarvis.logoutGithub(workspace))
      setErro(null)
    } catch (error) {
      setErro('Não foi possível desconectar a conta.')
      log.ui.error('Falha ao desconectar o GitHub', { workspace, error })
    } finally {
      setOcupado(false)
    }
  }

  async function salvarClientId(): Promise<void> {
    setOcupado(true)
    try {
      setSnapshot(await window.jarvis.setGithubClientId(clientId, workspace))
      setClientId('')
      setErro(null)
    } catch (error) {
      setErro('Não foi possível salvar o client ID.')
      log.ui.error('Falha ao salvar client ID do GitHub', { workspace, error })
    } finally {
      setOcupado(false)
    }
  }

  async function copiarCodigo(codigo: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(codigo)
      setCopiado(true)
    } catch {
      // Área de transferência negada não é erro do fluxo: o código está na tela e pode ser
      // digitado. Avisar aqui roubaria a atenção do que importa.
      setCopiado(false)
    }
  }

  const visual = ESTADO_VISUAL[snapshot?.estado ?? 'missing']
  const conectado = snapshot?.estado === 'present'
  const semClientId = snapshot !== null && !snapshot.clientIdConfigurado

  return (
    <Panel titulo={`GitHub · ${nomeDoEspaco}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusOperacional
            estado={visual.operacional}
            rotulo={visual.rotulo}
            descricao={
              snapshot?.estado === 'present' && snapshot.expiraEm !== undefined
                ? snapshot.renovavel
                  ? 'A sessão se renova sozinha antes de vencer.'
                  : 'A sessão vence e precisará de nova conexão.'
                : undefined
            }
          />
          {snapshot?.estado === 'expirado' && <Tag>Reconecte para continuar</Tag>}
        </div>

        {erro !== null && (
          <InlineAlert tom="err" titulo="Conexão com o GitHub">
            {erro}
          </InlineAlert>
        )}

        {/*
         * O client ID vem antes de tudo quando falta: sem ele o botão Conectar só produziria a
         * mesma recusa, e oferecer uma ação que não pode dar certo é pior que explicar o que
         * falta. Com ele configurado, o campo sai da frente e vira ajuste secundário.
         */}
        {semClientId && (
          <InlineAlert tom="warn" titulo="Falta o client ID da GitHub App">
            Informe o client ID de uma GitHub App com Device Flow habilitado. Ele é público — não é
            uma senha, e não é guardado no cofre de credenciais.
          </InlineAlert>
        )}

        {fluxo === null ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void conectar()} desabilitado={ocupado || semClientId}>
              {conectado ? 'Reconectar' : 'Conectar ao GitHub'}
            </Button>
            {snapshot !== null && snapshot.estado !== 'missing' && (
              <Button
                variante="secundaria"
                onClick={() => void desconectar()}
                desabilitado={ocupado}
              >
                Desconectar
              </Button>
            )}
          </div>
        ) : (
          <div
            data-jos-github-fluxo="aberto"
            className="flex flex-col gap-3 rounded-md border border-current/15 p-4"
          >
            <p className="text-sm">
              Abra{' '}
              <a
                href={fluxo.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {fluxo.verificationUri}
              </a>{' '}
              e informe o código abaixo.
            </p>

            {/*
             * O código é o elemento que o usuário transcreve. `tabular-nums` mantém a largura de
             * cada caractere estável e `tracking-[0.25em]` separa os grupos — as duas coisas que
             * evitam confundir caracteres parecidos ao digitar noutro dispositivo.
             */}
            <div className="flex flex-wrap items-center gap-3">
              <output
                data-jos-github-codigo
                className="font-mono text-2xl font-semibold tabular-nums tracking-[0.25em]"
              >
                {fluxo.userCode}
              </output>
              <Button variante="secundaria" onClick={() => void copiarCodigo(fluxo.userCode)}>
                {copiado ? 'Copiado' : 'Copiar código'}
              </Button>
            </div>

            {/*
             * `role="status"` e não um spinner: o que informa o progresso aqui é o texto que
             * muda de minuto em minuto, e um leitor de tela precisa ouvir a mudança. Um spinner
             * girando diria "algo acontece" sem dizer quanto tempo resta.
             */}
            <p role="status" className="text-xs opacity-70">
              Aguardando a autorização no navegador… O código vale por mais{' '}
              {minutosRestantes(fluxo.expiraEm, agora)} min.
            </p>

            <div>
              <Button variante="secundaria" onClick={() => void cancelar()}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/*
         * O override fica no fim e sem cerimônia: quem usa a GitHub App do projeto nunca precisa
         * dele. Colocá-lo em destaque sugeriria que configurar é obrigatório, quando o desenho é
         * o contrário — funcionar sem configuração é o critério 7.
         */}
        <Field
          rotulo="Client ID da GitHub App (opcional)"
          descricao="Sobrepõe o client ID de fábrica. Deixe em branco para voltar ao padrão."
        >
          {(atributos) => (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Input
                  {...atributos}
                  valor={clientId}
                  onMudar={setClientId}
                  placeholder="Iv1.0123456789abcdef"
                  autoComplete="off"
                  desabilitado={ocupado}
                />
              </div>
              <Button
                variante="secundaria"
                onClick={() => void salvarClientId()}
                desabilitado={ocupado}
              >
                Salvar
              </Button>
            </div>
          )}
        </Field>
      </div>
    </Panel>
  )
}
