import { useEffect, useState } from 'react'
import type { CommandExecution, CommandReason } from '@shared/domain/terminal'
import { Button, Card, Field, InlineAlert, Input } from '@design/ui'
import { LogViewer, StatusOperacional, type EstadoOperacional } from '@design/patterns'
import { log } from '../lib/log'

/**
 * Painel do terminal controlado (SPEC-ExecucaoReal-02, critério 10).
 *
 * **Binário e argumentos em campos separados** — não é escolha estética, é a barreira. Um
 * campo único de linha de comando exigiria tokenizar no main e rejeitar metacaracteres; com
 * campos separados o comando roda com `shell: false` e `;`/`&&`/`$()` chegam ao processo como
 * texto literal. A forma da UI é o que fecha a superfície de injeção.
 *
 * O renderer **não decide nada**: submete, mostra o que voltou. Allowlist, denylist, timeout
 * e aprovação vivem no main; aqui não há cópia dessas regras para divergir da original.
 */

/** Estado operacional do DS por desfecho — a UI nunca inventa vocabulário próprio. */
const ESTADO_POR_COMANDO: Readonly<Record<CommandExecution['state'], EstadoOperacional>> = {
  'aguardando-aprovacao': 'executando',
  concluido: 'ativo',
  falhou: 'erro',
  bloqueado: 'inativo'
}

const ROTULO_POR_ESTADO: Readonly<Record<CommandExecution['state'], string>> = {
  'aguardando-aprovacao': 'Aguardando aprovação',
  concluido: 'Concluído',
  falhou: 'Falhou',
  bloqueado: 'Bloqueado'
}

/**
 * Texto do motivo, em linguagem de usuário. Mapeado do enum do contrato — nunca a string
 * técnica direto na tela, e nunca `error.message` cru: o usuário precisa saber *o que fazer*,
 * e "ENOENT" não diz isso.
 */
const TEXTO_POR_MOTIVO: Readonly<Record<CommandReason, string>> = {
  'binario-fora-da-allowlist':
    'Este comando não está na lista de permitidos deste espaço. Adicione-o abaixo para poder executá-lo.',
  'cwd-fora-da-allowlist':
    'O diretório de trabalho está fora dos diretórios permitidos. Ajuste-o ou permita o diretório nas configurações.',
  'elevacao-negada': 'Execução com privilégio elevado não é permitida.',
  'bloqueado-pela-politica': 'A política de segurança bloqueou este comando.',
  'aguardando-aprovacao-destrutivo':
    'Comando potencialmente destrutivo: pausado até uma decisão humana em Operações.',
  'aprovacao-negada': 'A aprovação foi negada; o comando não foi executado.',
  executado: 'Comando executado.',
  'timeout-excedido': 'O comando excedeu o tempo limite e foi encerrado.',
  'falha-na-execucao': 'O comando falhou durante a execução.'
}

/**
 * Divide os argumentos por espaço.
 *
 * Separação **por espaço apenas** — sem aspas, sem escape. Deliberado: quanto mais esperto
 * este parser, mais perto ele chega de ser um mini-shell no renderer, que é exatamente o que
 * a fatia evita. Argumento com espaço é caso que a fatia não cobre; quando aparecer um uso
 * real, vira campo de lista, não sintaxe.
 */
function dividirArgumentos(texto: string): readonly string[] {
  return texto.split(/\s+/).filter((parte) => parte.length > 0)
}

