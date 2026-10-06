import { randomUUID } from 'node:crypto'
import type {
  ConfiguracaoDoCronograma,
  SequenciaDoCronograma,
  ResultadoDoCronograma,
  AtividadeDoCronograma
} from '@shared/domain/cronograma'
import type { PolicyDecision } from '@shared/policies'
import { validarCronograma } from './validar-cronograma'

export interface DepsDoCronograma {
  readonly agora: () => Date
  readonly usuarioAtual?: () => string
  readonly estado: {
    readonly ler: () => ConfiguracaoDoCronograma
    readonly salvar: (config: ConfiguracaoDoCronograma) => void
    readonly historico: () => readonly ResultadoDoCronograma[]
    readonly registrar: (resultado: ResultadoDoCronograma) => void
  }
  readonly registrarParaUsuario?: (usuarioId: string, resultado: ResultadoDoCronograma) => void
  readonly avaliar: (acao: string) => PolicyDecision
  readonly auditar: (marco: string, payload: Record<string, unknown>) => void
  readonly midiaAutorizada: (
    atividade: Extract<AtividadeDoCronograma, { tipo: 'tocar-midia-local' }>
  ) => boolean
  readonly podeReproduzir: () => Promise<boolean>
  readonly sessaoBloqueada: () => boolean
  readonly falar: () => Promise<void>
  readonly tocarMidia: (
    midia: Extract<AtividadeDoCronograma, { tipo: 'tocar-midia-local' }>['midia']
  ) => Promise<void>
}

const acaoDaAtividade = (atividade: AtividadeDoCronograma): string => `cronograma.${atividade.tipo}`
const chaveDaMinuta = (data: Date): string =>
  `${data.getFullYear()}-${data.getMonth()}-${data.getDate()}:${data.getHours()}:${data.getMinutes()}`

export class CronogramaService {
  private fila: Promise<void> = Promise.resolve()
  private readonly minutosDisparados = new Set<string>()
  private ultimaMinuta?: string

  constructor(private readonly deps: DepsDoCronograma) {}

  ler(): ConfiguracaoDoCronograma {
    return this.deps.estado.ler()
  }
  historico(): readonly ResultadoDoCronograma[] {
    return this.deps.estado.historico()
  }

  salvar(entrada: unknown): ConfiguracaoDoCronograma {
    if (!validarCronograma(entrada)) throw new Error('Cronograma inválido')
    const configuracao = entrada
    this.deps.auditar('inicio', {
      versao: configuracao.versao,
      sequencias: configuracao.sequencias.map((s) => s.id)
    })
    const decisoes: { sequenciaId: string; atividadeId: string; decisao: PolicyDecision }[] = []
    try {
      for (const sequencia of configuracao.sequencias) {
        for (const atividade of sequencia.atividades) {
          const decisao = this.deps.avaliar(acaoDaAtividade(atividade))
          decisoes.push({ sequenciaId: sequencia.id, atividadeId: atividade.id, decisao })
          if (decisao.outcome !== 'allow')
            throw new Error(
              `Atividade ${atividade.id} (${atividade.tipo}) recusada: ${decisao.reason}`
            )
          if (atividade.tipo === 'tocar-midia-local' && !this.deps.midiaAutorizada(atividade)) {
            throw new Error(
              `Atividade ${atividade.id} (${atividade.tipo}) recusada: mídia não selecionada no dispositivo`
            )
          }
        }
      }
      this.deps.estado.salvar(configuracao)
      this.deps.auditar('fim', { estado: 'salvo', decisoes })
      return configuracao
    } catch (erro) {
      this.deps.auditar('fim', {
        estado: 'recusado',
        decisoes,
        motivo: erro instanceof Error ? erro.message : 'desconhecido'
      })
      throw erro
    }
  }

  dispararEvento(evento: 'boas-vindas'): boolean {
    const configuracao = this.ler()
    if (!configuracao.ativa) return false
    const selecionadas = configuracao.sequencias.filter(
      (s) => s.ativa && s.gatilho.tipo === 'evento' && s.gatilho.evento === evento
    )
    for (const sequencia of selecionadas) this.enfileirar(sequencia, 'evento')
    return selecionadas.length > 0
  }

