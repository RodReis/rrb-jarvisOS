/**
 * O ciclo TESTE → REVIEWER → DEVELOPER (SPEC-Squads-04, ADR-006 decisões 9 e 10).
 *
 * **A ordem é fixa e a decisão é do kernel.** Produzir o trabalho (escritores e, com dois, o
 * integrador), rodar a suíte **antes** de o REVIEWER olhar, revisar, e — se algum dos dois reprova
 * — devolver ao DEVELOPER **só o que é novo e aceito**, dentro do limite da M9-F04 contado **por
 * run** (decisão do PI de 2026-10-03). Esgotado o limite, a issue para com motivo para o PI: não
 * existe "aceitar mesmo assim", nem quarta tentativa.
 *
 * Quem produz o trabalho é uma **porta** (`produzir`): o ciclo não sabe se são um ou dois
 * escritores, nem como se integra — só recebe um commit pronto, ou o motivo de não haver. Revisão
 * não consome tentativa; só a correção que ela dispara (a rodada da revisão é a tentativa do
 * DEVELOPER que está sendo revista).
 *
 * Cada volta fica registrada (critério 5), inclusive a que parou. Nunca lança.
 *
 * **O ciclo não é retomável**: ele sempre começa na tentativa 1, e uma segunda execução do mesmo run
 * esbarra no registro das voltas (`erro-interno`). Retomar depois de reiniciar o app é decisão
 * futura (MVP-028), e o registro no banco já guarda o que ela precisaria.
 */

import type { ComandosDeValidacao } from '@shared/domain/ci-workflow'
import type { PerfilDeCi } from '@shared/domain/ci-profile'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  correcoesParaOEscritor,
  decidirRetrabalho,
  type CorrecaoParaOEscritor
} from '@shared/domain/squad-retrabalho'
import type { AuditRepository } from '../storage/audit-repository'
import type { AchadoRepository } from './achado-repository'
import type { PedidoDeRevisao, RevisorService } from './squad-revisor'
import { resumoDaSuite, type EtapaDeTeste } from './squad-teste'

export interface PedidoDeProducao {
  readonly runId: string
  /** A tentativa do DEVELOPER, a partir de 1. */
  readonly tentativa: number
  /** Os achados aceitos da revisão anterior, deduplicados: a única entrada de correção. */
  readonly correcoes: readonly CorrecaoParaOEscritor[]
  /** A falha da suíte anterior, quando foi ela que reprovou. */
  readonly falhaDeTeste?: { readonly passo: string; readonly evidencia: string }
  readonly signal?: AbortSignal
}

export type ProducaoDoTrabalho =
  | {
      readonly estado: 'pronto'
      /** O commit pronto para testar: o do escritor, ou o da integração com dois escritores. */
      readonly commitSha: string
      /** O resumo do manifesto de hunks, em texto do kernel (vazio com um escritor só). */
      readonly manifesto: string
    }
  | { readonly estado: 'parado'; readonly motivo: string }

export type RevisaoDoCiclo = Omit<
  PedidoDeRevisao,
  'resultadoSha' | 'testes' | 'manifesto' | 'rodada' | 'signal'
>

export interface PedidoDoCiclo {
  readonly runId: string
  readonly projectId: string
  readonly sliceId: string
  readonly repositorio: string
  readonly baseSha: string
  readonly comandos: ComandosDeValidacao
  readonly perfilDeCi?: PerfilDeCi
  readonly revisao: RevisaoDoCiclo
  readonly signal?: AbortSignal
}

export type MotivoDoCiclo =
  | 'tentativas-esgotadas'
  | 'falha-externa'
  | 'tentativa-invalida'
  | 'sem-correcao-aceita'
  | 'suite-nao-rodou'
  | 'producao-parada'
  | 'revisao-parada'
  | 'conflito-entre-revisores'
  | 'revisao-sem-parecer'
  | 'revisor-bloqueou'
  | 'parecer-sem-evidencia'
  | 'cancelada'
  | 'erro-interno'

export type ResultadoDoCiclo =
  | {
      readonly estado: 'aprovado'
      readonly commitSha: string
      readonly tentativas: number
    }
  | {
      readonly estado: 'parado'
      readonly motivo: MotivoDoCiclo
      readonly detalhe?: string
      readonly tentativas: number
    }

export interface DependenciasDoCiclo {
  readonly produzir: (pedido: PedidoDeProducao) => Promise<ProducaoDoTrabalho>
  readonly teste: Pick<EtapaDeTeste, 'executar'>
  readonly revisor: Pick<RevisorService, 'revisar'>
  readonly achados: Pick<AchadoRepository, 'registrarVolta'>
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
}

export class CicloDeRevisao {
  constructor(private readonly deps: DependenciasDoCiclo) {}

  async executar(pedido: PedidoDoCiclo): Promise<ResultadoDoCiclo> {
    // A tentativa em curso, para o `catch` dizer em qual delas o ciclo caiu.
    const marca = { tentativa: 1 }
    try {
      return await this.rodar(pedido, marca)
    } catch (erro) {
      return {
        estado: 'parado',
        motivo: 'erro-interno',
        detalhe: erro instanceof Error ? erro.name : 'desconhecido',
        tentativas: marca.tentativa
      }
    }
  }

