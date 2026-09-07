import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { GeracaoOutcome } from '@shared/domain/brief'
import { Button, Field, LoadingState, Textarea } from '@design/ui'
import { log } from '../lib/log'
import { RecusaDaGeracao } from './RecusaDaGeracao'

/**
 * A etapa do prompt (SPEC-Jornada-02, critério 1).
 *
 * A tela que faltava no MVP-008: **em nenhum momento o PI dizia o que o projeto é**. O wizard
 * perguntava sobre escopo e público, mas ninguém nunca escrevia a frase que originou tudo.
 *
 * Três decisões de forma:
 *
 *  - **Um campo, e nada mais.** Sem contador de caracteres, sem sugestão de estrutura, sem
 *    exemplo pré-preenchido. A página inteira é a pergunta, e qualquer moldura ao redor dela
 *    empurraria o PI a preencher um formulário em vez de descrever o que quer.
 *  - **Salvar não gera** (#281). Até esta correção o mesmo clique salvava o prompt e gerava o
 *    brief — antes de qualquer pergunta do refinamento, então o brief nascia sem decisão alguma
 *    para citar. Agora o prompt vira revisão no Git e a jornada avança; o brief nasce no fim do
 *    refinamento. Com isso saem daqui o aviso de rota e o selo de custo: nada nesta tela chama
 *    o modelo, e anunciar rota onde não há chamada descreve um custo que não existe.
 */

interface PromptDoProjetoProps {
  readonly workspace: WorkspaceId
  readonly projectId: string
  readonly nomeDoProjeto: string
  /** Chamado quando o prompt foi salvo e a jornada avançou para o refinamento. */
  readonly onAvancar: () => void
}

