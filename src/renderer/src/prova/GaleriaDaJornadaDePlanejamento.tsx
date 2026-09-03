import { ProvedorDeTema } from '@design/tokens/provider'
import type { CorAcento } from '@design/tokens/acento'
import type { ModoUi, Modulo } from '@design/tokens/semantic'
import type { EstadoDaJornada } from '@shared/domain/jornada'
import { montarTrilha } from '@shared/domain/jornada'
import { TrilhaDaJornada } from '../app/TrilhaDaJornada'

/**
 * Galeria de prova da jornada de planejamento (SPEC-Jornada-01, § Testes).
 *
 * **Existe por causa do gate visual da spec:** *"screenshot da jornada apresentado ao PI — esta
 * fatia existe porque a verificação visual nunca aconteceu no MVP-008"*. Os testes de tela
 * provam comportamento com JSDOM, que não tem layout: altura real, fonte carregada e contraste
 * computado só aparecem num navegador de verdade.
 *
 * As três cenas são os três estados que a trilha precisa distinguir **sem depender de cor**:
 * começo (quase tudo futuro), meio (as três posições ao mesmo tempo) e regressão (o motivo
 * acima da trilha). Uma cena só provaria o caso fácil.
 *
 * **Mora no renderer, não em `src/design/prova/`.** A fronteira do DS (SPEC-DesignSystem-01)
 * proíbe `src/design/` de importar domínio ou renderer, e esta galeria monta a trilha do
 * produto — que é dos dois. Quem se move é o arquivo, não a regra: mesma decisão que pôs o
 * `vite.prova.config.ts` na raiz por precisar de `node:path`.
 */

export type CenaDaJornada = 'inicio' | 'meio' | 'regressao'

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
  readonly cena?: CenaDaJornada
}

/**
 * Monta o estado a partir da etapa. Usa `montarTrilha` do domínio — o mesmo código do produto,
 * não uma cópia: uma trilha fabricada aqui poderia divergir da real e a captura provaria a
 * fixture, não a tela.
 */
function estado(
  etapa: EstadoDaJornada['etapa'],
  motivoDaRegressao: string | null = null
): EstadoDaJornada {
  const trilha = montarTrilha(etapa)
  const atual = trilha.find((e) => e.posicao === 'atual')

  return {
    projectId: 'p-prova',
    etapa,
    cta: atual?.cta ?? '',
    trilha,
    motivoDaRegressao,
    recalculada: false
  }
}

const CENAS: Readonly<Record<CenaDaJornada, EstadoDaJornada>> = {
  // Começo: uma etapa atual e onze futuras. É o estado em que todo projeto existente abre
  // depois da migração, e o que o PI verá primeiro.
  inicio: estado('prompt'),
  // Meio: as três posições convivendo. É a única cena que prova que concluída, atual e futura
  // se distinguem entre si — nas outras duas sempre falta uma das três.
  meio: estado('arquitetura'),
  // Regressão: o motivo acima da trilha (critério 7).
  regressao: estado('prd', 'O PRD mudou semanticamente depois do aceite do pacote.')
}

export function GaleriaDaJornadaDePlanejamento({
  modo,
  modulo = 'jarvis',
  acento,
  cena = 'meio'
}: GaleriaProps): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#C4C4C4'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <div
        data-jornada-planejamento={cena}
        className="min-h-screen bg-[var(--jos-cor-superficie)] p-8"
      >
        {/* Largura da coluna igual à do produto: a trilha não estica, e medir numa caixa mais
            larga daria um contraste e um ritmo que a tela real não tem. */}
        <div className="max-w-[19rem]">
          <TrilhaDaJornada estado={CENAS[cena]} onAgir={() => {}} />
        </div>
      </div>
    </ProvedorDeTema>
  )
}
