/**
 * Padrões operacionais (SPEC-DesignSystem-04b, PRD §12; critérios 1, 4 e 5).
 *
 * **Fronteira dura, e ela é o assunto desta fatia.** Risco e aprovação aqui são *UI*: o
 * `ApprovalDialog` mostra impacto, risco e custo e emite um callback — quem **decide** é o Policy
 * Engine, no main (ARCHITECTURE: "Main não decide política sozinho"). Nenhum componente daqui
 * enforça, executa ou vê segredo.
 *
 * Isso não é uma limitação a contornar depois: um design system que decidisse política teria a
 * decisão em dois lugares, e o dia em que divergissem seria o dia em que a UI aprovaria o que o
 * runtime bloqueia. Por isso tudo entra por props tipadas.
 */

import { RefreshCw } from 'lucide-react'
import { AlertDialog, Badge, Button, Card, InlineAlert } from '../ui'
import {
  CLASSE_TEXTO_SEMANTICO,
  ICONE_SEMANTICO,
  NOME_DO_TOM,
  type TomSemantico
} from '../ui/semantica'
import { cx } from '../ui/base'
import { redigirLinhas } from './redigir'

/* ────────────────────────────── Status (critério 4) ────────────────────────────── */

/**
 * Estados de sincronização — PRD §12.4, os cinco que a spec nomeia.
 *
 * `pendente` e `andamento` parecem próximos e não são: *andamento* é "está subindo agora",
 * *pendente* é "há coisa a subir e ninguém está subindo". Quem vê o segundo sabe que precisa de
 * conexão; quem vê o primeiro só espera.
 */
export type EstadoSync = 'concluida' | 'andamento' | 'offline' | 'pendente' | 'falha'

const TOM_DO_SYNC: Readonly<Record<EstadoSync, TomSemantico>> = {
  concluida: 'ok',
  andamento: 'info',
  offline: 'warn',
  pendente: 'warn',
  falha: 'err'
}

/**
 * Rótulo de cada estado — **texto, não só cor** (critério 4).
 *
 * A régua da F03a vale aqui: quem não distingue verde de âmbar precisa do rótulo, e quem usa
 * leitor de tela precisa que ele esteja no DOM. `offline` e `pendente` compartilham o tom `warn`
 * justamente por isso — a cor não os separa, o texto sim.
 */
const ROTULO_SYNC: Readonly<Record<EstadoSync, string>> = {
  concluida: 'Sincronizado',
  andamento: 'Sincronizando',
  offline: 'Offline',
  pendente: 'Pendente',
  falha: 'Falha na sincronização'
}

export function SyncStatus({
  estado,
  detalhe
}: {
  readonly estado: EstadoSync
  readonly detalhe?: string
}): React.JSX.Element {
  const tom = TOM_DO_SYNC[estado]
  const Icone = ICONE_SEMANTICO[tom]

  return (
    <span
      data-jos-sync={estado}
      // `role="status"` e não `alert`: sync é informação de contexto. Um `alert` a cada
      // sincronização interromperia a leitura do usuário várias vezes por minuto.
      role="status"
      className="inline-flex items-center gap-1.5 text-[length:var(--jos-texto-mini)]"
    >
      <Icone size={14} aria-hidden className={CLASSE_TEXTO_SEMANTICO[tom]} />
      <span className={CLASSE_TEXTO_SEMANTICO[tom]}>{ROTULO_SYNC[estado]}</span>
      {detalhe !== undefined && (
        <span className="text-[var(--jos-cor-texto-suave)]">· {detalhe}</span>
      )}
    </span>
  )
}

/** Estados de execução, agente, serviço, provider e conector — o mesmo padrão texto+ícone+cor. */
export type EstadoOperacional = 'ativo' | 'inativo' | 'degradado' | 'erro' | 'executando'

/**
 * Tom por estado. `inativo` mapeia para `undefined` — **ausência de tom**, não um tom neutro.
 *
 * `TomSemantico` tem quatro valores (`ok/info/warn/err`) e não inclui neutro, o que é correto:
 * as semânticas existem para comunicar *estado do sistema*, e "desligado" não é um estado
 * semântico — é a falta de um. Inventar um quinto tom aqui espalharia um conceito novo pelo DS
 * inteiro para servir um único caso.
 */
const TOM_OPERACIONAL: Readonly<Record<EstadoOperacional, TomSemantico | undefined>> = {
  ativo: 'ok',
  executando: 'info',
  inativo: undefined,
  degradado: 'warn',
  erro: 'err'
}

/**
 * Indicador de estado operacional.
 *
 * Um componente para agente, serviço, provider, conector e execução — a spec lista seis nomes,
 * e seriam seis cópias do mesmo `texto + ícone + cor`. O que muda entre eles é o **rótulo**, que
 * vem por prop. É a mesma disciplina anti-duplicação da F05.
 */
