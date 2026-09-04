import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Disclosure, Spinner } from '@design/ui'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EstadoDoMarco, LinhaDeMarco, VistaDeMarcos } from '@shared/domain/marcos'
import type { MarcoDocumental } from '@shared/domain/projects'

/**
 * O painel de marcos (SPEC-Fases-04 § Painel).
 *
 * Responde uma pergunta que a tela do projeto não respondia: **o que o PI aceitou está no Git?**
 * Cada linha é um documento do planejamento, com o estado, o commit e a coerência entre o blob
 * commitado e a revisão aceita.
 *
 * ## Estado não é comunicado só por cor (PRD §14)
 *
 * O `Badge` com tom carrega cor **e** ícone, e o rótulo diz a mesma coisa em palavra. Quem olha
 * de relance lê a forma; quem não distingue as cores lê o texto; os dois leem a mesma coisa. Um
 * ponto colorido sozinho seria o atalho que a régua proíbe.
 *
 * ## O botão não commita — ele retoma
 *
 * "Commitar marco" chama `completeMilestone`, a retomada da M8-F01, e não um commit próprio. É o
 * critério 3 e a decisão da M9-F01 ao mesmo tempo: existe **um** caminho de escrita no Git, e ele
 * não passa por aqui. Não há canal `marcos:commitar` para esta tela chamar mesmo que quisesse.
 */

/** O tom semântico de cada estado. Dado, não lógica — mesma postura do `MENSAGEM_DO_MARCO`. */
const TOM_DO_ESTADO: Readonly<Record<EstadoDoMarco, 'ok' | 'info' | 'warn'>> = {
  commitado: 'ok',
  'sem-revisao': 'info',
  'revisao-sem-commit': 'warn',
  'blob-divergente': 'warn'
}

/**
 * O rótulo de cada estado.
 *
 * `blob-divergente` vira *"commit desatualizado"* de propósito: "blob" é vocabulário de Git, e a
 * pergunta que o PI faz é sobre o documento dele, não sobre o objeto interno do repositório. O
 * detalhe técnico fica na descrição, onde quem procura encontra.
 */
const ROTULO_DO_ESTADO: Readonly<Record<EstadoDoMarco, string>> = {
  commitado: 'versionado',
  'sem-revisao': 'sem revisão',
  'revisao-sem-commit': 'sem commit',
  'blob-divergente': 'commit desatualizado'
}

const DESCRICAO_DO_ESTADO: Readonly<Record<EstadoDoMarco, string>> = {
  commitado: 'O commit contém exatamente a revisão aceita.',
  'sem-revisao': 'Ainda não há revisão aceita deste documento.',
  'revisao-sem-commit': 'A revisão foi aceita, mas nunca virou commit.',
  'blob-divergente': 'O commit guarda uma versão anterior à que foi aceita.'
}

/**
 * O marco que commita cada documento.
 *
 * O mapa é por documento porque é assim que a M8-F01 nomeia os commits: cada marco tem mensagem
 * própria e determinística. Um documento fora do mapa não ganha botão — melhor não oferecer a
 * ação do que oferecer uma que commitaria com a mensagem errada.
 */
const MARCO_DO_DOCUMENTO: Readonly<Record<string, MarcoDocumental>> = {
  'docs/PRD.md': 'prd-aprovado',
  'docs/ARCHITECTURE.md': 'arquitetura-aprovada',
  'docs/DESIGN-SYSTEM.md': 'design-anexado',
  'docs/PROMPT.md': 'prompt-registrado'
}

interface MarcosDoProjetoProps {
  readonly projectId: string
  readonly workspace: WorkspaceId
}

export function MarcosDoProjeto({
  projectId,
  workspace
}: MarcosDoProjetoProps): React.JSX.Element | null {
  const [vista, setVista] = useState<VistaDeMarcos | undefined>(undefined)
  const [carregando, setCarregando] = useState(true)
  const [commitando, setCommitando] = useState<string | undefined>(undefined)

  /**
   * A leitura em si. Não mexe em `carregando` — quem o liga é quem chama, e a distinção importa:
   * na montagem o estado já **nasce** carregando, e um `setState` síncrono no efeito encadearia
   * um render a mais sem mudar nada (`react-hooks/set-state-in-effect`).
   */
  const ler = useCallback(() => {
    return window.jarvis
      .marcosDoProjeto(projectId, workspace)
      .then(setVista)
      .finally(() => setCarregando(false))
  }, [projectId, workspace])

  /** A releitura pedida pelo PI, ou a que segue um commit: aí sim o spinner precisa voltar. */
  const reler = useCallback(() => {
    setCarregando(true)
    void ler()
  }, [ler])

  // Uma leitura por abertura (spec § Painel): a seção lê ao montar, e daí em diante só quando o
  // PI pede. Reler a cada render faria cada movimento na tela disparar quatro comandos de Git.
  useEffect(() => {
    void ler()
  }, [ler])

  const commitar = useCallback(
    async (caminho: string) => {
      const marco = MARCO_DO_DOCUMENTO[caminho]
      if (marco === undefined) return

      setCommitando(caminho)
      try {
        await window.jarvis.completeMilestone(projectId, marco, workspace)
      } finally {
        setCommitando(undefined)
        reler()
      }
    },
    [projectId, workspace, reler]
  )

  // Projeto sem documento aceito não tem marco a mostrar, e um painel vazio "Marcos" seria o
  // ruído que o console da F03 evita pela mesma razão.
  if (!carregando && vista?.disponivel === true && vista.linhas.length === 0) return null

  const pendentes =
    vista?.linhas.filter(
      (l) => l.estado === 'revisao-sem-commit' || l.estado === 'blob-divergente'
    ).length ?? 0

  return (
    <Disclosure
      rotulo="Marcos"
      resumo={<ResumoDosMarcos vista={vista} pendentes={pendentes} />}
    >
      <div className="flex flex-col gap-3">
        {carregando && vista === undefined ? (
          <div className="flex items-center gap-2 py-4 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            <Spinner rotulo="Lendo o repositório" tamanho="pequeno" />
            Lendo o repositório do projeto.
          </div>
        ) : vista?.disponivel === false ? (
          // O motivo, e não uma lista vazia: lista vazia seria lida como "nenhum documento",
          // que é o oposto do que aconteceu.
          <p className="py-2 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-warn-leitura)]">
            {vista.mensagem}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {(vista?.linhas ?? []).map((linha) => (
                <LinhaDoMarco
                  key={linha.caminho}
                  linha={linha}
                  commitando={commitando === linha.caminho}
                  onCommitar={() => void commitar(linha.caminho)}
                />
              ))}
            </ul>

            <EstadoDoRepositorio vista={vista} />

            <div className="flex justify-end">
              <Button variante="secundaria" onClick={reler} desabilitado={carregando}>
                Verificar de novo
              </Button>
            </div>
          </>
        )}
      </div>
    </Disclosure>
  )
}

