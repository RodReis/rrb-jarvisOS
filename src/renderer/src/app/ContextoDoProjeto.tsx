import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSearch } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type {
  ContextItem,
  ContextPack,
  ContextPackOutcome,
  ContextPackReason,
  FalhaRegistrada
} from '@shared/domain/context-pack'
import type { CapacidadeResolvida } from '@shared/domain/skills'
import type { ContextPackRequest } from '@shared/contracts/ipc'
import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  LoadingState,
  Meter,
  Panel,
  Table,
  type Coluna
} from '@design/ui'
import { log } from '../lib/log'

/**
 * Contexto, skills e orçamento de um projeto (SPEC-Planejamento-02).
 *
 * **O que esta tela existe para tornar visível.** O critério 3 pede que a exceção de leitura
 * ampla seja *visível*; o critério 2, que se possa reproduzir quais revisões foram enviadas; o
 * critério 6, que a expansão de tokens tenha causa atribuída. Nada disso é verificável num
 * manifesto que só existe no banco — daí o painel: ele mostra o que saiu da máquina, hasheado,
 * antes de sair.
 *
 * **A tela não lê arquivo.** Ela indica caminhos relativos e o main lê, dentro do diretório do
 * projeto. Não há campo de conteúdo em nenhum lugar daqui, e é a mesma fronteira que a tela de
 * Projetos respeita ao não ter controle de Git: o renderer pede *o quê*, nunca entrega o que
 * leu.
 *
 * **Sobre a forma.** Vocabulário do DS já entregue, não um dialeto novo: `Panel` para a seção,
 * `Meter` com faixas para o teto de tokens (o mesmo componente e as mesmas faixas do painel de
 * Orçamento — a barra muda de tom exatamente onde o gate começa a recusar), mono em micro
 * maiúsculo para metadado de máquina. A escolha que vale nomear é o **hash em mono truncado com
 * o valor inteiro no `title`**: o hash é a prova do critério 2, e mostrá-lo por extenso comeria
 * a linha inteira sem que ninguém o lesse — mas escondê-lo de todo tiraria da tela justamente o
 * que ela existe para mostrar.
 */

interface ContextoDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
}

/**
 * Tom do alerta por desfecho. Mapa fechado, como em `ProjetosLocais`: um motivo novo no
 * contrato quebra a compilação aqui, em vez de cair num tom default e pintar uma recusa de
 * segredo com a mesma cor de um sucesso.
 *
 * `leitura-ampla-sem-excecao` e os tetos são **`warn`, não `err`**: nada quebrou. O usuário
 * pediu mais do que o padrão permite e a resposta é registrar o motivo — pintar isso de vermelho
 * ensinaria a ler um gate funcionando como falha.
 */
const TOM_POR_MOTIVO: Readonly<Record<ContextPackReason, 'ok' | 'err' | 'warn'>> = {
  montado: 'ok',
  'leitura-ampla-sem-excecao': 'warn',
  'teto-da-excecao-excedido': 'warn',
  'teto-de-tokens-excedido': 'warn',
  // Segredo é `err`: aqui algo **está** errado — um arquivo com credencial foi selecionado, e
  // o usuário precisa removê-lo, não registrar um motivo.
  'segredo-no-contexto': 'err',
  'projeto-desconhecido': 'err',
  'contexto-vazio': 'warn'
}

/** Trunca o hash para caber na linha. O valor inteiro fica no `title` e no `aria-label`. */
function hashCurto(hash: string): string {
  return hash.slice(0, 12)
}

function formatarUsd(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })
}

