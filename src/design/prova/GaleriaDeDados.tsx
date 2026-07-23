import { useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { ProvedorDeTema } from '../tokens/provider'
import type { CorAcento } from '../tokens/acento'
import type { ModoUi, Modulo } from '../tokens/semantic'
import {
  AlertDialog,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  Meter,
  Panel,
  Progress,
  Separator,
  Skeleton,
  Spinner,
  Table,
  Tag,
  ToastProvider,
  Tooltip,
  TooltipProvider,
  Tree,
  useToast,
  type Coluna,
  type TomSemantico
} from '../ui'

/**
 * Galeria de prova de dados, overlays e feedback (SPEC-DesignSystem-03b).
 *
 * Irmã da `GaleriaDeControles` (F03a) e com o mesmo propósito: medir num navegador de verdade o
 * que jsdom não mede — contraste **computado**, layout real, o glass do toast, a barra lateral, o
 * anel de foco pintado.
 *
 * A diferença de forma vem do assunto: metade desta fatia só existe **aberta**. Um `Dialog`
 * fechado não tem o que capturar, e um toast que ninguém disparou não está na tela. Por isso a
 * galeria aceita `cena` na query: cada cena monta um estado diferente, e o Playwright captura
 * uma por vez. Renderizar tudo aberto ao mesmo tempo empilharia cinco backdrops opacos e não
 * mostraria nenhum.
 */

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  /** Qual estado montar. `estatica` é o padrão: tudo que existe sem interação. */
  readonly cena?: Cena
}

export type Cena = 'estatica' | 'dialog' | 'alert' | 'drawer' | 'toasts'

const TONS: readonly TomSemantico[] = ['ok', 'info', 'warn', 'err', 'violet']

interface Execucao {
  readonly id: string
  readonly workflow: string
  readonly estado: string
  readonly tom: TomSemantico
  readonly custo: number
}

const EXECUCOES: readonly Execucao[] = [
  { id: 'e1', workflow: 'publicacao-seo', estado: 'Concluída', tom: 'ok', custo: 12 },
  { id: 'e2', workflow: 'sync-contatos', estado: 'Em execução', tom: 'info', custo: 340 },
  { id: 'e3', workflow: 'backup-diario', estado: 'Bloqueada', tom: 'err', custo: 0 }
]

const COLUNAS: ReadonlyArray<Coluna<Execucao>> = [
  { chave: 'workflow', cabecalho: 'Workflow', celula: (l) => l.workflow },
  {
    chave: 'estado',
    cabecalho: 'Estado',
    celula: (l) => (
      <Badge tom={l.tom} comPonto>
        {l.estado}
      </Badge>
    )
  },
  { chave: 'custo', cabecalho: 'Tokens', celula: (l) => l.custo, numerica: true }
]

export function GaleriaDeDados({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'estatica'
}: GaleriaProps): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#FF5C00'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <TooltipProvider>
        <ToastProvider>
          <div
            data-testid="galeria"
            data-cena={cena}
            className="min-h-screen bg-[var(--jos-cor-superficie)] p-8 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
          >
            <div className="mx-auto flex max-w-4xl flex-col gap-10">
              <Cabecalho modo={modo} modulo={modulo} cena={cena} />
              <SecaoSuperficies />
              <SecaoIndicadores />
              <SecaoEstrutura />
              <SecaoFeedback />
              <SecaoVazios />
            </div>
            <Overlays cena={cena} />
            {cena === 'toasts' && <DisparoDeToasts />}
          </div>
        </ToastProvider>
      </TooltipProvider>
    </ProvedorDeTema>
  )
}

function Cabecalho({
  modo,
  modulo,
  cena
}: {
  modo: ModoUi
  modulo: Modulo
  cena: Cena
}): React.JSX.Element {
  return (
    <header className="flex items-baseline justify-between border-b border-[rgba(var(--jos-borda-rgb),0.12)] pb-4">
      <h1 className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] tracking-[var(--jos-tracking-acao)]">
        Dados e overlays
      </h1>
      <p className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
        {modulo} · {modo} · {cena}
      </p>
    </header>
  )
}

