import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, ShieldCheck } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Roadmap, RoadmapOutcome, RoadmapReason } from '@shared/domain/roadmap'
import type { Approval, AprovacaoOutcome, AprovacaoReason, Gate } from '@shared/domain/aprovacoes'
import { GATES } from '@shared/domain/aprovacoes'
import { Badge, Button, InlineAlert, LoadingState, Separator } from '@design/ui'
import { log } from '../lib/log'

/**
 * O roadmap do projeto e o centro de aprovações (SPEC-Planejamento-06).
 *
 * **Gerar e aprovar são dois botões, e a distância entre eles é o desenho.** Gerar compõe e
 * propõe; aprovar é o aceite do PI. Um botão só — "gerar e aprovar" — faria a tela oferecer,
 * num clique, a coisa que os critérios 3 e 7 separam: quem propõe não decide que a proposta
 * vale.
 *
 * **A tela mostra o que o gate cobre antes de o PI aprovar.** As revisões com hash aparecem sob
 * cada gate, não atrás de um "detalhes": aprovar sem ver o que se aprova é o clique automático
 * que o critério 5 existe para não ensinar. E quando a revisão já está aprovada, o botão diz
 * isso em vez de convidar a reaprovar.
 *
 * Três garantias vivem na fronteira, não aqui:
 *  - **A tela não decide se o DAG é válido.** Ela mostra os problemas que voltaram, nomeados.
 *  - **A tela não sabe quem aprova.** A identidade vem da sessão no main; não há campo de autor.
 *  - **A tela não promove MVP.** A promoção é efeito do gate `MVP_ENTRY` no serviço.
 */

interface RoadmapDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
}

/**
 * Tom por desfecho da geração. Mapa fechado, como nas telas irmãs: um motivo novo no contrato
 * quebra a compilação aqui em vez de cair num default silencioso.
 *
 * `sem-base` é **`warn`**: nada quebrou, falta um passo — e a mensagem diz qual. `dag-invalido`
 * é `err` porque o roadmap composto está de fato inconsistente.
 */
const TOM_DA_GERACAO: Readonly<Record<RoadmapReason, 'ok' | 'err' | 'warn'>> = {
  gerado: 'ok',
  'projeto-inexistente': 'err',
  'sem-base': 'warn',
  'dag-invalido': 'err',
  'falha-de-escrita': 'err'
}

/**
 * Tom por desfecho da aprovação.
 *
 * `ja-aprovado` é **`ok`, não `warn`**: nada deu errado — a revisão já tem o aceite, que é
 * exatamente o estado desejado. Pintar de aviso ensinaria o PI a ler o critério 5 como
 * problema.
 */
const TOM_DA_APROVACAO: Readonly<Record<AprovacaoReason, 'ok' | 'err' | 'warn'>> = {
  aprovado: 'ok',
  'projeto-inexistente': 'err',
  'ja-aprovado': 'ok',
  'sem-identidade': 'warn',
  'sem-revisoes': 'warn',
  'dag-invalido': 'err'
}

