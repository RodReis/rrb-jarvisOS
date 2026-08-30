import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Project, ProjectOutcome, ProjectReason } from '@shared/domain/projects'
import { Button, EmptyState, Field, InlineAlert, Input, LoadingState } from '@design/ui'
import { log } from '../lib/log'

/**
 * Projetos locais (SPEC-Planejamento-01).
 *
 * **A tela não conhece Git.** Não há botão de `init`, de `commit` nem campo de mensagem: ela
 * cria um projeto ou importa uma pasta, e o versionamento é consequência disso no main, pelo
 * terminal controlado (decisão 2 do PI). Um controle de Git aqui exigiria um canal que
 * recebesse comando — o segundo caminho de escrita que a fatia existe para não abrir.
 *
 * Duas garantias vivem na fronteira, não aqui:
 *  - **O renderer nunca toca o filesystem.** Escolher a pasta a importar acontece no main
 *    (`pickProjectDirectory`), como na tela de diretórios permitidos.
 *  - **A tela não decide colisão nem permissão.** Ela mostra o `ProjectOutcome` que voltou;
 *    duplicar as checagens aqui criaria uma segunda fonte de política, que divergiria da
 *    primeira no dia em que uma das duas mudasse.
 *
 * **Sobre a forma.** O vocabulário visual é o do DS já entregue (SPEC-DS-04b/05), não um
 * dialeto novo: display com tracking para o título de seção, **mono em micro maiúsculo** para
 * metadado de máquina, e o acento do espaço como única cor de destaque. A escolha que vale
 * nomear é o **caminho do projeto em mono**: ele é um endereço de disco, e endereço lido em
 * fonte proporcional esconde a diferença entre `l`/`1` e `O`/`0` — justamente quando o usuário
 * precisa conferir *onde* o app escreveu.
 */

interface ProjetosLocaisProps {
  readonly workspace: WorkspaceId
}

/**
 * Tom do `InlineAlert` por desfecho. Mapa fechado, não `if` espalhado: um motivo novo no
 * contrato quebra a compilação aqui, em vez de cair silenciosamente num tom default e mostrar
 * uma recusa de permissão com a mesma cor de um sucesso.
 *
 * `colisao` é **`warn`, não `err`**: nada quebrou. O projeto existe e o usuário pode retomá-lo;
 * pintar isso de vermelho ensinaria a ler um estado normal como falha.
 */
const TOM_POR_MOTIVO: Readonly<Record<ProjectReason, 'ok' | 'err' | 'warn'>> = {
  criado: 'ok',
  importado: 'ok',
  'nome-invalido': 'warn',
  colisao: 'warn',
  'diretorio-fora-da-allowlist': 'err',
  'diretorio-inexistente': 'err',
  'git-indisponivel': 'err',
  'falha-no-git': 'err',
  'falha-de-escrita': 'err'
}