export function StatusOperacional({
  estado,
  rotulo,
  descricao
}: {
  readonly estado: EstadoOperacional
  readonly rotulo: string
  readonly descricao?: string
}): React.JSX.Element {
  const tom = TOM_OPERACIONAL[estado]

  return (
    <span
      data-jos-status={estado}
      role="status"
      className="inline-flex items-center gap-2 text-[length:var(--jos-texto-mini)]"
    >
      <Badge tom={tom} comPonto>
        {rotulo}
      </Badge>
      {/* O nome do tom em texto: sem ele, "ativo" e "degradado" só diferem pela cor do badge. */}
      <span className="sr-only">{tom === undefined ? 'inativo' : NOME_DO_TOM[tom]}</span>
      {descricao !== undefined && (
        <span className="text-[var(--jos-cor-texto-suave)]">{descricao}</span>
      )}
    </span>
  )
}

/* ─────────────────────── Risco e aprovação (critério 1) ─────────────────────── */

export type NivelDeRisco = 'baixo' | 'medio' | 'alto' | 'bloqueado'

const TOM_DO_RISCO: Readonly<Record<NivelDeRisco, TomSemantico>> = {
  baixo: 'ok',
  medio: 'warn',
  alto: 'err',
  bloqueado: 'err'
}

const ROTULO_RISCO: Readonly<Record<NivelDeRisco, string>> = {
  baixo: 'Risco baixo',
  medio: 'Risco médio',
  alto: 'Risco alto',
  bloqueado: 'Bloqueado'
}

/**
 * Indicador de risco.
 *
 * O PRD §15 é explícito: *"estados de risco usam texto explícito e não podem ser retematizados
 * pelo usuário"*. Por isso lê `--jos-cor-err/warn/ok`, que são semânticas de marca — imutáveis
 * — e nunca `--jos-cor-acento`, que o usuário escolhe. Um risco alto pintado com o acento verde
 * escolhido pelo usuário deixaria de comunicar risco.
 */
export function RiskIndicator({ nivel }: { readonly nivel: NivelDeRisco }): React.JSX.Element {
  const tom = TOM_DO_RISCO[nivel]
  const Icone = ICONE_SEMANTICO[tom]

  return (
    <span
      data-jos-risco={nivel}
      className={cx(
        'inline-flex items-center gap-1.5 text-[length:var(--jos-texto-mini)]',
        CLASSE_TEXTO_SEMANTICO[tom]
      )}
    >
      <Icone size={14} aria-hidden />
      {ROTULO_RISCO[nivel]}
    </span>
  )
}

export interface AcaoSensivel {
  /** O que será feito, em linguagem de usuário — não o `ActionId` técnico. */
  readonly acao: string
  readonly solicitante: string
  /** O que muda no mundo se isto for aprovado. */
  readonly impacto: string
  readonly risco: NivelDeRisco
  /** Custo estimado, já formatado. Dado mock nesta fatia (decisão do PI: Corte 3). */
  readonly custoEstimado?: string
  readonly escopo?: string
}

/**
 * Resumo da ação sensível — o que o usuário lê **antes** de decidir (critério 1).
 *
 * Os cinco campos do critério (ação, solicitante, impacto, risco, custo) não são um formulário
 * bonito: são a diferença entre aprovar informado e clicar em "sim". Por isso `acao`,
 * `solicitante`, `impacto` e `risco` são **obrigatórios** no tipo — um resumo sem impacto é
 * exatamente a confirmação genérica que a spec proíbe.
 */
export function SensitiveActionSummary({
  acao
}: {
  readonly acao: AcaoSensivel
}): React.JSX.Element {
  const linhas: readonly { readonly rotulo: string; readonly valor: string }[] = [
    { rotulo: 'Ação', valor: acao.acao },
    { rotulo: 'Solicitante', valor: acao.solicitante },
    { rotulo: 'Impacto', valor: acao.impacto },
    ...(acao.escopo !== undefined ? [{ rotulo: 'Escopo', valor: acao.escopo }] : []),
    ...(acao.custoEstimado !== undefined
      ? [{ rotulo: 'Custo estimado', valor: acao.custoEstimado }]
      : [])
  ]

  return (
    <div data-jos-resumo-sensivel className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[length:var(--jos-texto-mini)]">
        {linhas.map((linha) => (
          <div key={linha.rotulo} className="contents">
            <dt className="font-[family-name:var(--jos-fonte-mono)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
              {linha.rotulo}
            </dt>
            <dd className="text-[var(--jos-cor-texto)]">{linha.valor}</dd>
          </div>
        ))}
      </dl>
      <RiskIndicator nivel={acao.risco} />
    </div>
  )
}