function Secao({
  titulo,
  id,
  children
}: {
  titulo: string
  id: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section data-prova={id} className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
        {titulo}
      </h2>
      {children}
    </section>
  )
}

function SecaoSuperficies(): React.JSX.Element {
  return (
    <Secao titulo="Superfícies e rótulos" id="superficies">
      <div className="grid grid-cols-3 gap-4">
        <Card titulo="Execuções hoje">
          <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            14 concluídas, 1 bloqueada.
          </p>
        </Card>
        <Card titulo="Card clicável" interativo onClick={() => {}}>
          <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            Eleva no hover.
          </p>
        </Card>
        <Panel titulo="Execução bloqueada" tom="err">
          <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            A política barrou a etapa de escrita.
          </p>
        </Panel>
      </div>

      {/* Os cinco tons lado a lado: é a linha onde um tom que não sobrevive ao modo claro
          aparece imediatamente contra os outros quatro. */}
      <div className="flex flex-wrap items-center gap-2">
        {TONS.map((tom) => (
          <Badge key={tom} tom={tom} comPonto>
            {tom}
          </Badge>
        ))}
        <Badge>neutro</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tag onRemover={() => {}} rotuloRemover="Remover a tag Finanças">
          Finanças
        </Tag>
        <Tag>Somente leitura</Tag>
        <Avatar nome="Rodrigo Reis" />
        <Avatar nome="Noa" tamanho="pequeno" />
        <Tooltip conteudo="Detalhe que não cabe no rótulo">
          <Button variante="secundaria">Com tooltip</Button>
        </Tooltip>
      </div>

      <Separator />
    </Secao>
  )
}

function SecaoIndicadores(): React.JSX.Element {
  return (
    <Secao titulo="Indicadores" id="indicadores">
      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <Progress valor={68} rotulo="Enviando arquivos" />
          <Progress valor={40} rotulo="Etapa 2 de 5" tom="info" />
          <Progress rotulo="Processando (indeterminado)" />
        </div>
        <div className="flex flex-col gap-3">
          <Meter
            valor={42}
            rotulo="Orçamento usado"
            formatar={(v) => `${v}%`}
            faixas={[
              { ate: 70, tom: 'ok' },
              { ate: 90, tom: 'warn' },
              { ate: 100, tom: 'err' }
            ]}
          />
          <Meter
            valor={82}
            rotulo="Disco do workspace"
            formatar={(v) => `${v}%`}
            faixas={[
              { ate: 70, tom: 'ok' },
              { ate: 90, tom: 'warn' },
              { ate: 100, tom: 'err' }
            ]}
          />
          <Meter
            valor={97}
            rotulo="Cota de tokens"
            formatar={(v) => `${v}%`}
            faixas={[
              { ate: 70, tom: 'ok' },
              { ate: 90, tom: 'warn' },
              { ate: 100, tom: 'err' }
            ]}
          />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <Spinner rotulo="Carregando execuções" />
        <Spinner rotulo="Carregando" tamanho="pequeno" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton largura="60%" />
          <Skeleton largura="90%" />
          <Skeleton altura="3rem" forma="card" />
        </div>
      </div>
    </Secao>
  )
}

function SecaoEstrutura(): React.JSX.Element {
  return (
    <Secao titulo="Estrutura de dados" id="estrutura">
      <Table
        colunas={COLUNAS}
        linhas={EXECUCOES}
        chaveDaLinha={(l) => l.id}
        legenda="Execuções recentes"
        onLinhaClique={() => {}}
      />

      <Tree
        rotulo="Diretórios permitidos"
        nos={[
          {
            id: '1',
            rotulo: 'Documentos',
            filhos: [
              { id: '1a', rotulo: 'Projetos' },
              { id: '1b', rotulo: 'Arquivo' }
            ]
          },
          { id: '2', rotulo: 'Downloads' }
        ]}
      />
    </Secao>
  )
}

