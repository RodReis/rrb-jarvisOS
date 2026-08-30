import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  BloqueioExterno,
  PacoteEstrutural,
  PacoteOutcome,
  PacoteReason
} from '@shared/domain/pacote-estrutural'
import { Badge, Button, Field, InlineAlert, Input, LoadingState, Separator } from '@design/ui'
import { log } from '../lib/log'

/**
 * O pacote estrutural do projeto (SPEC-Planejamento-04).
 *
 * **A tela não escreve documento.** Não há editor, nem campo de conteúdo: ela pede a geração e
 * mostra o que voltou. O conteúdo é composto no main a partir das decisões do wizard e das
 * evidências extraídas — um campo de texto aqui seria o caminho por onde uma afirmação sem
 * origem entraria, que é o que os critérios 1 e 5 existem para impedir.
 *
 * Três garantias vivem na fronteira, não aqui:
 *  - **A tela não decide se a pesquisa bastou.** Ela mostra o `BloqueioExterno` que voltou, com
 *    os cinco campos que a `CONVENTION.md` §4 exige.
 *  - **A tela não sabe compor.** Nenhuma regra de seção mora no renderer.
 *  - **A tela não julga evidência.** O verificador é do main.
 *
 * **Sobre a forma.** O bloqueio é a peça de destaque, e não um toast que some: ele carrega a
 * ação de retomada, e é a única coisa que o PI pode fazer a respeito. Esconder isso atrás de uma
 * notificação efêmera o obrigaria a lembrar o que dizia — pelo mesmo motivo que a M8-F01 pôs a
 * correção *dentro* do alerta, e não numa tela distante.
 */

interface PacoteDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
}

/**
 * Tom do `InlineAlert` por desfecho. Mapa fechado, como o `TOM_POR_MOTIVO` das telas irmãs: um
 * motivo novo no contrato quebra a compilação aqui em vez de cair num default silencioso.
 *
 * `decisoes-incompletas` e `pesquisa-bloqueada` são **`warn`, não `err`**: nada quebrou. Falta
 * um passo, e os dois dizem qual — pintar de vermelho ensinaria a ler um estado normal do fluxo
 * como falha.
 */
const TOM_POR_MOTIVO: Readonly<Record<PacoteReason, 'ok' | 'err' | 'warn'>> = {
  gerado: 'ok',
  'projeto-inexistente': 'err',
  'decisoes-incompletas': 'warn',
  'pesquisa-bloqueada': 'warn',
  'falha-de-escrita': 'err'
}

export function PacoteDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto
}: PacoteDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [pacotes, setPacotes] = useState<readonly PacoteEstrutural[] | undefined>(undefined)
  const [consulta, setConsulta] = useState('')
  const [gerando, setGerando] = useState(false)
  const [desfecho, setDesfecho] = useState<PacoteOutcome | null>(null)

  const buscar = useCallback(
    (): Promise<readonly PacoteEstrutural[]> => window.jarvis.listarPacotes(projectId),
    [projectId]
  )

  useEffect(() => {
    let ativo = true

    buscar()
      .then((lista) => {
        if (ativo) setPacotes(lista)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao listar os pacotes do projeto', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
        setPacotes([])
      })

    return () => {
      ativo = false
    }
  }, [projectId, buscar])

  async function gerar(): Promise<void> {
    setGerando(true)
    try {
      const resultado = await window.jarvis.gerarPacote(projectId, consulta, workspace)
      setDesfecho(resultado)
      if (resultado.reason === 'gerado') setPacotes(await buscar())
    } catch (causa: unknown) {
      log.ui.error('Falha ao gerar o pacote estrutural', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setGerando(false)
    }
  }

  const ultimo = pacotes?.[0]

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`pacote-${projectId}`}>
      <header className="flex flex-col gap-1">
        <h3
          id={`pacote-${projectId}`}
          className="flex items-center gap-2 font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)]"
        >
          <FileText aria-hidden="true" className="size-4" />
          {t('pacote.titulo')}
        </h3>
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('pacote.descricao', { nome: nomeDoProjeto })}
        </p>
      </header>

      <Field rotulo={t('pacote.consulta')} descricao={t('pacote.consultaAjuda')}>
        {(atributos) => (
          <Input
            {...atributos}
            valor={consulta}
            onMudar={setConsulta}
            desabilitado={gerando}
            placeholder={t('pacote.consultaPlaceholder')}
          />
        )}
      </Field>

      <div className="flex justify-end">
        <Button onClick={() => void gerar()} carregando={gerando} desabilitado={gerando}>
          {t('pacote.gerar')}
        </Button>
      </div>

      {desfecho !== null && (
        <InlineAlert tom={TOM_POR_MOTIVO[desfecho.reason]} titulo={desfecho.mensagem}>
          {desfecho.pendencias !== undefined && desfecho.pendencias.length > 0 && (
            <p className="text-[length:var(--jos-texto-micro)]">
              {t('pacote.pendencias', { lista: desfecho.pendencias.join(', ') })}
            </p>
          )}
        </InlineAlert>
      )}

      {desfecho?.bloqueio !== undefined && <Bloqueio bloqueio={desfecho.bloqueio} />}

      <Separator />

      {pacotes === undefined ? (
        <LoadingState rotulo={t('pacote.carregando')} />
      ) : ultimo === undefined ? (
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {t('pacote.vazio')}
        </p>
      ) : (
        <RevisaoGerada pacote={ultimo} total={pacotes.length} />
      )}
    </section>
  )
}