export function PromptDoProjeto({
  workspace,
  projectId,
  nomeDoProjeto,
  onAvancar
}: PromptDoProjetoProps): React.JSX.Element {
  const { t } = useTranslation()
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  /*
   * O desfecho **inteiro**, e não uma string já concatenada.
   *
   * A versão anterior fazia `[mensagem, acao].join(' ')` e jogava fora `problemas` e
   * `textoDoModelo` — que o main já devolvia. O PI lia "a saída do modelo não passou no
   * validador, nem depois da correção" enquanto o console, logo abaixo, mostrava o modelo
   * dizendo que o diretório já continha outro produto e que ele não ia sobrescrever. A tela
   * tinha o fato e mostrava a frase genérica.
   */
  const [recusa, setRecusa] = useState<GeracaoOutcome | null>(null)

  useEffect(() => {
    let ativo = true

    window.jarvis
      .lerPromptDoProjeto(projectId, workspace)
      .then((prompt) => {
        if (!ativo) return
        // O texto já escrito volta para o campo: reabrir o projeto não pode custar o rascunho.
        if (prompt !== null) setTexto(prompt.texto)
      })
      .catch((error: unknown) => {
        if (ativo) log.ui.error('Falha ao carregar o prompt', { error })
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [projectId, workspace])

  /**
   * Salva o prompt e avança para o refinamento (#281).
   *
   * **Não chama o modelo.** Até esta correção, salvar disparava a geração do brief no mesmo
   * clique — e como isso acontecia antes de qualquer pergunta, o brief nascia sem nenhuma
   * decisão para citar. Agora o prompt vira revisão no Git e a jornada avança; o brief é gerado
   * no fim do refinamento, onde as decisões já existem.
   *
   * `salvarPromptDoProjeto` devolve `null` para prompt vazio — mas o botão já está desabilitado
   * nesse caso, e a recusa aqui é a segunda barreira, não a primeira.
   */
  async function salvarEAvancar(): Promise<void> {
    setOcupado(true)
    setRecusa(null)

    try {
      const salvo = await window.jarvis.salvarPromptDoProjeto(projectId, texto, workspace)

      if (salvo === null) {
        setRecusa({ resultado: 'sem-prompt', mensagem: t('prompt.vazioRecusa') })
        return
      }

      onAvancar()
    } catch (error: unknown) {
      log.ui.error('Falha ao salvar o prompt', { error })
      setRecusa({ resultado: 'saida-invalida', mensagem: t('prompt.falha') })
    } finally {
      setOcupado(false)
    }
  }

  if (carregando) return <LoadingState rotulo={t('prompt.carregando')} />

  const vazio = texto.trim().length === 0

  return (
    /*
     * O ritmo da coluna, e não sete irmãos com o mesmo `gap`.
     *
     * A versão anterior separava tudo por `gap-4`: cabeçalho, avisos, campo, exemplos e botão
     * pesavam igual, e a tela lida de relance virava uma pilha de blocos sem começo — foi o que
     * a captura do PI mostrou como "poluída". A régua do craft floor é a oposta: grupo apertado,
     * separação generosa. Aqui há **três** grupos, e o espaço entre eles é o que os nomeia.
     *
     * A coluna tem medida de leitura. O campo do prompt herdava a largura inteira do painel, e
     * uma linha de texto de 120 caracteres cansa o retorno de linha exatamente onde o PI escreve
     * o texto mais longo do produto — a prosa acima dele já respeitava `62ch`, e o campo não.
     */
    <div className="flex max-w-[74ch] flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h3 className="text-[length:var(--jos-texto-realce)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {t('prompt.titulo')}
        </h3>
        {/* Medida de leitura: prosa larga demais cansa o retorno de linha. */}
        <p className="max-w-[62ch] text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {t('prompt.descricao', { nome: nomeDoProjeto })}
        </p>
      </header>

      {/*
        A recusa vem **acima** do campo, onde o PI já está olhando depois de clicar. O aviso de
        rota saiu daqui com a geração (#281): salvar o prompt não chama o modelo, e anunciar
        "não há rota autorizada" numa tela que não gera nada descreveria um custo inexistente —
        quem precisa dizê-lo é o refinamento, que é onde a chamada acontece.
      */}
      {recusa !== null && <RecusaDaGeracao desfecho={recusa} />}

      {/*
        O campo e os exemplos são **um grupo**: os exemplos existem para desbloquear a página em
        branco, e separá-los do campo com o mesmo espaço que separa as seções os transformava num
        bloco autônomo que o olho lê depois de já ter decidido não escrever.

        Exemplos para **ler**, não para clicar (decisão do PI, 2026-09-03). A página em branco é
        o problema real desta tela: o campo grande e vazio chega no momento em que o PI tem menos
        ideia do que escrever. Mas cartão que preenche o campo faria ele partir do texto da IA em
        vez do problema dele — e a decisão de "um campo, e nada mais" existe justamente para a
        tela não virar formulário. Por isso são duas frases curtas, sem controle nenhum: não há
        clique, não há `input`, e a prova visual que trava "um `textarea`, zero `input`" continua
        valendo.
      */}
      <div className="flex flex-col gap-3">
        <Field rotulo={t('prompt.rotulo')} descricao={t('prompt.ajuda')}>
          {(atributos) => (
            <Textarea
              {...atributos}
              valor={texto}
              onMudar={setTexto}
              placeholder={t('prompt.placeholder')}
              desabilitado={ocupado}
              /*
               * Piso de 6 linhas, e o campo cresce daí. O valor fixo anterior abria meio metro
               * de vazio sob uma frase — a captura mostrou 500px de campo escuro embaixo de uma
               * linha de texto, e um campo grande e vazio intimida exatamente quem ainda não
               * sabe o que escrever. Seis linhas convidam sem cobrar.
               */
              linhas={6}
            />
          )}
        </Field>

        <div className="flex flex-col gap-1.5">
          <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {t('prompt.exemplosTitulo')}
          </p>

          {/*
            Grade de duas trilhas em vez de linha que reflui: a frase e o motivo ficam alinhados
            entre os dois exemplos, então o olho lê a coluna do "porquê" de uma vez. Com
            `flex-wrap`, o motivo do primeiro exemplo pousava em qualquer posição horizontal e os
            dois pares deixavam de se ler como uma lista.

            `subgrid` não serve: as trilhas precisam viver na lista, e é onde estão.
          */}
          <ul className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
            {[
              { texto: t('prompt.exemploA'), porque: t('prompt.exemploAPorque') },
              { texto: t('prompt.exemploB'), porque: t('prompt.exemploBPorque') }
            ].map((exemplo) => (
              <li
                key={exemplo.porque}
                className="grid gap-x-3 text-[length:var(--jos-texto-micro)] sm:col-span-2 sm:grid-cols-subgrid sm:items-baseline"
              >
                <span className="text-[var(--jos-cor-texto-secundario)]">“{exemplo.texto}”</span>
                <span className="font-[family-name:var(--jos-fonte-mono)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
                  {exemplo.porque}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/*
        A ação, atrás de uma divisória: escrever e avançar são momentos diferentes, e uma linha é
        o jeito mais barato de dizer isso. Sem ela, o botão era só mais um irmão na pilha — e a
        única ação da tela ficava com o mesmo peso visual dos exemplos acima dele.
      */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-5">
        {/*
          Salvar **não chama o modelo** (#281): o botão guarda o prompt, commita o `PROMPT.md` e
          leva ao refinamento. Por isso saiu o `Sparkles` — o ícone de geração num botão que não
          gera prometia uma chamada de IA que não acontece aqui — e por isso o `bloqueado` de
          rota deixou de desabilitar: sem rota autorizada o PI ainda pode escrever e salvar, e é
          na etapa seguinte, onde a geração de fato ocorre, que a falta de rota importa.
        */}
        <Button
          variante="primaria"
          onClick={() => void salvarEAvancar()}
          desabilitado={ocupado || vazio}
          carregando={ocupado}
          iconeInicial={<ArrowRight aria-hidden="true" className="size-4" />}
        >
          {ocupado ? t('prompt.salvando') : t('prompt.salvar')}
        </Button>

        {/* Diz **por que** o botão está desabilitado. Um alvo morto sem explicação faz o PI
            procurar o defeito na própria escrita. */}
        {vazio && (
          <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
            {t('prompt.escrevaAlgo')}
          </span>
        )}
      </div>
    </div>
  )
}