/**
 * Diálogo de aprovação (critério 1).
 *
 * Sobre o `AlertDialog` da F03b, que já traz o contrato do destrutivo: clique fora inerte, Escape
 * cancela e nunca confirma. O que esta camada acrescenta é o **conteúdo obrigatório** — o resumo
 * antes da confirmação — e o **verbo específico**.
 *
 * `verboConfirmar` não tem default de propósito. Um `'Confirmar'` padrão é exatamente a
 * confirmação genérica que o critério proíbe: quem monta o diálogo é obrigado a escrever o que o
 * botão faz ("Executar deploy", "Remover chave"), porque só quem conhece a ação sabe nomeá-la.
 */
export function ApprovalDialog({
  aberto,
  acao,
  verboConfirmar,
  onAprovar,
  onRecusar
}: {
  readonly aberto: boolean
  readonly acao: AcaoSensivel
  readonly verboConfirmar: string
  readonly onAprovar: () => void
  readonly onRecusar: () => void
}): React.JSX.Element {
  return (
    <AlertDialog
      aberto={aberto}
      titulo={`Aprovar: ${acao.acao}`}
      descricao={acao.impacto}
      verboConfirmar={verboConfirmar}
      onConfirmar={onAprovar}
      onFechar={onRecusar}
    >
      <SensitiveActionSummary acao={acao} />
    </AlertDialog>
  )
}

/* ──────────────── Operação e diagnóstico (critérios 3 e 5) ──────────────── */

/**
 * Visor de log com **redaction antes de exibir** (critério 3, PRD §15).
 *
 * A redaction não é opcional nem uma prop: acontece sempre, dentro do componente. Uma prop
 * `redigir={true}` seria uma que alguém esquece de passar — e o esquecimento aparece como
 * segredo na tela.
 *
 * Ver `redigir.ts` para o limite honesto do que a regex cobre: esta é a segunda camada, a
 * primeira é o `redact()` do main, que impede o segredo de chegar ao arquivo.
 */
export function LogViewer({
  linhas,
  rotulo = 'Registro'
}: {
  readonly linhas: readonly string[]
  readonly rotulo?: string
}): React.JSX.Element {
  const seguras = redigirLinhas(linhas)

  return (
    <div data-jos-logviewer className="flex flex-col gap-2">
      <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
        {rotulo}
      </span>
      <pre
        // `tabIndex` para que quem navega por teclado consiga rolar a região.
        tabIndex={0}
        aria-label={rotulo}
        className="max-h-64 overflow-auto rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-3 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]"
      >
        {seguras.join('\n')}
      </pre>
    </div>
  )
}

/**
 * Runtime indisponível + ação de reiniciar (critério 5).
 *
 * O diagnóstico copiável passa pela **mesma** redaction do `LogViewer` — e é aqui que ela mais
 * importa: um diagnóstico é justamente o texto que o usuário cola num chat de suporte. Se o
 * segredo sobreviver à cópia, ele sai do dispositivo.
 *
 * `onReiniciar` é opcional porque nem toda falha permite reinício ("quando permitido", diz o
 * critério) — e um botão que não faz nada é pior que a ausência dele.
 */
export function RuntimeUnavailable({
  mensagem,
  diagnostico,
  onReiniciar,
  onCopiarDiagnostico
}: {
  readonly mensagem: string
  readonly diagnostico: readonly string[]
  readonly onReiniciar?: () => void
  /** Recebe o texto **já redigido** — o componente nunca entrega o original. */
  readonly onCopiarDiagnostico?: (textoRedigido: string) => void
}): React.JSX.Element {
  const redigido = redigirLinhas(diagnostico).join('\n')

  return (
    <Card titulo="Runtime indisponível">
      <div data-jos-runtime-indisponivel className="flex flex-col gap-3">
        <InlineAlert tom="err" titulo="O runtime não está respondendo">
          {mensagem}
        </InlineAlert>

        <LogViewer linhas={diagnostico} rotulo="Diagnóstico" />

        <div className="flex flex-wrap gap-2">
          {onCopiarDiagnostico !== undefined && (
            <Button variante="secundaria" onClick={() => onCopiarDiagnostico(redigido)}>
              Copiar diagnóstico
            </Button>
          )}
          {onReiniciar !== undefined && (
            <Button onClick={onReiniciar}>
              <RefreshCw size={16} aria-hidden />
              Reiniciar runtime
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Aviso de operação offline — PRD §12.4. */
export function OfflineBanner({ detalhe }: { readonly detalhe?: string }): React.JSX.Element {
  return (
    <InlineAlert tom="warn" titulo="Você está offline">
      {detalhe ?? 'As alterações ficam no dispositivo e sobem quando a conexão voltar.'}
    </InlineAlert>
  )
}

/** Aviso de sincronização pendente — PRD §12.4. */
export function PendingSyncNotice({
  quantidade
}: {
  readonly quantidade: number
}): React.JSX.Element {
  return (
    <InlineAlert tom="info" titulo="Sincronização pendente">
      {quantidade === 1
        ? '1 alteração aguardando envio.'
        : `${quantidade} alterações aguardando envio.`}
    </InlineAlert>
  )
}
