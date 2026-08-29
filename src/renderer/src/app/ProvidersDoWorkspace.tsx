import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import { AI_PROVIDERS, type AiProvider } from '@shared/domain/ai'
import {
  ROTULO_DO_TASK_TYPE,
  TASK_TYPES,
  type ProviderStatus,
  type RoutingPolicy,
  type TaskType
} from '@shared/domain/routing'
import { Button, Checkbox, Field, InlineAlert, Panel, Select, Tag } from '@design/ui'
import { StatusOperacional, type EstadoOperacional } from '@design/patterns'
import { log } from '../lib/log'

/**
 * Providers e roteamento do espaço ativo (SPEC-Providers-04, critérios 5 e 8).
 *
 * Duas coisas numa tela porque são a mesma pergunta vista de dois lados: **quem está de pé**
 * (status) e **quem deve atender o quê** (rotas). Separá-las faria o usuário editar a rota numa
 * tela sem saber, na outra, que o provider que ele acabou de preferir está offline.
 *
 * Nada aqui decide nem mede: o healthcheck roda no main com cache curto, e a seleção acontece
 * dentro do ponto único de chamada. Uma tela que pingasse providers por conta própria manteria
 * uma segunda noção de "quem está de pé", e a dela discordaria da que roteia.
 */

interface ProvidersProps {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

/** Nome legível de cada provider — a tela não deriva texto de identificador. */
const ROTULO_DO_PROVIDER: Readonly<Record<AiProvider, string>> = {
  anthropic: 'Anthropic (Claude API)',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)',
  'claude-code': 'Claude Code CLI'
}

/**
 * O estado operacional que o DS pinta a partir do healthcheck.
 *
 * `loading` existe no contrato (RF-011) e aparece enquanto a primeira medição não voltou — é
 * diferente de `offline`, e confundi-los faria a tela dizer "fora do ar" para um provider que
 * ainda não foi perguntado.
 */
function estadoDe(status: ProviderStatus): EstadoOperacional {
  if (status.estado === 'online') return 'ativo'
  // `degradado` e não `inativo` para o `loading`: o DS não tem um estado "medindo", e
  // "degradado" é o que mais se aproxima de "ainda não sabemos" sem afirmar que está fora.
  if (status.estado === 'loading') return 'degradado'
  return 'inativo'
}