export function ProjetosLocais({ workspace }: ProjetosLocaisProps): React.JSX.Element {
  const { t } = useTranslation()
  const [projetos, setProjetos] = useState<readonly Project[]>([])
  const [nome, setNome] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [desfecho, setDesfecho] = useState<ProjectOutcome | null>(null)
  /** Qual item está em edição inline, e o texto sendo digitado nele. */
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [edicao, setEdicao] = useState('')
  /**
   * Qual item pediu confirmação de remoção. Confirmação **inline**, não `AlertDialog`: o
   * diálogo destrutivo do DS existe para perda irreversível, e aqui nada se perde — os
   * arquivos continuam no disco. Usar o alerta forte descreveria um risco que não existe, e
   * gastaria a atenção que ele precisa ter quando o risco for real.
   */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)

  /*
   * A flag `ativo` tem o mesmo desenho das outras telas: sem ela, desmontar durante a promise
   * deixaria um `setState` em componente já fora da árvore.
   */
  useEffect(() => {
    let ativo = true

    window.jarvis
      .listProjects(workspace)
      .then((lista) => {
        if (ativo) setProjetos(lista)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao listar projetos', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [workspace])

  async function recarregar(): Promise<void> {
    setProjetos(await window.jarvis.listProjects(workspace))
  }

  async function criar(): Promise<void> {
    setOcupado(true)
    try {
      const resultado = await window.jarvis.createProject(nome, workspace)
      setDesfecho(resultado)
      // Só limpa o campo quando o projeto nasceu: numa recusa, o nome digitado é justamente o
      // que o usuário vai ajustar, e apagá-lo o obrigaria a redigitar para corrigir um acento.
      if (resultado.project) {
        setNome('')
        await recarregar()
      }
    } catch (error) {
      log.ui.error('Falha ao criar projeto', { error })
    } finally {
      setOcupado(false)
    }
  }

  async function renomear(projectId: string, nomeAtual: string): Promise<void> {
    // O campo de edição é o mesmo item da lista virando editável (`edicao`), e não um modal:
    // renomear é a operação mais leve da tela, e um diálogo para trocar uma palavra custa dois
    // cliques a mais e tira o nome do contexto onde o usuário o está comparando com os outros.
    if (edicao.trim() === '' || edicao.trim() === nomeAtual) {
      setEditandoId(null)
      return
    }

    setOcupado(true)
    try {
      const resultado = await window.jarvis.renameProject(projectId, edicao.trim(), workspace)
      setDesfecho(resultado)
      if (resultado.project) {
        setEditandoId(null)
        await recarregar()
      }
    } catch (error) {
      log.ui.error('Falha ao renomear projeto', { error })
    } finally {
      setOcupado(false)
    }
  }

  async function remover(projectId: string): Promise<void> {
    setOcupado(true)
    try {
      // Desregistra apenas: os arquivos e o histórico Git ficam no disco (decisão do PI). É por
      // isso que não há `AlertDialog` de confirmação destrutiva aqui — a ação é reversível por
      // reimportação, e um alerta de perda irreversível descreveria algo que não acontece.
      if (await window.jarvis.removeProject(projectId, workspace)) {
        setConfirmandoId(null)
        await recarregar()
      }
    } catch (error) {
      log.ui.error('Falha ao remover projeto', { error })
    } finally {
      setOcupado(false)
    }
  }

  async function importar(): Promise<void> {
    setOcupado(true)
    try {
      // O seletor abre no main. Cancelar devolve string vazia — e aí não há nada a fazer, nem
      // desfecho a mostrar: o usuário desistiu, e isso não é um erro a relatar.
      const diretorio = await window.jarvis.pickProjectDirectory()
      if (!diretorio) return

      const resultado = await window.jarvis.importProject(diretorio, workspace)
      setDesfecho(resultado)
      if (resultado.project) await recarregar()
    } catch (error) {
      log.ui.error('Falha ao importar projeto', { error })
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section aria-label={t('projetos.titulo')} className="mt-6 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2
          className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] tracking-[2px] text-[var(--jos-cor-texto)]"
          id="projetos-titulo"
        >
          {t('projetos.titulo')}
        </h2>
        <p className="text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
          {t('projetos.descricao')}
        </p>
      </header>

      {desfecho !== null && (
        <InlineAlert tom={TOM_POR_MOTIVO[desfecho.reason]} titulo={desfecho.mensagem} />
      )}

      {/* A barra de ação fica **acima** da lista de propósito: a tarefa dominante desta tela é
          começar um projeto, não revisar os que já existem. Ordem de leitura = ordem de uso. */}
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-4">
        <div className="min-w-[220px] flex-1">
          <Field rotulo={t('projetos.nome')} descricao={t('projetos.nomeAjuda')}>
            {(atributos) => (
              <Input
                {...atributos}
                valor={nome}
                onMudar={setNome}
                placeholder={t('projetos.nomePlaceholder')}
              />
            )}
          </Field>
        </div>
        <Button onClick={() => void criar()} desabilitado={ocupado || nome.trim().length === 0}>
          {t('projetos.criar')}
        </Button>
        <Button variante="secundaria" onClick={() => void importar()} desabilitado={ocupado}>
          {t('projetos.importar')}
        </Button>
      </div>

      {carregando ? (
        <LoadingState rotulo={t('projetos.carregando')} />
      ) : projetos.length === 0 ? (
        <EmptyState titulo={t('projetos.vazio')} descricao={t('projetos.vazioDescricao')} />
      ) : (
        <ul aria-labelledby="projetos-titulo" className="flex flex-col gap-2">
          {projetos.map((projeto) => (
            <li key={projeto.id} data-jos-projeto={projeto.slug}>
              {/* Não é `Card`: a lista pede um item de linha, e o cartão do DS traz padding e
                  sombra dimensionados para conteúdo autônomo. Uma pilha de cartões faria cada
                  projeto competir por atenção, quando o que se quer é varrer a coluna. A borda
                  esquerda acende no acento ao passar o mouse — o item inteiro é a superfície,
                  e a marca do espaço é o que sinaliza foco. */}
              <article className="group flex flex-wrap items-center justify-between gap-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] border-l-2 border-l-transparent bg-[var(--jos-cor-superficie-elevada)] p-4 transition-[border-color,transform] duration-[var(--jos-duracao-media)] hover:-translate-y-px hover:border-l-[var(--jos-cor-acento)]">
                <div className="flex min-w-0 flex-col gap-1">
                  {editandoId === projeto.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        valor={edicao}
                        onMudar={setEdicao}
                        aria-label={t('projetos.renomearDe', { nome: projeto.nome })}
                      />
                      <Button
                        onClick={() => void renomear(projeto.id, projeto.nome)}
                        desabilitado={ocupado}
                      >
                        {t('projetos.salvar')}
                      </Button>
                      <Button variante="secundaria" onClick={() => setEditandoId(null)}>
                        {t('projetos.cancelar')}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-medio)] text-[var(--jos-cor-texto)]">
                      {projeto.nome}
                    </span>
                  )}
                  {/* `break-all`: caminho longo não tem espaço onde quebrar, e sem isso ele
                      estoura a largura do item em vez de continuar na linha de baixo. */}
                  <span className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                    {projeto.diretorio}
                  </span>
                </div>

                {/* Origem em mono maiúsculo: é metadado de máquina, e o DS já usa essa forma
                    para o mesmo papel em Providers e Orçamento. Repetir a convenção é o que
                    faz a tela nova parecer parte do app, e não um enxerto. */}
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
                    {projeto.origem === 'criado' ? t('projetos.criado') : t('projetos.importado')}
                  </span>

                  {confirmandoId === projeto.id ? (
                    <>
                      {/* O texto da confirmação diz o que **de fato** acontece: sai da lista,
                          fica no disco. Uma confirmação genérica ("tem certeza?") faria o
                          usuário supor a perda dos arquivos e desistir do que é reversível. */}
                      <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                        {t('projetos.removerAviso')}
                      </span>
                      <Button
                        variante="perigo"
                        onClick={() => void remover(projeto.id)}
                        desabilitado={ocupado}
                        aria-label={t('projetos.removerDe', { nome: projeto.nome })}
                      >
                        {t('projetos.confirmar')}
                      </Button>
                      <Button variante="secundaria" onClick={() => setConfirmandoId(null)}>
                        {t('projetos.cancelar')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variante="secundaria"
                        onClick={() => {
                          setEdicao(projeto.nome)
                          setEditandoId(projeto.id)
                        }}
                        /* O nome acessível carrega o projeto: numa lista de botões "Renomear"
                           idênticos, o leitor de tela não diria qual deles renomeia o quê. */
                        aria-label={t('projetos.renomearDe', { nome: projeto.nome })}
                      >
                        {t('projetos.renomear')}
                      </Button>
                      <Button
                        variante="secundaria"
                        onClick={() => setConfirmandoId(projeto.id)}
                        aria-label={t('projetos.removerDe', { nome: projeto.nome })}
                      >
                        {t('projetos.remover')}
                      </Button>
                    </>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
