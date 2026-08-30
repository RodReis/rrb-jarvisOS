import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSearch, FolderPlus, FolderSearch, ShieldCheck } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Project, ProjectOutcome, ProjectReason } from '@shared/domain/projects'
import { Button, EmptyState, Field, InlineAlert, Input, LoadingState } from '@design/ui'
import { log } from '../lib/log'
import { ContextoDoProjeto } from './ContextoDoProjeto'

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
 * **Sobre a forma.** Vocabulário visual do DS já entregue (SPEC-DS-04b/05), não um dialeto
 * novo: display com tracking no título de seção, **mono em micro maiúsculo** para metadado de
 * máquina, e o acento do espaço como única cor de destaque. A escolha que vale nomear é o
 * **caminho do projeto em mono**: é um endereço de disco, e endereço em fonte proporcional
 * esconde a diferença entre `l`/`1` e `O`/`0` — justamente quando o usuário confere *onde* o
 * app escreveu.
 */

interface ProjetosLocaisProps {
  readonly workspace: WorkspaceId
}

/**
 * Tom do `InlineAlert` por desfecho. Mapa fechado, não `if` espalhado: um motivo novo no
 * contrato quebra a compilação aqui, em vez de cair num tom default e mostrar uma recusa de
 * permissão com a mesma cor de um sucesso.
 *
 * `colisao` é **`warn`, não `err`**: nada quebrou. O projeto existe e pode ser retomado; pintar
 * isso de vermelho ensinaria a ler um estado normal como falha.
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

/**
 * O binário que a fatia precisa ter permitido. Constante nomeada porque aparece em dois lugares
 * — a checagem e o botão de correção — e um literal duplicado divergiria.
 */