/**
 * O bloqueio, com os cinco campos da `CONVENTION.md` §4 à vista.
 *
 * Os cinco aparecem porque *"sem esses campos, o bloqueio é inválido"* — e um bloqueio que
 * mostrasse só a mensagem deixaria o PI sem saber o que tentar, quantas vezes já se tentou, nem
 * por que não vale seguir assim mesmo.
 */
function Bloqueio({ bloqueio }: { readonly bloqueio: BloqueioExterno }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <dl className="flex flex-col gap-2 rounded-[var(--jos-raio-chip)] border border-[color-mix(in_srgb,var(--jos-cor-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--jos-cor-warn)_8%,transparent)] px-3 py-2.5 text-[length:var(--jos-texto-micro)]">
      {(
        [
          ['causa', bloqueio.causa],
          ['evidencia', bloqueio.evidencia],
          ['tentativas', String(bloqueio.tentativas)],
          ['porQueNaoSeguir', bloqueio.porQueNaoSeguir],
          ['retomada', bloqueio.retomada]
        ] as const
      ).map(([chave, valor]) => (
        <div key={chave} className="flex flex-col gap-0.5">
          <dt className="font-mono uppercase text-[var(--jos-cor-texto-suave)]">
            {t(`pacote.bloqueio.${chave}`)}
          </dt>
          <dd className="text-[var(--jos-cor-texto-secundario)]">{valor}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A revisão gerada: os três documentos com seus hashes e o commit.
 *
 * O hash aparece truncado na tela e completo no rótulo acessível — mesma postura do manifesto da
 * M8-F02: truncar é economia de largura, não de informação, e quem ouve a lista não tem `title`
 * para consultar.
 */
function RevisaoGerada({
  pacote,
  total
}: {
  readonly pacote: PacoteEstrutural
  readonly total: number
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-mono text-[length:var(--jos-texto-micro)] uppercase text-[var(--jos-cor-texto-suave)]">
          {t('pacote.revisao', { count: total })}
        </h4>
        {pacote.commitHash === null ? (
          <Badge tom="warn">{t('pacote.semCommit')}</Badge>
        ) : (
          <Badge tom="ok">
            <span
              className="font-mono"
              aria-label={t('pacote.commitCompleto', { hash: pacote.commitHash })}
            >
              {pacote.commitHash.slice(0, 8)}
            </span>
          </Badge>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {pacote.documentos.map((doc) => (
          <li key={doc.documento} className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--jos-texto-micro)]">
              {doc.caminho}
            </span>
            <span className="shrink-0 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
              {t('pacote.afirmacoes', { count: doc.afirmacoes.length })}
            </span>
            <span
              className="shrink-0 font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
              aria-label={t('pacote.hashCompleto', { hash: doc.hash })}
            >
              {doc.hash.slice(0, 12)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