export function RoadmapDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto
}: RoadmapDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [roadmap, setRoadmap] = useState<Roadmap | undefined>(undefined)
  const [aprovacoes, setAprovacoes] = useState<readonly Approval[]>([])
  const [ocupado, setOcupado] = useState<'nao' | 'gerando' | 'aprovando'>('nao')
  const [desfecho, setDesfecho] = useState<RoadmapOutcome | null>(null)
  const [aprovacao, setAprovacao] = useState<AprovacaoOutcome | null>(null)

  const buscar = useCallback(
    (): Promise<readonly [Roadmap, readonly Approval[]]> =>
      Promise.all([
        window.jarvis.carregarRoadmap(projectId, workspace),
        window.jarvis.listarAprovacoes(projectId, workspace)
      ]),
    [projectId, workspace]
  )

  const aplicar = useCallback(([mapa, aceites]: readonly [Roadmap, readonly Approval[]]): void => {
    setRoadmap(mapa)
    setAprovacoes(aceites)
  }, [])

  useEffect(() => {
    let ativo = true

    buscar()
      .then((r) => {
        if (ativo) aplicar(r)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao carregar o roadmap', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
        setRoadmap({ mvps: [], slices: [] })
      })

    return () => {
      ativo = false
    }
  }, [projectId, buscar, aplicar])

  async function gerar(): Promise<void> {
    setOcupado('gerando')
    try {
      const resultado = await window.jarvis.gerarRoadmap(projectId, workspace)
      setDesfecho(resultado)
      // A geração muda o que os gates cobrem: a aprovação anterior descreve outro conteúdo.
      setAprovacao(null)
      if (resultado.reason === 'gerado') aplicar(await buscar())
    } catch (causa: unknown) {
      log.ui.error('Falha ao gerar o roadmap', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  async function aprovar(gate: Gate): Promise<void> {
    setOcupado('aprovando')
    try {
      const resultado = await window.jarvis.aprovarGate(projectId, gate, workspace)
      setAprovacao(resultado)
      if (resultado.reason === 'aprovado') aplicar(await buscar())
    } catch (causa: unknown) {
      log.ui.error('Falha ao aprovar o gate', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  const trabalhando = ocupado !== 'nao'
  const temRoadmap = (roadmap?.mvps.length ?? 0) > 0

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`roadmap-${projectId}`}>
      <header className="flex flex-col gap-1">
        <h3
          id={`roadmap-${projectId}`}
          className="flex items-center gap-2 font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)]"
        >
          <GitBranch aria-hidden="true" className="size-4" />
          {t('roadmap.titulo')}
        </h3>
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('roadmap.descricao', { nome: nomeDoProjeto })}
        </p>
      </header>

      {roadmap === undefined ? (
        <LoadingState rotulo={t('roadmap.carregando')} />
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variante="primaria"
              onClick={() => void gerar()}
              carregando={ocupado === 'gerando'}
              desabilitado={trabalhando}
            >
              {temRoadmap ? t('roadmap.regerar') : t('roadmap.gerar')}
            </Button>
          </div>

          {desfecho !== null && (
            <InlineAlert tom={TOM_DA_GERACAO[desfecho.reason]} titulo={desfecho.mensagem}>
              {desfecho.problemas !== undefined && desfecho.problemas.length > 0 && (
                <ul className="flex flex-col gap-1 text-[length:var(--jos-texto-micro)]">
                  {/* Os problemas vêm nomeados do domínio: "há um ciclo" não é acionável. */}
                  {desfecho.problemas.map((p) => (
                    <li key={p.mensagem}>{p.mensagem}</li>
                  ))}
                </ul>
              )}
            </InlineAlert>
          )}

          {temRoadmap && <MapaDoRoadmap roadmap={roadmap} />}

          <Separator />

          <CentroDeAprovacoes
            projectId={projectId}
            workspace={workspace}
            aprovacoes={aprovacoes}
            desabilitado={trabalhando}
            aprovando={ocupado === 'aprovando'}
            onAprovar={(gate) => void aprovar(gate)}
          />

          {aprovacao !== null && (
            <InlineAlert tom={TOM_DA_APROVACAO[aprovacao.reason]} titulo={aprovacao.mensagem} />
          )}
        </>
      )}
    </section>
  )
}

/**
 * O mapa: os MVPs com estado e dependências, e as fatias com a SPEC.
 *
 * O estado é **texto**, não só cor (critério 4 do DS): quem não distingue a cor precisa do mesmo
 * sinal. E `proposto` não é pintado de aviso — é o estado normal de um MVP que ainda não entrou
 * na fila, e alarmá-lo ensinaria a ler o critério 3 como pendência.
 */
function MapaDoRoadmap({ roadmap }: { readonly roadmap: Roadmap }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-mono text-[length:var(--jos-texto-micro)] uppercase text-[var(--jos-cor-texto-suave)]">
        {t('roadmap.mvps', { count: roadmap.mvps.length })}
      </h4>

      <ul className="flex flex-col gap-2">
        {roadmap.mvps.map((mvp) => {
          const fatias = roadmap.slices.filter((s) => s.mvpId === mvp.id)
          const dependencias = mvp.dependeDe
            .map((d) => roadmap.mvps.find((m) => m.id === d)?.titulo ?? d)
            .join(', ')

          return (
            <li
              key={mvp.id}
              className="flex flex-col gap-2 rounded-[var(--jos-raio-chip)] border border-[var(--jos-cor-borda)] px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-[length:var(--jos-texto-micro)]">
                    {mvp.numero}. {mvp.titulo}
                  </span>
                  <span className="block text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                    {mvp.tese}
                  </span>
                </span>
                <Badge tom={mvp.estado === 'na-fila' ? 'ok' : 'info'}>
                  {t(`roadmap.estado.${mvp.estado}`)}
                </Badge>
              </div>

              {mvp.dependeDe.length > 0 && (
                <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                  {t('roadmap.dependeDe', { lista: dependencias })}
                </p>
              )}

              <ul className="flex flex-col gap-1">
                {fatias.map((fatia) => (
                  <li key={fatia.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                      {fatia.titulo}
                    </span>
                    <span className="shrink-0 truncate font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                      {fatia.specSlug}
                    </span>
                    {fatia.detalhada && <Badge tom="ok">{t('roadmap.detalhada')}</Badge>}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * O centro de aprovações: um gate por linha, com o que ele cobre e o estado do aceite.
 *
 * **As revisões aparecem antes do botão, não atrás dele.** Aprovar sem ver o que se aprova é o
 * clique automático que o critério 5 existe para não ensinar — e o hash truncado com o completo
 * no rótulo acessível é a mesma postura das telas irmãs.
 */
function CentroDeAprovacoes({
  projectId,
  workspace,
  aprovacoes,
  desabilitado,
  aprovando,
  onAprovar
}: {
  readonly projectId: string
  readonly workspace: WorkspaceId
  readonly aprovacoes: readonly Approval[]
  readonly desabilitado: boolean
  readonly aprovando: boolean
  readonly onAprovar: (gate: Gate) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <h4 className="flex items-center gap-2 font-mono text-[length:var(--jos-texto-micro)] uppercase text-[var(--jos-cor-texto-suave)]">
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {t('roadmap.gates')}
      </h4>

      <ul className="flex flex-col gap-2">
        {GATES.map((gate) => (
          <LinhaDoGate
            key={gate}
            gate={gate}
            projectId={projectId}
            workspace={workspace}
            aprovacoes={aprovacoes}
            desabilitado={desabilitado}
            aprovando={aprovando}
            onAprovar={onAprovar}
          />
        ))}
      </ul>
    </div>
  )
}

/** Uma linha do centro de aprovações: o gate, o que ele cobre e o aceite. */
function LinhaDoGate({
  gate,
  projectId,
  workspace,
  aprovacoes,
  desabilitado,
  aprovando,
  onAprovar
}: {
  readonly gate: Gate
  readonly projectId: string
  readonly workspace: WorkspaceId
  readonly aprovacoes: readonly Approval[]
  readonly desabilitado: boolean
  readonly aprovando: boolean
  readonly onAprovar: (gate: Gate) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [revisoes, setRevisoes] = useState<readonly { artefato: string; hash: string }[]>([])

  useEffect(() => {
    let ativo = true

    window.jarvis
      .revisoesDoGate(projectId, gate, workspace)
      .then((r) => {
        if (ativo) setRevisoes(r)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao carregar as revisões do gate', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
      })

    return () => {
      ativo = false
    }
    // `aprovacoes` entra nas dependências de propósito: aprovar muda o que o gate mostra, e sem
    // ela a linha seguiria exibindo o estado anterior.
  }, [projectId, gate, workspace, aprovacoes])

  // A aprovação vigente é a que cobre **exatamente** estas revisões (critério 5). A comparação
  // é do conjunto, como no domínio — a tela não pode ser mais permissiva que o serviço.
  const vigente = aprovacoes.find(
    (a) =>
      a.gate === gate &&
      a.revisoes.length === revisoes.length &&
      a.revisoes.every((r) =>
        revisoes.some((atual) => atual.artefato === r.artefato && atual.hash === r.hash)
      )
  )

  return (
    <li className="flex flex-col gap-2 rounded-[var(--jos-raio-chip)] border border-[var(--jos-cor-borda)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="font-mono text-[length:var(--jos-texto-micro)]">{gate}</span>
          <span className="block text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t(`roadmap.gate.${gate}`)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {vigente !== undefined ? (
            <Badge tom="ok">{t('roadmap.aprovado')}</Badge>
          ) : (
            <Badge tom="warn">{t('roadmap.pendente')}</Badge>
          )}
          <Button
            variante="secundaria"
            onClick={() => onAprovar(gate)}
            carregando={aprovando}
            // Um gate sem revisões não tem o que aprovar, e um já aprovado não pede novo aceite:
            // o botão que não pode dar certo não deve convidar ao clique. A recusa continua no
            // serviço — a tela não é a garantia.
            desabilitado={desabilitado || revisoes.length === 0 || vigente !== undefined}
          >
            {t('roadmap.aprovar')}
          </Button>
        </span>
      </div>

      {revisoes.length === 0 ? (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {t('roadmap.semRevisoes')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {revisoes.map((revisao) => (
            <li key={revisao.artefato} className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {revisao.artefato}
              </span>
              <span
                className="shrink-0 font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
                aria-label={t('roadmap.hashCompleto', { hash: revisao.hash })}
              >
                {revisao.hash.slice(0, 12)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {vigente !== undefined && (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {t('roadmap.aprovadoPor', { identidade: vigente.identidade })}
        </p>
      )}
    </li>
  )
}
