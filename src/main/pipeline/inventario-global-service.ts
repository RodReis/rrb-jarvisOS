import type { InventarioGlobal, NoInventario, EstadoRemotoDoNo } from './inventario-global'
import { reconciliarInventario } from './inventario-global'
import type {
  EscopoDoInventario,
  InventarioSnapshotRepository
} from './inventario-snapshot-repository'

export interface ProjecaoLocalDoInventario {
  readonly nos: readonly NoInventario[]
  /** SHA-256 do manifesto local relevante (STATUS, SPECs e gates). */
  readonly revisao: string
}

export interface ProjecaoGithubDoInventario {
  readonly nos: readonly EstadoRemotoDoNo[]
  /** SHA-256 da resposta normalizada, sem corpo livre de issue/PR. */
  readonly revisao: string
  /** Só `true` quando todas as páginas e recursos esperados foram lidos sem erro. */
  readonly completa: boolean
}

export interface FontesDoInventario {
  lerLocal(escopo: EscopoDoInventario): Promise<ProjecaoLocalDoInventario>
  lerGithub(
    escopo: EscopoDoInventario,
    nosLocais: readonly NoInventario[]
  ): Promise<ProjecaoGithubDoInventario>
}

/** Atualiza sob demanda e persiste somente reconciliação completa das duas fontes. */
export class InventarioGlobalService {
  constructor(
    private readonly fontes: FontesDoInventario,
    private readonly repository: InventarioSnapshotRepository,
    private readonly agora: () => string = () => new Date().toISOString()
  ) {}

  carregar(escopo: EscopoDoInventario): ReturnType<InventarioSnapshotRepository['carregar']> {
    return this.repository.carregar(escopo)
  }

  async reconciliar(escopo: EscopoDoInventario): Promise<InventarioGlobal> {
    const local = await this.fontes.lerLocal(escopo)
    const github = await this.fontes.lerGithub(escopo, local.nos)
    if (!github.completa) {
      throw new Error(
        'Coleta GitHub incompleta; snapshot anterior preservado e execução indisponível.'
      )
    }
    if (!ehSha256(local.revisao) || !ehSha256(github.revisao)) {
      throw new Error('Fonte sem fingerprint SHA-256 válido; snapshot não foi atualizado.')
    }

    const inventario = reconciliarInventario(local.nos, github.nos, {
      local: local.revisao,
      github: github.revisao
    })
    this.repository.salvar(escopo, inventario, this.agora())
    return inventario
  }
}

function ehSha256(valor: string): boolean {
  return /^[a-f0-9]{64}$/i.test(valor)
}
