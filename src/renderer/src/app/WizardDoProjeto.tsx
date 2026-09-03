import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Wand2 } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  Contradicao,
  Decision,
  EstadoDoWizard,
  Pergunta,
  Resposta,
  RespostaOutcome,
  VistaDoWizard,
  WizardReason
} from '@shared/domain/wizard'
import { opcoesOrdenadas } from '@shared/domain/wizard'
import {
  Badge,
  Button,
  Dialog,
  Field,
  InlineAlert,
  LoadingState,
  Separator,
  Textarea
} from '@design/ui'
import { log } from '../lib/log'

/**
 * O wizard orientado (SPEC-Planejamento-03).
 *
 * **Uma pergunta por pop-up**, e é por isso que isto é um `Dialog` e não o painel inline que o
 * contexto usa: o contrato da spec é conduzir *uma decisão de cada vez*, e uma tela que
 * mostrasse a lista inteira convidaria a responder tudo de qualquer jeito — o oposto do que a
 * fatia existe para fazer.
 *
 * Três garantias vivem na fronteira, não aqui:
 *  - **A tela não decide o que perguntar.** A pergunta chega pronta do main, com opções,
 *    recomendação e impacto. Um catálogo no renderer seria uma segunda fonte que divergiria.
 *  - **A tela não resolve contradição.** Ela mostra o que voltou em `contradicao-pendente` e
 *    pede o aceite; substituir por conta própria é exatamente o silêncio que o critério 5
 *    proíbe.
 *  - **A tela não decide o que é delegável.** O botão "Decide por mim" só aparece quando a
 *    pergunta diz que é, e o main recusa de novo se alguém chegar por outro caminho.
 *
 * **Sobre a forma.** A recomendação é *distinguível, não forçada* (critério 2): ela vem
 * primeiro e leva um selo — mas é um botão do mesmo peso visual dos demais, sem pré-seleção e
 * sem foco automático. Marcar o radio por padrão faria a recomendação virar o caminho de menor
 * esforço, e a spec pede o contrário: que o PI escolha vendo o impacto de cada lado.
 */

interface WizardDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  readonly aberto: boolean
  readonly onFechar: () => void
  /**
   * De onde vêm a pergunta e o histórico. Ausente = o wizard do catálogo (M8-F03).
   *
   * **Parametrizado, e não duplicado.** O refinamento da M25-F02 conduz a mesma decisão com a
   * mesma mecânica — contradição, delegação, retomada —, e a única diferença é a origem da
   * pergunta: lá o catálogo é código versionado, aqui é gerado por projeto. Copiar a tela
   * criaria duas superfícies que divergiriam na primeira correção feita só numa delas.
   */
  readonly fonte?: {
    readonly ler: () => Promise<VistaDoWizard | null>
    readonly responder: (resposta: Resposta) => Promise<RespostaOutcome>
  }
}

/**
 * Tom do `InlineAlert` por desfecho. Mapa fechado, como o `TOM_POR_MOTIVO` da tela de projetos:
 * um motivo novo no contrato quebra a compilação aqui em vez de cair num default silencioso.
 *
 * `contradicao-pendente` é **`warn`, não `err`**: nada falhou. O PI mudou de ideia, o que é
 * legítimo — pintar de vermelho ensinaria a ler uma revisão normal como erro.
 */
const TOM_POR_MOTIVO: Readonly<Record<WizardReason, 'ok' | 'err' | 'warn'>> = {
  registrada: 'ok',
  'projeto-inexistente': 'err',
  'pergunta-desconhecida': 'err',
  'escolha-invalida': 'warn',
  'nao-delegavel': 'warn',
  'contradicao-pendente': 'warn'
}