/** Uma linha de provider: estado, origem, latência, custo e o seletor de modelo. */
function LinhaDeProvider({
  status,
  modelos,
  aoTrocarModelo
}: {
  readonly status: ProviderStatus
  readonly modelos: readonly string[]
  readonly aoTrocarModelo: (modelo: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 border-b border-[rgba(var(--jos-borda-rgb),0.16)] pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusOperacional
            estado={estadoDe(status)}
            rotulo={ROTULO_DO_PROVIDER[status.provider]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
           * Origem e custo como `Tag`, não como cor da linha: "roda na minha máquina" e "não
           * cobra por chamada" são fatos que o usuário precisa **ler**, e o critério do DS é
           * que estado nunca vive só na cor.
           */}
          <Tag>{status.origem === 'local' ? 'Local' : 'Nuvem'}</Tag>
          {status.unmetered && <Tag>Sem custo por chamada</Tag>}
          {status.latenciaMs !== undefined && (
            <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
              {status.latenciaMs} ms
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Field rotulo={`Modelo do ${ROTULO_DO_PROVIDER[status.provider]}`}>
          {(atributos) => (
            <Select
              {...atributos}
              valor={status.modelo}
              onMudar={aoTrocarModelo}
              opcoes={modelos.map((m) => ({ valor: m, rotulo: m }))}
            />
          )}
        </Field>
      </div>
    </div>
  )
}

/**
 * O editor de uma rota: a ordem de preferência e o toggle de local.
 *
 * A ordem é editada por **subir/descer**, e não por arrastar: arrastar exige mouse e um alvo
 * grande, e o critério 5 pede operável por teclado. Botões resolvem os dois casos com o mesmo
 * código.
 */
function EditorDeRota({
  taskType,
  preferencia,
  preferirLocal,
  aoMudar
}: {
  readonly taskType: TaskType
  readonly preferencia: readonly AiProvider[]
  readonly preferirLocal: boolean
  readonly aoMudar: (preferencia: readonly AiProvider[], preferirLocal: boolean) => void
}): React.JSX.Element {
  const mover = (indice: number, direcao: -1 | 1): void => {
    const destino = indice + direcao
    if (destino < 0 || destino >= preferencia.length) return

    const nova = [...preferencia]
    const [item] = nova.splice(indice, 1)
    if (item !== undefined) nova.splice(destino, 0, item)
    aoMudar(nova, preferirLocal)
  }

  const alternar = (provider: AiProvider): void => {
    const nova = preferencia.includes(provider)
      ? preferencia.filter((p) => p !== provider)
      : [...preferencia, provider]
    aoMudar(nova, preferirLocal)
  }

  return (
    <div className="flex flex-col gap-3 border-b border-[rgba(var(--jos-borda-rgb),0.16)] pb-4 last:border-b-0 last:pb-0">
      <h4 className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
        {ROTULO_DO_TASK_TYPE[taskType]}
      </h4>

      {preferencia.length === 0 ? (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          Nenhum provider atende este tipo de tarefa.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {preferencia.map((provider, indice) => (
            <li key={provider} className="flex items-center justify-between gap-3">
              <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto)]">
                {indice + 1}. {ROTULO_DO_PROVIDER[provider]}
              </span>
              <div className="flex gap-1">
                <Button
                  variante="secundaria"
                  onClick={() => mover(indice, -1)}
                  desabilitado={indice === 0}
                >
                  {`Subir ${ROTULO_DO_PROVIDER[provider]} em ${ROTULO_DO_TASK_TYPE[taskType]}`}
                </Button>
                <Button
                  variante="secundaria"
                  onClick={() => mover(indice, 1)}
                  desabilitado={indice === preferencia.length - 1}
                >
                  {`Descer ${ROTULO_DO_PROVIDER[provider]} em ${ROTULO_DO_TASK_TYPE[taskType]}`}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-4">
        {AI_PROVIDERS.filter((p) => !preferencia.includes(p)).map((provider) => (
          <Button key={provider} variante="secundaria" onClick={() => alternar(provider)}>
            {`Incluir ${ROTULO_DO_PROVIDER[provider]} em ${ROTULO_DO_TASK_TYPE[taskType]}`}
          </Button>
        ))}
      </div>

      <Checkbox
        rotulo={`Preferir provider local em ${ROTULO_DO_TASK_TYPE[taskType]}`}
        marcado={preferirLocal}
        onMudar={(valor) => aoMudar(preferencia, valor)}
      />
    </div>
  )
}

export function ProvidersDoWorkspace({
  workspace,
  nomeDoEspaco
}: ProvidersProps): React.JSX.Element {
  const [status, setStatus] = useState<readonly ProviderStatus[] | null>(null)
  const [rotas, setRotas] = useState<RoutingPolicy | null>(null)
  const [modelos, setModelos] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)

  const carregar = useCallback(async (): Promise<void> => {
    const [novoStatus, novasRotas] = await Promise.all([
      window.jarvis.getProviderStatus(workspace),
      window.jarvis.getRouting(workspace)
    ])

    // Os modelos por provider vêm juntos para o seletor não precisar de um round-trip por
    // linha na primeira pintura.
    const listas = await Promise.all(
      AI_PROVIDERS.map(async (p) => [p, await window.jarvis.getProviderModels(p)] as const)
    )

    setStatus(novoStatus)
    setRotas(novasRotas)
    setModelos(Object.fromEntries(listas))
    setErro(null)
  }, [workspace])

  useEffect(() => {
    let ativo = true

    // `void` numa função async, e não `.catch()` encadeado: a regra
    // `react-hooks/set-state-in-effect` acusa o `setState` no corpo síncrono do efeito, e ela
    // está certa — o `catch` de uma promessa já resolvida rodaria antes de o efeito terminar,
    // disparando renderização em cascata. Dentro da async, o `await` garante que qualquer
    // `setState` acontece depois.
    void (async () => {
      try {
        await carregar()
      } catch {
        if (!ativo) return
        log.ui.error('Falha ao carregar os providers do espaço', { workspace })
        setErro('Não foi possível carregar os providers deste espaço.')
      }
    })()

    return () => {
      ativo = false
    }
  }, [carregar, workspace])

  async function verificarDeNovo(): Promise<void> {
    setVerificando(true)
    try {
      await carregar()
    } catch {
      log.ui.error('Falha ao verificar os providers', { workspace })
      setErro('Não foi possível verificar os providers.')
    } finally {
      setVerificando(false)
    }
  }

  async function trocarModelo(provider: AiProvider, modelo: string): Promise<void> {
    try {
      const aceito = await window.jarvis.setProviderModel(provider, modelo, workspace)
      if (!aceito) {
        setErro(`O modelo ${modelo} não está disponível para este provider.`)
        return
      }
      await carregar()
    } catch {
      log.ui.error('Falha ao trocar o modelo do provider', { workspace, provider })
      setErro('Não foi possível trocar o modelo.')
    }
  }

  async function salvarRota(
    taskType: TaskType,
    preferencia: readonly AiProvider[],
    preferirLocal: boolean
  ): Promise<void> {
    try {
      const atualizado = await window.jarvis.setRoute(
        { taskType, preferencia, preferirLocal },
        workspace
      )
      setRotas(atualizado)
      setErro(null)
    } catch {
      log.ui.error('Falha ao salvar a rota', { workspace, taskType })
      setErro('Não foi possível salvar a rota.')
    }
  }

  if (erro !== null && status === null) {
    // Erro **no lugar** do conteúdo: com a carga falhando, mostrar o aviso junto de uma lista
    // vazia diria "você não tem providers" quando o certo é "não sabemos quais são". Mesma
    // régua da M4-F03 e do painel de orçamento.
    return (
      <Panel titulo={`Providers de IA · ${nomeDoEspaco}`}>
        <InlineAlert tom="err" titulo="Providers indisponíveis">
          {erro}
        </InlineAlert>
      </Panel>
    )
  }

  if (status === null || rotas === null) {
    return (
      <Panel titulo={`Providers de IA · ${nomeDoEspaco}`}>
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-suave)]">
          Verificando os providers deste espaço…
        </p>
      </Panel>
    )
  }

  return (
    <Panel
      titulo={`Providers de IA · ${nomeDoEspaco}`}
      acoes={
        <Button
          variante="secundaria"
          onClick={() => void verificarDeNovo()}
          carregando={verificando}
        >
          Verificar de novo
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-suave)]">
          Cada tipo de tarefa tem uma ordem de preferência. Provider fora do ar não é escolhido: a
          chamada cai para o próximo da lista, e a troca fica registrada na auditoria.
        </p>

        {erro !== null && (
          <InlineAlert tom="err" titulo="Ação não concluída">
            {erro}
          </InlineAlert>
        )}

        <div className="flex flex-col gap-4">
          {status.map((s) => (
            <LinhaDeProvider
              key={s.provider}
              status={s}
              modelos={modelos[s.provider] ?? [s.modelo]}
              aoTrocarModelo={(modelo) => void trocarModelo(s.provider, modelo)}
            />
          ))}
        </div>

        <section className="flex flex-col gap-4">
          <h3 className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
            Roteamento por tipo de tarefa
          </h3>

          {TASK_TYPES.map((taskType) => (
            <EditorDeRota
              key={taskType}
              taskType={taskType}
              preferencia={rotas.rotas[taskType].preferencia}
              preferirLocal={rotas.rotas[taskType].preferirLocal}
              aoMudar={(preferencia, preferirLocal) =>
                void salvarRota(taskType, preferencia, preferirLocal)
              }
            />
          ))}
        </section>
      </div>
    </Panel>
  )
}
