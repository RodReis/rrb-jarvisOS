/**
 * O perfil isolado do Codex, na tela (SPEC-Multi-Executor-02, critérios 1, 4 e 6).
 *
 * A pergunta que este painel responde ao PI: **a identidade Codex da pipeline está pronta, e o
 * que ela vai custar?**
 *
 * ## O que este componente nunca faz
 *
 * Não pede senha, token nem chave — não há campo para isso, e não é validação: o login acontece
 * **no CLI**, por fluxo de dispositivo, e o que a tela mostra é a instrução que o PI segue no
 * navegador. Um formulário aqui seria exatamente o que o critério 1 proíbe.
 *
 * Componente próprio, e não mais uma seção em `ProvidersDoWorkspace`: aquele arquivo já tem 407
 * linhas, e o perfil do Codex tem estado e ciclo próprios (login assíncrono, instrução a exibir,
 * decisão de cobrança). Fundir os dois faria uma tela de 600 linhas com duas responsabilidades.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ACAO_DA_SAUDE,
  CODEX_BILLING_MODES,
  ROTULO_DA_SAUDE,
  ROTULO_DO_MODO,
  modoGastaDinheiro,
  type CodexBillingMode,
  type CodexHealthState,
  type CodexProfileState
} from '@shared/domain/codex-profile'
import { Badge, Button, Checkbox, Field, InlineAlert, Panel, Select } from '@design/ui'
import type { TomSemantico } from '@design/ui'

/**
 * O tom de cada estado — **dado, não `if`**.
 *
 * `quota_unknown` é `info` e não `warn` de propósito: é o estado **normal** deste CLI (não há
 * telemetria de quota a ler), e pintá-lo de aviso ensinaria a ignorar avisos. `offline` é `warn`
 * e não `err` porque não é falha do sistema — é uma ferramenta ausente, que o PI instala.
 */
const TOM_DA_SAUDE: Readonly<Record<CodexHealthState, TomSemantico>> = {
  ready: 'ok',
  auth_required: 'warn',
  quota_limited: 'warn',
  quota_unknown: 'info',
  offline: 'warn'
}

/**
 * O contêiner: busca o estado pela ponte e monta o painel.
 *
 * Separado do componente de apresentação pela regra do projeto — o painel recebe tudo por props e
 * é testável sem `window.jarvis`, e este aqui só resolve dados. É a mesma divisão de
 * `ModelosPorFase`.
 */
export function PerfilDoCodexDoWorkspace(): React.JSX.Element | null {
  const [estado, setEstado] = useState<CodexProfileState>()

  const carregar = useCallback((): void => {
    void window.jarvis.estadoDoCodex().then(setEstado)
  }, [])

  useEffect(() => carregar(), [carregar])

  // Enquanto o CLI não respondeu, nada — e não um esqueleto: a consulta é local e rápida, e um
  // placeholder piscando seria mais ruído que informação.
  if (estado === undefined) return null

  return (
    <PerfilDoCodex
      estado={estado}
      onEntrar={() => window.jarvis.entrarNoCodex()}
      onSair={() => window.jarvis.sairDoCodex()}
      onTrocarModo={(modo, habilitado) => window.jarvis.setModoDoCodex(modo, habilitado)}
      onRecarregar={carregar}
    />
  )
}

export interface PerfilDoCodexProps {
  readonly estado: CodexProfileState
  readonly onEntrar: () => Promise<{ readonly ok: boolean; readonly instrucao: string }>
  readonly onSair: () => Promise<boolean>
  readonly onTrocarModo: (
    modo: CodexBillingMode,
    habilitado: boolean
  ) => Promise<CodexBillingMode | undefined>
  readonly onRecarregar: () => void
}

