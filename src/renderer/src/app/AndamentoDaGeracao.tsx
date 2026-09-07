import type { AndamentoDaEtapa, EtapaDaGeracao } from '@shared/domain/geracao'
import { ETAPAS_DA_GERACAO, progressoDaGeracao } from '@shared/domain/geracao'

/**
 * O andamento de uma geração de pacote (SPEC-Jornada-03 § Geração): quanto já terminou, o que
 * acontece agora, o que cada etapa produziu.
 *
 * ## Por que aqui e não no console (#318)
 *
 * Ele nasceu dentro do `ConsoleDaGeracao`, no fim de uma página longa — e o PI, que está no topo
 * olhando o botão que acabou de apertar, rolava a tela inteira para saber em que ponto a rodada
 * estava. Pior: o console zera a trilha a cada `traceId` novo, e o anúncio de etapa viaja com um
 * trace derivado do projeto, fixo entre rodadas. O resultado era a barra somando **duas**
 * gerações: uma rodada nova abria em 60%, com "Gravação — os três documentos foram gravados" de
 * uma rodada anterior, enquanto esta ainda gerava.
 *
 * Aqui ele recebe o andamento já apurado por rodada (`aplicarEtapa`, no domínio) e só desenha.
 * O console segue com o que é dele: o texto do modelo e as ferramentas.
 *
 * ## Por que o acento não aparece
 *
 * O acento é escolhido pelo usuário entre oito cores, e três delas colidem com significado que o
 * sistema reserva: com `#FF2C2C` uma geração saudável ficaria idêntica a erro, com `#2CFF05` uma
 * etapa pendente pareceria concluída, e `#2323FF` tem 2,58:1 sobre o carbono. Pintar **estado**
 * com a cor da preferência quebra o princípio 5 do produto — preferência visual não altera
 * significado semântico.
 *
 * Então quem distingue as etapas é **forma**: preenchido contra vazado, ícone de concluído
 * contra pendente, peso do texto. Isso funciona nas oito cores, no daltonismo e em escala de
 * cinza, que é o princípio 2. As semânticas (`ok` e `err`) entram só onde há de fato estado de
 * sistema — e essas o usuário não retematiza.
 */

/**
 * O nome de cada etapa na tela. Dado, não lógica — e em pt-BR, como toda a interface.
 *
 * `Record` completo de propósito: uma etapa nova no contrato quebra a compilação aqui, e não cai
 * num rótulo vazio na tela do PI (issue #337).
 *
 * **`documentos`, `validacao` e `gravacao` são compartilhados** pelas três gerações e ganham
 * nome genérico. Nomear "PRD, Landscape e Convention" era certo quando só o PRD tinha barra;
 * com as três, o mesmo rótulo apareceria na arquitetura anunciando documentos que ela não gera.
 */
const NOME_DA_ETAPA: Readonly<Record<EtapaDaGeracao, string>> = {
  pesquisa: 'Pesquisa de mercado',
  documentos: 'Escrita dos documentos',
  validacao: 'Validação da saída',
  contradicoes: 'Busca de contradições',
  gravacao: 'Gravação dos documentos',
  prototipos: 'Leitura dos protótipos',
  coerencia: 'Análise de coerência',
  mvps: 'Proposta dos MVPs',
  dag: 'Checagem de dependências',
  spec: 'Escrita da SPEC da fatia'
}