export function WizardDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  aberto,
  onFechar,
  fonte
}: WizardDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  /**
   * Um estado, três valores: `undefined` ainda carregando, `null` não deu para ler, objeto
   * pronto. Um booleano `carregando` separado teria de ser desligado no `finally` do
   * carregamento — um `setState` síncrono dentro do efeito, que dispara render em cascata.
   */
  const [estado, setEstado] = useState<EstadoDoWizard | null | undefined>(undefined)
  const [historico, setHistorico] = useState<readonly Decision[]>([])
  const [enviando, setEnviando] = useState(false)
  const [desfecho, setDesfecho] = useState<RespostaOutcome | null>(null)
  /**
   * A última resposta enviada, guardada só para o reenvio com aceite de substituição: a
   * contradição volta **sem** ter gravado, e aceitar precisa remandar a mesma escolha.
   */
  const [pendente, setPendente] = useState<Resposta | null>(null)

  /**
   * Lê o estado do main. **Ler não avança** — é o que faz a retomada do critério 6 funcionar:
   * reabrir o pop-up pergunta onde parou, e a resposta vem do histórico gravado, não de estado
   * que morreu quando a janela fechou.
   */
  const buscar = useCallback(
    (): Promise<VistaDoWizard | null> =>
      fonte?.ler() ?? window.jarvis.getWizardState(projectId, workspace),
    [projectId, workspace, fonte]
  )

  const aplicar = useCallback((vista: VistaDoWizard | null): void => {
    setEstado(vista?.estado ?? null)
    setHistorico(vista?.historico ?? [])
  }, [])

  /*
   * A flag `ativo` tem o mesmo desenho das outras telas: sem ela, fechar o pop-up durante a
   * promise deixaria um `setState` em componente já fora da árvore. O estado **nasce**
   * `undefined` (carregando), então não há nada a ligar aqui.
   */
  useEffect(() => {
    if (!aberto) return undefined
    let ativo = true

    buscar()
      .then((vista) => {
        if (ativo) aplicar(vista)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao ler o estado do wizard', {
          projectId,
          stack: causa instanceof Error ? causa.stack : undefined
        })
        setEstado(null)
      })

    return () => {
      ativo = false
    }
  }, [aberto, projectId, buscar, aplicar])

  async function responder(resposta: Resposta): Promise<void> {
    setEnviando(true)
    setPendente(resposta)
    try {
      const resultado = await (fonte?.responder(resposta) ??
        window.jarvis.answerWizard(projectId, resposta, workspace))
      setDesfecho(resultado)
      // Só recarrega quando algo foi gravado. Em `contradicao-pendente` nada mudou no banco, e
      // recarregar apagaria da tela a contradição que o PI precisa ler para decidir.
      if (resultado.reason === 'registrada') aplicar(await buscar())
    } catch (erro) {
      log.ui.error('Falha ao registrar decisão', { erro: String(erro) })
    } finally {
      setEnviando(false)
    }
  }

  const contradicoes =
    desfecho?.reason === 'contradicao-pendente' ? desfecho.contradicoes : undefined

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo={t('wizard.titulo', { nome: nomeDoProjeto })}
      descricao={t('wizard.descricao')}
      rodape={
        <Button variante="secundaria" onClick={onFechar}>
          {t('wizard.fechar')}
        </Button>
      }
    >
      {estado === undefined ? (
        <LoadingState rotulo={t('wizard.carregando')} />
      ) : estado === null ? (
        <InlineAlert tom="err" titulo={t('wizard.indisponivel')} />
      ) : (
        <div className="flex flex-col gap-4">
          {desfecho !== null && (
            <InlineAlert tom={TOM_POR_MOTIVO[desfecho.reason]} titulo={desfecho.mensagem} />
          )}

          {contradicoes !== undefined && contradicoes.length > 0 && (
            <ContradicoesPendentes
              contradicoes={contradicoes}
              enviando={enviando}
              onCancelar={() => setDesfecho(null)}
              onAceitar={() => {
                // Reenvia **a mesma** resposta, agora com o aceite. Remontar a escolha aqui
                // arriscaria mandar algo diferente do que gerou a contradição que o PI leu.
                if (pendente === null) return
                void responder({ ...pendente, aceitarSubstituicao: true })
              }}
            />
          )}

          {estado.tipo === 'pergunta' && (
            /*
              `key` na pergunta: trocar de pergunta **remonta** o formulário, e a escolha
              anterior morre com a instância antiga. É o reset idiomático do React — um efeito
              que zerasse o estado a cada troca dispararia render em cascata, e o lint barra.
            */
            <PerguntaAtual
              key={estado.pergunta.id}
              pergunta={estado.pergunta}
              restantes={estado.restantes}
              enviando={enviando}
              onResponder={(resposta) => void responder(resposta)}
            />
          )}

          {estado.tipo === 'concluido' && <ResumoDasDecisoes decisoes={estado.decisoes} />}

          {estado.tipo === 'bloqueado' && (
            <InlineAlert tom="err" titulo={estado.motivo}>
              {estado.retomada}
            </InlineAlert>
          )}

          {historico.length > 0 && estado.tipo === 'pergunta' && (
            <>
              <Separator />
              <ResumoDasDecisoes decisoes={historico} compacto />
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

/**
 * A pergunta corrente. Cada opção mostra o **impacto**, porque escolher sem ver o trade-off é
 * escolher no escuro — e o contrato da pergunta (spec § Contrato da pergunta) exige o impacto
 * declarado por opção, não só o rótulo.
 */
function PerguntaAtual({
  pergunta,
  restantes,
  enviando,
  onResponder
}: {
  readonly pergunta: Pergunta
  readonly restantes: number
  readonly enviando: boolean
  readonly onResponder: (resposta: Resposta) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // Estado da escolha **aqui**, não no pai: a instância morre quando a pergunta troca (o `key`
  // do chamador), e o reset sai de graça em vez de exigir um efeito que zere campo.
  const [escolha, setEscolha] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const podeConfirmar = escolha !== null || texto.trim() !== ''

  return (
    <section className="flex flex-col gap-3" aria-labelledby="wizard-pergunta">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3
            id="wizard-pergunta"
            className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)]"
          >
            {pergunta.titulo}
          </h3>
          <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            {pergunta.enunciado}
          </p>
        </div>
        {/* Mono em micro maiúsculo para metadado de máquina, como o resto da plataforma. */}
        <span className="shrink-0 font-mono text-[length:var(--jos-texto-micro)] uppercase text-[var(--jos-cor-texto-suave)]">
          {t('wizard.restantes', { count: restantes })}
        </span>
      </header>

      {/*
        `radiogroup` explícito, e não o `RadioGroup` do DS: aquele aceita rótulo por opção, e
        aqui cada opção carrega rótulo **e** impacto **e** um selo de recomendada. Estender o
        componente do DS por um caso só seria a abstração de uso único que a plataforma evita.
      */}
      <div role="radiogroup" aria-labelledby="wizard-pergunta" className="flex flex-col gap-2">
        {opcoesOrdenadas(pergunta).map((opcao) => {
          const selecionada = escolha === opcao.id
          const recomendada = opcao.id === pergunta.recomendada
          return (
            <button
              key={opcao.id}
              type="button"
              role="radio"
              aria-checked={selecionada}
              disabled={enviando}
              onClick={() => {
                setEscolha(opcao.id)
                // Escolher limpa o texto: as duas respostas são exclusivas, e mandar as duas
                // faria o main recusar por escolha inválida sem o PI entender por quê.
                setTexto('')
              }}
              className={[
                'flex flex-col gap-1 rounded-[var(--jos-raio-chip)] border px-3 py-2.5 text-left',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--jos-cor-acento)]',
                selecionada
                  ? 'border-[var(--jos-cor-acento)] bg-[color-mix(in_srgb,var(--jos-cor-acento)_8%,transparent)]'
                  : 'border-[rgba(var(--jos-borda-rgb),0.16)] hover:border-[rgba(var(--jos-borda-rgb),0.32)]'
              ].join(' ')}
            >
              <span className="flex items-center gap-2">
                <span className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)]">
                  {opcao.rotulo}
                </span>
                {recomendada && (
                  <Badge tom="info">
                    <Sparkles aria-hidden="true" className="size-3" />
                    {t('wizard.recomendada')}
                  </Badge>
                )}
              </span>
              <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
                {opcao.impacto}
              </span>
            </button>
          )
        })}
      </div>

      {/* A justificativa da recomendação fica visível sempre: ela é o que torna a recomendação
       *argumentada* em vez de autoritativa. */}
      <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
        {t('wizard.porque', { justificativa: pergunta.justificativa })}
      </p>

      {pergunta.aceitaTextoLivre && (
        <Field rotulo={t('wizard.textoLivre')}>
          {(atributos) => (
            <Textarea
              {...atributos}
              valor={texto}
              onMudar={(v) => {
                setTexto(v)
                // Digitar limpa a opção, pelo mesmo motivo que escolher limpa o texto.
                if (v.trim() !== '') setEscolha(null)
              }}
              linhas={2}
              desabilitado={enviando}
              placeholder={t('wizard.textoLivrePlaceholder')}
            />
          )}
        </Field>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {pergunta.delegavel && (
          <Button
            variante="secundaria"
            onClick={() =>
              onResponder({
                perguntaId: pergunta.id,
                escolha: null,
                texto: null,
                autor: 'agente'
              })
            }
            desabilitado={enviando}
            iconeInicial={<Wand2 aria-hidden="true" className="size-4" />}
          >
            {t('wizard.decidePorMim')}
          </Button>
        )}
        <Button
          variante="primaria"
          onClick={() =>
            onResponder({
              perguntaId: pergunta.id,
              escolha,
              texto: escolha === null && texto.trim() !== '' ? texto : null,
              autor: 'pi'
            })
          }
          desabilitado={enviando || !podeConfirmar}
        >
          {t('wizard.confirmar')}
        </Button>
      </div>
    </section>
  )
}

/**
 * A contradição, com a decisão anterior à vista. É a tela do critério 5: o PI vê o que muda
 * **antes** de aceitar, e nada foi gravado até ele aceitar.
 */
function ContradicoesPendentes({
  contradicoes,
  enviando,
  onAceitar,
  onCancelar
}: {
  readonly contradicoes: readonly Contradicao[]
  readonly enviando: boolean
  readonly onAceitar: () => void
  readonly onCancelar: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-2 rounded-[var(--jos-raio-chip)] border border-[color-mix(in_srgb,var(--jos-cor-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--jos-cor-warn)_8%,transparent)] px-3 py-2.5">
      <h4 className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-corpo)]">
        {t('wizard.contradicaoTitulo')}
      </h4>
      <ul className="flex flex-col gap-1">
        {contradicoes.map((c) => (
          <li
            key={c.perguntaAfetada}
            className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]"
          >
            {t('wizard.contradicaoItem', {
              pergunta: c.impacto,
              anterior: c.anterior.escolha ?? c.anterior.texto ?? ''
            })}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2 pt-1">
        <Button variante="secundaria" onClick={onCancelar} desabilitado={enviando}>
          {t('wizard.contradicaoManter')}
        </Button>
        <Button onClick={onAceitar} desabilitado={enviando}>
          {t('wizard.contradicaoSubstituir')}
        </Button>
      </div>
    </section>
  )
}

/**
 * O resumo do critério 7. Mostra **quem decidiu** cada item — é a leitura da trilha que a
 * invariante 3 do CONVENTION §4 torna necessária: delegado ao agente e escolhido pelo PI não
 * podem parecer a mesma coisa depois do fato.
 */
function ResumoDasDecisoes({
  decisoes,
  compacto = false
}: {
  readonly decisoes: readonly Decision[]
  readonly compacto?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const vigentes = decisoes.filter((d) => d.motivo !== 'omitida')

  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-mono text-[length:var(--jos-texto-micro)] uppercase text-[var(--jos-cor-texto-suave)]">
        {compacto ? t('wizard.jaDecidido') : t('wizard.resumo')}
      </h4>
      <ul className="flex flex-col gap-1.5">
        {vigentes.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-[length:var(--jos-texto-micro)]">
              {t('wizard.resumoItem', {
                pergunta: d.perguntaId,
                escolha: d.escolha ?? d.texto ?? ''
              })}
            </span>
            <Badge tom={d.autor === 'agente' ? 'info' : 'ok'}>
              {d.autor === 'agente' ? t('wizard.autorAgente') : t('wizard.autorPi')}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}
