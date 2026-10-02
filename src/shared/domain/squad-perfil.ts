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
      /** Janela de contexto pedida ao Ollama; vai ao snapshot. Só vale para `ollama`. */
      readonly numCtx?: number
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
  /** Turnos (idas e vindas com o modelo) que uma tarefa pode gastar — SPEC-Squads-02. */
  readonly maxTurnosPorTarefa: number
  /** Tempo de parede que uma tarefa pode gastar, em minutos — SPEC-Squads-02. */
  readonly maxMinutosPorTarefa: number
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
  | 'CHAVE_DESCONHECIDA'
  | 'APROVACAO_DESCONHECIDA'

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

/**
 * Tetos de sanidade dos limites. Um `maxTokensEntradaPorTarefa` de `1e300` é inteiro e passaria
 * por "positivo", mas é lixo: alimentaria a cota de custo com um número que não significa nada.
 */
export const TETO_DE_TAREFAS = 1_000
export const TETO_DE_TOKENS_POR_TAREFA = 1_000_000
export const TETO_DE_TURNOS_POR_TAREFA = 200
export const TETO_DE_MINUTOS_POR_TAREFA = 240

/**
 * As chaves que o schema conhece, **nível a nível**. O validador recusa o resto em vez de copiar:
 * um perfil com `acessoPorFuncao.admin = { git: true }` tem a forma certa nas chaves que o
 * validador olha e uma permissão que ele nunca viu — exatamente o que o critério 3 proíbe.
 */
const CHAVES_DO_PERFIL = [
  'schema',
  'tipoDeFatia',
  'versao',
  'camadas',
  'capacidades',
  'escritores',
  'integrador',
  'revisor',
  'acessoPorFuncao',
  'aprovacoes',
  'limites'
] as const
const CHAVES_DA_ORIGEM_FASE = ['origem'] as const
const CHAVES_DA_ORIGEM_MODELO = ['origem', 'provider', 'modelo', 'validador', 'numCtx'] as const

/** Faixa de `num_ctx` que o produto aceita: abaixo o plano não cabe; acima a VRAM do PI não segura. */
export const MIN_NUM_CTX = 2_048
export const MAX_NUM_CTX = 131_072
const CHAVES_DA_CAPACIDADE = ['id', 'obrigatoria', 'camadas'] as const
const CHAVES_DO_ACESSO = ['escrita', 'git', 'github'] as const
const CHAVES_DA_CAMADA_DO_PAPEL = ['camada'] as const
const CHAVES_DOS_LIMITES = [
  'maxTarefasMinimo',
  'maxTokensEntradaPorTarefa',
  'maxTokensSaidaPorTarefa',
  'maxTurnosPorTarefa',
  'maxMinutosPorTarefa'
] as const

const TETO_DO_LIMITE: Readonly<Record<(typeof CHAVES_DOS_LIMITES)[number], number>> = {
  maxTarefasMinimo: TETO_DE_TAREFAS,
  maxTokensEntradaPorTarefa: TETO_DE_TOKENS_POR_TAREFA,
  maxTokensSaidaPorTarefa: TETO_DE_TOKENS_POR_TAREFA,
  maxTurnosPorTarefa: TETO_DE_TURNOS_POR_TAREFA,
  maxMinutosPorTarefa: TETO_DE_MINUTOS_POR_TAREFA
}

type Problemas = ProblemaDoPerfil[]

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const ehInteiroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max

const ehInteiroAte = (v: unknown, teto: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= teto

/** Congela em profundidade. O perfil é contrato: ninguém o altera depois de validado. */
export function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    for (const filho of Object.values(valor)) congelar(filho)
  }
  return valor
}

function registrar(
  problemas: Problemas,
  codigo: CodigoDeProblema,
  caminho: string,
  detalhe: string
): void {
  problemas.push({ codigo, caminho, detalhe })
}

/** Recusa toda chave própria fora da lista — inclusive a `__proto__` que o `JSON.parse` cria. */
function exigirSoChaves(
  objeto: Record<string, unknown>,
  permitidas: readonly string[],
  caminho: string,
  problemas: Problemas
): void {
  for (const chave of Object.keys(objeto)) {
    if (permitidas.includes(chave)) continue
    const onde = caminho === '' ? chave : `${caminho}.${chave}`
    registrar(problemas, 'CHAVE_DESCONHECIDA', onde, `a chave ${chave} não existe no schema`)
  }
}

