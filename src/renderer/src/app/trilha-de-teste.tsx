import { useCallback, useRef, useState } from 'react'
import { Button } from '@design/ui'
import { CTA_DA_ETAPA, type Etapa } from '@shared/domain/jornada'

/**
 * A trilha, do ponto de vista de um painel, para os testes de tela (#332, defeito 4).
 *
 * O botão de avanço e o de aceite **saíram dos painéis e foram para a trilha** — regra do PI:
 * dois botões com o mesmo nome, um do lado do outro, não dá. Os testes que clicavam neles
 * passariam a não achar nada, e a saída fácil seria afirmar que o painel publicou uma função.
 * Isso provaria menos do que provava antes: uma ação publicada e nunca disparada é exatamente o
 * defeito que estamos consertando.
 *
 * Então este helper monta o painel **junto do botão que a trilha desenha**, com o mesmo rótulo
 * (`CTA_DA_ETAPA`), a mesma desabilitação por bloqueio e o mesmo carregando por ocupado. Os
 * testes continuam clicando num botão de verdade, e agora atravessam a ligação inteira.
 *
 * O que ele não é: uma segunda implementação da trilha, nem a prova da costura. `TrilhaDaJornada`
 * tem os próprios testes em `trilha.test.tsx`, e a costura real — `ProjetoAberto` ligando painel
 * e trilha — é medida em `projeto-aberto.test.tsx`. Sem aquele arquivo, este helper estaria
 * provando a si mesmo.
 */

/** As props que `ProjetoAberto` passa ao painel da etapa. */
export interface PropsDaTrilha {
  readonly onAcaoDaEtapa: (acao: (() => void) | null) => void
  readonly onOcupado: (ocupado: boolean) => void
  readonly onBloqueioDoAceite: (motivo: string | undefined) => void
}

/**
 * Monta o painel com as props da trilha e o botão que ela desenha.
 *
 * `painel` é uma função de props para elemento — e não um elemento pronto — porque o painel
 * precisa nascer **com** os callbacks: um elemento já construído teria as props fixadas.
 */
export function ComTrilha({
  etapa,
  painel
}: {
  readonly etapa: Etapa
  readonly painel: (props: PropsDaTrilha) => React.JSX.Element
}): React.JSX.Element {
  // Em `ref` como no `ProjetoAberto`: publicar a ação não redesenha nada.
  const acao = useRef<(() => void) | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [bloqueio, setBloqueio] = useState<string | undefined>(undefined)

  // Em `useCallback`: a identidade estável evita republicar a ação a cada render do painel.
  const publicar = useCallback((nova: (() => void) | null) => {
    acao.current = nova
  }, [])
  const disparar = useCallback(() => acao.current?.(), [])

  const Painel = painel

  return (
    <div>
      <Button
        variante="primaria"
        onClick={disparar}
        desabilitado={ocupado || bloqueio !== undefined}
        carregando={ocupado}
      >
        {CTA_DA_ETAPA[etapa]}
      </Button>
      {bloqueio !== undefined && <span>{bloqueio}</span>}
      <Painel onAcaoDaEtapa={publicar} onOcupado={setOcupado} onBloqueioDoAceite={setBloqueio} />
    </div>
  )
}
