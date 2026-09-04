import { useCallback, useEffect, useState } from 'react'
import type { AiProvider } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Fase } from '@shared/domain/fase'
import type { RotaComModelo } from '@shared/domain/modelo-da-fase'
import type { DecisaoDeRota } from '@shared/domain/rota-de-geracao'
import { ROTULO_DA_FASE } from '@shared/domain/fase'
import { modelosDoCatalogo, rotuloDoModelo } from '@shared/domain/modelo-da-fase'
import { Button, Field, IconButton, Popover, Select } from '@design/ui'
import { log } from '../lib/log'

/**
 * Trocar o modelo **deste projeto** (SPEC-Fases-02, critérios 3 e 6).
 *
 * A pergunta que responde: **e se este projeto precisar de outro modelo?** O padrão do workspace
 * atende o caso comum; o projeto que diverge não deveria obrigar o PI a mudar o padrão de todos
 * os outros para depois desfazer.
 *
 * Três decisões:
 *
 *  - **Popover, e não um combo sempre visível.** O card é um índice: o PI passa os olhos por
 *    doze deles procurando o próximo passo. Um seletor aberto em cada card competiria com o
 *    nome e o CTA pela mesma atenção, para uma ação que acontece raramente.
 *  - **Só a fase atual.** Trocar "o modelo do Planejamento" num projeto que já está construindo
 *    é uma escolha sem efeito visível, e um seletor de fase aqui faria o card responder uma
 *    pergunta que o Settings responde melhor.
 *  - **Desabilitado na rota bloqueada** (critério 6): escolher modelo não destrava rota, e um
 *    seletor ativo ali prometeria que sim.
 */

/** O provider que atende cada rota. Espelha `PROVIDER_DA_ROTA` do main, sem importar do main. */
const PROVIDER_DA_ROTA: Readonly<Record<RotaComModelo, AiProvider>> = {
  assinatura: 'claude-code',
  paga: 'anthropic'
}

/**
 * A rota com modelo, ou `undefined` quando a decisão é `bloqueado`.
 *
 * `undefined` e não um padrão: rota bloqueada não gera, então não tem modelo a trocar — inventar
 * "assinatura" aqui faria o seletor editar a política de uma rota que não vai rodar.
 */
function rotaComModelo(decisao: DecisaoDeRota): RotaComModelo | undefined {
  return decisao === 'bloqueado' ? undefined : decisao
}

interface TrocaDeModeloProps {
  readonly projectId: string
  readonly fase: Fase
  readonly decisao: DecisaoDeRota
  readonly modelo: string
  readonly workspace: WorkspaceId
  /** Recarrega o resumo do card: o modelo exibido é o que o **main** confirma. */
  readonly aoTrocar: () => void
}