function validarOrigem(
  camada: Camada,
  origem: Record<string, unknown>,
  problemas: Problemas
): void {
  const caminho = `camadas.${camada}`
  if (origem.origem === 'fase') {
    exigirSoChaves(origem, CHAVES_DA_ORIGEM_FASE, caminho, problemas)
    return
  }
  if (origem.origem !== 'modelo') {
    registrar(problemas, 'SCHEMA', caminho, `origem ${String(origem.origem)} desconhecida`)
    return
  }
  exigirSoChaves(origem, CHAVES_DA_ORIGEM_MODELO, caminho, problemas)

  const { validador, numCtx } = origem
  if (
    numCtx !== undefined &&
    (origem.provider !== 'ollama' || !ehInteiroEntre(numCtx, MIN_NUM_CTX, MAX_NUM_CTX))
  ) {
    registrar(
      problemas,
      'SCHEMA',
      `${caminho}.numCtx`,
      `só para ollama, inteiro entre ${MIN_NUM_CTX} e ${MAX_NUM_CTX}`
    )
  }
  if (validador !== undefined && validador !== 'e1') {
    registrar(problemas, 'SCHEMA', `${caminho}.validador`, 'só o validador e1 existe')
  }
  validarProviderEModelo(camada, origem, problemas)
}

/** O par pedido existe? E o orquestrador local declara o validador que a Emenda E1 exige? */
function validarProviderEModelo(
  camada: Camada,
  origem: Record<string, unknown>,
  problemas: Problemas
): void {
  const caminho = `camadas.${camada}`
  const { provider, modelo, validador } = origem
  if (typeof provider !== 'string' || !(AI_PROVIDERS as readonly string[]).includes(provider)) {
    registrar(
      problemas,
      'MODELO_FORA_DO_CATALOGO',
      caminho,
      `provider ${String(provider)} desconhecido`
    )
    return
  }
  if (typeof modelo !== 'string' || modelo.trim() === '') {
    registrar(problemas, 'MODELO_FORA_DO_CATALOGO', caminho, 'modelo em branco')
    return
  }
  // A tag do Ollama é a da máquina do usuário: o produto não a cataloga, e a disponibilidade é
  // pergunta da resolução. Para os demais providers, o catálogo manda — é ele que proíbe Fable
  // pela API paga.
  if (provider !== 'ollama' && !modeloExisteNoCatalogo(provider as AiProvider, modelo)) {
    registrar(
      problemas,
      'MODELO_FORA_DO_CATALOGO',
      caminho,
      `${provider} não tem o modelo ${modelo}`
    )
  }
  if (camada === 'orquestrador' && provider === 'ollama' && validador !== 'e1') {
    registrar(
      problemas,
      'LOCAL_SEM_VALIDADOR_E1',
      caminho,
      'o orquestrador local só entra com o validador endurecido (SPEC-Squads-02, Emenda E1)'
    )
  }
}

function validarCamadas(bruto: unknown, problemas: Problemas): void {
  if (!ehObjeto(bruto)) {
    registrar(problemas, 'SCHEMA', 'camadas', 'as camadas não são um objeto')
    return
  }
  exigirSoChaves(bruto, CAMADAS, 'camadas', problemas)
  for (const camada of CAMADAS) {
    const origem = bruto[camada]
    if (ehObjeto(origem)) validarOrigem(camada, origem, problemas)
    else registrar(problemas, 'SCHEMA', `camadas.${camada}`, 'camada sem origem declarada')
  }
}