export function ContextoDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto
}: ContextoDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [packs, setPacks] = useState<readonly ContextPack[]>([])
  const [capacidades, setCapacidades] = useState<readonly CapacidadeResolvida[]>([])
  const [falhas, setFalhas] = useState<readonly FalhaRegistrada[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [desfecho, setDesfecho] = useState<ContextPackOutcome | null>(null)
  const [arquivos, setArquivos] = useState('')
  const [tarefa, setTarefa] = useState('')
  /**
   * O motivo da exceção de leitura ampla. Campo **de texto**, não um botão "permitir": o
   * critério 3 pede exceção *registrada*, e um botão registraria que aconteceu sem registrar
   * por quê — que é a diferença entre exceção e permissão.
   */
  const [motivoDaExcecao, setMotivoDaExcecao] = useState('')

  /**
   * Busca as três listas de uma vez. **Só busca** — quem aplica no estado é o chamador.
   *
   * A divisão existe porque `setState` no corpo de um efeito dispara renderização em cascata
   * (e o lint do repositório a barra): dentro do efeito o resultado entra pelo `.then`, com a
   * guarda de desmontagem; fora dele, o chamador aplica direto.
   */
  const buscar = useCallback(async (): Promise<{
    readonly listaDePacks: readonly ContextPack[]
    readonly listaDeCapacidades: readonly CapacidadeResolvida[]
    readonly listaDeFalhas: readonly FalhaRegistrada[]
  }> => {
    const [listaDePacks, listaDeCapacidades, listaDeFalhas] = await Promise.all([
      window.jarvis.listContextPacks(projectId),
      window.jarvis.listCapabilities(),
      window.jarvis.listFailures(projectId)
    ])
    return { listaDePacks, listaDeCapacidades, listaDeFalhas }
  }, [projectId])

  const aplicar = useCallback(
    (dados: {
      readonly listaDePacks: readonly ContextPack[]
      readonly listaDeCapacidades: readonly CapacidadeResolvida[]
      readonly listaDeFalhas: readonly FalhaRegistrada[]
    }): void => {
      setPacks(dados.listaDePacks)
      setCapacidades(dados.listaDeCapacidades)
      setFalhas(dados.listaDeFalhas)
    },
    []
  )

  const recarregar = useCallback(async (): Promise<void> => {
    aplicar(await buscar())
  }, [aplicar, buscar])

  /*
   * A flag `ativo` tem o mesmo desenho das outras telas: sem ela, desmontar durante a promise
   * deixaria um `setState` em componente já fora da árvore. E o estado já **nasce** carregando,
   * então não há `setCarregando(true)` aqui — o painel monta e desmonta junto com o projeto que
   * mostra, e reafirmar o valor inicial só custaria uma renderização.
   */
  useEffect(() => {
    let ativo = true

    buscar()
      .then((dados) => {
        if (ativo) aplicar(dados)
      })
      .catch((causa: unknown) => {
        if (ativo) {
          log.ui.error('Falha ao carregar o contexto do projeto', {
            projectId,
            stack: causa instanceof Error ? causa.stack : undefined
          })
        }
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, buscar, aplicar])

  /**
   * Monta o pack. Uma linha por arquivo, e a origem é **derivada do formato**: caminho com
   * curinga (`**`) é leitura ampla, o resto é seleção explícita. Derivar em vez de pedir ao
   * usuário que classifique evita a pergunta que ele responderia sempre igual — e mantém a
   * exceção presa ao que de fato a exige.
   */
  const montar = async (): Promise<void> => {
    const caminhos = arquivos
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha.length > 0)

    if (caminhos.length === 0) return

    setOcupado(true)
    try {
      const candidatos = caminhos.map((caminho) => ({
        caminho,
        origem: caminho.includes('*') ? ('leitura-ampla' as const) : ('explicito' as const),
        motivo: t('contexto.motivoPadrao')
      }))

      const pedido: ContextPackRequest = {
        projectId,
        tarefa: tarefa.trim().length > 0 ? tarefa.trim() : nomeDoProjeto,
        etapa: 'contexto',
        candidatos,
        // A rota vem do roteamento no momento da chamada; aqui declara-se a **prevista**, que é
        // o que decide se o orçamento desta etapa é em USD ou em uso.
        rota: 'anthropic' satisfies AiProvider,
        ...(motivoDaExcecao.trim().length > 0
          ? {
              excecaoDeLeituraAmpla: {
                motivo: motivoDaExcecao.trim(),
                tetoDeBytes: 512 * 1024,
                autorizadoPor: '',
                autorizadoEm: new Date().toISOString()
              }
            }
          : {})
      }

      const resultado = await window.jarvis.buildContextPack(pedido, workspace)
      setDesfecho(resultado)
      await recarregar()
    } catch (causa: unknown) {
      log.ui.error('Falha ao montar o contexto', {
        projectId,
        stack: causa instanceof Error ? causa.stack : undefined
      })
      setDesfecho({ reason: 'contexto-vazio', mensagem: t('contexto.erroInesperado') })
    } finally {
      setOcupado(false)
    }
  }

  const resolver = async (fingerprint: string): Promise<void> => {
    setOcupado(true)
    try {
      await window.jarvis.resolveFailure(projectId, fingerprint, workspace)
      await recarregar()
    } finally {
      setOcupado(false)
    }
  }

  const ultimo = packs[0]

  /**
   * Colunas do manifesto. O hash tem coluna própria porque é ele que responde a pergunta do
   * critério 2 — misturá-lo ao caminho o transformaria em decoração do nome do arquivo.
   */
  const colunas: ReadonlyArray<Coluna<ContextItem>> = [
    {
      chave: 'caminho',
      cabecalho: t('contexto.colunaArquivo'),
      celula: (item) => (
        <span className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]">
          {item.caminho}
          {item.linhas !== undefined && `:${item.linhas.de}-${item.linhas.ate}`}
        </span>
      )
    },
    {
      chave: 'origem',
      cabecalho: t('contexto.colunaOrigem'),
      celula: (item) => (
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
          {t(`contexto.origem.${item.origem}`)}
        </span>
      )
    },
    {
      chave: 'hash',
      cabecalho: t('contexto.colunaHash'),
      celula: (item) => (
        // O hash inteiro no `title` **e** no `aria-label`: truncar é economia de largura, não
        // de informação — quem precisa conferir a revisão precisa do valor completo, e quem
        // ouve a tabela não tem `title` para consultar.
        <span
          title={item.hash}
          aria-label={t('contexto.hashCompleto', { hash: item.hash })}
          className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
        >
          {hashCurto(item.hash)}
        </span>
      )
    },
    {
      chave: 'bytes',
      cabecalho: t('contexto.colunaBytes'),
      numerica: true,
      celula: (item) => (
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {item.bytes.toLocaleString('pt-BR')}
        </span>
      )
    }
  ]

  const abertas = falhas.filter((falha) => !falha.resolvida)

  return (
    <section className="flex flex-col gap-5" aria-labelledby="contexto-titulo">
      <header className="flex flex-col gap-1">
        <h3
          id="contexto-titulo"
          className="text-[length:var(--jos-texto-secao)] font-[var(--jos-peso-forte)] tracking-[var(--jos-tracking-display)] text-[var(--jos-cor-texto)]"
        >
          {t('contexto.titulo')}
        </h3>
        <p className="max-w-[70ch] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
          {t('contexto.descricao')}
        </p>
      </header>

      {desfecho !== null && (
        <InlineAlert tom={TOM_POR_MOTIVO[desfecho.reason]} titulo={desfecho.mensagem}>
          {desfecho.caminhosComSegredo !== undefined && (
            // Os caminhos acusados, **nunca o trecho**. É o que o usuário precisa para remover
            // o arquivo da seleção; repetir o segredo aqui o copiaria para a tela.
            <ul className="mt-1 flex flex-col gap-0.5">
              {desfecho.caminhosComSegredo.map((caminho) => (
                <li
                  key={caminho}
                  className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]"
                >
                  {caminho}
                </li>
              ))}
            </ul>
          )}
        </InlineAlert>
      )}

      <div className="flex flex-col gap-4 border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-5">
        <Field rotulo={t('contexto.tarefa')} descricao={t('contexto.tarefaAjuda')}>
          {(atributos) => (
            <Input
              {...atributos}
              valor={tarefa}
              onMudar={setTarefa}
              placeholder={t('contexto.tarefaPlaceholder')}
            />
          )}
        </Field>

        <Field rotulo={t('contexto.arquivos')} descricao={t('contexto.arquivosAjuda')}>
          {(atributos) => (
            <Input
              {...atributos}
              valor={arquivos}
              onMudar={setArquivos}
              placeholder={t('contexto.arquivosPlaceholder')}
            />
          )}
        </Field>

        {/*
          O campo da exceção aparece **só quando um curinga foi digitado**. Sempre visível, ele
          viraria pedágio do caminho normal e o usuário aprenderia a preenchê-lo por hábito —
          esvaziando o critério 3, que existe para que a exceção seja rara e explicada.
        */}
        {arquivos.includes('*') && (
          <Field rotulo={t('contexto.excecao')} descricao={t('contexto.excecaoAjuda')} obrigatorio>
            {(atributos) => (
              <Input
                {...atributos}
                valor={motivoDaExcecao}
                onMudar={setMotivoDaExcecao}
                placeholder={t('contexto.excecaoPlaceholder')}
              />
            )}
          </Field>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void montar()}
            desabilitado={ocupado || arquivos.trim().length === 0}
            carregando={ocupado}
            iconeInicial={<FileSearch aria-hidden="true" className="size-4" />}
          >
            {t('contexto.montar')}
          </Button>
        </div>
      </div>

      {carregando ? (
        <LoadingState rotulo={t('contexto.carregando')} />
      ) : ultimo === undefined ? (
        <EmptyState titulo={t('contexto.vazio')} descricao={t('contexto.vazioDescricao')} />
      ) : (
        <Panel titulo={t('contexto.manifesto')}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
                {ultimo.tarefa}
              </span>
              <span
                title={ultimo.hash}
                className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]"
              >
                {t('contexto.hashDoPack', { hash: hashCurto(ultimo.hash) })}
              </span>
            </div>

            {/*
              O orçamento da etapa. Duas leituras diferentes conforme a rota, e a diferença é o
              ponto: na rota de assinatura não existe USD a mostrar, e imprimir "US$ 0,00" ali
              diria "esta chamada foi de graça" em vez de "esta rota não cobra por chamada".
            */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
                  {t('contexto.tokensDaEtapa')}
                </span>
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                  {t('contexto.tokensDe', {
                    usados: ultimo.orcamento.tokensEstimados.toLocaleString('pt-BR'),
                    teto: ultimo.orcamento.tetoDeTokens.toLocaleString('pt-BR')
                  })}
                </span>
              </div>
              <Meter
                valor={ultimo.orcamento.tokensEstimados}
                maximo={ultimo.orcamento.tetoDeTokens}
                rotulo={t('contexto.tokensDaEtapa')}
                formatar={(v) => v.toLocaleString('pt-BR')}
                // As mesmas faixas do painel de Orçamento: a barra muda de tom onde o gate
                // começa a recusar, e a cor da tela e a regra do main passam a ser a mesma
                // coisa em vez de duas que se parecem.
                faixas={[
                  { ate: ultimo.orcamento.tetoDeTokens * 0.8, tom: 'ok' },
                  { ate: ultimo.orcamento.tetoDeTokens, tom: 'warn' },
                  { ate: Number.POSITIVE_INFINITY, tom: 'err' }
                ]}
              />
              <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {ultimo.orcamento.unmetered
                  ? t('contexto.rotaSemCusto', { rota: ultimo.rota })
                  : t('contexto.rotaComCusto', {
                      rota: ultimo.rota,
                      valor: formatarUsd(ultimo.orcamento.estimadoUsd ?? 0)
                    })}
              </p>
              {ultimo.orcamento.motivoDaExpansao !== undefined && (
                <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                  {t('contexto.expansao', { motivo: ultimo.orcamento.motivoDaExpansao })}
                </p>
              )}
            </div>

            {/*
              A exceção de leitura ampla, quando existe. Em faixa própria e com o motivo por
              extenso: o critério 3 pede exceção **visível**, e visível quer dizer legível na
              tela — não um ícone que só quem conhece o sistema decifra.
            */}
            {ultimo.excecaoDeLeituraAmpla !== undefined && (
              <div className="flex flex-col gap-1 rounded-[var(--jos-raio-chip)] border border-[color-mix(in_srgb,var(--jos-cor-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--jos-cor-warn)_8%,transparent)] px-3 py-2.5">
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-secundario)]">
                  {t('contexto.excecaoRegistrada')}
                </span>
                <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto)]">
                  {ultimo.excecaoDeLeituraAmpla.motivo}
                </p>
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                  {t('contexto.tetoDaExcecao', {
                    bytes: ultimo.excecaoDeLeituraAmpla.tetoDeBytes.toLocaleString('pt-BR')
                  })}
                </span>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table
                colunas={colunas}
                linhas={[...ultimo.itens]}
                chaveDaLinha={(item) => `${item.caminho}:${item.hash}`}
                legenda={t('contexto.legendaTabela', { tarefa: ultimo.tarefa })}
              />
            </div>
          </div>
        </Panel>
      )}

      {/*
        As falhas abertas. Só as abertas: a resolvida não volta ao contexto (critério 4), e
        mostrá-la aqui contradiria a tela com o que o pack de fato carrega.
      */}
      {abertas.length > 0 && (
        <Panel titulo={t('contexto.falhasAbertas')}>
          <ul className="flex flex-col gap-2">
            {abertas.map((falha) => (
              <li
                key={falha.fingerprint}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
                    {falha.resumo}
                  </span>
                  <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                    {t('contexto.ocorrencias', { total: falha.ocorrencias })}
                  </span>
                </div>
                <Button
                  variante="secundaria"
                  onClick={() => void resolver(falha.fingerprint)}
                  desabilitado={ocupado}
                  aria-label={t('contexto.resolverDe', { resumo: falha.resumo })}
                >
                  {t('contexto.resolver')}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/*
        As capacidades e por qual meio cada uma foi atendida (critério 5).
        **`direto` não é degradação**, e a tela o trata como igual: sem estilo de aviso, sem
        ícone de alerta. Pintá-lo como falta ensinaria que o fluxo sem skill está quebrado —
        quando é justamente o caminho que a spec garante existir.
      */}
      {capacidades.length > 0 && (
        <Panel titulo={t('contexto.capacidades')}>
          <ul className="flex flex-col gap-1.5">
            {capacidades.map((capacidade) => (
              <li
                key={capacidade.capacidade}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
              >
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
                  {capacidade.meio === 'skill'
                    ? (capacidade.skillId ?? t('contexto.meioSkill'))
                    : t('contexto.meioDireto')}
                </span>
                <span className="min-w-0 flex-1 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                  {capacidade.procedimento}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  )
}
