/**
 * Providers e BYOK (SPEC-DesignSystem-04b, critério 2; PRD §12.5 e §15).
 *
 * **A regra que governa este arquivo inteiro:** a chave crua entra por um campo e sai por um
 * callback — e não fica em lugar nenhum no meio. O renderer não persiste, não loga e não guarda
 * em estado que sobreviva ao submit (PRD §15: *"o renderer não persiste chaves em storage, cache,
 * logs ou telemetria"*). Quem guarda é o runtime, no cofre do SO (ADR-001).
 *
 * Depois de configurada, a UI **nunca mais** vê a chave: exibe provider, status, últimos quatro
 * caracteres e data da validação — e é só isso que o tipo `CredencialMascarada` permite
 * carregar. Não é disciplina de quem escreve a tela; é o tipo recusando o dado.
 */

import { useState } from 'react'
import { AlertDialog, Button, Field, InlineAlert, PasswordInput } from '../ui'
import { StatusOperacional, type EstadoOperacional } from './Operacionais'

/**
 * A mensagem obrigatória do PRD §12.5 — **literal**, não parafraseada.
 *
 * Ela informa três coisas que mudam a decisão do usuário: a chave fica no dispositivo, agentes só
 * rodam com a Plataforma aberta, e trocar de computador exige reconfigurar. Reescrevê-la "para
 * ficar mais curta" apagaria a segunda ou a terceira — por isso é constante exportada, e há teste
 * afirmando que ela aparece no `ProviderSetup`.
 */
export const MENSAGEM_BYOK =
  'Suas chaves de IA ficam protegidas neste dispositivo e não são armazenadas na nuvem. ' +
  'Agentes e automações funcionam somente enquanto a Plataforma estiver aberta. ' +
  'Se você trocar de computador, precisará configurar as chaves novamente.'

/**
 * O que a UI pode saber de uma credencial **depois** de configurada (PRD §15).
 *
 * Note o que este tipo **não** tem: nenhum campo que caiba a chave. Um `valor?: string` opcional
 * seria o caminho por onde ela voltaria à tela — e opcional é o que alguém preenche "só neste
 * caso". O tipo é a garantia; o comentário é só a explicação dela.
 */
export interface CredencialMascarada {
  readonly provider: string
  /** Os **últimos quatro** caracteres — o suficiente para o usuário reconhecer qual chave é. */
  readonly ultimos4: string
  readonly estado: EstadoOperacional
  /** Data da última validação, já formatada — o DS não formata data (locale é do produto). */
  readonly validadaEm?: string
}

/**
 * Resumo da credencial configurada.
 *
 * `select-none` no trecho mascarado: o PRD §15 pede que *"inputs sensíveis desabilitem cópia
 * acidental em superfícies de resumo"*. Não é proteção contra quem quer copiar — os quatro
 * dígitos não são segredo —, é contra o gesto distraído de selecionar a linha inteira e colar
 * num chat junto com o resto.
 */
export function MaskedCredentialSummary({
  credencial
}: {
  readonly credencial: CredencialMascarada
}): React.JSX.Element {
  return (
    <div
      data-jos-credencial={credencial.provider}
      className="flex flex-wrap items-center gap-3 rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-3"
    >
      <span className="font-[var(--jos-peso-medio)] text-[length:var(--jos-texto-corpo)]">
        {credencial.provider}
      </span>
      <span
        className="select-none font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-suave)]"
        // O `aria-label` diz o que os pontinhos significam: um leitor de tela anunciando
        // "•••• 3f9a" sem contexto não informa nada.
        aria-label={`Chave terminada em ${credencial.ultimos4}`}
      >
        ••••&nbsp;{credencial.ultimos4}
      </span>
      <StatusOperacional estado={credencial.estado} rotulo={rotuloDoEstado(credencial.estado)} />
      {credencial.validadaEm !== undefined && (
        <span className="text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]">
          Validada em {credencial.validadaEm}
        </span>
      )}
    </div>
  )
}

function rotuloDoEstado(estado: EstadoOperacional): string {
  const rotulos: Readonly<Record<EstadoOperacional, string>> = {
    ativo: 'Válida',
    executando: 'Validando',
    inativo: 'Não configurada',
    degradado: 'Atenção',
    erro: 'Inválida'
  }
  return rotulos[estado]
}

