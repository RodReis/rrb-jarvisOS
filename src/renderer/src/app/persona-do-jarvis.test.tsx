import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonaDoJarvis } from './PersonaDoJarvis'
import type { PersonaEditavel } from '@shared/domain/voz'

/**
 * A persona editável em Settings (SPEC-Voz-03, critério 5).
 *
 * Ponte por `vi.stubGlobal`, não `defineProperty`: a propriedade definida sobrevive ao
 * `unstubAllGlobals` do vizinho e quebra outro arquivo só no CI.
 *
 * O que estes testes prendem é a **separação dos dois blocos**: o texto livre é do usuário e
 * volta como escrita; o bloco fixo é do produto, aparece como leitura e nunca é enviado. Que
 * esvaziar o texto livre não remove o bloco fixo é medido também no main (`persona.spec.ts`),
 * porque é lá que a garantia mora — aqui se mede que a tela não a contradiz.
 */

const lerPersona = vi.fn()
const salvarPersona = vi.fn()

const BLOCO_FIXO = [
  'Responda em português do Brasil, sempre.',
  'Nunca use markdown, listas com marcadores, código, links ou emoji.'
].join('\n')

function persona(extra: Partial<PersonaEditavel> = {}): PersonaEditavel {
  return {
    textoLivre: 'Você é o JARVIS. Trate o operador por "operador".',
    blocoFixo: BLOCO_FIXO,
    teto: 2000,
    ...extra
  }
}

beforeEach(() => {
  lerPersona.mockReset().mockResolvedValue(persona())
  salvarPersona
    .mockReset()
    .mockImplementation(async (texto: string) => persona({ textoLivre: texto }))
  vi.stubGlobal('jarvis', { lerPersona, salvarPersona })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function montar(espaco = 'JARVIS OS'): ReturnType<typeof render> {
  return render(<PersonaDoJarvis workspace="jarvis" nomeDoEspaco={espaco} />)
}

describe('os dois blocos têm donos diferentes, e a tela mostra isso', () => {
  it('carrega o texto livre num campo editável', async () => {
    montar()

    const campo = await screen.findByRole('textbox')
    expect(campo).toHaveValue('Você é o JARVIS. Trate o operador por "operador".')
  })

  it('mostra o bloco fixo como leitura, fora de qualquer campo', async () => {
    /*
     * Não é campo desabilitado: um campo cinza convida a tentar editá-lo e sugere que a
     * permissão poderia ser dada. Ele não é uma edição bloqueada — é a garantia do produto.
     */
    montar()

    expect(await screen.findByText(/Nunca use markdown/)).toBeInTheDocument()
    // Um só campo na tela, e é o do texto livre.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('grava só o texto livre — o bloco fixo não volta pela ponte', async () => {
    montar()
    const campo = await screen.findByRole('textbox')

    await userEvent.clear(campo)
    await userEvent.type(campo, 'Seja breve.')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(salvarPersona).toHaveBeenCalledWith('Seja breve.', 'jarvis'))
    // Contrafactual do critério: se o bloco fixo viajasse como dado gravável, uma edição
    // poderia removê-lo e a resposta voltaria em markdown para ser lida em voz alta.
    expect(salvarPersona.mock.calls[0][0]).not.toContain('Nunca use markdown')
  })
})

describe('esvaziar o texto livre é escolha, não erro (critério 5)', () => {
  it('deixa salvar o campo vazio', async () => {
    // Vazio significa "sem tom próprio", e o bloco fixo continua valendo sozinho. Exigir texto
    // aqui faria a tela recusar uma configuração que o produto suporta.
    montar()
    const campo = await screen.findByRole('textbox')

    await userEvent.clear(campo)
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(salvarPersona).toHaveBeenCalledWith('', 'jarvis'))
  })

  it('o bloco fixo continua na tela com o campo vazio', async () => {
    lerPersona.mockResolvedValue(persona({ textoLivre: '' }))
    montar()

    expect(await screen.findByText(/Nunca use markdown/)).toBeInTheDocument()
  })
})

describe('o teto protege o contexto da conversa', () => {
  it('recusa salvar acima do teto, dizendo quanto passou', async () => {
    // O texto entra no system de **toda** conversa: uma persona gigante consumiria o contexto
    // que o snapshot e o histórico precisam, e o JARVIS "esqueceria" o estado do app.
    lerPersona.mockResolvedValue(persona({ textoLivre: 'x'.repeat(2001), teto: 2000 }))
    montar()

    await screen.findByRole('textbox')
    expect(await screen.findByRole('alert')).toHaveTextContent(/2001 de 2000/)
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled()
  })

  it('não mostra contador enquanto o texto cabe', async () => {
    // Um "0 / 2000" permanente daria ao campo a cara de formulário com limite apertado, quando o
    // teto é folgado para o uso real.
    montar()

    await screen.findByRole('textbox')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('a tela mostra o que foi gravado, não o que foi digitado', () => {
  it('adota o valor que o main devolveu', async () => {
    /*
     * O main é a fronteira de confiança e pode recusar. Se a tela mantivesse o rascunho, ela
     * exibiria uma edição que não aconteceu — e o usuário sairia de Settings acreditando ter
     * salvo o que o banco não tem.
     */
    salvarPersona.mockResolvedValue(persona({ textoLivre: 'o que o main aceitou' }))
    montar()
    const campo = await screen.findByRole('textbox')

    await userEvent.clear(campo)
    await userEvent.type(campo, 'o que eu digitei')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(campo).toHaveValue('o que o main aceitou'))
  })

  it('confirma o salvamento sem prometer antes da hora', async () => {
    montar()
    const campo = await screen.findByRole('textbox')

    // Nada de "salva" antes de salvar.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await userEvent.clear(campo)
    await userEvent.type(campo, 'novo tom')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByRole('status')).toBeInTheDocument()
  })
})

describe('a persona é do espaço, não do usuário', () => {
  it('lê a persona do espaço em que a tela está', async () => {
    // Escopada a `user_id + workspace_id`: trocar de espaço troca a persona. É por isso que ela
    // mora na aba `ia` e não na `voz`, que é do usuário.
    montar()

    await waitFor(() => expect(lerPersona).toHaveBeenCalledWith('jarvis'))
  })

  it('nomeia o espaço na descrição, para não haver dúvida de qual persona é', async () => {
    montar('JARVIS OS')

    expect(await screen.findByText(/JARVIS OS/)).toBeInTheDocument()
  })
})