  private async rodar(
    pedido: PedidoDoCiclo,
    marca: { tentativa: number }
  ): Promise<ResultadoDoCiclo> {
    let tentativa = 1
    let correcoes: readonly CorrecaoParaOEscritor[] = []
    let falhaDeTeste: PedidoDeProducao['falhaDeTeste']
    // Função, e não leitura direta: o sinal muda **durante** o `await`, e o TypeScript estreitaria
    // a segunda leitura pela primeira.
    const cancelado = (): boolean => pedido.signal?.aborted === true

    for (;;) {
      marca.tentativa = tentativa
      const parado = (motivo: MotivoDoCiclo, detalhe?: string): ResultadoDoCiclo => ({
        estado: 'parado',
        motivo,
        ...(detalhe === undefined ? {} : { detalhe }),
        tentativas: tentativa
      })
      if (cancelado()) return parado('cancelada')

      const produzido = await this.deps
        .produzir({
          runId: pedido.runId,
          tentativa,
          correcoes,
          ...(falhaDeTeste === undefined ? {} : { falhaDeTeste }),
          ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
        })
        .catch((): ProducaoDoTrabalho => ({ estado: 'parado', motivo: 'erro-na-producao' }))
      if (produzido.estado === 'parado') return parado('producao-parada', produzido.motivo)

      const suite = await this.deps.teste.executar({
        runId: pedido.runId,
        projectId: pedido.projectId,
        sliceId: pedido.sliceId,
        repositorio: pedido.repositorio,
        commitSha: produzido.commitSha,
        comandos: pedido.comandos,
        ...(pedido.perfilDeCi === undefined ? {} : { perfilDeCi: pedido.perfilDeCi }),
        tentativa,
        ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
      })
      if (suite.estado === 'cancelada') return parado('cancelada')
      if (suite.estado === 'nao-rodou') return parado('suite-nao-rodou', suite.motivo)

      if (suite.estado === 'vermelha') {
        const decisao = decidirRetrabalho(tentativa, {
          origem: 'teste',
          classificacao: suite.classificacao
        })
        this.registrar(pedido, tentativa, 'teste', decisao, [])
        if (decisao.tipo === 'parar') return parado(decisao.motivo)
        tentativa = decisao.proximaTentativa
        // As correções aceitas que ainda estão pendentes **seguem**: se a suíte quebrou na volta
        // que corrigia o achado X, o escritor continua precisando saber que X segue aceito.
        falhaDeTeste = { passo: suite.passo, evidencia: suite.evidencia }
        continue
      }

      // TESTE verde: agora o REVIEWER. Cancelar entre as duas etapas não deixa a revisão rodar.
      if (cancelado()) return parado('cancelada')
      const revisao = await this.deps.revisor.revisar({
        ...pedido.revisao,
        resultadoSha: produzido.commitSha,
        testes: resumoDaSuite(suite),
        manifesto: produzido.manifesto,
        rodada: tentativa,
        ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
      })
      if (revisao.estado === 'parada') return parado('revisao-parada', revisao.motivo)

      const { veredito } = revisao
      if (veredito.resultado === 'PASS') {
        return { estado: 'aprovado', commitSha: produzido.commitSha, tentativas: tentativa }
      }
      if (veredito.resultado === 'BLOCKED') return parado(veredito.motivo)

      const aVoltar = correcoesParaOEscritor(revisao.achados)
      const assinaturas = aVoltar.map((a) => a.assinatura)
      // Reprovou sem nada aceito para corrigir: devolver ao DEVELOPER de mãos vazias gastaria uma
      // tentativa sem informação nova. Quem decide é o PI.
      if (aVoltar.length === 0) {
        this.registrar(
          pedido,
          tentativa,
          'revisao',
          { tipo: 'parar', motivo: 'sem-correcao-aceita' },
          []
        )
        return parado('sem-correcao-aceita')
      }
      const decisao = decidirRetrabalho(tentativa, { origem: 'revisao' })
      this.registrar(pedido, tentativa, 'revisao', decisao, assinaturas)
      if (decisao.tipo === 'parar') return parado(decisao.motivo)
      tentativa = decisao.proximaTentativa
      correcoes = aVoltar
      falhaDeTeste = undefined
    }
  }

  /** Cada volta fica registrada no banco e na auditoria: ids, estados e contagens. */
  private registrar(
    pedido: PedidoDoCiclo,
    tentativa: number,
    origem: 'teste' | 'revisao',
    decisao:
      | { readonly tipo: 'voltar'; readonly proximaTentativa: number }
      | { readonly tipo: 'parar'; readonly motivo: string },
    assinaturas: readonly string[]
  ): void {
    const motivo = decisao.tipo === 'parar' ? decisao.motivo : undefined
    this.deps.achados.registrarVolta(
      { userId: this.deps.userId(), workspaceId: this.deps.workspaceId(), runId: pedido.runId },
      {
        tentativa,
        origem,
        decisao: decisao.tipo,
        ...(motivo === undefined ? {} : { motivo }),
        assinaturas
      }
    )
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-retrabalho',
      payload: {
        runId: pedido.runId,
        tentativa,
        origem,
        decisao: decisao.tipo,
        ...(motivo === undefined ? {} : { motivo }),
        achados: assinaturas.length
      }
    })
  }
}
