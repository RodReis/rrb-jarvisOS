import { useState } from 'react'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import { Badge, Button, Panel, Table, type Coluna, type TomSemantico } from '@design/ui'

/**
 * O desfecho de um run, do jeito que o operador precisa ler (SPEC-Entrega-06, critério 7).
 *
 * A pergunta que este painel responde é *"o que aconteceu, quanto custou e o que decide agora?"*
 * — nessa ordem. O SHA, os checks e os eventos **não** entram na primeira leitura: o critério
 * pede um estado terminal compreensível sem log técnico, e quarenta caracteres de hexadecimal no
 * topo são o oposto disso. Eles ficam num expansor, disponíveis para quem for auditar.
 *
 * **Nenhum botão de ação.** A § Interface da spec proíbe mostrar commit, push, PR e merge como
 * botões do PI, e proíbe pedir aceite final aqui. A pipeline já executou; o aceite é ato do PI
 * no board. O painel informa — e há teste varrendo os papéis acessíveis para provar que ele não
 * ganhou um botão por descuido.
 *
 * **Artefato aparece por nome e hash**, nunca por conteúdo (critério 2): o hash é o que sobrevive
 * à retenção apagar o anexo pesado, e é por ele que se confirma qual arquivo foi aquele.
 *
 * O componente não busca nada: recebe o ledger e as pendências por prop, como manda a regra de
 * que componente não conhece infraestrutura. Quem consulta a ponte é quem o monta.
 */

interface PainelDeEntregaProps {
  readonly ledger: ExecutionLedger
  readonly pendencias: readonly PendenciaDeLimpeza[]
}

/**
 * Como cada desfecho se chama e o que ele significa para quem lê.
 *
 * Tabela, e não `switch`: os quatro terminais precisam de nome, tom e próxima decisão, e uma
 * tabela deixa visível que nenhum deles ficou sem. `AWAITING_MERGE` é `info` e não `warn` de
 * propósito — o kill-switch desligado é configuração legítima do projeto, não um problema.
 */
const DESFECHOS: Readonly<
  Record<
    EstadoDoRun,
    { readonly rotulo: string; readonly tom: TomSemantico; readonly decisao: string }
  >
> = {
  MERGED: {
    rotulo: 'Mergeado',
    tom: 'ok',
    decisao: 'A fatia está na base. O aceite da issue é do PI, no board.'
  },
  AWAITING_MERGE: {
    rotulo: 'Aguardando merge',
    tom: 'info',
    decisao: 'O pull request está verde. O merge e o aceite ficam com o PI.'
  },
  BLOCKED: {
    rotulo: 'Bloqueado',
    tom: 'err',
    decisao: 'A causa está nos detalhes técnicos. Retomar exige resolver o bloqueio primeiro.'
  },
  CANCELLED: {
    rotulo: 'Cancelado',
    tom: 'warn',
    decisao: 'Branch e pull request foram preservados. Nada foi desfeito.'
  },
  PLANNED: { rotulo: 'Planejado', tom: 'info', decisao: 'A fatia ainda não pediu aceite.' },
  AWAITING_PI: { rotulo: 'Aguardando o PI', tom: 'info', decisao: 'A fatia aguarda aprovação.' },
  READY: { rotulo: 'Pronto', tom: 'info', decisao: 'A fatia aguarda o slot de execução.' },
  RUNNING: { rotulo: 'Em execução', tom: 'info', decisao: 'O executor está construindo.' },
  VALIDATING: { rotulo: 'Validando', tom: 'info', decisao: 'Testes, lint e revisão em curso.' },
  PR_CI: { rotulo: 'No CI', tom: 'info', decisao: 'Os checks estão correndo na origem.' }
}

/** Duração legível. Um run de doze minutos não deve ser lido como `754000`. */
function duracao(ms: number): string {
  const total = Math.round(ms / 1000)
  const minutos = Math.floor(total / 60)
  const segundos = total % 60
  return minutos === 0 ? `${segundos}s` : `${minutos}min ${segundos}s`
}

/** USD em pt-BR, como no resto do app: o operador lê `US$ 1,42`, não `1.42`. */
function usd(valor: number): string {
  return `US$ ${valor.toFixed(2).replace('.', ',')}`
}

/** Bytes legíveis. O tamanho existe para dizer "é pesado", não para conferir a conta. */
function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

/** Os doze primeiros do hash: o bastante para reconhecer, curto o bastante para ler. */
function hashCurto(hash: string): string {
  return hash.slice(0, 12)
}