function SecaoFeedback(): React.JSX.Element {
  return (
    <Secao titulo="Feedback in-loco" id="feedback">
      {/* Os quatro tons empilhados: é a captura que mostra se `info` e `ok` ficam
          indistinguíveis um do outro no modo claro. */}
      <InlineAlert tom="ok" titulo="Workflow salvo" />
      <InlineAlert tom="info" titulo="Sincronização agendada para 03:00" />
      <InlineAlert tom="warn" titulo="Cota quase no limite" onDispensar={() => {}}>
        Restam 3% do orçamento diário de tokens.
      </InlineAlert>
      <InlineAlert tom="err" titulo="Não foi possível salvar">
        Verifique a conexão com o serviço local.
      </InlineAlert>

      <LoadingState rotulo="Carregando painel">
        <Skeleton largura="45%" />
        <Skeleton largura="80%" />
      </LoadingState>
    </Secao>
  )
}

function SecaoVazios(): React.JSX.Element {
  return (
    <Secao titulo="Estados vazios e de erro" id="vazios">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)]">
          <EmptyState
            titulo="Nenhum workflow"
            descricao="Crie o primeiro para começar."
            icone={<FolderOpen className="size-8" />}
            acao={<Button variante="primaria">Criar workflow</Button>}
          />
        </div>
        <div className="rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)]">
          <ErrorState
            titulo="Falha ao carregar execuções"
            descricao="O serviço local não respondeu."
            onTentarNovamente={() => {}}
          />
        </div>
      </div>
    </Secao>
  )
}

/**
 * Overlays montados **abertos**, um por cena.
 *
 * Sempre `aberto` e com `onFechar` inerte: a captura precisa do estado aberto, e um overlay que
 * fechasse ao primeiro clique do Playwright não estaria lá na hora do screenshot.
 */
function Overlays({ cena }: { readonly cena: Cena }): React.JSX.Element | null {
  const nada = (): void => {}

  if (cena === 'dialog') {
    return (
      <Dialog
        aberto
        onFechar={nada}
        titulo="Editar workflow"
        descricao="As alterações valem a partir da próxima execução."
        rodape={
          <>
            <Button variante="secundaria">Cancelar</Button>
            <Button variante="primaria">Salvar</Button>
          </>
        }
      >
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          O workflow roda em modo simulado até ser aprovado.
        </p>
        <InlineAlert tom="info" titulo="Modo simulado" />
      </Dialog>
    )
  }

  if (cena === 'alert') {
    return (
      <AlertDialog
        aberto
        onFechar={nada}
        onConfirmar={nada}
        titulo="Excluir 3 workflows?"
        descricao="Os workflows e todo o histórico de execução serão removidos. A ação não pode ser desfeita."
        verboConfirmar="Excluir 3 workflows"
      />
    )
  }

  if (cena === 'drawer') {
    return (
      <Drawer aberto onFechar={nada} titulo="Detalhes da execução">
        <Panel titulo="Etapas" tom="info">
          <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            3 de 5 concluídas.
          </p>
        </Panel>
        <Progress valor={60} rotulo="Progresso da execução" />
      </Drawer>
    )
  }

  return null
}

/**
 * Dispara um toast de cada tom para a captura.
 *
 * No efeito e não num `onClick`: a cena precisa estar montada quando o Playwright captura, sem
 * depender de o teste clicar em nada. Dispara uma vez (deps vazias) — o dedupe do provider
 * cobriria a repetição, mas depender dele aqui seria testar o motor pela porta errada.
 */
function DisparoDeToasts(): React.JSX.Element {
  const { disparar } = useToast()

  useEffect(() => {
    const cenas: ReadonlyArray<{ tom: TomSemantico; titulo: string; mensagem?: string }> = [
      { tom: 'ok', titulo: 'Workflow concluído', mensagem: 'publicacao-seo em 12s' },
      { tom: 'info', titulo: 'Sincronização iniciada' },
      { tom: 'warn', titulo: 'Cota quase no limite', mensagem: 'Restam 3% do orçamento' },
      { tom: 'err', titulo: 'Execução bloqueada', mensagem: 'Diretório fora da allowlist' }
    ]
    // Duração longa: o auto-dismiss de 4200 ms fecharia os toasts antes da captura, e a prova
    // registraria uma tela vazia. É ajuste do cenário, não do componente.
    for (const c of cenas) disparar({ ...c, duracao: 600_000 })
  }, [disparar])

  return <span className="sr-only">Toasts disparados para a prova visual.</span>
}
