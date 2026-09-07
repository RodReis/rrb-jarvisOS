import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCheck2, FileCode2, Image, Paperclip } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Anexo, TipoDeAnexo } from '@shared/domain/anexos-de-design'
import type { AchadoDoPrototipo, ValidacaoDoPrototipo } from '@shared/domain/validacao-de-prototipo'
import type { PacoteArquitetura } from '@shared/domain/arquitetura'
import { Badge, Button, InlineAlert, LoadingState, Separator, Tag } from '@design/ui'
import { log } from '../lib/log'

/**
 * Os anexos de design do PI e a arquitetura que eles liberam (SPEC-Planejamento-05).
 *
 * **A tela não anexa; ela pede o ato.** O botão abre o seletor nativo (no main) e, com o caminho
 * escolhido, chama o canal que copia e hasheia. Não há campo de caminho digitável, e a ausência
 * é o desenho: um caminho digitado apontaria para um arquivo que o app não confirmou existir, e
 * o gate conta a partir de um ato verificável, não de uma string.
 *
 * **A forma segue o gate, não a lista.** O que o PI precisa saber ao abrir isto é *o que ainda
 * falta* — então as duas exigências aparecem como linhas com estado próprio, e não como um
 * contador "1 de 2". Um contador informa o progresso e esconde qual metade falta, que é
 * justamente a pergunta. Assets ficam abaixo, separados: eles não são exigência do gate (um
 * protótipo sem imagem está completo), e misturá-los com as exigências ensinaria o contrário.
 *
 * **Os achados são perguntas, e a tela os mostra como perguntas.** A spec pede *"problemas viram
 * perguntas com recomendação"*; renderizá-los como lista de erros vermelhos trocaria a pergunta
 * por veredito e tiraria do PI a decisão que é dele. O que impede a arquitetura aparece com tom
 * de aviso e a recomendação junto; o que é só pergunta fica registrado, sem alarme.
 */

interface AnexosDeDesignProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /**
   * Avisa o pai de que a jornada mudou de etapa.
   *
   * O `AnexoService` conclui o marco `design-anexado` **no ato do anexo**, e esse marco transita
   * `design → arquitetura`. Sem este aviso a trilha continua dizendo *"Conclua 'Anexar design'
   * para chegar aqui"* enquanto o painel ao lado já diz que os anexos estão completos — duas
   * leituras da mesma tela discordando, e a que bloqueia é a errada. Era preciso recarregar a
   * janela para a trilha andar (issue #332).
   *
   * Os painéis das outras etapas recebem o mesmo aviso como `onAceito`; este era o único que
   * mudava a etapa sem ter como dizê-lo.
   */
  readonly onEtapaMudou: () => void
}

/** O ícone de cada tipo. Mesmo vocabulário de ícone em toda a superfície (register product). */
const ICONE_DO_TIPO: Readonly<Record<TipoDeAnexo, typeof FileCheck2>> = {
  'design-system': FileCheck2,
  prototipo: FileCode2,
  asset: Image
}

/** As duas exigências do gate, na ordem em que o PI as cumpre. */
const EXIGENCIAS: readonly Extract<TipoDeAnexo, 'design-system' | 'prototipo'>[] = [
  'design-system',
  'prototipo'
]