  verificarHorario(): void {
    const agora = this.deps.agora()
    const minuta = chaveDaMinuta(agora)
    if (this.ultimaMinuta !== minuta) {
      this.minutosDisparados.clear()
      this.ultimaMinuta = minuta
    }
    const configuracao = this.ler()
    if (!configuracao.ativa) return
    const minuto = agora.getHours() * 60 + agora.getMinutes()
    for (const sequencia of configuracao.sequencias) {
      const gatilho = sequencia.gatilho
      if (
        !sequencia.ativa ||
        gatilho.tipo !== 'horario' ||
        !gatilho.dias.includes(agora.getDay()) ||
        gatilho.minuto !== minuto
      )
        continue
      const chave = `${sequencia.id}:${minuta}`
      if (this.minutosDisparados.has(chave)) continue
      this.minutosDisparados.add(chave)
      this.enfileirar(sequencia, 'horario')
    }
  }

  async aguardarFila(): Promise<void> {
    await this.fila
  }

  private enfileirar(
    sequencia: SequenciaDoCronograma,
    gatilho: ResultadoDoCronograma['gatilho']
  ): void {
    const usuarioAoDisparar = this.deps.usuarioAtual?.()
    this.fila = this.fila
      .then(() => {
        if (usuarioAoDisparar !== this.deps.usuarioAtual?.()) return
        return this.executar(sequencia, gatilho, usuarioAoDisparar)
      })
      .catch((erro) => {
        this.deps.auditar('falha-da-fila', {
          sequenciaId: sequencia.id,
          ...(usuarioAoDisparar ? { usuarioId: usuarioAoDisparar } : {}),
          motivo: erro instanceof Error ? erro.message : 'desconhecido'
        })
      })
  }

  private async executar(
    sequencia: SequenciaDoCronograma,
    gatilho: ResultadoDoCronograma['gatilho'],
    usuarioAoDisparar?: string
  ): Promise<void> {
    const atividades: ResultadoDoCronograma['atividades'][number][] = []
    const resultado: ResultadoDoCronograma = {
      id: randomUUID(),
      sequenciaId: sequencia.id,
      nome: sequencia.nome,
      iniciadoEm: this.deps.agora().toISOString(),
      gatilho,
      atividades
    }
    for (const atividade of sequencia.atividades) {
      this.deps.auditar('atividade-inicio', {
        resultadoId: resultado.id,
        atividadeId: atividade.id,
        tipo: atividade.tipo,
        ...(usuarioAoDisparar ? { usuarioId: usuarioAoDisparar } : {})
      })
      let motivo: string | undefined
      try {
        if (usuarioAoDisparar !== this.deps.usuarioAtual?.()) motivo = 'usuário alterado'
        if (!motivo) {
          const atual = this.ler()
          if (!atual.ativa || !atual.sequencias.some((s) => s.id === sequencia.id && s.ativa))
            motivo = 'sequência desativada'
        }
        const decisao = motivo ? undefined : this.deps.avaliar(acaoDaAtividade(atividade))
        if (!motivo && decisao?.outcome !== 'allow') motivo = `política: ${decisao?.reason}`
        else if (!motivo && gatilho === 'horario' && this.deps.sessaoBloqueada())
          motivo = 'sessão bloqueada'
        else if (!motivo && !(await this.deps.podeReproduzir())) motivo = 'guarda de áudio'
        if (!motivo && usuarioAoDisparar !== this.deps.usuarioAtual?.()) motivo = 'usuário alterado'
        else if (!motivo && atividade.tipo === 'falar') await this.deps.falar()
        else if (!motivo && atividade.tipo === 'tocar-midia-local')
          await this.deps.tocarMidia(atividade.midia)
        if (usuarioAoDisparar !== this.deps.usuarioAtual?.()) motivo = 'usuário alterado'
      } catch (erro) {
        motivo = erro instanceof Error ? erro.message : 'falha desconhecida'
      }
      const desfecho = {
        id: atividade.id,
        tipo: atividade.tipo,
        estado: motivo ? ('nao-executada' as const) : ('executada' as const),
        ...(motivo ? { motivo } : {})
      }
      atividades.push(desfecho)
      this.deps.auditar('atividade-fim', {
        resultadoId: resultado.id,
        ...(usuarioAoDisparar ? { usuarioId: usuarioAoDisparar } : {}),
        ...desfecho
      })
    }
    if (usuarioAoDisparar && this.deps.registrarParaUsuario)
      this.deps.registrarParaUsuario(usuarioAoDisparar, resultado)
    else this.deps.estado.registrar(resultado)
  }
}
