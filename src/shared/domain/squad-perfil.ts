/**
 * O perfil de um Squad (SPEC-Squads-01) — o contrato que o orquestrador e o validador consomem.
 *
 * A pergunta que este arquivo responde: **que Squad é permitido montar para este tipo de fatia?**
 * Quantos escritores, em que camada de modelo cada papel roda, o que cada função pode tocar e
 * quais ações esperam o PI. O orquestrador *propõe* um plano; o perfil é o que o kernel confere
 * antes de qualquer dispatch (ADR-006, decisão 2).
 *
 * Quatro decisões governam o desenho:
 *
 *  - **Validação devolve todos os problemas**, no padrão do `ci-profile`: quem escreve o perfil
 *    conserta de uma vez, e um validador que para no primeiro erro transforma o conserto numa fila.
 *  - **Nenhum agente tem Git ou GitHub, em nenhuma função, em nenhum perfil.** Quem commita,
 *    integra, abre a PR e faz o merge é o kernel (ADR-006, decisão 5). O campo existe no perfil
 *    para a recusa ser *verificável* — um perfil que não pudesse dizer `git: true` não provaria
 *    que o rejeita.
 *  - **Dois escritores ficam desligados por padrão** até o MVP-028 (ADR-006, decisão 16). O perfil
 *    de produção recusa `escritores: 2`; o E2E de teste liga `multiEscritor`.
 *  - **O orquestrador padrão é o modelo da fase** (PI, 2026-10-02, após a M11-F00 reprovar o
 *    critério de 80%). O local via Ollama é opção, e só com o validador endurecido da Emenda E1.
 *
 * Mora em `src/shared/domain`: pura, sem disco, sem rede, verificável sem o Electron.
 */

import type { AiProvider } from './ai'
import type { CapacidadeId } from './squad-capacidades'
import { AI_PROVIDERS } from './ai'
import { isCapacidadeId } from './squad-capacidades'
import { modeloExisteNoCatalogo } from './modelo-da-fase'

/** A versão do schema. Perfil de outra versão é recusado, não convertido por adivinhação. */
export const VERSAO_DO_SCHEMA_DO_PERFIL = 1

/**
 * As camadas de modelo (ADR-006, decisão 4).
 *
 *  - `orquestrador`: quebra a issue em tarefas e escolhe a camada de cada uma;
 *  - `executor`: tarefas estruturais e repetitivas (testes simples, boilerplate);
 *  - `especialista`: lógica complexa, refatoração de arquitetura, depuração, revisão de segurança.
 */
export const CAMADAS = ['orquestrador', 'executor', 'especialista'] as const
export type Camada = (typeof CAMADAS)[number]

export function isCamada(value: unknown): value is Camada {
  return typeof value === 'string' && (CAMADAS as readonly string[]).includes(value)
}

/** O que um agente faz no Squad. É a função, e não o agente, que decide o acesso. */
export const FUNCOES = ['leitura', 'escritor', 'integrador'] as const
export type Funcao = (typeof FUNCOES)[number]

/** As funções que escrevem no worktree. As demais só leem (ADR-006, decisão 5). */
const FUNCOES_QUE_ESCREVEM: readonly Funcao[] = ['escritor', 'integrador']

/**
 * As ações que esperam o PI antes de executar (ADR-006, decisão 11).
 *
 * O `deploy` entra como registrado: hoje está fora do escopo da V2, mas o perfil já o lista para
 * que o dia em que ele chegar não exija reabrir o contrato — e para o perfil que o omitir ser
 * recusado em vez de herdar silêncio.
 */
export const ACOES_COM_APROVACAO = [
  'alteracao-estrutural-de-banco',
  'comando-destrutivo',
  'deploy'
] as const
export type AcaoComAprovacao = (typeof ACOES_COM_APROVACAO)[number]

/** O teto de escritores que o produto aceita (ADR-006, decisão 5). */
export const MAX_ESCRITORES = 2

/**
 * De onde sai o modelo de uma camada.
 *
 *  - `fase`: o modelo da fase (MVP-026), pela rota que o projeto escolheu. É o padrão.
 *  - `modelo`: um par explícito. Para `ollama`, a tag é a da máquina do usuário e o produto não a
 *    cataloga; para os demais, o catálogo manda. `validador: 'e1'` é obrigatório no orquestrador
 *    local — é a declaração de que o plano dele passa pelo validador endurecido da SPEC-Squads-02.
 */