export function AnexosDeDesign({
  workspace,
  projectId,
  nomeDoProjeto,
  onEtapaMudou
}: AnexosDeDesignProps): React.JSX.Element {
  const { t } = useTranslation()
  const [anexos, setAnexos] = useState<readonly Anexo[] | undefined>(undefined)
  const [validacoes, setValidacoes] = useState<readonly ValidacaoDoPrototipo[]>([])
  /* A recusa do **ato de anexar** — extensão incompatível, arquivo inexistente, grande demais.
     Estado próprio desde a SPEC-Jornada-04: antes ela viajava no desfecho da arquitetura, que
     saiu desta tela. Fundi-los fazia uma recusa de anexo parecer um problema da geração. */
  const [falhaAoAnexar, setFalhaAoAnexar] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'nao' | 'anexando' | 'validando'>('nao')
  const [arquiteturas, setArquiteturas] = useState<readonly PacoteArquitetura[]>([])

  /**
   * Busca o estado do projeto: anexos e arquiteturas juntos.
   *
   * As duas chamadas em paralelo porque são independentes — encadeá-las somaria as latências
   * sem nenhuma depender da outra.
   */
  const buscar = useCallback(
    (): Promise<readonly [readonly Anexo[], readonly PacoteArquitetura[]]> =>
      Promise.all([
        window.jarvis.listarAnexos(projectId),
        window.jarvis.listarArquiteturas(projectId)
      ]),
    [projectId]
  )

  const aplicar = useCallback(
    ([lista, geradas]: readonly [readonly Anexo[], readonly PacoteArquitetura[]]): void => {
      setAnexos(lista)
      setArquiteturas(geradas)
    },
    []
  )

  useEffect(() => {
    let ativo = true

    buscar()
      .then((resultado) => {
        if (ativo) aplicar(resultado)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao listar os anexos do projeto', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
        setAnexos([])
      })

    return () => {
      ativo = false
    }
  }, [projectId, buscar, aplicar])

  async function anexar(tipo: TipoDeAnexo): Promise<void> {
    setOcupado('anexando')
    try {
      const origem = await window.jarvis.escolherAnexo(tipo)
      // Cancelar o seletor não é desfecho: nada aconteceu, e mostrar um alerta ensinaria a ler
      // "mudei de ideia" como erro.
      if (origem === '') return

      const resultado = await window.jarvis.anexarDesign(projectId, tipo, origem, workspace)
      if (resultado.reason === 'anexado') {
        aplicar(await buscar())
        // O anexo mudou: a validação anterior descreve outro conjunto de arquivos.
        setValidacoes([])
        setFalhaAoAnexar(null)
        // E o marco `design-anexado` acabou de sair no main: a trilha precisa saber, senão ela
        // fica na etapa anterior até alguém recarregar a janela.
        onEtapaMudou()
      } else {
        setFalhaAoAnexar(resultado.mensagem)
      }
    } catch (causa: unknown) {
      log.ui.error('Falha ao anexar', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  async function remover(caminho: string): Promise<void> {
    try {
      await window.jarvis.removerAnexo(projectId, caminho, workspace)
      aplicar(await buscar())
      setValidacoes([])
      setFalhaAoAnexar(null)
    } catch (causa: unknown) {
      log.ui.error('Falha ao remover anexo', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    }
  }

  async function validar(): Promise<void> {
    setOcupado('validando')
    try {
      setValidacoes(await window.jarvis.validarPrototipos(projectId))
    } catch (causa: unknown) {
      log.ui.error('Falha ao validar os protótipos', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
    } finally {
      setOcupado('nao')
    }
  }

  const lista = anexos ?? []
  const assets = lista.filter((a) => a.tipo === 'asset')
  const faltando = EXIGENCIAS.filter((e) => !lista.some((a) => a.tipo === e))
  const gateAberto = faltando.length === 0
  const trabalhando = ocupado !== 'nao'
  const achados = [...validacoes.flatMap((v) => v.achados)]
  const ultima = arquiteturas[0]

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`anexos-${projectId}`}>
      <header className="flex flex-col gap-1">
        <h3
          id={`anexos-${projectId}`}
          className="flex items-center gap-2 font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)]"
        >
          <Paperclip aria-hidden="true" className="size-4" />
          {t('anexos.titulo')}
        </h3>
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('anexos.descricao', { nome: nomeDoProjeto })}
        </p>
      </header>

      {anexos === undefined ? (
        <LoadingState rotulo={t('anexos.carregando')} />
      ) : (
        <>
          {/*
           * As duas exigências, cada uma com o seu estado. Não é um contador: o PI precisa
           * saber **qual** falta, e "1 de 2" esconde exatamente isso.
           */}
          <ul className="flex flex-col gap-2">
            {EXIGENCIAS.map((tipo) => (
              <ExigenciaDoGate
                key={tipo}
                tipo={tipo}
                anexos={lista.filter((a) => a.tipo === tipo)}
                desabilitado={trabalhando}
                onAnexar={() => void anexar(tipo)}
                onRemover={(caminho) => void remover(caminho)}
              />
            ))}
          </ul>

          {/*
           * Assets abaixo e separados: não são exigência do gate (protótipo sem imagem está
           * completo), e agrupá-los com as exigências ensinaria o contrário.
           */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                {t('anexos.assets')}
              </span>
              <Button
                variante="secundaria"
                onClick={() => void anexar('asset')}
                desabilitado={trabalhando}
              >
                {t('anexos.adicionarAsset')}
              </Button>
            </div>
            {assets.length === 0 ? (
              <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                {t('anexos.semAssets')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {assets.map((asset) => (
                  <Tag
                    key={asset.caminho}
                    onRemover={() => void remover(asset.caminho)}
                    rotuloRemover={t('anexos.removerAnexo', { caminho: asset.caminho })}
                  >
                    <span
                      className="font-mono"
                      aria-label={t('anexos.hashCompleto', { hash: asset.hash })}
                    >
                      {nomeDoArquivo(asset.caminho)}
                    </span>
                  </Tag>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
              {gateAberto
                ? t('anexos.gateAberto')
                : t('anexos.gateFechado', {
                    lista: faltando.map((f) => t(`anexos.tipo.${f}`)).join(', ')
                  })}
            </p>
            <div className="flex gap-2">
              {/* A conferência é a ação desta tela. **Gerar a arquitetura saiu daqui** com a
                  SPEC-Jornada-04: a etapa seguinte tem tela própria, e manter o botão aqui
                  ofereceria o mesmo ato em dois lugares com estados diferentes. */}
              <Button
                variante="primaria"
                onClick={() => void validar()}
                carregando={ocupado === 'validando'}
                desabilitado={trabalhando || !lista.some((a) => a.tipo === 'prototipo')}
              >
                {t('anexos.validar')}
              </Button>
            </div>
          </div>

          {falhaAoAnexar !== null && <InlineAlert tom="warn" titulo={falhaAoAnexar} />}

          {achados.length > 0 && <Achados achados={achados} />}

          {validacoes.length > 0 && achados.length === 0 && (
            <InlineAlert tom="ok" titulo={t('anexos.validacaoLimpa')} />
          )}

          {ultima !== undefined && (
            <RevisaoDaArquitetura pacote={ultima} total={arquiteturas.length} />
          )}
        </>
      )}
    </section>
  )
}

/**
 * Uma exigência do gate, com o seu estado e a sua ação.
 *
 * O estado é **ícone + texto + badge**, nunca só cor (critério 4 do DS): quem não distingue a
 * cor precisa do mesmo sinal. O hash aparece truncado na tela e completo no rótulo acessível —
 * truncar é economia de largura, não de informação.
 */
function ExigenciaDoGate({
  tipo,
  anexos,
  desabilitado,
  onAnexar,
  onRemover
}: {
  readonly tipo: TipoDeAnexo
  readonly anexos: readonly Anexo[]
  readonly desabilitado: boolean
  readonly onAnexar: () => void
  readonly onRemover: (caminho: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const Icone = ICONE_DO_TIPO[tipo]
  const atendida = anexos.length > 0

  return (
    <li className="flex flex-col gap-2 rounded-[var(--jos-raio-chip)] border border-[var(--jos-cor-borda)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Icone aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate text-[length:var(--jos-texto-micro)]">
            {t(`anexos.tipo.${tipo}`)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge tom={atendida ? 'ok' : 'warn'}>
            {atendida ? t('anexos.anexado') : t('anexos.pendente')}
          </Badge>
          {/* Anexar o que falta é a ação da linha; substituir o que já está lá não é. A
              variante segue o estado em vez de ser fixa, para o acento marcar exatamente as
              pendências — uma fileira toda em primária destacaria também o que está pronto. */}
          <Button
            variante={atendida ? 'secundaria' : 'primaria'}
            onClick={onAnexar}
            desabilitado={desabilitado}
          >
            {atendida ? t('anexos.substituir') : t('anexos.anexar')}
          </Button>
        </span>
      </div>

      {anexos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {anexos.map((anexo) => (
            <li key={anexo.caminho} className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {anexo.caminho}
              </span>
              <span
                className="shrink-0 font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
                aria-label={t('anexos.hashCompleto', { hash: anexo.hash })}
              >
                {anexo.hash.slice(0, 12)}
              </span>
              <Button
                variante="secundaria"
                onClick={() => onRemover(anexo.caminho)}
                desabilitado={desabilitado}
              >
                {t('anexos.remover')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Os achados da validação — perguntas com recomendação.
 *
 * A ordem vem do domínio (o que impede primeiro), e a tela a preserva: reordenar aqui faria a
 * regra viver em dois lugares. O que impede leva badge próprio, porque a consequência é
 * diferente — a arquitetura não sai enquanto ele existir.
 */
function Achados({
  achados
}: {
  readonly achados: readonly AchadoDoPrototipo[]
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ul className="flex flex-col gap-2">
      {achados.map((achado) => (
        <li
          key={achado.id}
          className="flex flex-col gap-1.5 rounded-[var(--jos-raio-chip)] border border-[var(--jos-cor-borda)] px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[length:var(--jos-texto-micro)]">{achado.pergunta}</p>
            {achado.severidade === 'impede-arquitetura' && (
              <Badge tom="warn">{t('anexos.impede')}</Badge>
            )}
          </div>
          <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {t('anexos.recomendacao', { texto: achado.recomendacao })}
          </p>
          <p className="font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {achado.evidencia}
          </p>
        </li>
      ))}
    </ul>
  )
}

/** A revisão de arquitetura gerada: os quatro documentos com hash, e o commit. */
function RevisaoDaArquitetura({
  pacote,
  total
}: {
  readonly pacote: PacoteArquitetura
  readonly total: number
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-mono text-[length:var(--jos-texto-micro)] uppercase text-[var(--jos-cor-texto-suave)]">
          {t('anexos.revisao', { count: total })}
        </h4>
        {pacote.commitHash === null ? (
          <Badge tom="warn">{t('anexos.semCommit')}</Badge>
        ) : (
          <Badge tom="ok">
            <span
              className="font-mono"
              aria-label={t('anexos.commitCompleto', { hash: pacote.commitHash })}
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
              {t('anexos.afirmacoes', { count: doc.afirmacoes.length })}
            </span>
            <span
              className="shrink-0 font-mono text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
              aria-label={t('anexos.hashCompleto', { hash: doc.hash })}
            >
              {doc.hash.slice(0, 12)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** O nome do arquivo, para o chip do asset. O caminho inteiro não cabe num chip. */
function nomeDoArquivo(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf('/') + 1)
}
