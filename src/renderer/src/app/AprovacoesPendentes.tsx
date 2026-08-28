import { useEffect, useState } from 'react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/domain/execution'
import { Button, Card, InlineAlert } from '@design/ui'
import { SensitiveActionSummary, type AcaoSensivel, type NivelDeRisco } from '@design/patterns'
import { log } from '../lib/log'

function riscoDaAprovacao(approval: ApprovalRequest): NivelDeRisco {
  if (approval.risk === 'baixo' || approval.risk === 'medio' || approval.risk === 'alto') {
    return approval.risk
  }
  return 'bloqueado'
}

function texto(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function resumoDaAprovacao(approval: ApprovalRequest): AcaoSensivel {
  const path = texto(approval.operation['path'])
  const targetPath = texto(approval.operation['targetPath'])
  const operation = texto(approval.operation['kind']) ?? approval.action
  const escopo = targetPath ? `${path ?? '-'} -> ${targetPath}` : path

  return {
    acao: `Filesystem: ${operation}`,
    solicitante: 'runtime local',
    impacto:
      approval.reason === 'elevada-por-path-fora-da-allowlist'
        ? 'Autoriza uma exceção pontual fora da allowlist para esta execução.'
        : 'Permite que a etapa pendente toque o filesystem de verdade.',
    risco: riscoDaAprovacao(approval),
    ...(escopo ? { escopo } : {})
  }
}

export function AprovacoesPendentes({
  workspace
}: {
  readonly workspace: 'noa' | 'jarvis'
}): React.JSX.Element {
  const [items, setItems] = useState<readonly ApprovalRequest[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState<string | null>(null)

  /** Recarrega a fila depois de resolver uma aprovação. O boot tem o efeito próprio abaixo. */
  async function carregar(): Promise<void> {
    try {
      const pendentes = await window.jarvis.listPendingApprovals(workspace)
      setErro(null)
      setItems(pendentes)
    } catch (error) {
      setErro('Não foi possível carregar as aprovações pendentes.')
      log.ui.error('Falha ao listar aprovações pendentes', { workspace, error })
    }
  }

  useEffect(() => {
    let ativo = true

    window.jarvis
      .listPendingApprovals(workspace)
      .then((pendentes) => {
        if (!ativo) return
        setErro(null)
        setItems(pendentes)
      })
      .catch((error: unknown) => {
        if (!ativo) return
        setErro('Não foi possível carregar as aprovações pendentes.')
        log.ui.error('Falha ao listar aprovações pendentes', { workspace, error })
      })

    return () => {
      ativo = false
    }
  }, [workspace])

  async function resolver(id: string, decision: ApprovalDecision): Promise<void> {
    try {
      setErro(null)
      setResolvendo(id)
      await window.jarvis.resolveApproval(id, decision)
      await carregar()
    } catch (error) {
      setErro('Não foi possível resolver a aprovação.')
      log.ui.error('Falha ao resolver aprovação', { id, decision, error })
    } finally {
      setResolvendo(null)
    }
  }

  return (
    <section aria-label="Aprovações pendentes" className="mt-5 flex flex-col gap-3">
      <div>
        <h2 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-forte)]">
          Aprovações pendentes
        </h2>
        <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
          Operações reais que estão pausadas aguardando decisão humana.
        </p>
      </div>

      {erro && (
        <InlineAlert tom="err" titulo="Falha na aprovação">
          {erro}
        </InlineAlert>
      )}

      {items.length === 0 ? (
        <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]">
          Nenhuma aprovação pendente.
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((approval) => (
            <Card key={approval.id} titulo={`Etapa ${approval.stepId}`}>
              <SensitiveActionSummary acao={resumoDaAprovacao(approval)} />
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() => void resolver(approval.id, 'aprovado')}
                  carregando={resolvendo === approval.id}
                >
                  Aprovar
                </Button>
                <Button
                  variante="perigo"
                  onClick={() => void resolver(approval.id, 'negado')}
                  desabilitado={resolvendo === approval.id}
                >
                  Negar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
