import { useState } from 'react'
import { ProvedorDeTema } from '../tokens/provider'
import type { CorAcento } from '../tokens/acento'
import type { ModoUi, Modulo } from '../tokens/semantic'
import { Button, Card } from '../ui'
import {
  ApprovalDialog,
  LogViewer,
  MaskedCredentialSummary,
  OfflineBanner,
  PendingSyncNotice,
  ProviderSetup,
  RemoveCredentialDialog,
  RiskIndicator,
  RuntimeUnavailable,
  StatusOperacional,
  SyncStatus,
  type AcaoSensivel,
  type EstadoOperacional,
  type EstadoSync
} from '../patterns'

/**
 * Galeria de prova dos padrões operacionais (SPEC-DesignSystem-04b).
 *
 * O que só existe com layout real, e é o que esta galeria verifica: **contraste computado** dos
 * indicadores de risco e status. Eles carregam a informação mais crítica da interface — "isto é
 * perigoso", "isto falhou" — e são justamente os que leem semânticas, que a F03a mostrou
 * falharem 4.5:1 como texto no modo claro.
 *
 * As cenas com overlay (`aprovacao`, `remocao`) existem porque diálogo aberto não cabe numa
 * captura estática — mesma razão da galeria de dados na F03b.
 */

export type CenaOperacional = 'estatica' | 'aprovacao' | 'remocao'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  readonly cena?: CenaOperacional
}

const ACAO: AcaoSensivel = {
  acao: 'Executar deploy em produção',
  solicitante: 'agente-devops',
  impacto: 'Substitui a versão ativa em 3 servidores.',
  risco: 'alto',
  custoEstimado: 'US$ 0,42',
  escopo: 'cluster-prod'
}

const SYNCS: readonly EstadoSync[] = ['concluida', 'andamento', 'offline', 'pendente', 'falha']
const STATUS: readonly EstadoOperacional[] = ['ativo', 'executando', 'inativo', 'degradado', 'erro']

const LOG = [
  '[info] runtime iniciado em 128ms',
  'GET /v1/messages Authorization: Bearer sk-ant-naodeveaparecer123',
  '{"provider":"anthropic","apiKey":"segredo-invisivel","modelo":"claude"}',
  '[warn] limite de taxa em 80%'
]

export function GaleriaDeOperacionais({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'estatica'
}: GaleriaProps): React.JSX.Element {
  const [aprovacaoAberta, setAprovacaoAberta] = useState(cena === 'aprovacao')
  const [remocaoAberta, setRemocaoAberta] = useState(cena === 'remocao')

  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#FF5C00'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <div
        data-testid="galeria"
        className="min-h-screen bg-[var(--jos-cor-superficie)] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <Card titulo="Status e sincronização">
            <div className="flex flex-col gap-3" data-prova="status">
              <div className="flex flex-wrap gap-4">
                {SYNCS.map((estado) => (
                  <SyncStatus key={estado} estado={estado} />
                ))}
              </div>
              <div className="flex flex-wrap gap-4">
                {STATUS.map((estado) => (
                  <StatusOperacional key={estado} estado={estado} rotulo={estado} />
                ))}
              </div>
            </div>
          </Card>

          <Card titulo="Risco">
            <div className="flex flex-wrap gap-4" data-prova="risco">
              <RiskIndicator nivel="baixo" />
              <RiskIndicator nivel="medio" />
              <RiskIndicator nivel="alto" />
              <RiskIndicator nivel="bloqueado" />
            </div>
          </Card>

          <Card titulo="Avisos">
            <div className="flex flex-col gap-3">
              <OfflineBanner />
              <PendingSyncNotice quantidade={4} />
            </div>
          </Card>

          {/* O log traz segredos de propósito: a captura é a prova de que eles não aparecem. */}
          <Card titulo="Registro (com redaction)">
            <LogViewer linhas={LOG} />
          </Card>

          <Card titulo="Provider e BYOK">
            <div className="flex flex-col gap-4">
              <ProviderSetup provider="Anthropic" onSalvar={() => undefined} />
              <MaskedCredentialSummary
                credencial={{
                  provider: 'Anthropic',
                  ultimos4: '3f9a',
                  estado: 'ativo',
                  validadaEm: '23/07/2026'
                }}
              />
            </div>
          </Card>

          <RuntimeUnavailable
            mensagem="O processo do runtime não respondeu ao heartbeat."
            diagnostico={LOG}
            onReiniciar={() => undefined}
            onCopiarDiagnostico={() => undefined}
          />

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setAprovacaoAberta(true)}>Abrir aprovação</Button>
            <Button variante="secundaria" onClick={() => setRemocaoAberta(true)}>
              Abrir remoção
            </Button>
          </div>
        </div>

        <ApprovalDialog
          aberto={aprovacaoAberta}
          acao={ACAO}
          verboConfirmar="Executar deploy"
          onAprovar={() => setAprovacaoAberta(false)}
          onRecusar={() => setAprovacaoAberta(false)}
        />

        <RemoveCredentialDialog
          aberto={remocaoAberta}
          provider="Anthropic"
          execucoesAfetadas={2}
          onRemover={() => setRemocaoAberta(false)}
          onCancelar={() => setRemocaoAberta(false)}
        />
      </div>
    </ProvedorDeTema>
  )
}