export function PerfilDoCodex({
  estado,
  onEntrar,
  onSair,
  onTrocarModo,
  onRecarregar
}: PerfilDoCodexProps): React.JSX.Element {
  const [instrucao, setInstrucao] = useState<string>()
  const [ocupado, setOcupado] = useState(false)
  const [recusa, setRecusa] = useState<string>()
  /**
   * A habilitação do modo pago **começa desligada a cada montagem**, e não é lembrada.
   *
   * A regra 4 diz que alterar o modo de cobrança cria uma decisão nova; um consentimento que
   * sobrevivesse à sessão faria a próxima troca herdar a autorização da anterior — que é a
   * transição silenciosa que a spec proíbe, só que com um passo humano no começo.
   */
  const [habilitado, setHabilitado] = useState(false)

  /*
   * A instrução só vale enquanto o perfil **não** autenticou: um código de dispositivo já
   * consumido é ruído que parece ação pendente.
   *
   * **Derivada no render, não sincronizada por efeito.** Um `useEffect` que chamasse
   * `setInstrucao(undefined)` seria estado espelhando estado — o antipadrão que o
   * `react-hooks/set-state-in-effect` aponta, e que custa um render extra a cada mudança de
   * saúde. O que se quer é uma função do estado atual, e é isso que isto é.
   */
  const instrucaoVisivel = estado.saude === 'auth_required' ? instrucao : undefined

  const entrar = useCallback(async (): Promise<void> => {
    setOcupado(true)
    try {
      const resultado = await onEntrar()
      setInstrucao(resultado.instrucao)
      onRecarregar()
    } finally {
      setOcupado(false)
    }
  }, [onEntrar, onRecarregar])

  const sair = useCallback(async (): Promise<void> => {
    setOcupado(true)
    try {
      await onSair()
      setInstrucao(undefined)
      onRecarregar()
    } finally {
      setOcupado(false)
    }
  }, [onSair, onRecarregar])

  const trocarModo = useCallback(
    async (modo: CodexBillingMode): Promise<void> => {
      setRecusa(undefined)
      const aplicado = await onTrocarModo(modo, habilitado)

      // `undefined` é a recusa da regra 3 — e a tela **diz por quê**, em vez de reverter o combo
      // em silêncio. Um select que voltasse sozinho pareceria defeito, não política.
      if (aplicado === undefined) {
        setRecusa(
          'Modos que gastam créditos exigem habilitação explícita. Marque a autorização antes de trocar.'
        )
        return
      }
      onRecarregar()
    },
    [onTrocarModo, habilitado, onRecarregar]
  )

  const acao = ACAO_DA_SAUDE[estado.saude]

  return (
    <Panel titulo="Perfil do Codex">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tom={TOM_DA_SAUDE[estado.saude]} comPonto>
            {ROTULO_DA_SAUDE[estado.saude]}
          </Badge>
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-secundario)]">
            {estado.codexHome}
          </span>
        </div>

        {/*
         * O alerta traz **o que fazer**, não o nome do estado — que o selo acima já diz.
         *
         * Repetir "Login necessário" no título faria a mesma frase aparecer duas vezes na mesma
         * altura da tela, e o alerta pareceria eco do selo em vez de acrescentar o próximo passo.
         */}
        {acao !== undefined && (
          <InlineAlert tom={TOM_DA_SAUDE[estado.saude]} titulo="O que fazer">
            {acao}
          </InlineAlert>
        )}

        {/*
         * A instrução do login por dispositivo — o código e a URL que o PI usa no navegador.
         *
         * Em `<pre>` porque o CLI a formata em linhas, e o código precisa ser copiável sem
         * reflow. **Não é credencial**: é o que o fornecedor imprime para o humano continuar do
         * outro lado, e passa por `redigirSegredos` no main antes de chegar aqui.
         */}
        {instrucaoVisivel !== undefined && instrucaoVisivel !== '' && (
          <div className="flex flex-col gap-2">
            <h3 className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[2px] text-[var(--jos-cor-texto-secundario)]">
              Continue no navegador
            </h3>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--jos-raio-card)] border border-[rgba(var(--jos-borda-rgb),0.12)] bg-[var(--jos-cor-superficie-elevada)] p-3 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto)]">
              {instrucaoVisivel}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void entrar()} carregando={ocupado}>
            Entrar no Codex
          </Button>
          <Button variante="secundaria" onClick={() => void sair()} desabilitado={ocupado}>
            Sair
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          <Field rotulo="Modo de cobrança">
            {(atributos) => (
              <Select
                {...atributos}
                valor={estado.modo}
                onMudar={(valor) => void trocarModo(valor as CodexBillingMode)}
                opcoes={CODEX_BILLING_MODES.map((modo) => ({
                  valor: modo,
                  rotulo: ROTULO_DO_MODO[modo]
                }))}
              />
            )}
          </Field>

          {/*
           * A autorização de gasto, **explícita e por decisão** (regra 4).
           *
           * O rótulo diz o que a marcação autoriza, e não só nomeia o campo: é a frase que o PI
           * confirma antes de o sistema poder gastar.
           */}
          <Checkbox
            rotulo="Autorizo trocar para um modo que consome créditos ou API. Sem esta marcação, a assinatura nunca cai em modo pago sozinha."
            marcado={habilitado}
            onMudar={setHabilitado}
          />

          {recusa !== undefined && (
            <InlineAlert tom="warn" titulo="Troca recusada">
              {recusa}
            </InlineAlert>
          )}

          {modoGastaDinheiro(estado.modo) && (
            <InlineAlert tom="warn" titulo="Este modo gasta dinheiro">
              A execução é bloqueada antes de começar quando o projeto não tem teto de créditos
              configurado, ou quando o teto já foi atingido.
            </InlineAlert>
          )}
        </div>

        {estado.diagnostico !== undefined && (
          <p className="max-w-[68ch] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]">
            {estado.diagnostico}
          </p>
        )}
      </div>
    </Panel>
  )
}
