import { describe, expect, it } from 'vitest'
import type { AuditEventInput } from '../../shared/domain/entities'
import type { PerfilDeSquad } from '../../shared/domain/squad-perfil'
import type { AmbienteDeResolucao } from '../../shared/domain/squad-resolucao'
import { PERFIL_PADRAO } from '../../shared/domain/squad-perfil'
import { resolverPerfil } from '../../shared/domain/squad-resolucao'
import {
  auditarSnapshotDoSquad,
  criarSnapshotDoSquad,
  reproduzirSnapshot,
  revisaoDoPerfil
} from './squad-snapshot'

const FASE = { provider: 'claude-code', modelo: 'claude-fable-5-1' } as const
const AMBIENTE: AmbienteDeResolucao = {
  skills: ['code-review'],
  ferramentas: [],
  ollama: { disponivel: false, modelos: [] },
  optInApiPaga: false
}

describe('revisão do perfil — critério 1 (reproduzível)', () => {
  it('é determinística e independe da ordem das chaves', () => {
    const embaralhado = Object.fromEntries(
      Object.entries(PERFIL_PADRAO).reverse()
    ) as unknown as PerfilDeSquad
    expect(revisaoDoPerfil(embaralhado)).toBe(revisaoDoPerfil(PERFIL_PADRAO))
    expect(revisaoDoPerfil(PERFIL_PADRAO)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('muda quando qualquer campo do perfil muda', () => {
    const outro = { ...PERFIL_PADRAO, versao: PERFIL_PADRAO.versao + 1 }
    expect(revisaoDoPerfil(outro)).not.toBe(revisaoDoPerfil(PERFIL_PADRAO))
    const outroLimite = {
      ...PERFIL_PADRAO,
      limites: { ...PERFIL_PADRAO.limites, maxTokensSaidaPorTarefa: 1 }
    }
    expect(revisaoDoPerfil(outroLimite)).not.toBe(revisaoDoPerfil(PERFIL_PADRAO))
  })
})

describe('snapshot do run', () => {
  it('reproduz a resolução registrada a partir do próprio snapshot', () => {
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE)
    expect(reproduzirSnapshot(snap)).toEqual(snap.resolucao)
    expect(snap.revisao).toBe(revisaoDoPerfil(PERFIL_PADRAO))
  })

  it('mudar o perfil depois não altera o snapshot (regra 4)', () => {
    const mutavel = structuredClone(PERFIL_PADRAO) as { escritores: number; versao: number }
    const snap = criarSnapshotDoSquad(mutavel as unknown as PerfilDeSquad, AMBIENTE, FASE)
    const revisaoAntes = snap.revisao

    mutavel.versao = 99
    mutavel.escritores = 2

    expect(snap.perfil.versao).toBe(PERFIL_PADRAO.versao)
    expect(snap.perfil.escritores).toBe(1)
    expect(snap.revisao).toBe(revisaoAntes)
  })

  it('o snapshot é imutável', () => {
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE)
    expect(Object.isFrozen(snap)).toBe(true)
    expect(Object.isFrozen(snap.resolucao)).toBe(true)
  })

  it('guarda o ambiente e o modelo da fase com que resolveu, para o fallback ser auditável', () => {
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE)
    expect(snap.ambiente).toEqual(AMBIENTE)
    expect(snap.modeloDaFase).toEqual(FASE)
    expect(snap.resolucao).toEqual(resolverPerfil(PERFIL_PADRAO, AMBIENTE, FASE))
  })
})

describe('auditoria do snapshot usado', () => {
  it('registra a revisão, o tipo de fatia e a elegibilidade — sem o perfil inteiro', () => {
    const eventos: AuditEventInput[] = []
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE)

    auditarSnapshotDoSquad(
      { append: (e) => void eventos.push(e) },
      { userId: 'u1', workspaceId: 'jarvis' },
      snap
    )

    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      user_id: 'u1',
      workspace_id: 'jarvis',
      type: 'squad-snapshot',
      payload: {
        revisao: snap.revisao,
        tipoDeFatia: 'padrao',
        versaoDoPerfil: 1,
        elegivel: true
      }
    })
    expect(JSON.stringify(eventos[0].payload)).not.toContain('acessoPorFuncao')
  })

  it('registra os fallbacks, porque a troca de camada não pode ser silenciosa', () => {
    const eventos: AuditEventInput[] = []
    const local: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      camadas: {
        ...PERFIL_PADRAO.camadas,
        orquestrador: { origem: 'modelo', provider: 'ollama', modelo: 'qwen3:8b', validador: 'e1' }
      }
    }
    const snap = criarSnapshotDoSquad(local, AMBIENTE, FASE)

    auditarSnapshotDoSquad(
      { append: (e) => void eventos.push(e) },
      { userId: 'u1', workspaceId: 'jarvis' },
      snap
    )

    expect(eventos[0].payload).toMatchObject({
      fallbacks: [{ camada: 'orquestrador', motivo: 'OLLAMA_FORA_DO_AR' }]
    })
  })
})