export function AndamentoDaGeracao({
  etapas,
  gerando,
  contrato = [...ETAPAS_DA_GERACAO]
}: {
  readonly etapas: ReadonlyMap<EtapaDaGeracao, AndamentoDaEtapa>
  readonly gerando: boolean
  /**
   * As etapas desta geração, na ordem. O default é o do PRD, que foi quem estreou o componente.
   *
   * É a lista que dá o denominador: usar a do PRD na arquitetura contaria etapas que nunca
   * chegam, e a barra pararia em 60% numa geração que terminou.
   */
  readonly contrato?: readonly EtapaDaGeracao[]
}): React.JSX.Element | null {
  // Sem nenhum anúncio não há progresso a mostrar. Uma barra em 0% durante uma geração que não
  // reporta etapas afirmaria que nada aconteceu, o que é diferente de "não se sabe".
  if (etapas.size === 0) return null

  const progresso = progressoDaGeracao(
    new Map([...etapas].map(([etapa, v]) => [etapa, v.estado])),
    contrato
  )

  const emCurso = contrato.find((e) => etapas.get(e)?.estado === 'iniciada')
  const atual = emCurso ?? [...contrato].reverse().find((e) => etapas.has(e))
  const resumoAtual = atual === undefined ? undefined : etapas.get(atual)?.resumo

  return (
    <section
      data-jos-progresso
      aria-label="Andamento da geração"
      className="flex flex-col gap-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.14)] bg-[var(--jos-cor-superficie-elevada)] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[length:var(--jos-texto-corpo)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]">
          {atual === undefined ? 'Geração' : NOME_DA_ETAPA[atual]}
        </span>
        {/* `tabular-nums` para o número não dançar de largura entre 8% e 100%. */}
        <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-realce)] tabular-nums text-[var(--jos-cor-texto)]">
          {progresso}%
        </span>
      </div>

      {/*
        A barra carrega o mesmo número que o texto ao lado, e o `role` diz isso ao leitor de tela
        — sem ele, a barra é uma div decorativa e quem não vê fica sem o progresso.
      */}
      <div
        role="progressbar"
        aria-valuenow={progresso}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da geração"
        className="h-1 w-full overflow-hidden rounded-[var(--jos-raio-pill)] bg-[rgba(var(--jos-borda-rgb),0.14)]"
      >
        <div
          className="h-full rounded-[var(--jos-raio-pill)] bg-[var(--jos-cor-texto)] transition-[width] duration-[var(--jos-duracao-media)] ease-[var(--jos-curva-padrao)]"
          style={{ width: `${progresso}%` }}
        />
      </div>

      <ul className="flex flex-col gap-1.5">
        {contrato.map((etapa) => {
          const registro = etapas.get(etapa)
          const estado = registro?.estado

          return (
            <li
              key={etapa}
              data-jos-etapa={etapa}
              data-jos-estado={estado ?? 'pendente'}
              className="flex items-baseline gap-2.5"
            >
              {/*
                O marcador é **forma antes de cor**: cheio para concluída, anel para a que está
                acontecendo, vazado para o que não começou. Lido em cinza, ele continua dizendo
                as três coisas.
              */}
              <span
                aria-hidden="true"
                className={
                  estado === 'concluida'
                    ? 'mt-[0.35rem] size-2 shrink-0 rounded-full bg-[var(--jos-cor-ok-leitura)]'
                    : estado === 'falhou'
                      ? 'mt-[0.35rem] size-2 shrink-0 rounded-full bg-[var(--jos-cor-err-leitura)]'
                      : estado === 'iniciada'
                        ? 'mt-[0.35rem] size-2 shrink-0 rounded-full border-2 border-[var(--jos-cor-texto)]'
                        : 'mt-[0.35rem] size-2 shrink-0 rounded-full border border-[rgba(var(--jos-borda-rgb),0.35)]'
                }
              />

              <span
                className={
                  estado === 'iniciada'
                    ? 'text-[length:var(--jos-texto-mini)] font-[var(--jos-peso-semi)] text-[var(--jos-cor-texto)]'
                    : estado === undefined
                      ? 'text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]'
                      : 'text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]'
                }
              >
                {NOME_DA_ETAPA[etapa]}
              </span>

              {/* O estado também em texto, para quem não distingue as formas nem as cores. */}
              {estado === 'falhou' && (
                <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-err-leitura)]">
                  falhou
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {/*
        O que a etapa em curso produziu. `aria-live` porque ele muda sozinho durante a geração, e
        `polite` para não interromper quem está lendo outra parte da tela.
      */}
      {resumoAtual !== undefined && (
        <p
          aria-live={gerando ? 'polite' : 'off'}
          className="max-w-[62ch] border-t border-[rgba(var(--jos-borda-rgb),0.10)] pt-3 text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]"
        >
          {resumoAtual}
        </p>
      )}
    </section>
  )
}
