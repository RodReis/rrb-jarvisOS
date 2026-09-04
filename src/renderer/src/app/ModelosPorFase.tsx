import { useCallback, useEffect, useState } from 'react'
import type { AiProvider } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Fase } from '@shared/domain/fase'
import type { PhaseModelPolicy, RotaComModelo } from '@shared/domain/modelo-da-fase'
import { FASES, ROTULO_DA_FASE } from '@shared/domain/fase'
import { ORIGEM_DO_PROVIDER, ROTULO_DO_PROVIDER, isRotaUnmetered } from '@shared/domain/ai'
import {
  ROTAS_COM_MODELO,
  ROTULO_DA_ROTA,
  modelosDoCatalogo,
  politicaDeModeloPadrao,
  rotuloDoModelo
} from '@shared/domain/modelo-da-fase'
import { Field, InlineAlert, Select, Tag } from '@design/ui'

/**
 * Qual modelo gera cada fase (SPEC-Fases-02, critério 1).
 *
 * A pergunta que a tela responde: **o Planejamento e a Construção precisam do mesmo modelo?**
 * Até aqui a resposta era forçosamente sim — havia um modelo ativo por provider, e as três fases
 * o usavam. O PI decidiu que não, e é essa escolha que estas seis combos guardam.
 *
 * Três decisões de desenho:
 *
 *  - **Uma seção por fase, duas combos por seção**, e não uma tabela de seis linhas: a rota é
 *    subordinada à fase, não par dela. Uma tabela plana faria "Planejamento na assinatura" e
 *    "Construção na paga" parecerem itens irmãos de uma lista, quando a pergunta que o PI faz é
 *    sempre "e nesta fase?".
 *  - **O combo lista o catálogo da rota**, e é por isso que Fable aparece na assinatura e não na
 *    paga. Filtrar aqui, e não recusar depois, é o que faz a tela nunca oferecer o que a
 *    fronteira recusaria — um combo que oferece o impossível é uma tela mentindo.
 *  - **A rota paga é editável mesmo sem credencial** (decisão do PI, 2026-09-04): isto é
 *    configuração do workspace, não uma geração. Escolher agora deixa pronto para o dia do
 *    opt-in; desabilitar obrigaria a configurar credencial antes de poder decidir.
 *
 * Arquivo próprio, e não mais uma seção dentro de `ProvidersDoWorkspace`: aquele já tem 389
 * linhas com o editor de rotas por tarefa, e as duas superfícies respondem perguntas diferentes.
 */

/** O provider que atende cada rota. Espelha `PROVIDER_DA_ROTA` do main, sem importar do main. */
const PROVIDER_DA_ROTA: Readonly<Record<RotaComModelo, AiProvider>> = {
  assinatura: 'claude-code',
  paga: 'anthropic'
}

interface ComboDeModeloProps {
  readonly fase: Fase
  readonly rota: RotaComModelo
  readonly valor: string
  readonly aoMudar: (modelo: string) => void
}

/** Uma combo: os modelos que o provider daquela rota oferece, com rótulo e id juntos. */
function ComboDeModelo({ fase, rota, valor, aoMudar }: ComboDeModeloProps): React.JSX.Element {
  const provider = PROVIDER_DA_ROTA[rota]

  return (
    <div className="flex flex-col gap-2">
      <Field rotulo={`${ROTULO_DA_ROTA[rota]} · ${ROTULO_DO_PROVIDER[provider]}`}>
        {(atributos) => (
          <Select
            {...atributos}
            data-jos-fase={fase}
            data-jos-rota={rota}
            valor={valor}
            onMudar={aoMudar}
            opcoes={modelosDoCatalogo(provider).map((m) => ({
              valor: m,
              // Rótulo **e** id: o rótulo é o que o PI reconhece, o id é o que aparece no ledger
              // e no card. Só o rótulo faria a evidência não casar com a escolha.
              rotulo: `${rotuloDoModelo(m)} · ${m}`
            }))}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        {/*
         * Origem e custo como `Tag`, repetindo a convenção da tela de providers: "roda na minha
         * máquina" e "não cobra por chamada" são fatos que o usuário precisa ler, e o critério
         * do DS é que estado nunca vive só na cor.
         */}
        <Tag>{ORIGEM_DO_PROVIDER[provider] === 'local' ? 'Local' : 'Nuvem'}</Tag>
        {isRotaUnmetered(provider) && <Tag>Sem custo por chamada</Tag>}
      </div>
    </div>
  )
}

interface ModelosPorFaseProps {
  readonly workspace: WorkspaceId
}

export function ModelosPorFase({ workspace }: ModelosPorFaseProps): React.JSX.Element {
  /*
   * Começa no padrão em vez de `null`: os seis combos do padrão são o que o banco vazio devolve,
   * então mostrá-los antes da resposta não é chutar — é antecipar o caso normal. Um `null` aqui
   * daria um piscar de tela vazia em toda abertura da aba, para nada.
   *
   * O `user_id` do agregado não importa para a tela (ela só le `fases`), e o renderer nao o
   * conhece: quem carrega o escopo e o main, em toda chamada.
   */
  const [politica, setPolitica] = useState<PhaseModelPolicy>(() =>
    politicaDeModeloPadrao('', workspace)
  )
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    void window.jarvis.getPhaseModels(workspace).then((p) => {
      if (ativo) setPolitica(p)
    })

    return () => {
      ativo = false
    }
  }, [workspace])

  const trocar = useCallback(
    async (fase: Fase, rota: RotaComModelo, modelo: string): Promise<void> => {
      const resultado = await window.jarvis.setPhaseModel(
        fase,
        rota,
        PROVIDER_DA_ROTA[rota],
        modelo,
        workspace
      )

      // `undefined` é a fronteira recusando o par (critério 4). A tela mantém a política que
      // continua valendo e diz o motivo — recarregar sozinha esconderia que a escolha não pegou.
      if (resultado === undefined) {
        setErro(`O modelo ${modelo} não está disponível nesta rota. Nada foi alterado.`)
        return
      }

      setErro(null)
      setPolitica(resultado)
    },
    [workspace]
  )

  return (
    <section className="flex flex-col gap-6" aria-labelledby="modelos-por-fase">
      <div className="flex flex-col gap-2">
        <h3
          id="modelos-por-fase"
          className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]"
        >
          Modelos por fase
        </h3>
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          A geração de cada fase sai pelo modelo escolhido aqui. Cada projeto pode divergir deste
          padrão no cabeçalho dele. O modelo da rota paga só é usado quando o projeto habilita a
          rota paga.
        </p>
      </div>

      {erro !== null && (
        <InlineAlert tom="warn" titulo="Modelo não aplicado">
          {erro}
        </InlineAlert>
      )}

      {FASES.map((fase) => (
        <div
          key={fase}
          data-jos-fase={fase}
          className="flex flex-col gap-3 border-b border-[rgba(var(--jos-borda-rgb),0.16)] pb-5 last:border-b-0 last:pb-0"
        >
          <h4 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-suave)]">
            {ROTULO_DA_FASE[fase]}
          </h4>

          <div className="grid gap-4 sm:grid-cols-2">
            {ROTAS_COM_MODELO.map((rota) => (
              <ComboDeModelo
                key={rota}
                fase={fase}
                rota={rota}
                valor={politica.fases[fase][rota].modelo}
                aoMudar={(modelo) => void trocar(fase, rota, modelo)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