export function TrocaDeModeloDoProjeto({
  projectId,
  fase,
  decisao,
  modelo,
  workspace,
  aoTrocar
}: TrocaDeModeloProps): React.JSX.Element {
  const rota = rotaComModelo(decisao)
  const [temOverride, setTemOverride] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (rota === undefined) return
    let ativo = true

    /*
     * `try` em volta da chamada, e nao so `.catch()`: uma ponte sem este metodo lanca
     * **sincronamente**, antes de existir promise, e o `.catch()` sozinho nao pega — a excecao
     * sobe pelo efeito e derruba a lista de projetos inteira. Mesma protecao que o
     * `resumoDeVarios` do `ProjetosLocais` ja tinha, e pela mesma razao: o card sem a marca de
     * override continua util, uma lista em branco nao.
     */
    try {
      window.jarvis
        .getPhaseModelOverrides(projectId, workspace)
        .then((overrides) => {
          if (ativo) {
            setTemOverride(overrides.some((o) => o.fase === fase && o.rota === rota))
          }
        })
        .catch((error: unknown) => {
          if (ativo) log.ui.error('Falha ao ler os overrides de modelo', { error })
        })
    } catch (error: unknown) {
      log.ui.error('Ponte sem o canal de overrides de modelo', { error })
    }

    return () => {
      ativo = false
    }
  }, [projectId, fase, rota, workspace])

  const trocar = useCallback(
    async (escolhido: string): Promise<void> => {
      if (rota === undefined) return

      const gravado = await window.jarvis.setPhaseModelOverride(
        {
          project_id: projectId,
          fase,
          rota,
          provider: PROVIDER_DA_ROTA[rota],
          modelo: escolhido
        },
        workspace
      )

      // `undefined` é a fronteira recusando o par (critério 4). Dizer o motivo, e não recarregar
      // como se tivesse dado certo.
      if (gravado === undefined) {
        setErro(`O modelo ${escolhido} não está disponível nesta rota.`)
        return
      }

      setErro(null)
      setTemOverride(true)
      aoTrocar()
    },
    [projectId, fase, rota, workspace, aoTrocar]
  )

  const voltarAoPadrao = useCallback(async (): Promise<void> => {
    if (rota === undefined) return

    await window.jarvis.clearPhaseModelOverride(projectId, fase, rota, workspace)
    setTemOverride(false)
    setErro(null)
    aoTrocar()
  }, [projectId, fase, rota, workspace, aoTrocar])

  const bloqueada = rota === undefined

  return (
    <Popover
      gatilho={
        <IconButton
          desabilitado={bloqueada}
          rotulo={
            bloqueada
              ? 'Trocar o modelo não está disponível: nenhuma rota autorizada para este projeto'
              : `Trocar o modelo da fase ${ROTULO_DA_FASE[fase]} deste projeto`
          }
        >
          {/*
           * O **id** do modelo e o gatilho, nao o rotulo curto: o selo ja dizia `ROTA · modelo`
           * com o id, e e o id que aparece no ledger (SPEC-Fases-01, criterio 4 — "rota e modelo
           * do card sao os mesmos que a geracao usa"). Trocar por "Opus 5" aqui faria o card e a
           * evidencia deixarem de casar. O rotulo curto vive no combo, onde ha espaco para os
           * dois.
           *
           * Transformar o modelo em botao mantem a leitura e ganha a acao, sem um icone a mais
           * competindo pela atencao numa linha que o PI varre em doze cards. O ponto depois do id
           * marca "este projeto diverge do espaco" — forma, e nao so cor, porque o criterio do DS
           * e que estado nunca viva so na cor.
           */}
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px]">
            {modelo}
            {temOverride ? ' ·' : ''}
          </span>
        </IconButton>
      }
    >
      <div className="flex w-[18rem] flex-col gap-3">
        <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          O modelo da fase {ROTULO_DA_FASE[fase]} neste projeto. Sem escolha aqui, vale o padrão do
          espaço.
        </p>

        {erro !== null && (
          <p className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-err)]">{erro}</p>
        )}

        {rota !== undefined && (
          <Field rotulo={`Modelo da fase ${ROTULO_DA_FASE[fase]}`}>
            {(atributos) => (
              <Select
                {...atributos}
                data-jos-troca-modelo={projectId}
                valor={modelo}
                onMudar={(m) => void trocar(m)}
                opcoes={modelosDoCatalogo(PROVIDER_DA_ROTA[rota]).map((m) => ({
                  valor: m,
                  rotulo: `${rotuloDoModelo(m)} · ${m}`
                }))}
              />
            )}
          </Field>
        )}

        {/*
         * "Voltar ao padrão" só existe quando há override a remover: um botão que não faz nada
         * é pior que nenhum botão — ele promete uma ação e devolve silêncio.
         */}
        {temOverride && (
          <Button variante="secundaria" onClick={() => void voltarAoPadrao()}>
            Voltar ao padrão do espaço
          </Button>
        )}
      </div>
    </Popover>
  )
}
