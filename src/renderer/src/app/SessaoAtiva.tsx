import { useState } from 'react'
import type {
  AccentColor,
  ThemePreference,
  UserProfile,
  WorkspaceId
} from '@shared/domain/entities'
import type { CorAcento } from '@design/tokens/acento'
import type { Modulo } from '@design/tokens/semantic'
import { log } from '../lib/log'
import { usePreferences } from '../preferences/usePreferences'
import { AppShell } from './AppShell'
import { TelaChoice } from './TelaChoice'
import { TransicaoDeMarca } from './TransicaoDeMarca'

/**
 * A sessão de um usuário logado: **CHOICE → transição → shell** (SPEC-CHOICE-01).
 *
 * Extraída do `App` para separar responsabilidades: o `App` sabe *se* há sessão; esta camada
 * conduz a jornada de entrada e monta o shell no espaço escolhido. É remontada a cada login
 * (a `key` no `App`), então a CHOICE reaparece em toda sessão — a decisão da spec.
 *
 * **A troca de espaço no meio da sessão NÃO passa por aqui.** Ela continua no rail do `AppShell`,
 * intacta (opção A da spec; a SPEC-Fundacao-02 não muda). Esta camada só decide o espaço de
 * *entrada*; depois que o shell monta, ele é dono da navegação e da troca.
 */

/**
 * As três fases da entrada. `escolhendo` é a CHOICE; `entrando` é a transição de marca; `dentro`
 * é o shell montado. Um único estado, e não três booleans, porque as fases são mutuamente
 * exclusivas — dois booleans permitiriam "escolhendo E entrando", que não existe.
 */
type Fase =
  | { readonly nome: 'escolhendo' }
  | { readonly nome: 'entrando'; readonly destino: WorkspaceId }
  | { readonly nome: 'dentro'; readonly destino: WorkspaceId }

export function SessaoAtiva({
  perfil,
  onSair
}: {
  readonly perfil: UserProfile
  readonly onSair: () => void
}): React.JSX.Element {
  const { preferencias, salvar } = usePreferences()
  const [fase, setFase] = useState<Fase>({ nome: 'escolhendo' })

  function escolherAcento(modulo: Modulo, cor: CorAcento): void {
    const chave = modulo === 'noa' ? 'accentNoa' : 'accentJarvis'
    void salvar({ [chave]: cor as AccentColor })
  }

  /** O seletor de tema da CHOICE escreve a preferência da SPEC-Fundacao-05 (mesmo caminho do Settings). */
  function escolherTema(tema: ThemePreference): void {
    void salvar({ theme: tema })
  }

  /**
   * Escolher um card: audita a entrada no main e passa para a transição.
   *
   * `switchWorkspace` **antes** de montar o shell é o que mantém o `AppShell` intocado — ele lê
   * `getWorkspace()` no boot e encontra o espaço já definido, sem receber prop nova. A auditoria
   * (`workspace-switch`, critério 7) acontece aqui, na única porta de entrada.
   */
  function entrar(destino: WorkspaceId): void {
    window.jarvis
      .switchWorkspace(destino)
      .then((resultado) => {
        log.ui.info('Espaço de entrada escolhido na CHOICE', {
          para: resultado.workspace,
          auditSeq: resultado.auditSeq
        })
      })
      .catch((error: unknown) => {
        // Falha ao auditar não trava a entrada: registra e segue. Barrar a navegação por um
        // evento de auditoria seria mais grave que a auditoria perdida.
        log.ui.error('Falha ao registrar a entrada no espaço', { destino, error })
      })
    setFase({ nome: 'entrando', destino })
  }

  if (fase.nome === 'dentro') {
    return <AppShell perfil={perfil} onSair={onSair} />
  }

  // A CHOICE e a transição pintam com o acento; esperar as preferências evita um flash com o
  // fallback antes de o acento gravado chegar. O snapshot do main já resolveu `null → default`,
  // então daqui para baixo o acento é sempre uma cor pintável — sem fallback duplicado no renderer.
  if (!preferencias) {
    return <main className="fixed inset-0 bg-[#060708]" aria-hidden />
  }

  // Mesma paleta de 8 hex nos dois lados; o cast é seguro porque o main só devolve cor validada.
  const acentoNoa = preferencias.accentNoa as CorAcento
  const acentoJarvis = preferencias.accentJarvis as CorAcento

  if (fase.nome === 'entrando') {
    const modulo: Modulo = fase.destino
    return (
      <TransicaoDeMarca
        modulo={modulo}
        acento={modulo === 'noa' ? acentoNoa : acentoJarvis}
        onConcluir={() => setFase({ nome: 'dentro', destino: fase.destino })}
      />
    )
  }

  return (
    <TelaChoice
      acentoNoa={acentoNoa}
      acentoJarvis={acentoJarvis}
      tema={preferencias.theme}
      onEscolherAcento={escolherAcento}
      onEscolherTema={escolherTema}
      onEntrar={entrar}
    />
  )
}
