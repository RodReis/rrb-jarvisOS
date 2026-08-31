import { useEffect, useState } from 'react'
import type { WorkspaceId } from '@shared/domain/entities'
import type { BudgetSnapshot } from '@shared/domain/budget'
import { Button, Field, Input, InlineAlert, Meter, Panel } from '@design/ui'
import { log } from '../lib/log'

/**
 * Orçamento de IA do espaço ativo (SPEC-Providers-03, critérios 7 e 8).
 *
 * A UI mínima que a spec pede: os limites editáveis, o acumulado do período e o alerta ao
 * cruzar o limiar. Nada aqui **calcula**: o acumulado vem somado do main, sobre os
 * `CostEvent` gravados, e a decisão do gate acontece dentro do ponto único de chamada. Um
 * segundo cálculo no renderer divergiria do que barra — e o número na tela deixaria de ser o
 * número que vale.
 *
 * **Escopada pelo espaço ativo**, como as credenciais: NOA e JARVIS têm orçamentos próprios, e
 * sem o espaço no cabeçalho o usuário ajustaria o limite de um achando que ajustou os dois.
 *
 * O alerta é **derivado**, não um estado próprio: se o acumulado já cruzou o limiar, a tela o
 * mostra. Guardar "estou alertando" num `useState` criaria uma segunda verdade que envelhece
 * — e envelheceria justamente enquanto o usuário edita o limite que a define.
 */

interface OrcamentoProps {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}

/** USD com dois decimais. Uma função só: o mesmo número aparece em quatro lugares na tela. */
function usd(valor: number): string {
  return `US$ ${valor.toFixed(2)}`
}

/**
 * O texto do alerta quando o período cruzou o limiar (critério 7).
 *
 * `null` quando não há o que alertar. Devolver string vazia faria a tela ter de testar
 * `=== ''` para decidir se renderiza — a ausência de alerta é ausência, não texto vazio.
 */
function alertaDe(snapshot: BudgetSnapshot): string | null {
  const { policy, gasto } = snapshot
  const cruzou = (usado: number, limite: number): boolean =>
    limite > 0 && usado / limite >= policy.alertThreshold

  if (cruzou(gasto.diaUsd, policy.dailyLimit)) {
    return `O gasto de hoje (${usd(gasto.diaUsd)}) já passou de ${Math.round(
      policy.alertThreshold * 100
    )}% do limite diário de ${usd(policy.dailyLimit)}.`
  }
  if (cruzou(gasto.mesUsd, policy.monthlyLimit)) {
    return `O gasto do mês (${usd(gasto.mesUsd)}) já passou de ${Math.round(
      policy.alertThreshold * 100
    )}% do limite mensal de ${usd(policy.monthlyLimit)}.`
  }
  return null
}

/**
 * Uma linha de período: a barra e os números.
 *
 * As faixas do `Meter` são **dado**, não `if` embutido — o componente já decide o tom pela
 * primeira faixa cujo teto o valor não ultrapassou. O limiar de alerta vira o teto da faixa
 * neutra, então a barra muda de tom exatamente onde o gate começa a alertar: a cor da tela e a
 * regra do main passam a ser a mesma coisa, em vez de duas que se parecem.
 */
function LinhaDePeriodo({
  rotulo,
  usado,
  limite,
  limiar
}: {
  readonly rotulo: string
  readonly usado: number
  readonly limite: number
  readonly limiar: number
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]">
          {rotulo}
        </span>
        {/*
         * Números como texto, e não só como largura da barra: "estado nunca só por cor" vale
         * também para grandeza. Quem não distingue o preenchimento precisa ler quanto gastou.
         */}
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          {usd(usado)} de {usd(limite)}
        </span>
      </div>
      <Meter
        valor={usado}
        maximo={limite > 0 ? limite : 1}
        rotulo={rotulo}
        // O `Meter` já renderiza `formatar(valor)` num rótulo próprio à direita, de largura
        // fixa: só o gasto cabe ali. O par "gasto de limite" fica na linha acima, e o
        // `aria-valuetext` carrega os dois — quem ouve recebe o contexto que a largura não
        // deixa mostrar duas vezes.
        formatar={(v) => usd(v)}
        faixas={[
          { ate: limite * limiar, tom: 'ok' },
          { ate: limite, tom: 'warn' },
          { ate: Number.POSITIVE_INFINITY, tom: 'err' }
        ]}
      />
    </div>
  )
}