function ResumoDosMarcos({
  vista,
  pendentes
}: {
  readonly vista: VistaDeMarcos | undefined
  readonly pendentes: number
}): React.JSX.Element {
  const sujo = (vista?.repositorio.sujos.length ?? 0) > 0

  return (
    <span className="flex items-center gap-2">
      {pendentes > 0 && (
        <Badge tom="warn">
          {pendentes} {pendentes === 1 ? 'pendência' : 'pendências'}
        </Badge>
      )}
      {sujo && <Badge tom="warn">árvore suja</Badge>}
      {pendentes === 0 && !sujo && vista?.disponivel === true && <Badge tom="ok">versionado</Badge>}
    </span>
  )
}

function LinhaDoMarco({
  linha,
  commitando,
  onCommitar
}: {
  readonly linha: LinhaDeMarco
  readonly commitando: boolean
  readonly onCommitar: () => void
}): React.JSX.Element {
  const precisaCommit = linha.estado === 'revisao-sem-commit' || linha.estado === 'blob-divergente'
  const temMarco = MARCO_DO_DOCUMENTO[linha.caminho] !== undefined

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[rgba(var(--jos-borda-rgb),0.08)] py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[length:var(--jos-texto-corpo)]">
        {linha.caminho}
      </span>

      {/* O hash curto em tabular: são sete dígitos hexadecimais que o PI compara com o `git log`,
          e a largura variável faria a coluna dançar entre uma linha e a seguinte. */}
      {linha.commit !== undefined && (
        <code className="font-mono text-[length:var(--jos-texto-micro)] tabular-nums text-[var(--jos-cor-texto-suave)]">
          {linha.commit.slice(0, 7)}
        </code>
      )}

      {linha.data !== undefined && (
        <time
          dateTime={linha.data}
          className="text-[length:var(--jos-texto-micro)] tabular-nums text-[var(--jos-cor-texto-suave)]"
        >
          {dataCurta(linha.data)}
        </time>
      )}

      <Badge tom={TOM_DO_ESTADO[linha.estado]}>{ROTULO_DO_ESTADO[linha.estado]}</Badge>

      {precisaCommit && temMarco && (
        <Button
          variante="secundaria"
          onClick={onCommitar}
          desabilitado={commitando}
          carregando={commitando}
        >
          Commitar marco
        </Button>
      )}

      {/* A explicação em texto, e não num `title`: tooltip de mouse não existe para quem navega
          por teclado, e é justamente o estado pendente que precisa ser entendido. */}
      {precisaCommit && (
        <p className="w-full text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {DESCRICAO_DO_ESTADO[linha.estado]}
        </p>
      )}
    </li>
  )
}

function EstadoDoRepositorio({
  vista
}: {
  readonly vista: VistaDeMarcos | undefined
}): React.JSX.Element | null {
  if (vista === undefined) return null

  const { sujos, publicadoEm, headInterrompido } = vista.repositorio

  return (
    <div className="flex flex-col gap-1 border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-3 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
      {headInterrompido && (
        <p className="text-[var(--jos-cor-warn-leitura)]">
          Há um merge ou rebase interrompido. Conclua ou aborte a operação antes de aceitar a SPEC.
        </p>
      )}

      {/* Só os caminhos, nunca o conteúdo (critério 2): o painel fala sobre versionamento, e
          mostrar o diff exporia texto do usuário numa tela que não é para isso. */}
      <p>
        {sujos.length === 0
          ? 'Árvore limpa.'
          : `${sujos.length} ${sujos.length === 1 ? 'arquivo' : 'arquivos'} sem commit: ${sujos.join(', ')}`}
      </p>

      <p>
        {publicadoEm === undefined
          ? 'Não publicado.'
          : `Publicado em ${publicadoEm.slice(0, 7)}.`}
      </p>
    </div>
  )
}

/** Data curta pt-BR. O ano fica de fora: a coluna fala de dias, não de anos. */
function dataCurta(iso: string): string {
  const data = new Date(iso)
  return Number.isNaN(data.getTime())
    ? ''
    : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
