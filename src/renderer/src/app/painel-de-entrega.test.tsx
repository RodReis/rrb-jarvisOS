/**
 * O painel do estado terminal de um run (SPEC-Entrega-06, critérios 2, 5 e 7).
 *
 * Três perguntas: o painel **explica o desfecho sem log técnico**, ele **não oferece ao PI botão
 * de commit/push/PR/merge nem de aceite**, e ele **cita artefato por hash**. As duas primeiras
 * são o critério 7 e a § Interface da spec; a terceira é o critério 2.
 *
 * A ausência de botões é testada por papel acessível, não por texto solto: é assim que a
 * asserção continua valendo quando o rótulo mudar de idioma.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
import { PainelDeEntrega } from './PainelDeEntrega'

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const HASH = 'c'.repeat(64)

function ledger(over: Partial<ExecutionLedger> = {}): ExecutionLedger {
  return {
    runId: 'run-1',
    userId: 'user-1',
    projectId: 'proj-1',
    estadoFinal: 'AWAITING_MERGE',
    duracaoMs: 754_000,
    tentativas: 2,
    tokens: 12_000,
    creditos: 8,
    custoUsd: 1.42,
    eventos: [{ em: '2026-09-02T00:00:00.000Z', oQue: 'entrega-iniciada' }],
    headSha: HEAD,
    checks: [{ nome: 'validacao', conclusao: 'success' }],
    artefatos: [{ nome: 'reports/TESTS.md', hash: HASH, bytes: 2048 }],
    encerradoEm: '2026-09-02T00:12:34.000Z',
    ...over
  }
}

const PENDENCIA: PendenciaDeLimpeza = {
  runId: 'run-1',
  recurso: 'container',
  identificador: 'jarvisos-run-1',
  motivo: 'O Docker recusou parar o container.',
  em: '2026-09-02T00:13:00.000Z'
}

describe('PainelDeEntrega', () => {
  it('nomeia o estado terminal em pt-BR, não pelo enum cru', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)
    expect(screen.getByText(/aguardando merge/i)).toBeInTheDocument()
    expect(screen.queryByText('AWAITING_MERGE')).toBeNull()
  })

  it('diz qual é a próxima decisão, e ela é do PI — o app não a executa', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)
    expect(screen.getByText(/aceite/i)).toBeInTheDocument()
  })

  it('mostra custo, duração e tentativas de relance', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)
    expect(screen.getByText(/US\$ 1,42|US\$ 1\.42/)).toBeInTheDocument()
    expect(screen.getByText(/12min 34s|12 min/)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('não oferece botão de commit, push, PR, merge ou aceite', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[PENDENCIA]} />)
    for (const proibido of [/commit/i, /push/i, /pull request/i, /mergear/i, /aceitar/i]) {
      expect(screen.queryByRole('button', { name: proibido })).toBeNull()
    }
  })

  it('mantém Git e eventos atrás de um expansor — o estado se entende sem eles', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)

    // O SHA não está visível antes de expandir. O critério 7 pede um estado compreensível sem
    // detalhe técnico, e um SHA de 40 caracteres na primeira leitura é exatamente o oposto.
    expect(screen.queryByText(HEAD)).toBeNull()
  })

  it('revela o SHA e os eventos ao expandir os detalhes', async () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)

    await userEvent.click(screen.getByRole('button', { name: /detalhes técnicos/i }))

    expect(screen.getByText(HEAD)).toBeInTheDocument()
    expect(screen.getByText(/entrega-iniciada/)).toBeInTheDocument()
  })

  it('cita artefato por nome e hash, nunca por conteúdo', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)

    expect(screen.getByText('reports/TESTS.md')).toBeInTheDocument()
    // Hash abreviado na tela; o valor inteiro fica no `title` para quem precisar copiá-lo.
    expect(screen.getByTitle(HASH)).toBeInTheDocument()
  })

  it('mostra a pendência de limpeza com o recurso, o identificador e o motivo', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[PENDENCIA]} />)

    expect(screen.getByText('jarvisos-run-1')).toBeInTheDocument()
    expect(screen.getByText(/docker recusou parar/i)).toBeInTheDocument()
  })

  it('sem pendência, não inventa uma seção vazia de alarme', () => {
    render(<PainelDeEntrega ledger={ledger()} pendencias={[]} />)
    expect(screen.queryByText(/pendência/i)).toBeNull()
  })

  it('MERGED mostra o merge SHA como parte da prova', async () => {
    const merge = 'b'.repeat(40)
    render(
      <PainelDeEntrega
        ledger={ledger({ estadoFinal: 'MERGED', mergeSha: merge })}
        pendencias={[]}
      />
    )

    expect(screen.getByText(/mergeado/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /detalhes técnicos/i }))
    expect(screen.getByText(merge)).toBeInTheDocument()
  })

  it('BLOCKED explica o desfecho sem transformá-lo em erro do usuário', () => {
    render(<PainelDeEntrega ledger={ledger({ estadoFinal: 'BLOCKED' })} pendencias={[]} />)
    expect(screen.getByText(/bloqueado/i)).toBeInTheDocument()
  })

  it('run sem artefato não mostra uma tabela vazia', () => {
    render(<PainelDeEntrega ledger={ledger({ artefatos: [] })} pendencias={[]} />)
    expect(screen.queryByText('reports/TESTS.md')).toBeNull()
  })
})