const BINARIO_GIT = 'git'

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
   * Qual item pediu confirmação de remoção. Confirmação **inline**, não `AlertDialog`: o diálogo
   * destrutivo do DS existe para perda irreversível, e aqui nada se perde — os arquivos ficam no
   * disco. Usar o alerta forte descreveria um risco que não existe, e gastaria a atenção que ele
   * precisa ter quando o risco for real.
   */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  /**
   * Qual projeto teve o contexto aberto (SPEC-Planejamento-02).
   *
   * Expansão **inline**, não rota nova nem modal: o contexto é *do projeto*, e separá-lo numa
   * tela própria obrigaria o usuário a levar na cabeça qual projeto estava olhando. Um por vez
   * porque o painel é alto — dois abertos empurrariam a lista para fora da dobra e o usuário
   * perderia a coluna que veio varrer.
   */
  const [contextoDeId, setContextoDeId] = useState<string | null>(null)

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

  /**
   * Permite o `git` sem sair da tela, e tenta de novo.
   *
   * **Não é um atalho que burla política.** `addAllowedCommand` é o mesmo canal da tela de
   * Terminal Controlado: classifica `permissions.change` como alto risco e audita, tudo no main.
   * O que muda é *onde* o usuário exerce a decisão — e mandá-lo a outra tela para exercer a
   * mesma decisão é fricção sem ganho de segurança. O erro que não oferece a correção é um beco
   * sem saída: o texto diz o que fazer, e a tela não deixa fazer.
   */
  async function permitirGit(): Promise<void> {
    setOcupado(true)
    try {
      await window.jarvis.addAllowedCommand(BINARIO_GIT, workspace)
      // Repete a ação que falhou. Permitir o comando sem retomar a criação deixaria o usuário
      // com um alerta resolvido e nenhum projeto — ele teria de descobrir sozinho que precisa
      // clicar de novo.
      const resultado = await window.jarvis.createProject(nome, workspace)
      setDesfecho(resultado)
      if (resultado.project) {
        setNome('')
        await recarregar()
      }
    } catch (error) {
      log.ui.error('Falha ao permitir o git e retomar a criação', { error })
    } finally {
      setOcupado(false)
    }
  }

  async function renomear(projectId: string, nomeAtual: string): Promise<void> {
    // O campo de edição é o próprio item virando editável, e não um modal: renomear é a operação
    // mais leve da tela, e um diálogo para trocar uma palavra custa dois cliques a mais e tira o
    // nome do contexto onde o usuário o compara com os outros.
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
      // isso que não há `AlertDialog` de confirmação destrutiva — a ação é reversível por
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

  // O único desfecho cuja correção cabe **nesta** tela. Os outros ou são do texto digitado
  // (nome inválido, colisão) ou pedem uma decisão que não é daqui (permitir um diretório).
  const podeCorrigirGit = desfecho?.reason === 'git-indisponivel'

  return (
    <section aria-labelledby="projetos-titulo" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h2
          className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] tracking-[1.5px] text-[var(--jos-cor-texto)]"
          id="projetos-titulo"
        >
          {t('projetos.titulo')}
        </h2>
        {/* Cap de medida: a descrição é prosa, e prosa larga demais cansa o retorno de linha. */}
        <p className="max-w-[68ch] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
          {t('projetos.descricao')}
        </p>
      </header>

      {desfecho !== null && (
        <InlineAlert tom={TOM_POR_MOTIVO[desfecho.reason]} titulo={desfecho.mensagem}>
          {podeCorrigirGit && (
            // A ação de correção mora **dentro** do alerta que a pede. Um erro cuja instrução é
            // "vá em outra tela" transfere ao usuário o trabalho de encontrar o caminho; o
            // princípio 3 do produto pede que o erro diga o problema *e* a próxima ação — e uma
            // ação que não pode ser executada onde é lida não é a próxima ação, é uma referência.
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void permitirGit()}
                carregando={ocupado}
                desabilitado={ocupado}
                iconeInicial={<ShieldCheck aria-hidden="true" className="size-4" />}
              >
                {t('projetos.permitirGit')}
              </Button>
              {/* Diz o que o clique faz de fato: é uma permissão de alto risco, auditada, e o
                  usuário merece saber disso antes e não depois. */}
              <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {t('projetos.permitirGitAviso')}
              </span>
            </div>
          )}
        </InlineAlert>
      )}

      {/*
        A criação fica **acima** da lista: a tarefa dominante desta tela é começar um projeto,
        não revisar os existentes. Ordem de leitura = ordem de uso.

        Não é um cartão sobre a seção — seria cartão dentro de cartão, e o conteúdo já vive numa
        superfície elevada. A separação vem de uma régua e do espaço, que é o material mais barato
        e o que não acrescenta uma caixa a mais para o olho processar.

        `items-start` e não `items-end`: o `Field` tem descrição sob o input, e alinhar pela base
        alinharia os botões pela última linha do texto de ajuda — que é o desalinhamento visível.
        Alinhados ao topo, os botões recebem o mesmo deslocamento do rótulo e ficam na linha do
        input, que é a âncora que o olho usa.
      */}
      <div className="flex flex-col gap-4 border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-5">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-4">
          <div className="min-w-[240px] flex-1">
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

          {/* Os botões descem o equivalente ao rótulo do campo (linha + gap do `Field`) para
              pousarem na altura do input. Valor derivado da estrutura do `Field`, não um número
              escolhido a olho: rótulo em micro (~1rem de caixa) + `gap-2`. */}
          <div className="flex flex-wrap gap-2 pt-[calc(1rem+0.5rem)]">
            <Button
              onClick={() => void criar()}
              desabilitado={ocupado || nome.trim().length === 0}
              carregando={ocupado && !podeCorrigirGit}
              iconeInicial={<FolderPlus aria-hidden="true" className="size-4" />}
            >
              {t('projetos.criar')}
            </Button>
            <Button
              variante="secundaria"
              onClick={() => void importar()}
              desabilitado={ocupado}
              iconeInicial={<FolderSearch aria-hidden="true" className="size-4" />}
            >
              {t('projetos.importar')}
            </Button>
          </div>
        </div>
      </div>

      {carregando ? (
        <LoadingState rotulo={t('projetos.carregando')} />
      ) : projetos.length === 0 ? (
        <EmptyState titulo={t('projetos.vazio')} descricao={t('projetos.vazioDescricao')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {projetos.map((projeto) => {
            const editando = editandoId === projeto.id
            const confirmando = confirmandoId === projeto.id

            return (
              <li key={projeto.id} data-jos-projeto={projeto.slug}>
                {/*
                  Não é `Card`: a lista pede item de linha, e o cartão do DS traz padding e sombra
                  dimensionados para conteúdo autônomo — uma pilha deles faria cada projeto
                  competir por atenção quando o que se quer é varrer a coluna.

                  O hover acende a **borda inteira**, não uma faixa lateral: faixa colorida à
                  esquerda é decoração que finge ser semântica, e aqui o item todo é a superfície.
                */}
                <article className="flex flex-col gap-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-4 transition-colors duration-[var(--jos-duracao-rapida)] hover:border-[rgba(var(--jos-borda-rgb),0.24)]">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {editando ? (
                        <Input
                          valor={edicao}
                          onMudar={setEdicao}
                          aria-label={t('projetos.renomearDe', { nome: projeto.nome })}
                        />
                      ) : (
                        <span className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-medio)] text-[var(--jos-cor-texto)]">
                          {projeto.nome}
                        </span>
                      )}
                      {/* `break-all`: caminho longo não tem espaço onde quebrar, e sem isso
                          estoura a largura do item em vez de continuar na linha de baixo. */}
                      <span className="break-all font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
                        {projeto.diretorio}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* Origem em mono maiúsculo: metadado de máquina, e o DS já usa essa forma
                          para o mesmo papel em Providers e Orçamento. Repetir a convenção é o
                          que faz a tela nova parecer parte do app, e não um enxerto. */}
                      {!editando && !confirmando && (
                        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-acento-leitura)]">
                          {projeto.origem === 'criado'
                            ? t('projetos.criado')
                            : t('projetos.importado')}
                        </span>
                      )}

                      {editando ? (
                        <>
                          <Button
                            onClick={() => void renomear(projeto.id, projeto.nome)}
                            desabilitado={ocupado}
                          >
                            {t('projetos.salvar')}
                          </Button>
                          <Button variante="secundaria" onClick={() => setEditandoId(null)}>
                            {t('projetos.cancelar')}
                          </Button>
                        </>
                      ) : (
                        !confirmando && (
                          <>
                            <Button
                              variante="secundaria"
                              onClick={() => {
                                setEdicao(projeto.nome)
                                setEditandoId(projeto.id)
                              }}
                              /* O nome acessível carrega o projeto: numa lista de botões
                                 "Renomear" idênticos, o leitor de tela não diria qual renomeia
                                 o quê. */
                              aria-label={t('projetos.renomearDe', { nome: projeto.nome })}
                            >
                              {t('projetos.renomear')}
                            </Button>
                            <Button
                              variante="secundaria"
                              onClick={() =>
                                setContextoDeId((atual) =>
                                  atual === projeto.id ? null : projeto.id
                                )
                              }
                              /* `aria-expanded` porque o botão **alterna** uma região desta
                                 mesma tela: sem ele, quem ouve a interface não sabe se o
                                 painel abriu ou se a página mudou. */
                              aria-expanded={contextoDeId === projeto.id}
                              aria-label={
                                contextoDeId === projeto.id
                                  ? t('projetos.contextoFechar')
                                  : t('projetos.contextoAbrir', { nome: projeto.nome })
                              }
                              iconeInicial={<FileSearch aria-hidden="true" className="size-4" />}
                            >
                              {t('projetos.contexto')}
                            </Button>
                            <Button
                              variante="secundaria"
                              onClick={() => setConfirmandoId(projeto.id)}
                              aria-label={t('projetos.removerDe', { nome: projeto.nome })}
                            >
                              {t('projetos.remover')}
                            </Button>
                          </>
                        )
                      )}
                    </div>
                  </div>

                  {/*
                    A confirmação ocupa **a própria faixa**, e não a mesma linha dos metadados.
                    Espremida à direita, ela empurrava o texto e os dois botões para fora da
                    largura do item — e a pergunta mais importante da tela era a que menos cabia.
                  */}
                  {/*
                    O contexto do projeto (SPEC-Planejamento-02): o manifesto, o orçamento da
                    etapa e as falhas em aberto. Fica **dentro** do item porque é dele que o
                    contexto é — e abrir aqui evita a viagem de ida e volta que uma tela
                    separada custaria a cada troca de projeto.
                  */}
                  {contextoDeId === projeto.id && (
                    <div className="border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-4">
                      <ContextoDoProjeto
                        workspace={workspace}
                        projectId={projeto.id}
                        nomeDoProjeto={projeto.nome}
                      />
                    </div>
                  )}

                  {confirmando && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--jos-raio-chip)] border border-[color-mix(in_srgb,var(--jos-cor-err)_35%,transparent)] bg-[color-mix(in_srgb,var(--jos-cor-err)_8%,transparent)] px-3 py-2.5">
                      {/* Diz o que **de fato** acontece: sai da lista, fica no disco. Um "tem
                          certeza?" genérico faria o usuário supor a perda dos arquivos e
                          desistir do que é reversível. */}
                      <p className="min-w-0 flex-1 text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                        {t('projetos.removerAviso')}
                      </p>
                      <div className="flex shrink-0 gap-2">
                        <Button variante="secundaria" onClick={() => setConfirmandoId(null)}>
                          {t('projetos.cancelar')}
                        </Button>
                        <Button
                          variante="perigo"
                          onClick={() => void remover(projeto.id)}
                          desabilitado={ocupado}
                          aria-label={t('projetos.removerDe', { nome: projeto.nome })}
                        >
                          {t('projetos.confirmar')}
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
