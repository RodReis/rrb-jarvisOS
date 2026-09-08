import type { AprovacaoOutcome, AprovacaoReason } from '@shared/domain/aprovacoes'
import { InlineAlert } from '@design/ui'

/**
 * O desfecho de uma aprovação de gate, como a tela o mostra.
 *
 * **Mora aqui, e não duplicado nas duas telas.** O roadmap já mostrava isto; a arquitetura passou
 * a precisar quando o aceite do pacote virou aprovação do gate `PROJECT_PACKAGE` (#333). Duas
 * cópias divergiriam na primeira correção feita só numa delas — é o padrão que este repositório
 * já viu em `Portal` sem `container` e no teto de medida do brief.
 */

/**
 * Tom por desfecho da aprovação.
 *
 * `ja-aprovado` é **`ok`, não `warn`**: nada deu errado — a revisão já tem o aceite, que é
 * exatamente o estado desejado. Pintar de aviso ensinaria o PI a ler o critério 5 como problema.
 */
export const TOM_DA_APROVACAO: Readonly<Record<AprovacaoReason, 'ok' | 'err' | 'warn'>> = {
  aprovado: 'ok',
  'projeto-inexistente': 'err',
  'ja-aprovado': 'ok',
  'sem-identidade': 'warn',
  'sem-revisoes': 'warn',
  'dag-invalido': 'err',
  // `warn`, e não `err`: nada quebrou — falta commitar o que já foi aceito, e cada pendência vem
  // com a ação que a resolve. `err` diria ao PI que o app falhou, quando o que falta é um passo.
  'marcos-pendentes': 'warn'
}

export function DesfechoDaAprovacao({
  aprovacao
}: {
  readonly aprovacao: AprovacaoOutcome
}): React.JSX.Element {
  return (
    <InlineAlert tom={TOM_DA_APROVACAO[aprovacao.reason]} titulo={aprovacao.mensagem}>
      {/*
        As pendências, uma por linha, **com a ação** (SPEC-Fases-04, critério 4). Sem a ação o
        bloqueio seria um beco: a spec proíbe o "aceitar mesmo assim" justamente porque o caminho
        de saída é o remédio, não um botão de contornar.
      */}
      {aprovacao.problemas !== undefined && aprovacao.problemas.length > 0 && (
        <span className="flex flex-col gap-1">
          {aprovacao.problemas.map((problema) => (
            <span key={problema.mensagem} className="flex flex-col">
              <span>{problema.mensagem}</span>
              {problema.acao !== undefined && (
                <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto)]">
                  {problema.acao}
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </InlineAlert>
  )
}