export function TerminalControlado({
  workspace
}: {
  readonly workspace: 'noa' | 'jarvis'
}): React.JSX.Element {
  const [binario, setBinario] = useState('')
  const [argumentos, setArgumentos] = useState('')
  const [cwd, setCwd] = useState('')
  const [permitidos, setPermitidos] = useState<readonly string[]>([])
  const [novoPermitido, setNovoPermitido] = useState('')
  const [execucao, setExecucao] = useState<CommandExecution | null>(null)
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    window.jarvis
      .listAllowedCommands(workspace)
      .then((lista) => {
        if (ativo) setPermitidos(lista)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        setErro('Não foi possível carregar a lista de comandos permitidos.')
        log.ui.error('Falha ao listar comandos permitidos', { workspace, error })
      })

    return () => {
      ativo = false
    }
  }, [workspace])

  async function executar(): Promise<void> {
    if (binario.trim().length === 0 || cwd.trim().length === 0) return

    try {
      setErro(null)
      setExecutando(true)
      const resultado = await window.jarvis.runCommand(
        { binary: binario.trim(), args: dividirArgumentos(argumentos), cwd: cwd.trim() },
        workspace
      )
      setExecucao(resultado)
    } catch (error) {
      setErro('Não foi possível submeter o comando.')
      log.ui.error('Falha ao submeter comando', { workspace, error })
    } finally {
      setExecutando(false)
    }
  }

  async function permitir(): Promise<void> {
    if (novoPermitido.trim().length === 0) return

    try {
      setErro(null)
      setPermitidos(await window.jarvis.addAllowedCommand(novoPermitido.trim(), workspace))
      setNovoPermitido('')
    } catch (error) {
      setErro('Não foi possível permitir o comando.')
      log.ui.error('Falha ao permitir comando', { workspace, error })
    }
  }

  async function revogar(alvo: string): Promise<void> {
    try {
      setErro(null)
      setPermitidos(await window.jarvis.removeAllowedCommand(alvo, workspace))
    } catch (error) {
      setErro('Não foi possível revogar o comando.')
      log.ui.error('Falha ao revogar comando', { workspace, error })
    }
  }

  // A saída do terminal junta stdout e stderr numa leitura só, como um terminal de verdade —
  // e o `LogViewer` já redige segredo antes de pintar (SPEC-DS-04b).
  //
  // A última linha carrega o **fato técnico** (código de saída e duração, ou o estado quando
  // não houve processo), não a explicação: essa já está no `StatusOperacional` logo acima.
  // Repetir a mesma frase nos dois lugares faria o usuário lê-la duas vezes e o leitor de tela
  // anunciá-la em duplicidade.
  const linhasDaSaida = execucao
    ? [
        `$ ${execucao.binary}${execucao.args.length > 0 ? ` ${execucao.args.join(' ')}` : ''}`,
        `# ${execucao.cwd}`,
        ...(execucao.stdout ? execucao.stdout.split('\n') : []),
        ...(execucao.stderr ? execucao.stderr.split('\n') : []),
        execucao.exitCode === null
          ? `# ${ROTULO_POR_ESTADO[execucao.state].toLowerCase()} em ${execucao.durationMs} ms`
          : `# saiu com código ${execucao.exitCode} em ${execucao.durationMs} ms`
      ]
    : []

  return (
    <section aria-label="Terminal controlado" className="mt-5 flex flex-col gap-4">
      <div>
        <h2 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-forte)]">
          Terminal controlado
        </h2>
        <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
          Executa apenas comandos permitidos, em diretórios permitidos, sem privilégio elevado.
        </p>
      </div>

      {erro && (
        <InlineAlert tom="err" titulo="Falha no terminal">
          {erro}
        </InlineAlert>
      )}

      <Card titulo="Executar comando">
        <form
          className="flex flex-col gap-3"
          onSubmit={(evento) => {
            evento.preventDefault()
            void executar()
          }}
        >
          <Field rotulo="Comando" descricao="Somente o executável, sem argumentos.">
            {(atributos) => (
              <Input
                {...atributos}
                valor={binario}
                onMudar={setBinario}
                placeholder="git"
                autoComplete="off"
              />
            )}
          </Field>

          <Field rotulo="Argumentos" descricao="Separados por espaço. Opcional.">
            {(atributos) => (
              <Input
                {...atributos}
                valor={argumentos}
                onMudar={setArgumentos}
                placeholder="status --short"
                autoComplete="off"
              />
            )}
          </Field>

          <Field
            rotulo="Diretório de trabalho"
            descricao="Precisa estar na allowlist de diretórios."
          >
            {(atributos) => (
              <Input
                {...atributos}
                valor={cwd}
                onMudar={setCwd}
                placeholder="/caminho/permitido"
                autoComplete="off"
              />
            )}
          </Field>

          <div>
            <Button
              tipo="submit"
              carregando={executando}
              desabilitado={binario.trim().length === 0 || cwd.trim().length === 0}
            >
              Executar
            </Button>
          </div>
        </form>
      </Card>

      {execucao && (
        <Card titulo="Resultado">
          <div className="flex flex-col gap-3">
            <StatusOperacional
              estado={ESTADO_POR_COMANDO[execucao.state]}
              rotulo={ROTULO_POR_ESTADO[execucao.state]}
              descricao={TEXTO_POR_MOTIVO[execucao.reason]}
            />
            {execucao.motivoDestrutivo !== undefined && (
              <InlineAlert tom="warn" titulo="Comando potencialmente destrutivo">
                {execucao.motivoDestrutivo}. Decida em Operações para que ele execute.
              </InlineAlert>
            )}
            <LogViewer linhas={linhasDaSaida} rotulo="Saída do comando" />
          </div>
        </Card>
      )}

      <Card titulo="Comandos permitidos neste espaço">
        <div className="flex flex-col gap-3">
          <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
            Permitir um comando é ação de alto risco: fica registrado na auditoria.
          </p>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(evento) => {
              evento.preventDefault()
              void permitir()
            }}
          >
            <div className="min-w-48 flex-1">
              <Field rotulo="Permitir comando">
                {(atributos) => (
                  <Input
                    {...atributos}
                    valor={novoPermitido}
                    onMudar={setNovoPermitido}
                    placeholder="git"
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>
            <Button tipo="submit" desabilitado={novoPermitido.trim().length === 0}>
              Permitir
            </Button>
          </form>

          {permitidos.length === 0 ? (
            <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
              Nenhum comando permitido. O terminal não executa nada até você permitir um.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {permitidos.map((comando) => (
                <li key={comando} className="flex items-center justify-between gap-3">
                  <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)]">
                    {comando}
                  </span>
                  <Button
                    variante="perigo"
                    onClick={() => void revogar(comando)}
                    aria-label={`Revogar ${comando}`}
                  >
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  )
}