export type OrigemDaCamada =
  | { readonly origem: 'fase' }
  | {
      readonly origem: 'modelo'
      readonly provider: AiProvider
      readonly modelo: string
      readonly validador?: 'e1'
    }

export interface CapacidadeNoPerfil {
  readonly id: CapacidadeId
  readonly obrigatoria: boolean
  /** As camadas em que esta capacidade pode ser exercida. Ao menos uma. */
  readonly camadas: readonly Camada[]
}

export interface AcessoDaFuncao {
  readonly escrita: boolean
  readonly git: boolean
  readonly github: boolean
}

export interface LimitesDoPerfil {
  /**
   * Piso do teto de tarefas. O teto efetivo é `max(piso, nº de critérios da SPEC)`: cada tarefa
   * aponta um critério, e um teto fixo de 12 tornou impossível cobrir fatias de 13 critérios na
   * M11-F00.
   */
  readonly maxTarefasMinimo: number
  readonly maxTokensEntradaPorTarefa: number
  readonly maxTokensSaidaPorTarefa: number
}

export interface PerfilDeSquad {
  readonly schema: typeof VERSAO_DO_SCHEMA_DO_PERFIL
  /** Identificador do tipo de fatia (`kebab-case`). Aberto: quem consome decide o que existe. */
  readonly tipoDeFatia: string
  /** Revisão do conteúdo do perfil, inteira e crescente. A revisão *registrada* é o hash dela. */
  readonly versao: number
  readonly camadas: Readonly<Record<Camada, OrigemDaCamada>>
  readonly capacidades: readonly CapacidadeNoPerfil[]
  readonly escritores: 1 | 2
  /** Presente se, e somente se, há dois escritores. */
  readonly integrador?: { readonly camada: Camada }
  readonly revisor: { readonly camada: Camada }
  readonly acessoPorFuncao: Readonly<Record<Funcao, AcessoDaFuncao>>
  readonly aprovacoes: readonly AcaoComAprovacao[]
  readonly limites: LimitesDoPerfil
}

export type CodigoDeProblema =
  | 'SCHEMA'
  | 'VERSAO_DE_SCHEMA_DESCONHECIDA'
  | 'TIPO_INVALIDO'
  | 'VERSAO_INVALIDA'
  | 'CAMADA_INVALIDA'
  | 'CAPACIDADE_DESCONHECIDA'
  | 'CAPACIDADE_DUPLICADA'
  | 'MODELO_FORA_DO_CATALOGO'
  | 'LOCAL_SEM_VALIDADOR_E1'
  | 'ESCRITORES_EXCEDIDOS'
  | 'MULTI_ESCRITOR_DESLIGADO'
  | 'INTEGRADOR_AUSENTE'
  | 'INTEGRADOR_SEM_SEGUNDO_ESCRITOR'
  | 'INTEGRADOR_NA_CAMADA_DO_REVISOR'
  | 'PERMISSAO_GIT_GITHUB'
  | 'ACESSO_SUPERIOR_A_FUNCAO'
  | 'APROVACAO_AUSENTE'
  | 'LIMITE_INVALIDO'

export interface ProblemaDoPerfil {
  readonly codigo: CodigoDeProblema
  /** Onde no perfil (`camadas.executor`, `capacidades[1].id`). Para quem escreve o perfil achar. */
  readonly caminho: string
  readonly detalhe: string
}

export type ResultadoDaValidacao =
  | { readonly ok: true; readonly perfil: PerfilDeSquad }
  | { readonly ok: false; readonly problemas: readonly ProblemaDoPerfil[] }

export interface OpcoesDeValidacao {
  /** Liga o segundo escritor. Só o E2E de teste liga, até o MVP-028 (ADR-006, decisão 16). */
  readonly multiEscritor?: boolean
}

const TIPO_DE_FATIA = /^[a-z0-9]+(-[a-z0-9]+)*$/

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const ehInteiroPositivo = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0

/** Congela em profundidade. O perfil é contrato: ninguém o altera depois de validado. */
export function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    for (const filho of Object.values(valor)) congelar(filho)
  }
  return valor
}