export function OrcamentoDoWorkspace({
  workspace,
  nomeDoEspaco
}: OrcamentoProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [diario, setDiario] = useState('')
  const [mensal, setMensal] = useState('')
  const [salvando, setSalvando] = useState(false)

  /**
   * Recarrega ao trocar de espaço. Os campos são reescritos junto: o formulário mostra o
   * limite **daquele** espaço, e mantê-los faria o usuário salvar no NOA o número que digitou
   * olhando o JARVIS.
   */
  useEffect(() => {
    let ativo = true

    window.jarvis
      .getBudget(workspace)
      .then((atual) => {
        if (!ativo) return
        setSnapshot(atual)
        setDiario(String(atual.policy.dailyLimit))
        setMensal(String(atual.policy.monthlyLimit))
        setErro(null)
      })
      .catch((causa: unknown) => {
        if (!ativo) return
        log.ui.error('Falha ao carregar o orçamento do espaço', { workspace })
        setErro('Não foi possível carregar o orçamento deste espaço.')
        void causa
      })

    return () => {
      ativo = false
    }
  }, [workspace])

  async function salvar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault()
    if (snapshot === null) return

    const novoDiario = Number(diario.replace(',', '.'))
    const novoMensal = Number(mensal.replace(',', '.'))

    // Validação também aqui, e não só no main: o main **recusa** (é a fronteira que decide),
    // mas recusar em silêncio devolvendo o estado anterior deixaria o usuário sem saber por
    // que o número não mudou. A mensagem é da tela; a garantia é do main.
    if (!Number.isFinite(novoDiario) || novoDiario < 0) {
      setErro('O limite diário precisa ser um número maior ou igual a zero.')
      return
    }
    if (!Number.isFinite(novoMensal) || novoMensal < 0) {
      setErro('O limite mensal precisa ser um número maior ou igual a zero.')
      return
    }

    setSalvando(true)
    try {
      const atualizado = await window.jarvis.setBudgetLimits(
        {
          dailyLimit: novoDiario,
          monthlyLimit: novoMensal,
          // O limiar não é editável nesta fatia (a spec pede limites; o limiar tem default
          // configurável no contrato). Repassar o corrente mantém o valor em vez de
          // silenciosamente reduzi-lo ao padrão a cada salvamento.
          alertThreshold: snapshot.policy.alertThreshold
        },
        workspace
      )

      setSnapshot(atualizado)
      setDiario(String(atualizado.policy.dailyLimit))
      setMensal(String(atualizado.policy.monthlyLimit))
      setErro(null)
    } catch {
      log.ui.error('Falha ao salvar os limites de orçamento', { workspace })
      setErro('Não foi possível salvar os limites.')
    } finally {
      setSalvando(false)
    }
  }

  if (erro !== null && snapshot === null) {
    // Erro **no lugar** do conteúdo, não ao lado dele: com a carga falhando, mostrar o aviso
    // junto de limites zerados diria "seu orçamento é zero" quando o certo é "não sabemos
    // qual é". Foi o defeito encontrado na M4-F03, e a régua vale igual aqui.
    return (
      <Panel titulo={`Orçamento de IA · ${nomeDoEspaco}`}>
        <InlineAlert tom="err" titulo="Orçamento indisponível">
          {erro}
        </InlineAlert>
      </Panel>
    )
  }

  if (snapshot === null) {
    return (
      <Panel titulo={`Orçamento de IA · ${nomeDoEspaco}`}>
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-suave)]">
          Carregando o orçamento deste espaço…
        </p>
      </Panel>
    )
  }

  const alerta = alertaDe(snapshot)

  return (
    <Panel titulo={`Orçamento de IA · ${nomeDoEspaco}`}>
      <div className="flex flex-col gap-6">
        <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-suave)]">
          Antes de cada chamada, o gasto acumulado mais a estimativa desta chamada são comparados
          aos limites. Excedendo, a chamada é barrada. Como o custo real só é conhecido ao fim da
          resposta, o controle é por estimativa — reduz o risco de estouro, não o elimina.
        </p>

        {alerta !== null && (
          <InlineAlert tom="warn" titulo="Perto do limite">
            {alerta}
          </InlineAlert>
        )}

        <div className="flex flex-col gap-4">
          <LinhaDePeriodo
            rotulo="Hoje"
            usado={snapshot.gasto.diaUsd}
            limite={snapshot.policy.dailyLimit}
            limiar={snapshot.policy.alertThreshold}
          />
          <LinhaDePeriodo
            rotulo="Este mês"
            usado={snapshot.gasto.mesUsd}
            limite={snapshot.policy.monthlyLimit}
            limiar={snapshot.policy.alertThreshold}
          />
        </div>

        <form className="flex flex-col gap-4" onSubmit={(e) => void salvar(e)}>
          <Field rotulo="Limite diário (USD)" descricao="Teto do dia corrente.">
            {(atributos) => <Input {...atributos} valor={diario} onMudar={setDiario} />}
          </Field>

          <Field rotulo="Limite mensal (USD)" descricao="Teto do mês corrente.">
            {(atributos) => <Input {...atributos} valor={mensal} onMudar={setMensal} />}
          </Field>

          {erro !== null && (
            <InlineAlert tom="err" titulo="Limites não salvos">
              {erro}
            </InlineAlert>
          )}

          <div className="flex justify-end">
            <Button tipo="submit" carregando={salvando}>
              Salvar limites
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  )
}
