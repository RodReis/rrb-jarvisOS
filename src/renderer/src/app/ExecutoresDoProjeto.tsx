import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import type { ExecutorDeCodigo, ExecutorOperationalView } from '@shared/domain/executor-operacional'
import type { WorkspaceId } from '@shared/domain/entities'
import { Button, Checkbox, Field, InlineAlert, Input, Panel, Select, Tag } from '@design/ui'
import { StatusOperacional } from '@design/patterns'
import { log } from '../lib/log'

const ROTULO: Readonly<Record<ExecutorDeCodigo, string>> = {
  'claude-code': 'Claude Code',
  'codex-exec': 'Codex'
}

export function ExecutoresDoProjeto({
  projectId,
  workspace
}: {
  readonly projectId: string
  readonly workspace: WorkspaceId
}): React.JSX.Element {
  const [view, setView] = useState<ExecutorOperationalView | null>(null)
  const [principal, setPrincipal] = useState<ExecutorDeCodigo>('claude-code')
  const [fallbackPermitido, setFallbackPermitido] = useState(true)
  const [teto, setTeto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string>()

  const carregar = useCallback(async (): Promise<void> => {
    const atual = await window.jarvis.executorView(projectId, workspace)
    setView(atual)
    setPrincipal(atual.preference.executores[0] ?? 'claude-code')
    setFallbackPermitido(atual.preference.fallbackPermitido)
    setTeto(atual.preference.tetoUsd === undefined ? '' : String(atual.preference.tetoUsd))
  }, [projectId, workspace])

  useEffect(() => {
    let ativo = true

    void (async () => {
      try {
        await carregar()
      } catch (error: unknown) {
        if (!ativo) return
        log.ui.error('Falha ao carregar executores do projeto', { error })
        setErro('Não foi possível carregar os executores deste projeto.')
      }
    })()

    return () => {
      ativo = false
    }
  }, [carregar])

  async function salvar(): Promise<void> {
    setOcupado(true)
    setErro(undefined)
    try {
      const fallback: ExecutorDeCodigo = principal === 'claude-code' ? 'codex-exec' : 'claude-code'
      const tetoNormalizado = teto.trim() === '' ? undefined : Number(teto)
      if (
        tetoNormalizado !== undefined &&
        (!Number.isFinite(tetoNormalizado) || tetoNormalizado < 0)
      ) {
        setErro('Teto precisa ser um número maior ou igual a zero.')
        return
      }
      setView(
        await window.jarvis.saveExecutorPreference(
          projectId,
          fallbackPermitido ? [principal, fallback] : [principal],
          fallbackPermitido,
          tetoNormalizado,
          workspace
        )
      )
    } catch (error: unknown) {
      log.ui.error('Falha ao salvar executores do projeto', { error })
      setErro('Não foi possível salvar a preferência de executor.')
    } finally {
      setOcupado(false)
    }
  }

  if (view === null) return <Panel titulo="Executores">Carregando executores...</Panel>

  return (
    <Panel
      titulo="Executores"
      acoes={
        <Button
          variante="secundaria"
          onClick={() => void carregar()}
          iconeInicial={<RefreshCw aria-hidden="true" className="size-4" />}
        >
          Revalidar
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {erro !== undefined && (
          <InlineAlert tom="err" titulo="Ação não concluída">
            {erro}
          </InlineAlert>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="flex flex-col gap-3">
            {view.preview.estados.map((estado) => (
              <div
                key={estado.executor}
                className="rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.14)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusOperacional
                    estado={estado.elegivel ? 'ativo' : estado.disponivel ? 'degradado' : 'inativo'}
                    rotulo={estado.rotulo}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Tag>
                      {estado.modoDeCobranca === 'metered' ? 'Cobra por uso' : 'Assinatura'}
                    </Tag>
                    <Tag>
                      {estado.quota === 'quota_unknown' ? 'Quota desconhecida' : estado.quota}
                    </Tag>
                  </div>
                </div>
                <p className="mt-2 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                  {estado.motivo}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <Field rotulo="Executor principal">
              {(atributos) => (
                <Select
                  {...atributos}
                  valor={principal}
                  onMudar={(valor) => setPrincipal(valor as ExecutorDeCodigo)}
                  opcoes={[
                    { valor: 'claude-code', rotulo: ROTULO['claude-code'] },
                    { valor: 'codex-exec', rotulo: ROTULO['codex-exec'] }
                  ]}
                />
              )}
            </Field>
            <Checkbox
              rotulo="Permitir fallback para o outro executor"
              marcado={fallbackPermitido}
              onMudar={setFallbackPermitido}
            />
            <Field rotulo="Teto para modos pagos (USD)">
              {(atributos) => (
                <Input
                  {...atributos}
                  valor={teto}
                  onMudar={setTeto}
                  placeholder="Obrigatório antes de gastar créditos"
                />
              )}
            </Field>
            <Button
              variante="primaria"
              onClick={() => void salvar()}
              carregando={ocupado}
              iconeInicial={<Save aria-hidden="true" className="size-4" />}
            >
              Salvar preferência
            </Button>
          </div>
        </div>

        <InlineAlert
          tom={view.preview.decisao === 'escolhido' ? 'ok' : 'warn'}
          titulo={
            view.preview.decisao === 'escolhido'
              ? `Writer ${ROTULO[view.preview.writer ?? 'claude-code']} · revisor ${ROTULO[view.preview.revisor ?? 'claude-code']}`
              : 'Executor não elegível'
          }
        >
          {view.preview.motivo}
        </InlineAlert>

        <div className="rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] p-3">
          <h3 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-secundario)]">
            Prova operacional
          </h3>
          <p className="mt-2 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {view.proof.motivo}
          </p>
        </div>
      </div>
    </Panel>
  )
}