function validarCamadas(bruto: unknown, problemas: ProblemaDoPerfil[]): void {
  const problema = (codigo: CodigoDeProblema, caminho: string, detalhe: string): void => {
    problemas.push({ codigo, caminho, detalhe })
  }

  if (!ehObjeto(bruto)) {
    problema('SCHEMA', 'camadas', 'as camadas não são um objeto')
    return
  }

  for (const camada of CAMADAS) {
    const origem = bruto[camada]
    const caminho = `camadas.${camada}`

    if (!ehObjeto(origem)) {
      problema('SCHEMA', caminho, 'camada sem origem declarada')
      continue
    }
    if (origem.origem === 'fase') continue
    if (origem.origem !== 'modelo') {
      problema('SCHEMA', caminho, `origem ${String(origem.origem)} desconhecida`)
      continue
    }

    const { provider, modelo } = origem
    if (typeof provider !== 'string' || !(AI_PROVIDERS as readonly string[]).includes(provider)) {
      problema('MODELO_FORA_DO_CATALOGO', caminho, `provider ${String(provider)} desconhecido`)
      continue
    }
    if (typeof modelo !== 'string' || modelo.trim() === '') {
      problema('MODELO_FORA_DO_CATALOGO', caminho, 'modelo em branco')
      continue
    }
    // A tag do Ollama é a da máquina do usuário: o produto não a cataloga, e a disponibilidade
    // é pergunta da resolução. Para os demais providers, o catálogo manda — é ele que proíbe
    // Fable pela API paga.
    if (provider !== 'ollama' && !modeloExisteNoCatalogo(provider as AiProvider, modelo)) {
      problema('MODELO_FORA_DO_CATALOGO', caminho, `${provider} não tem o modelo ${modelo}`)
    }
    if (camada === 'orquestrador' && provider === 'ollama' && origem.validador !== 'e1') {
      problema(
        'LOCAL_SEM_VALIDADOR_E1',
        caminho,
        'o orquestrador local só entra com o validador endurecido (SPEC-Squads-02, Emenda E1)'
      )
    }
  }
}

function validarCapacidades(bruto: unknown, problemas: ProblemaDoPerfil[]): void {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    problemas.push({ codigo: 'SCHEMA', caminho: 'capacidades', detalhe: 'sem capacidades' })
    return
  }

  const vistas = new Set<unknown>()
  for (const [i, item] of bruto.entries()) {
    const caminho = `capacidades[${i}]`
    if (!ehObjeto(item)) {
      problemas.push({ codigo: 'SCHEMA', caminho, detalhe: 'a capacidade não é um objeto' })
      continue
    }
    if (!isCapacidadeId(item.id)) {
      problemas.push({
        codigo: 'CAPACIDADE_DESCONHECIDA',
        caminho: `${caminho}.id`,
        detalhe: `capacidade ${String(item.id)} não está no registro`
      })
    } else if (vistas.has(item.id)) {
      problemas.push({
        codigo: 'CAPACIDADE_DUPLICADA',
        caminho: `${caminho}.id`,
        detalhe: `${item.id} aparece mais de uma vez`
      })
    }
    vistas.add(item.id)

    if (typeof item.obrigatoria !== 'boolean') {
      problemas.push({
        codigo: 'SCHEMA',
        caminho: `${caminho}.obrigatoria`,
        detalhe: 'obrigatoria precisa ser booleano'
      })
    }
    const camadas = item.camadas
    if (!Array.isArray(camadas) || camadas.length === 0 || !camadas.every(isCamada)) {
      problemas.push({
        codigo: 'CAMADA_INVALIDA',
        caminho: `${caminho}.camadas`,
        detalhe: 'ao menos uma camada válida (orquestrador, executor ou especialista)'
      })
    }
  }
}