/** Estado da validação, para o feedback logo após o submit. */
export function ProviderValidationStatus({
  estado,
  mensagem
}: {
  readonly estado: EstadoOperacional
  readonly mensagem?: string
}): React.JSX.Element {
  return <StatusOperacional estado={estado} rotulo={rotuloDoEstado(estado)} descricao={mensagem} />
}

/**
 * Configuração de um provider (critério 2).
 *
 * A chave vive **só** no estado local deste componente, entre a digitação e o submit, e é
 * limpa imediatamente depois. Isso não é higiene opcional: enquanto ela estiver em estado
 * React, ela aparece em qualquer devtools aberto e em qualquer captura de estado.
 *
 * `onSalvar` recebe a chave crua porque alguém precisa levá-la ao cofre — e esse alguém é o
 * runtime, via IPC. O que o DS garante é que ela não vai a mais lugar nenhum: sem `console.log`,
 * sem `localStorage`, sem `analytics`, sem prop de telemetria.
 */
export function ProviderSetup({
  provider,
  onSalvar,
  estadoValidacao,
  mensagemValidacao
}: {
  readonly provider: string
  /** Recebe a chave crua **uma vez**, no submit. O componente a esquece em seguida. */
  readonly onSalvar: (chave: string) => void
  readonly estadoValidacao?: EstadoOperacional
  readonly mensagemValidacao?: string
}): React.JSX.Element {
  const [chave, setChave] = useState('')

  function submeter(evento: React.FormEvent): void {
    evento.preventDefault()
    if (chave.trim() === '') return
    onSalvar(chave)
    // Limpa **antes** de qualquer outra coisa acontecer. Um `setChave('')` depois de um `await`
    // deixaria a chave viva no estado durante toda a validação de rede.
    setChave('')
  }

  return (
    <form data-jos-provider-setup={provider} onSubmit={submeter} className="flex flex-col gap-3">
      {/* A mensagem obrigatória vem **antes** do campo: informa a decisão, não a justifica
          depois de tomada. */}
      <InlineAlert tom="info" titulo={`Configurar ${provider}`}>
        {MENSAGEM_BYOK}
      </InlineAlert>

      <Field rotulo="Chave de API" descricao="A chave não é enviada para a nuvem.">
        {(atributos) => (
          <PasswordInput
            {...atributos}
            valor={chave}
            onMudar={setChave}
            // `autoComplete="off"`: o gerenciador de senhas do navegador guardaria a chave, que é
            // exatamente o "storage do renderer" que o PRD §15 proíbe.
            autoComplete="off"
            placeholder="Cole a chave aqui"
          />
        )}
      </Field>

      {estadoValidacao !== undefined && (
        <ProviderValidationStatus estado={estadoValidacao} mensagem={mensagemValidacao} />
      )}

      <div>
        <Button tipo="submit">Salvar chave</Button>
      </div>
    </form>
  )
}

/**
 * Remoção de credencial (PRD §15: *"remover uma chave exige confirmação e informa execuções
 * afetadas"*).
 *
 * `execucoesAfetadas` é obrigatório — inclusive quando é zero. "Nenhuma execução será afetada" é
 * informação; a ausência do número deixaria o usuário supondo. E o verbo é específico, herdado do
 * contrato do `AlertDialog` da F03b.
 */
export function RemoveCredentialDialog({
  aberto,
  provider,
  execucoesAfetadas,
  onRemover,
  onCancelar
}: {
  readonly aberto: boolean
  readonly provider: string
  readonly execucoesAfetadas: number
  readonly onRemover: () => void
  readonly onCancelar: () => void
}): React.JSX.Element {
  const impacto =
    execucoesAfetadas === 0
      ? 'Nenhuma execução em andamento será afetada.'
      : execucoesAfetadas === 1
        ? '1 execução em andamento será interrompida.'
        : `${execucoesAfetadas} execuções em andamento serão interrompidas.`

  return (
    <AlertDialog
      aberto={aberto}
      titulo={`Remover a chave de ${provider}?`}
      descricao={impacto}
      verboConfirmar={`Remover chave de ${provider}`}
      onConfirmar={onRemover}
      onFechar={onCancelar}
    >
      <InlineAlert tom="warn" titulo="Isto não pode ser desfeito">
        Para voltar a usar {provider}, você precisará configurar a chave novamente.
      </InlineAlert>
    </AlertDialog>
  )
}