function validarCapacidade(
  item: unknown,
  i: number,
  vistas: Set<unknown>,
  problemas: Problemas
): void {
  const caminho = `capacidades[${i}]`
  if (!ehObjeto(item)) {
    registrar(problemas, 'SCHEMA', caminho, 'a capacidade não é um objeto')
    return
  }
  exigirSoChaves(item, CHAVES_DA_CAPACIDADE, caminho, problemas)

  if (!isCapacidadeId(item.id)) {
    registrar(
      problemas,
      'CAPACIDADE_DESCONHECIDA',
      `${caminho}.id`,
      `capacidade ${String(item.id)} não está no registro`
    )
  } else if (vistas.has(item.id)) {
    registrar(
      problemas,
      'CAPACIDADE_DUPLICADA',
      `${caminho}.id`,
      `${item.id} aparece mais de uma vez`
    )
  }
  vistas.add(item.id)

  if (typeof item.obrigatoria !== 'boolean') {
    registrar(problemas, 'SCHEMA', `${caminho}.obrigatoria`, 'obrigatoria precisa ser booleano')
  }
  // `Array.from` e não `.every` direto: `every` pula os buracos de um array esparso.
  const camadas = Array.isArray(item.camadas) ? Array.from(item.camadas as unknown[]) : []
  if (camadas.length === 0 || !camadas.every(isCamada)) {
    registrar(
      problemas,
      'CAMADA_INVALIDA',
      `${caminho}.camadas`,
      'ao menos uma camada válida (orquestrador, executor ou especialista)'
    )
  }
}

function validarCapacidades(bruto: unknown, problemas: Problemas): void {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    registrar(problemas, 'SCHEMA', 'capacidades', 'sem capacidades')
    return
  }
  const vistas = new Set<unknown>()
  for (const [i, item] of Array.from(bruto as unknown[]).entries()) {
    validarCapacidade(item, i, vistas, problemas)
  }
}

function validarAcesso(bruto: unknown, problemas: Problemas): void {
  if (!ehObjeto(bruto)) {
    registrar(problemas, 'SCHEMA', 'acessoPorFuncao', 'não é um objeto')
    return
  }
  exigirSoChaves(bruto, FUNCOES, 'acessoPorFuncao', problemas)

  for (const funcao of FUNCOES) {
    const acesso = bruto[funcao]
    const caminho = `acessoPorFuncao.${funcao}`
    if (!ehObjeto(acesso)) {
      registrar(problemas, 'SCHEMA', caminho, 'escrita, git e github obrigatórios')
      continue
    }
    exigirSoChaves(acesso, CHAVES_DO_ACESSO, caminho, problemas)
    if (CHAVES_DO_ACESSO.some((c) => typeof acesso[c] !== 'boolean')) {
      registrar(problemas, 'SCHEMA', caminho, 'escrita, git e github obrigatórios')
      continue
    }
    if (acesso.git === true || acesso.github === true) {
      registrar(
        problemas,
        'PERMISSAO_GIT_GITHUB',
        caminho,
        'nenhum agente tem Git ou GitHub; quem commita e integra é o kernel'
      )
    }
    if (acesso.escrita === true && !FUNCOES_QUE_ESCREVEM.includes(funcao)) {
      registrar(
        problemas,
        'ACESSO_SUPERIOR_A_FUNCAO',
        caminho,
        `a função ${funcao} só lê; escrita é de escritor e integrador`
      )
    }
  }
}

function camadaDoPapel(papel: unknown, caminho: string, problemas: Problemas): Camada | undefined {
  if (!ehObjeto(papel)) {
    registrar(problemas, 'CAMADA_INVALIDA', `${caminho}.camada`, 'obrigatória')
    return undefined
  }
  exigirSoChaves(papel, CHAVES_DA_CAMADA_DO_PAPEL, caminho, problemas)
  if (isCamada(papel.camada)) return papel.camada
  registrar(problemas, 'CAMADA_INVALIDA', `${caminho}.camada`, 'inválida')
  return undefined
}

function validarContagemDeEscritores(
  escritores: unknown,
  opcoes: OpcoesDeValidacao,
  problemas: Problemas
): number | undefined {
  if (!ehInteiroAte(escritores, Number.MAX_SAFE_INTEGER)) {
    registrar(problemas, 'SCHEMA', 'escritores', 'inteiro ≥ 1')
    return undefined
  }
  if (escritores > MAX_ESCRITORES) {
    registrar(
      problemas,
      'ESCRITORES_EXCEDIDOS',
      'escritores',
      `${escritores} escritores; o teto é ${MAX_ESCRITORES}`
    )
  } else if (escritores === 2 && opcoes.multiEscritor !== true) {
    registrar(
      problemas,
      'MULTI_ESCRITOR_DESLIGADO',
      'escritores',
      'dois escritores ficam desligados até o MVP-028 (ADR-006, decisão 16)'
    )
  }
  return escritores
}