function validarAcesso(bruto: unknown, problemas: ProblemaDoPerfil[]): void {
  if (!ehObjeto(bruto)) {
    problemas.push({ codigo: 'SCHEMA', caminho: 'acessoPorFuncao', detalhe: 'não é um objeto' })
    return
  }

  for (const funcao of FUNCOES) {
    const acesso = bruto[funcao]
    const caminho = `acessoPorFuncao.${funcao}`
    if (
      !ehObjeto(acesso) ||
      typeof acesso.escrita !== 'boolean' ||
      typeof acesso.git !== 'boolean' ||
      typeof acesso.github !== 'boolean'
    ) {
      problemas.push({ codigo: 'SCHEMA', caminho, detalhe: 'escrita, git e github obrigatórios' })
      continue
    }
    if (acesso.git || acesso.github) {
      problemas.push({
        codigo: 'PERMISSAO_GIT_GITHUB',
        caminho,
        detalhe: 'nenhum agente tem Git ou GitHub; quem commita e integra é o kernel'
      })
    }
    if (acesso.escrita && !FUNCOES_QUE_ESCREVEM.includes(funcao)) {
      problemas.push({
        codigo: 'ACESSO_SUPERIOR_A_FUNCAO',
        caminho,
        detalhe: `a função ${funcao} só lê; escrita é de escritor e integrador`
      })
    }
  }
}

function validarEscritores(
  bruto: Record<string, unknown>,
  opcoes: OpcoesDeValidacao,
  problemas: ProblemaDoPerfil[]
): void {
  const { escritores, integrador, revisor } = bruto

  if (!ehInteiroPositivo(escritores)) {
    problemas.push({ codigo: 'SCHEMA', caminho: 'escritores', detalhe: 'inteiro ≥ 1' })
    return
  }
  if (escritores > MAX_ESCRITORES) {
    problemas.push({
      codigo: 'ESCRITORES_EXCEDIDOS',
      caminho: 'escritores',
      detalhe: `${escritores} escritores; o teto é ${MAX_ESCRITORES}`
    })
  } else if (escritores === 2 && opcoes.multiEscritor !== true) {
    problemas.push({
      codigo: 'MULTI_ESCRITOR_DESLIGADO',
      caminho: 'escritores',
      detalhe: 'dois escritores ficam desligados até o MVP-028 (ADR-006, decisão 16)'
    })
  }

  const camadaDoRevisor = ehObjeto(revisor) && isCamada(revisor.camada) ? revisor.camada : undefined
  if (camadaDoRevisor === undefined) {
    problemas.push({ codigo: 'CAMADA_INVALIDA', caminho: 'revisor.camada', detalhe: 'obrigatória' })
  }

  const camadaDoIntegrador =
    ehObjeto(integrador) && isCamada(integrador.camada) ? integrador.camada : undefined

  if (escritores >= 2 && integrador === undefined) {
    problemas.push({
      codigo: 'INTEGRADOR_AUSENTE',
      caminho: 'integrador',
      detalhe: 'com mais de um escritor, alguém precisa integrar'
    })
  }
  if (escritores === 1 && integrador !== undefined) {
    problemas.push({
      codigo: 'INTEGRADOR_SEM_SEGUNDO_ESCRITOR',
      caminho: 'integrador',
      detalhe: 'integrador só existe com dois escritores'
    })
  }
  if (integrador !== undefined && camadaDoIntegrador === undefined) {
    problemas.push({ codigo: 'CAMADA_INVALIDA', caminho: 'integrador.camada', detalhe: 'inválida' })
  }
  if (camadaDoIntegrador !== undefined && camadaDoIntegrador === camadaDoRevisor) {
    problemas.push({
      codigo: 'INTEGRADOR_NA_CAMADA_DO_REVISOR',
      caminho: 'integrador.camada',
      detalhe: `quem integra não revisa o próprio resultado; ambos em ${camadaDoIntegrador}`
    })
  }
}

function validarLimites(bruto: unknown, problemas: ProblemaDoPerfil[]): void {
  const campos = ['maxTarefasMinimo', 'maxTokensEntradaPorTarefa', 'maxTokensSaidaPorTarefa']
  for (const campo of campos) {
    if (!ehObjeto(bruto) || !ehInteiroPositivo(bruto[campo])) {
      problemas.push({
        codigo: 'LIMITE_INVALIDO',
        caminho: `limites.${campo}`,
        detalhe: 'inteiro positivo obrigatório'
      })
    }
  }
}

/**
 * Valida um perfil que veio de fora (arquivo, IPC, fixture) e devolve o tipado e congelado, ou
 * **todos** os problemas. Nunca lança: perfil malformado é desfecho previsto.
 */
