import { describe, expect, it } from 'vitest'
import { perfilNodeEmWindows } from './ci-profile-perfis'
import {
  escreverMatrizDeProva,
  lerMatrizDeProva,
  problemasDaMatrizDeProva,
  type MatrizDeProva
} from './ci-proof-matrix'

const perfil = perfilNodeEmWindows('node')
const completa: MatrizDeProva = {
  criterios: [
    { numero: 1, validacoes: ['lint', 'typecheck'] },
    { numero: 2, validacoes: ['test', 'build'] }
  ],
  categorias: [
    { nome: 'regra', estado: 'aplicavel', validacoes: ['test'] },
    { nome: 'banco', estado: 'nao-aplicavel', validacoes: [], justificativa: 'Sem persistência.' },
    { nome: 'tela', estado: 'nao-aplicavel', validacoes: [], justificativa: 'Sem interface.' },
    { nome: 'e2e', estado: 'aplicavel', validacoes: ['test'] }
  ]
}

describe('matriz de prova da E1', () => {
  it('lê a matriz versionada dentro da SPEC e recusa estrutura ilegível', () => {
    expect(lerMatrizDeProva(`# SPEC\n\n${escreverMatrizDeProva(completa)}`)).toEqual(completa)
    expect(lerMatrizDeProva('## Matriz de prova\n```json\n{"criterios":42}\n```')).toBeUndefined()
  })

  it('aceita cobertura bidirecional e classificação explícita das categorias', () => {
    expect(problemasDaMatrizDeProva(['um', 'dois'], perfil, completa)).toEqual([])
  })

  it('recusa critério e validação obrigatória órfãos, sem inferir prova', () => {
    const matriz: MatrizDeProva = {
      ...completa,
      criterios: [{ numero: 1, validacoes: ['lint'] }]
    }
    expect(problemasDaMatrizDeProva(['um', 'dois'], perfil, matriz)).toEqual(
      expect.arrayContaining([
        'Critério 2 está sem prova.',
        'Validação obrigatória typecheck não cobre nenhum critério.',
        'Validação obrigatória build não cobre nenhum critério.'
      ])
    )
  })

  it('recusa categoria silenciosa, não aplicabilidade sem motivo e IDs inexistentes', () => {
    const matriz: MatrizDeProva = {
      criterios: [{ numero: 1, validacoes: ['inventada'] }],
      categorias: [{ nome: 'regra', estado: 'nao-aplicavel', validacoes: [], justificativa: '' }]
    }
    const problemas = problemasDaMatrizDeProva(['um'], perfil, matriz)
    expect(problemas).toContain('Validação inventada não existe no perfil.')
    expect(problemas).toContain('Categoria regra requer justificativa.')
    expect(problemas).toContain('Categoria banco não foi classificada.')
  })
})
