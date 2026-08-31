/**
 * As regras puras dos anexos (SPEC-Planejamento-05).
 *
 * O que estes testes protegem: **o gate conta presença, não conteúdo**, e conta a partir do ato
 * — não de arquivo encontrado no disco. A prova do ato em si é do serviço e do E2E (só lá existe
 * disco); aqui se prova a regra que decide quando o gate abre e o que falta.
 */

import { describe, expect, it } from 'vitest'
import type { WorkspaceId } from './entities'
import type { Anexo, TipoDeAnexo } from './anexos-de-design'
import {
  ARQUIVO_DESIGN_SYSTEM,
  DIRETORIO_DO_ANEXO,
  EXTENSOES_DO_ANEXO,
  PENDENCIAS_DO_GATE,
  TIPOS_DE_ANEXO,
  extensaoCompativel,
  gateDeAnexosAberto,
  isTipoDeAnexo,
  pendenciasDoGate
} from './anexos-de-design'

function anexo(tipo: TipoDeAnexo, caminho = 'docs/x'): Anexo {
  return {
    id: `id-${tipo}-${caminho}`,
    user_id: 'u1',
    workspace_id: 'jarvis' as WorkspaceId,
    projectId: 'p1',
    tipo,
    caminho,
    origem: `C:/externo/${caminho}`,
    hash: 'a'.repeat(64),
    bytes: 128,
    anexadoEm: '2026-08-30T12:00:00.000Z'
  }
}

describe('pendenciasDoGate', () => {
  it('lista as duas exigências quando nada foi anexado', () => {
    expect(pendenciasDoGate([])).toEqual(['design-system', 'prototipo'])
  })

  it('nomeia o que falta em vez de devolver só um booleano', () => {
    expect(pendenciasDoGate([anexo('design-system')])).toEqual(['prototipo'])
    expect(pendenciasDoGate([anexo('prototipo')])).toEqual(['design-system'])
  })

  it('abre o gate com design-system e ao menos um protótipo', () => {
    const anexos = [anexo('design-system'), anexo('prototipo')]
    expect(pendenciasDoGate(anexos)).toEqual([])
    expect(gateDeAnexosAberto(anexos)).toBe(true)
  })

  /**
   * A regra que evita barrar por algo que a spec não pede: um protótipo que não referencia
   * imagem nenhuma está completo sem asset. O que a spec exige sobre assets é que os
   * **referenciados** existam — e isso é validação de protótipo, não contagem de anexos.
   */
  it('não exige asset: protótipo sem imagem satisfaz o gate', () => {
    const anexos = [anexo('design-system'), anexo('prototipo')]
    expect(anexos.some((a) => a.tipo === 'asset')).toBe(false)
    expect(gateDeAnexosAberto(anexos)).toBe(true)
  })

  it('vários protótipos continuam satisfazendo a mesma exigência uma vez', () => {
    const anexos = [
      anexo('design-system'),
      anexo('prototipo', 'docs/prototipos/a.html'),
      anexo('prototipo', 'docs/prototipos/b.html')
    ]
    expect(gateDeAnexosAberto(anexos)).toBe(true)
  })

  it('asset sozinho não abre o gate', () => {
    expect(gateDeAnexosAberto([anexo('asset')])).toBe(false)
  })
})

describe('extensaoCompativel', () => {
  it('aceita a extensão que o tipo declara', () => {
    expect(extensaoCompativel('design-system', 'C:/x/DESIGN-SYSTEM.md')).toBe(true)
    expect(extensaoCompativel('prototipo', 'C:/x/home.html')).toBe(true)
    expect(extensaoCompativel('asset', 'C:/x/logo.svg')).toBe(true)
  })

  it('recusa extensão de outro tipo', () => {
    expect(extensaoCompativel('prototipo', 'C:/x/telas.pdf')).toBe(false)
    expect(extensaoCompativel('design-system', 'C:/x/design.html')).toBe(false)
  })

  it('é indiferente a maiúsculas', () => {
    expect(extensaoCompativel('prototipo', 'C:/x/HOME.HTML')).toBe(true)
  })

  it('recusa caminho sem extensão', () => {
    expect(extensaoCompativel('prototipo', 'C:/x/home')).toBe(false)
    expect(extensaoCompativel('prototipo', '.htaccess')).toBe(false)
  })
})

describe('contratos fechados', () => {
  it('todo tipo tem diretório e ao menos uma extensão', () => {
    for (const tipo of TIPOS_DE_ANEXO) {
      expect(DIRETORIO_DO_ANEXO[tipo]).toBeTruthy()
      expect(EXTENSOES_DO_ANEXO[tipo].length).toBeGreaterThan(0)
    }
  })

  /**
   * O gate exige presença; `asset` é anexável mas não exigido. Se alguém acrescentar `asset` às
   * pendências, este teste cai — e a discussão volta para a spec, que não o pede.
   */
  it('as pendências do gate são subconjunto dos tipos anexáveis', () => {
    for (const p of PENDENCIAS_DO_GATE) {
      expect(TIPOS_DE_ANEXO).toContain(p)
    }
    expect(PENDENCIAS_DO_GATE).not.toContain('asset')
  })

  it('o nome do design system é fixo', () => {
    expect(ARQUIVO_DESIGN_SYSTEM).toBe('DESIGN-SYSTEM.md')
  })

  it('isTipoDeAnexo recusa o que não está no enum', () => {
    expect(isTipoDeAnexo('prototipo')).toBe(true)
    expect(isTipoDeAnexo('figma')).toBe(false)
    expect(isTipoDeAnexo(null)).toBe(false)
    expect(isTipoDeAnexo(3)).toBe(false)
  })
})
