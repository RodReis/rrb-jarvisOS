import type { ConfiguracaoDoCronograma } from '@shared/domain/cronograma'

const identificador = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v)

export function validarCronograma(v: unknown): v is ConfiguracaoDoCronograma {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (
    c.versao !== 1 ||
    typeof c.ativa !== 'boolean' ||
    !Array.isArray(c.sequencias) ||
    c.sequencias.length > 30
  )
    return false
  const ids = new Set<string>()
  for (const raw of c.sequencias) {
    if (typeof raw !== 'object' || raw === null) return false
    const s = raw as Record<string, unknown>
    if (
      !identificador(s.id) ||
      ids.has(s.id) ||
      typeof s.nome !== 'string' ||
      !s.nome.trim() ||
      s.nome.length > 100 ||
      typeof s.ativa !== 'boolean'
    )
      return false
    ids.add(s.id)
    if (typeof s.gatilho !== 'object' || s.gatilho === null) return false
    const g = s.gatilho as Record<string, unknown>
    if (g.tipo === 'evento') {
      if (g.evento !== 'boas-vindas') return false
    } else if (g.tipo === 'horario') {
      if (
        !Array.isArray(g.dias) ||
        !g.dias.length ||
        g.dias.length > 7 ||
        new Set(g.dias).size !== g.dias.length ||
        !g.dias.every(
          (d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6
        ) ||
        !Number.isInteger(g.minuto) ||
        (g.minuto as number) < 0 ||
        (g.minuto as number) > 1439
      )
        return false
    } else return false
    if (!Array.isArray(s.atividades) || !s.atividades.length || s.atividades.length > 20)
      return false
    const atividades = new Set<string>()
    for (const rawAtividade of s.atividades) {
      if (typeof rawAtividade !== 'object' || rawAtividade === null) return false
      const a = rawAtividade as Record<string, unknown>
      if (!identificador(a.id) || atividades.has(a.id)) return false
      atividades.add(a.id)
      if (a.tipo === 'falar') continue
      if (a.tipo !== 'tocar-midia-local' || typeof a.midia !== 'object' || a.midia === null)
        return false
      const m = a.midia as Record<string, unknown>
      if (
        (m.tipo !== 'arquivo' && m.tipo !== 'pasta') ||
        typeof m.caminho !== 'string' ||
        !m.caminho ||
        m.caminho.length > 4096
      )
        return false
    }
  }
  return true
}