function validarEscritores(
  bruto: Record<string, unknown>,
  opcoes: OpcoesDeValidacao,
  problemas: Problemas
): void {
  const escritores = validarContagemDeEscritores(bruto.escritores, opcoes, problemas)
  const camadaDoRevisor = camadaDoPapel(bruto.revisor, 'revisor', problemas)
  if (escritores === undefined) return

  const { integrador } = bruto
  if (escritores >= 2 && integrador === undefined) {
    registrar(
      problemas,
      'INTEGRADOR_AUSENTE',
      'integrador',
      'com mais de um escritor, alguém precisa integrar'
    )
    return
  }
  if (integrador === undefined) return

  if (escritores === 1) {
    registrar(
      problemas,
      'INTEGRADOR_SEM_SEGUNDO_ESCRITOR',
      'integrador',
      'integrador só existe com dois escritores'
    )
  }
  const camadaDoIntegrador = camadaDoPapel(integrador, 'integrador', problemas)
  if (camadaDoIntegrador !== undefined && camadaDoIntegrador === camadaDoRevisor) {
    registrar(
      problemas,
      'INTEGRADOR_NA_CAMADA_DO_REVISOR',
      'integrador.camada',
      `quem integra não revisa o próprio resultado; ambos em ${camadaDoIntegrador}`
    )
  }
}

function validarAprovacoes(bruto: unknown, problemas: Problemas): void {
  const lista: readonly unknown[] = Array.isArray(bruto) ? Array.from(bruto as unknown[]) : []
  if (!Array.isArray(bruto)) registrar(problemas, 'SCHEMA', 'aprovacoes', 'precisa ser uma lista')

  for (const acao of lista) {
    if (!(ACOES_COM_APROVACAO as readonly unknown[]).includes(acao)) {
      registrar(
        problemas,
        'APROVACAO_DESCONHECIDA',
        'aprovacoes',
        `a ação ${String(acao)} não existe`
      )
    }
  }
  for (const acao of ACOES_COM_APROVACAO) {
    if (!lista.includes(acao)) {
      registrar(problemas, 'APROVACAO_AUSENTE', 'aprovacoes', `a ação ${acao} precisa esperar o PI`)
    }
  }
}

function validarLimites(bruto: unknown, problemas: Problemas): void {
  if (!ehObjeto(bruto)) {
    registrar(problemas, 'LIMITE_INVALIDO', 'limites', 'não é um objeto')
    return
  }
  exigirSoChaves(bruto, CHAVES_DOS_LIMITES, 'limites', problemas)
  for (const campo of CHAVES_DOS_LIMITES) {
    const teto = TETO_DO_LIMITE[campo]
    if (!ehInteiroAte(bruto[campo], teto)) {
      registrar(problemas, 'LIMITE_INVALIDO', `limites.${campo}`, `inteiro entre 1 e ${teto}`)
    }
  }
}

function validarCabecalho(bruto: Record<string, unknown>, problemas: Problemas): void {
  if (bruto.schema !== VERSAO_DO_SCHEMA_DO_PERFIL) {
    registrar(
      problemas,
      'VERSAO_DE_SCHEMA_DESCONHECIDA',
      'schema',
      `esperado ${VERSAO_DO_SCHEMA_DO_PERFIL}, veio ${String(bruto.schema)}`
    )
  }
  if (typeof bruto.tipoDeFatia !== 'string' || !TIPO_DE_FATIA.test(bruto.tipoDeFatia)) {
    registrar(problemas, 'TIPO_INVALIDO', 'tipoDeFatia', 'kebab-case não vazio')
  }
  if (!ehInteiroAte(bruto.versao, Number.MAX_SAFE_INTEGER)) {
    registrar(problemas, 'VERSAO_INVALIDA', 'versao', 'inteiro ≥ 1')
  }
}

/**
 * Monta o perfil **só com o que foi validado**. Não clona a entrada: chave que o schema não
 * conhece já foi recusada, mas copiar campo a campo é o que garante que nada além do contrato
 * chega ao consumidor — e que um valor sem clone (função, símbolo) não derruba a validação.
 */
