import { ProvedorDeTema, FundoDaIdentidade } from '../tokens/provider'
import type { CorAcento } from '../tokens/acento'
import type { ModoUi, Modulo } from '../tokens/semantic'
import { Badge, Button, Card, InlineAlert, VoiceMascot } from '../ui'

/**
 * Galeria de prova das identidades (SPEC-DesignSystem-05).
 *
 * O que esta galeria existe para provar é diferente das anteriores. Lá o alvo era o componente;
 * aqui é a **tese**: os mesmos componentes, lado a lado nas duas identidades, com a diferença
 * inteira vindo de token. Um olho humano vendo as duas colunas deve ler "mesmo sistema, dois
 * espaços" — se ler "dois sistemas", a fatia falhou por mais que os testes passem.
 *
 * Também cobre o que jsdom não mede e os critérios pedem: o **glow radial** (critério 4) só
 * existe com layout real — em jsdom `background-image` é a string que escrevemos, não um
 * gradiente pintado —, e o `mix-blend-mode` do mascote (critério 7) não é composto por nenhum
 * DOM virtual.
 */

interface GaleriaProps {
  readonly modo: ModoUi
  readonly modulo?: Modulo
  readonly acento?: CorAcento
}

/**
 * Uma coluna por identidade.
 *
 * Recebe `modulo` e monta **os mesmos** componentes — não há ramo por identidade dentro daqui.
 * É o guardrail anti-duplicação expresso como código de galeria: se esta função precisasse de
 * um `if (modulo === 'noa')` para renderizar, a tese estaria furada.
 */
function ColunaDaIdentidade({
  modulo,
  modo,
  acento
}: {
  readonly modulo: Modulo
  readonly modo: ModoUi
  readonly acento?: CorAcento
}): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={modo}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={acento ?? '#C4C4C4'}
      accentNoa={acento ?? '#C4C4C4'}
    >
      <FundoDaIdentidade
        className="flex-1 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] p-6 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
        data-prova-identidade={modulo}
      >
        <div className="flex flex-col gap-5" data-testid={`coluna-${modulo}`}>
          <header className="flex items-center gap-4">
            <VoiceMascot modulo={modulo} tamanho="medio" />
            <div className="flex flex-col gap-1">
              <span className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)]">
                {modulo === 'jarvis' ? 'JARVIS OS' : 'NOA'}
              </span>
              <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
                {modo} · acento próprio
              </span>
            </div>
          </header>

          {/* Estados do mascote — só o JARVIS os mostra (critério 6). */}
          <div className="flex items-center gap-3" data-prova="mascote-estados">
            <VoiceMascot modulo={modulo} tamanho="rail" />
            <VoiceMascot modulo={modulo} tamanho="rail" falando />
            <VoiceMascot modulo={modulo} tamanho="rail" ouvindo />
          </div>

          {/* Os mesmos componentes das fatias 03a/03b, sem uma linha por identidade. */}
          <div className="flex flex-wrap gap-2">
            <Button>Executar</Button>
            <Button variante="secundaria">Cancelar</Button>
          </div>

          <Card titulo="Sessão">
            <p className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
              O mesmo card, o mesmo botão, a mesma tipografia.
            </p>
          </Card>

          {/* Semânticas: têm de ficar idênticas nas duas colunas (critério 5). */}
          <div className="flex flex-wrap gap-2" data-prova="semanticas">
            <Badge tom="ok">Concluído</Badge>
            <Badge tom="warn">Atenção</Badge>
            <Badge tom="err">Falhou</Badge>
            <Badge tom="info">Info</Badge>
          </div>
          <InlineAlert tom="err" titulo="Erro de execução">
            A mesma cor de erro nos dois espaços.
          </InlineAlert>
        </div>
      </FundoDaIdentidade>
    </ProvedorDeTema>
  )
}

export function GaleriaDeIdentidades({ modo, acento }: GaleriaProps): React.JSX.Element {
  return (
    // Fundo neutro do documento: as duas colunas trazem o próprio fundo, e é a diferença entre
    // elas que a captura precisa mostrar.
    <div
      data-testid="galeria"
      className="flex min-h-screen gap-6 bg-neutral-900 p-6"
      data-prova-modo={modo}
    >
      <ColunaDaIdentidade modulo="jarvis" modo={modo} acento={acento} />
      <ColunaDaIdentidade modulo="noa" modo={modo} acento={acento} />
    </div>
  )
}
