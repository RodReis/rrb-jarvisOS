import { describe, expect, it } from 'vitest'
import { escolherRevisores, type RevisorCandidato } from './squad-revisores'

const claude = { provider: 'claude-code', modelo: 'claude-fable-5-1' } as const
const codex = { provider: 'codex', modelo: 'gpt' } as const
const ollama = { provider: 'ollama', modelo: 'qwen3:8b' } as const

const candidato = (id: string, modelo: RevisorCandidato['modelo']): RevisorCandidato => ({
  id,
  modelo
})

describe('escolherRevisores', () => {
  it('nunca escolhe quem escreveu ou integrou', () => {
    const r = escolherRevisores(
      [candidato('esc-a', claude), candidato('integrador', claude), candidato('rev-1', claude)],
      [
        { id: 'esc-a', modelo: claude },
        { id: 'integrador', modelo: claude }
      ]
    )

    expect(r).toMatchObject({ ok: true, revisores: [{ id: 'rev-1' }] })
  })

  it('prefere o executor cruzado quando há um elegível', () => {
    const r = escolherRevisores(
      [candidato('rev-mesmo', claude), candidato('rev-outro', codex)],
      [{ id: 'esc-a', modelo: claude }],
      1
    )

    expect(r).toMatchObject({ ok: true, cruzado: true, revisores: [{ id: 'rev-outro' }] })
  })

  it('sem executor cruzado elegível, segue com o que há e diz que não cruzou', () => {
    const r = escolherRevisores([candidato('rev-1', claude)], [{ id: 'esc-a', modelo: claude }])

    expect(r).toMatchObject({ ok: true, cruzado: false, revisores: [{ id: 'rev-1' }] })
  })

  it('respeita o máximo e a ordem dos candidatos dentro de cada grupo', () => {
    const r = escolherRevisores(
      [
        candidato('a', claude),
        candidato('b', codex),
        candidato('c', ollama),
        candidato('d', claude)
      ],
      [{ id: 'esc', modelo: claude }],
      2
    )

    expect(r).toMatchObject({ ok: true, revisores: [{ id: 'b' }, { id: 'c' }] })
  })

  it('sem nenhum elegível, não há revisão: o run para em vez de revisar sozinho', () => {
    expect(
      escolherRevisores([candidato('esc-a', claude)], [{ id: 'esc-a', modelo: claude }])
    ).toEqual({ ok: false, motivo: 'sem-revisor-elegivel' })
    expect(escolherRevisores([], [])).toEqual({ ok: false, motivo: 'sem-revisor-elegivel' })
  })

  it('o mesmo candidato repetido conta uma vez', () => {
    const r = escolherRevisores([candidato('a', claude), candidato('a', claude)], [])

    expect(r).toMatchObject({ ok: true, revisores: [{ id: 'a' }] })
  })

  it('máximo menor que 1 não escolhe ninguém', () => {
    expect(escolherRevisores([candidato('a', claude)], [], 0)).toEqual({
      ok: false,
      motivo: 'sem-revisor-elegivel'
    })
  })
})