function montarPerfil(b: Record<string, unknown>): PerfilDeSquad {
  const camadas = b.camadas as Record<Camada, Record<string, unknown>>
  const acesso = b.acessoPorFuncao as Record<Funcao, AcessoDaFuncao>
  const limites = b.limites as Record<(typeof CHAVES_DOS_LIMITES)[number], number>
  const origemDe = (o: Record<string, unknown>): OrigemDaCamada =>
    o.origem === 'fase'
      ? { origem: 'fase' }
      : {
          origem: 'modelo',
          provider: o.provider as AiProvider,
          modelo: o.modelo as string,
          ...(o.validador === 'e1' ? { validador: 'e1' as const } : {}),
          ...(typeof o.numCtx === 'number' ? { numCtx: o.numCtx } : {})
        }

  return congelar({
    schema: VERSAO_DO_SCHEMA_DO_PERFIL,
    tipoDeFatia: b.tipoDeFatia as string,
    versao: b.versao as number,
    camadas: {
      orquestrador: origemDe(camadas.orquestrador),
      executor: origemDe(camadas.executor),
      especialista: origemDe(camadas.especialista)
    },
    capacidades: (b.capacidades as Record<string, unknown>[]).map((c) => ({
      id: c.id as CapacidadeId,
      obrigatoria: c.obrigatoria as boolean,
      camadas: Array.from(c.camadas as Camada[])
    })),
    escritores: b.escritores as 1 | 2,
    ...(ehObjeto(b.integrador) ? { integrador: { camada: b.integrador.camada as Camada } } : {}),
    revisor: { camada: (b.revisor as { camada: Camada }).camada },
    acessoPorFuncao: Object.fromEntries(
      FUNCOES.map((f) => [
        f,
        { escrita: acesso[f].escrita, git: acesso[f].git, github: acesso[f].github }
      ])
    ) as Record<Funcao, AcessoDaFuncao>,
    aprovacoes: Array.from(b.aprovacoes as AcaoComAprovacao[]),
    limites: {
      maxTarefasMinimo: limites.maxTarefasMinimo,
      maxTokensEntradaPorTarefa: limites.maxTokensEntradaPorTarefa,
      maxTokensSaidaPorTarefa: limites.maxTokensSaidaPorTarefa,
      maxTurnosPorTarefa: limites.maxTurnosPorTarefa,
      maxMinutosPorTarefa: limites.maxMinutosPorTarefa
    }
  })
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

  const problemas: Problemas = []
  exigirSoChaves(bruto, CHAVES_DO_PERFIL, '', problemas)
  validarCabecalho(bruto, problemas)
  validarCamadas(bruto.camadas, problemas)
  validarCapacidades(bruto.capacidades, problemas)
  validarEscritores(bruto, opcoes, problemas)
  validarAcesso(bruto.acessoPorFuncao, problemas)
  validarAprovacoes(bruto.aprovacoes, problemas)
  validarLimites(bruto.limites, problemas)

  if (problemas.length > 0) return { ok: false, problemas }
  return { ok: true, perfil: montarPerfil(bruto) }
}

export interface LimitesCalculados {
  /** Quantos slots do pool o Squad ocupa: um por escritor (ADR-006, decisão 5). */
  readonly slots: number
  readonly maxTarefas: number
}

/**
 * Os limites que valem **antes** de instanciar o Squad (critério 4).
 *
 * `criteriosDaSpec` inválido **lança**: `Math.max(piso, NaN)` devolve `NaN`, e um gate que compara
 * `usd > limite` com `NaN` dá `false` — deixaria passar exatamente a conta que não existe.
 */
export function limitesDoPerfil(perfil: PerfilDeSquad, criteriosDaSpec: number): LimitesCalculados {
  if (!Number.isSafeInteger(criteriosDaSpec) || criteriosDaSpec < 0) {
    throw new RangeError(`número de critérios inválido: ${String(criteriosDaSpec)}`)
  }
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
    maxTokensSaidaPorTarefa: 8_000,
    maxTurnosPorTarefa: 30,
    maxMinutosPorTarefa: 45
  }
})
