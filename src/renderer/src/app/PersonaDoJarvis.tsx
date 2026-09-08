import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Textarea } from '@design/ui'
import type { WorkspaceId } from '@shared/domain/entities'
import type { PersonaEditavel } from '@shared/domain/voz'

/**
 * A persona editável do JARVIS (SPEC-Voz-03, critério 5).
 *
 * ## Dois blocos, dois donos — e é isso que a tela mostra
 *
 * O **texto livre** é do usuário: nome, tom, saudações. Editável aqui, vale na conversa seguinte,
 * sem rebuild. O **bloco fixo** é do produto: resposta curta, pt-BR, sem markdown, não inventar
 * dado fora do snapshot.
 *
 * O bloco fixo aparece como **leitura**, e não como campo desabilitado. Um campo cinza convida a
 * tentar editá-lo e sugere que a permissão poderia ser dada; ele não é uma edição bloqueada, é
 * outra coisa — a garantia que o produto dá independentemente do que o usuário escreva. Ele nem
 * volta pela ponte na escrita: `salvarPersona` leva só o texto livre.
 *
 * ## Por que esvaziar não é apagar a persona
 *
 * Campo vazio é escolha legítima: significa "sem tom próprio", e o bloco fixo continua valendo
 * sozinho. Por isso não há validação de obrigatoriedade aqui — a tela deixa salvar vazio, e a
 * resposta segue curta, em pt-BR, sem markdown.
 *
 * ## Aba `ia`, não `voz`
 *
 * A persona é escopada a `user_id + workspace_id`, e o critério de agrupamento da tela põe o que
 * é do par usuário+espaço nas abas `ia`/`roteamento`/`conectores`. A aba `voz` é do **usuário** —
 * microfone e runtime são da máquina. Trocar de espaço troca a persona; não troca o microfone.
 */
export function PersonaDoJarvis({
  workspace,
  nomeDoEspaco
}: {
  readonly workspace: WorkspaceId
  readonly nomeDoEspaco: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [persona, setPersona] = useState<PersonaEditavel | undefined>(undefined)
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    let vivo = true

    void window.jarvis.lerPersona(workspace).then((p) => {
      if (!vivo) return
      setPersona(p)
      setRascunho(p.textoLivre)
    })

    return () => {
      vivo = false
    }
    // `workspace` na lista: trocar de espaço troca a persona, e sem isto a tela mostraria a do
    // espaço anterior sobre o nome do novo.
  }, [workspace])

  async function salvar(): Promise<void> {
    setSalvando(true)

    try {
      const salva = await window.jarvis.salvarPersona(rascunho, workspace)
      setPersona(salva)
      // O rascunho volta do que **foi gravado**, não do que foi digitado: se o main recusou (teto
      // estourado), a tela mostra o valor real em vez de uma edição que não aconteceu.
      setRascunho(salva.textoLivre)
      setSalvo(true)
    } finally {
      setSalvando(false)
    }
  }

  if (persona === undefined) return <></>

  const excedeu = rascunho.length > persona.teto

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t('settings.persona')}</h3>
        <p className="text-xs opacity-70">
          {t('settings.personaDescricao', { espaco: nomeDoEspaco })}
        </p>
      </div>

      <Field
        rotulo={t('settings.personaTextoLivre')}
        descricao={t('settings.personaTextoLivreDescricao')}
      >
        {(atributos) => (
          <Textarea
            {...atributos}
            valor={rascunho}
            onMudar={(valor) => {
              setRascunho(valor)
              setSalvo(false)
            }}
            placeholder={t('settings.personaPlaceholder')}
          />
        )}
      </Field>

      <div className="flex items-center gap-3">
        <Button onClick={() => void salvar()} desabilitado={salvando || excedeu}>
          {t('settings.personaSalvar')}
        </Button>

        {/*
         * O contador só aparece quando estoura: um "0 / 2000" permanente daria ao campo a cara
         * de formulário com limite apertado, quando o teto é folgado para o uso real.
         */}
        {excedeu && (
          <p className="text-xs text-[var(--jos-cor-err)]" role="alert">
            {t('settings.personaLimite', { atual: rascunho.length, teto: persona.teto })}
          </p>
        )}

        {salvo && !excedeu && (
          <p className="text-xs opacity-70" role="status">
            {t('settings.personaSalva')}
          </p>
        )}
      </div>

      {/*
       * O bloco fixo, como leitura. `<pre>` porque ele é uma lista de regras em linhas, e um
       * parágrafo as juntaria numa frase só.
       */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('settings.personaBlocoFixo')}</p>
        <p className="text-xs opacity-70">{t('settings.personaBlocoFixoDescricao')}</p>
        <pre className="mt-1 whitespace-pre-wrap text-xs opacity-70">{persona.blocoFixo}</pre>
      </div>
    </section>
  )
}
