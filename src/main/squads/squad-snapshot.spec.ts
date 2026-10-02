import { describe, expect, it } from 'vitest'
import type { AuditEventInput } from '@shared/domain/entities'
import type { PerfilDeSquad } from '@shared/domain/squad-perfil'
import type { AmbienteDeResolucao } from '@shared/domain/squad-resolucao'
import { PERFIL_PADRAO } from '@shared/domain/squad-perfil'
import { resolverPerfil } from '@shared/domain/squad-resolucao'
import {
  auditarSnapshotDoSquad,
  criarSnapshotDoSquad,
  reproduzirSnapshot,
  revisaoDoPerfil,
  verificarSnapshot
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

describe('snapshot só nasce de perfil válido', () => {
  it('recusa perfil com permissão de Git — não vira snapshot elegível', () => {
    const ruim = structuredClone(PERFIL_PADRAO) as unknown as {
      acessoPorFuncao: { leitura: { git: boolean } }
    }
    ruim.acessoPorFuncao.leitura.git = true
    expect(() => criarSnapshotDoSquad(ruim as unknown as PerfilDeSquad, AMBIENTE, FASE)).toThrow(
      /PERMISSAO_GIT_GITHUB/
    )
  })

  it('recusa dois escritores sem o multi-escritor ligado, e aceita com ele (E2E de teste)', () => {
    const dois: PerfilDeSquad = {
      ...PERFIL_PADRAO,
      escritores: 2,
      integrador: { camada: 'executor' }
    }
    expect(() => criarSnapshotDoSquad(dois, AMBIENTE, FASE)).toThrow(/MULTI_ESCRITOR_DESLIGADO/)
    const snap = criarSnapshotDoSquad(dois, AMBIENTE, FASE, { multiEscritor: true })
    expect(snap.perfil.escritores).toBe(2)
  })
})

describe('verificarSnapshot — a revisão registrada confere com o perfil', () => {
  it('aceita o snapshot íntegro', () => {
    expect(verificarSnapshot(criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE))).toBe(true)
  })

  it('recusa snapshot lido de fora com perfil adulterado depois da revisão', () => {
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE)
    const adulterado = { ...snap, perfil: { ...snap.perfil, versao: 2 } }
    expect(verificarSnapshot(adulterado)).toBe(false)
  })

  it('recusa snapshot cuja resolução registrada não se reproduz', () => {
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, FASE)
    const adulterado = { ...snap, resolucao: { ...snap.resolucao, elegivel: false } }
    expect(verificarSnapshot(adulterado)).toBe(false)
  })
})

describe('auditoria registra o fallback por capacidade', () => {
  const auditar = (skills: readonly string[]): readonly Record<string, unknown>[] => {
    const eventos: AuditEventInput[] = []
    const snap = criarSnapshotDoSquad(PERFIL_PADRAO, { ...AMBIENTE, skills }, FASE)
    auditarSnapshotDoSquad(
      { append: (e) => void eventos.push(e) },
      { userId: 'u1', workspaceId: 'jarvis' },
      snap
    )
    return eventos[0].payload?.capacidades as readonly Record<string, unknown>[]
  }

  it('skill ausente vira prompt, e isso aparece no evento', () => {
    expect(auditar([])).toContainEqual({
      capacidade: 'revisao-de-codigo',
      camada: 'especialista',
      estado: 'fallback',
      via: 'prompt:revisao-de-codigo-disciplinada@1',
      motivo: 'IMPLEMENTACAO_AUSENTE'
    })
  })

  it('o que resolveu por implementação não polui o evento', () => {
    expect(auditar(['code-review']).some((c) => c.capacidade === 'revisao-de-codigo')).toBe(false)
  })
})