export function validarPerfil(
  bruto: unknown,
  opcoes: OpcoesDeValidacao = {}
): ResultadoDaValidacao {
  if (!ehObjeto(bruto)) {
    return {
      ok: false,
      problemas: [{ codigo: 'SCHEMA', caminho: '', detalhe: 'o perfil não é um objeto' }]
    }
  }

  const problemas: ProblemaDoPerfil[] = []

  if (bruto.schema !== VERSAO_DO_SCHEMA_DO_PERFIL) {
    problemas.push({
      codigo: 'VERSAO_DE_SCHEMA_DESCONHECIDA',
      caminho: 'schema',
      detalhe: `esperado ${VERSAO_DO_SCHEMA_DO_PERFIL}, veio ${String(bruto.schema)}`
    })
  }
  if (typeof bruto.tipoDeFatia !== 'string' || !TIPO_DE_FATIA.test(bruto.tipoDeFatia)) {
    problemas.push({
      codigo: 'TIPO_INVALIDO',
      caminho: 'tipoDeFatia',
      detalhe: 'kebab-case não vazio'
    })
  }
  if (!ehInteiroPositivo(bruto.versao)) {
    problemas.push({ codigo: 'VERSAO_INVALIDA', caminho: 'versao', detalhe: 'inteiro ≥ 1' })
  }

  validarCamadas(bruto.camadas, problemas)
  validarCapacidades(bruto.capacidades, problemas)
  validarEscritores(bruto, opcoes, problemas)
  validarAcesso(bruto.acessoPorFuncao, problemas)

  const aprovacoes = Array.isArray(bruto.aprovacoes) ? bruto.aprovacoes : []
  for (const acao of ACOES_COM_APROVACAO) {
    if (!aprovacoes.includes(acao)) {
      problemas.push({
        codigo: 'APROVACAO_AUSENTE',
        caminho: 'aprovacoes',
        detalhe: `a ação ${acao} precisa esperar o PI`
      })
    }
  }

  validarLimites(bruto.limites, problemas)

  if (problemas.length > 0) return { ok: false, problemas }
  return { ok: true, perfil: congelar(structuredClone(bruto) as unknown as PerfilDeSquad) }
}

export interface LimitesCalculados {
  /** Quantos slots do pool o Squad ocupa: um por escritor (ADR-006, decisão 5). */
  readonly slots: number
  readonly maxTarefas: number
}

/** Os limites que valem **antes** de instanciar o Squad (critério 4). */
export function limitesDoPerfil(perfil: PerfilDeSquad, criteriosDaSpec: number): LimitesCalculados {
  return {
    slots: perfil.escritores,
    maxTarefas: Math.max(perfil.limites.maxTarefasMinimo, criteriosDaSpec)
  }
}

/**
 * O perfil padrão: um escritor, o modelo da fase em toda camada, as seis capacidades.
 *
 * Revisão e testes são obrigatórios; análise, arquitetura, design e pesquisa são opcionais — a
 * ausência delas rebaixa a qualidade do plano, mas não o impede. O revisor roda no especialista:
 * é a camada que o ADR-006 reserva a revisão de segurança e a lógica complexa.
 */
export const PERFIL_PADRAO: PerfilDeSquad = congelar({
  schema: VERSAO_DO_SCHEMA_DO_PERFIL,
  tipoDeFatia: 'padrao',
  versao: 1,
  camadas: {
    orquestrador: { origem: 'fase' },
    executor: { origem: 'fase' },
    especialista: { origem: 'fase' }
  },
  capacidades: [
    { id: 'analise', obrigatoria: false, camadas: ['orquestrador', 'especialista'] },
    { id: 'arquitetura', obrigatoria: false, camadas: ['especialista'] },
    { id: 'testes', obrigatoria: true, camadas: ['executor', 'especialista'] },
    { id: 'revisao-de-codigo', obrigatoria: true, camadas: ['especialista'] },
    { id: 'revisao-de-design', obrigatoria: false, camadas: ['especialista'] },
    { id: 'pesquisa-documental', obrigatoria: false, camadas: ['executor', 'especialista'] }
  ],
  escritores: 1,
  revisor: { camada: 'especialista' },
  acessoPorFuncao: {
    leitura: { escrita: false, git: false, github: false },
    escritor: { escrita: true, git: false, github: false },
    integrador: { escrita: true, git: false, github: false }
  },
  aprovacoes: [...ACOES_COM_APROVACAO],
  limites: {
    maxTarefasMinimo: 12,
    maxTokensEntradaPorTarefa: 16_000,
    maxTokensSaidaPorTarefa: 8_000
  }
})