const COLUNAS_DE_ARTEFATO: readonly Coluna<ExecutionLedger['artefatos'][number]>[] = [
  { chave: 'nome', cabecalho: 'Artefato', celula: (a) => a.nome },
  {
    chave: 'hash',
    cabecalho: 'Hash',
    // O hash inteiro fica no `title` — quem vai auditar precisa do valor completo, e abreviar
    // sem oferecer o original transformaria a prova em enfeite.
    celula: (a) => (
      <code
        className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
        title={a.hash}
      >
        {hashCurto(a.hash)}
      </code>
    )
  },
  { chave: 'bytes', cabecalho: 'Tamanho', numerica: true, celula: (a) => tamanho(a.bytes) }
]

const COLUNAS_DE_PENDENCIA: readonly Coluna<PendenciaDeLimpeza>[] = [
  { chave: 'recurso', cabecalho: 'Recurso', celula: (p) => p.recurso },
  {
    chave: 'identificador',
    cabecalho: 'Identificador',
    celula: (p) => (
      <code className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
        {p.identificador}
      </code>
    )
  },
  { chave: 'motivo', cabecalho: 'Motivo', celula: (p) => p.motivo }
]

/**
 * Uma medida do run.
 *
 * Rótulo acima, valor abaixo — e não a métrica gigante com label minúscula que o dashboard
 * genérico usa. As quatro têm o mesmo peso porque nenhuma delas manda nas outras: o operador
 * lê as quatro juntas para entender se o run saiu caro, lento ou repetido.
 */
function Medida({ rotulo, valor }: { rotulo: string; valor: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-secundario)]">
        {rotulo}
      </dt>
      <dd className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-medio)] tabular-nums text-[var(--jos-cor-texto)]">
        {valor}
      </dd>
    </div>
  )
}

/** Um par técnico do expansor. Valor em mono e quebrável: SHA tem 40 caracteres. */
function LinhaTecnica({ rotulo, valor }: { rotulo: string; valor: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-secundario)]">
        {rotulo}
      </dt>
      <dd className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto)]">
        {valor}
      </dd>
    </div>
  )
}

export function PainelDeEntrega({ ledger, pendencias }: PainelDeEntregaProps): React.JSX.Element {
  const [detalhes, setDetalhes] = useState(false)
  const desfecho = DESFECHOS[ledger.estadoFinal]

  return (
    <Panel titulo="Resultado da entrega" tom={desfecho.tom}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Badge tom={desfecho.tom} comPonto>
            {desfecho.rotulo}
          </Badge>
          <p className="max-w-[68ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            {desfecho.decisao}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Medida rotulo="Custo" valor={usd(ledger.custoUsd)} />
          <Medida rotulo="Duração" valor={duracao(ledger.duracaoMs)} />
          <Medida rotulo="Tentativas" valor={String(ledger.tentativas)} />
          <Medida rotulo="Tokens" valor={ledger.tokens.toLocaleString('pt-BR')} />
        </dl>

        {ledger.artefatos.length > 0 && (
          <Table
            legenda="Artefatos do run, referenciados por hash"
            colunas={COLUNAS_DE_ARTEFATO}
            linhas={ledger.artefatos}
            chaveDaLinha={(a) => a.hash}
          />
        )}

        {pendencias.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-warn)]">
              Pendências de limpeza
            </h3>
            <p className="max-w-[68ch] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
              A limpeza não conseguiu devolver estes recursos. Nada do trabalho foi perdido: a
              reconciliação os retoma no próximo início.
            </p>
            <Table
              legenda="Recursos que a limpeza não removeu"
              colunas={COLUNAS_DE_PENDENCIA}
              linhas={pendencias}
              chaveDaLinha={(p) => `${p.recurso}:${p.identificador}`}
            />
          </section>
        )}

        <Button
          variante="secundaria"
          onClick={() => setDetalhes((aberto) => !aberto)}
          aria-expanded={detalhes}
          aria-controls="painel-entrega-detalhes"
        >
          Detalhes técnicos
        </Button>

        {detalhes && (
          <div
            id="painel-entrega-detalhes"
            className="flex flex-col gap-4 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-4"
          >
            <dl className="flex flex-col gap-3">
              {ledger.headSha !== undefined && (
                <LinhaTecnica rotulo="Head verificado" valor={ledger.headSha} />
              )}
              {ledger.mergeSha !== undefined && (
                <LinhaTecnica rotulo="Merge confirmado" valor={ledger.mergeSha} />
              )}
              <LinhaTecnica rotulo="Encerrado em" valor={ledger.encerradoEm} />
            </dl>

            {ledger.checks.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {ledger.checks.map((check) => (
                  <li key={check.nome}>
                    <Badge tom={check.conclusao === 'success' ? 'ok' : 'warn'}>
                      {check.nome}: {check.conclusao}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            <ol className="flex flex-col gap-1 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
              {ledger.eventos.map((evento) => (
                <li key={`${evento.em}-${evento.oQue}`}>
                  <time dateTime={evento.em}>{evento.em}</time> {evento.oQue}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Panel>
  )
}
