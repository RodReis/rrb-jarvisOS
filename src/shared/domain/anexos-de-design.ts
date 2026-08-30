/**
 * Os anexos de design do PI (SPEC-Planejamento-05).
 *
 * A pergunta que este arquivo responde: **o PI anexou o que a arquitetura precisa?**
 *
 * O gate desta fatia não é sobre conteúdo — é sobre **um ato**. A spec § Gate de anexos exige
 * três coisas presentes (`DESIGN-SYSTEM.md`, ao menos um protótipo `.html` cobrindo as jornadas
 * críticas, e os assets referenciados), e a decisão do PI (2026-08-29) diz *como* elas passam a
 * contar: **seletor de arquivos que copia para dentro do projeto e hasheia no instante do
 * anexo**. Não há varredura de pasta convencionada.
 *
 * **É por isso que `Anexo` carrega `anexadoEm` e `hash` e não tem como ser construído sem os
 * dois.** A alternativa — detectar arquivos largados no diretório — tornaria ambíguo o instante
 * em que o anexo passa a contar para o gate, que é justamente o que este gate precisa ter
 * preciso. Um arquivo que apareceu no disco por fora não satisfaz o gate (critério 7), e a forma
 * do tipo é o que impede o serviço de fingir que satisfaz: sem o ato, não há linha.
 *
 * **A IA analisa, mas não substitui o anexo** (spec § Gate). Por isso não existe origem "gerado"
 * aqui, pelo mesmo motivo que `AfirmacaoDoPacote` não tem origem "modelo": uma variante que
 * dissesse "o modelo produziu este DESIGN-SYSTEM" faria o gate se satisfazer sozinho, e o ato do
 * PI — a coisa inteira que o gate mede — viraria opcional.
 *
 * **O que este arquivo não faz:** não copia arquivo, não calcula hash de disco, não abre
 * protótipo (isso é I/O e Chromium, mora no main) e não decide quando a arquitetura pode sair —
 * só descreve a forma dos anexos e as regras puras sobre eles.
 *
 * Mora em `src/shared/domain` porque a tela mostra o gate e o que falta, e o contrato precisa ser
 * verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'

/**
 * Os tipos de anexo que o gate conhece. Enum fechado, e não extensão livre: cada um satisfaz uma
 * parte distinta do gate e tem regra própria de validação. Um quarto tipo é mudança de contrato,
 * nunca um arquivo que entra porque alguém passou outro nome.
 */
export const TIPOS_DE_ANEXO = ['design-system', 'prototipo', 'asset'] as const

export type TipoDeAnexo = (typeof TIPOS_DE_ANEXO)[number]

/**
 * Onde cada tipo de anexo é copiado, relativo à raiz do projeto.
 *
 * Constantes e não vindas do chamador, pela mesma razão do `ARQUIVO_DO_DOCUMENTO` da M8-F04: não
 * há entrada que direcione a escrita para fora do projeto porque não há entrada.
 */
export const DIRETORIO_DO_ANEXO: Readonly<Record<TipoDeAnexo, string>> = {
  'design-system': 'docs',
  prototipo: 'docs/prototipos',
  asset: 'docs/prototipos/assets'
}

/**
 * O nome fixo do `DESIGN-SYSTEM.md`.
 *
 * O gate pede *este* documento, não "algum markdown de design": o nome é o que a arquitetura vai
 * procurar, e aceitar qualquer nome faria o gate passar com um arquivo que ninguém lê depois.
 */
export const ARQUIVO_DESIGN_SYSTEM = 'DESIGN-SYSTEM.md'

/**
 * As extensões aceitas por tipo.
 *
 * `prototipo` aceita só `.html` porque é o que o gate mede — a spec pede protótipo HTML servido
 * localmente, e um `.pdf` não tem jornada navegável para validar.
 */
export const EXTENSOES_DO_ANEXO: Readonly<Record<TipoDeAnexo, readonly string[]>> = {
  'design-system': ['.md'],
  prototipo: ['.html'],
  asset: ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.css', '.js', '.woff', '.woff2']
}

/**
 * Um anexo, como ele existe depois do ato.
 *
 * `hash` é do conteúdo **copiado**, calculado no instante do anexo. `origem` guarda o caminho de
 * onde veio, e é dado de auditoria, não ponteiro: o projeto guarda a cópia, e o original externo
 * pode sumir sem que o anexo deixe de valer (decisão cravada — "o seletor copia, não referencia").
 */
export interface Anexo {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly tipo: TipoDeAnexo
  /** Caminho relativo à raiz do projeto — onde a cópia ficou. */
  readonly caminho: string
  /** O caminho externo escolhido no seletor. Auditoria: de onde o PI tirou isto. */
  readonly origem: string
  readonly hash: string
  readonly bytes: number
  /** O instante do ato. É ele que faz o anexo contar para o gate (critério 7). */
  readonly anexadoEm: string
}

/**
 * Por que anexar não deu certo. Enum fechado, como `PacoteReason`: a tela decide o que mostrar
 * a partir dele.
 */
export const ANEXO_REASONS = [
  'anexado',
  'projeto-inexistente',
  /** O arquivo escolhido não existe ou não pôde ser lido. */
  'origem-ilegivel',
  /** Extensão fora do que o tipo aceita. */
  'tipo-incompativel',
  /** A cópia falhou — disco cheio, permissão. */
  'falha-de-copia'
] as const

export type AnexoReason = (typeof ANEXO_REASONS)[number]

export interface AnexoOutcome {
  readonly reason: AnexoReason
  readonly anexo?: Anexo
  readonly mensagem: string
}

/**
 * O que falta para o gate abrir.
 *
 * Devolve a lista, e não um booleano, pela mesma razão de `pendenciasDoPrd`: "complete os
 * anexos" manda o PI procurar sozinho o que já entregou.
 */
export const PENDENCIAS_DO_GATE = ['design-system', 'prototipo'] as const

export type PendenciaDoGate = (typeof PENDENCIAS_DO_GATE)[number]

/**
 * Quais exigências do gate ainda não foram satisfeitas.
 *
 * **`asset` não entra na lista.** Um projeto cujos protótipos não referenciam imagem nenhuma
 * está completo sem nenhum asset — exigir um faria o gate barrar por algo que a spec não pede.
 * O que a spec pede sobre assets é outra coisa: que os **referenciados** existam, e isso é
 * validação de protótipo (`analisarPrototipo`), não contagem de anexos.
 */
export function pendenciasDoGate(anexos: readonly Anexo[]): readonly PendenciaDoGate[] {
  const tipos = new Set(anexos.map((a) => a.tipo))
  return PENDENCIAS_DO_GATE.filter((p) => !tipos.has(p))
}

/** O gate abriu? Açúcar sobre `pendenciasDoGate`, para quem só precisa do sim/não. */
export function gateDeAnexosAberto(anexos: readonly Anexo[]): boolean {
  return pendenciasDoGate(anexos).length === 0
}

/**
 * A extensão do caminho combina com o tipo declarado?
 *
 * Fronteira: o caminho vem do seletor nativo, mas o tipo vem do renderer, e o main não confia
 * no renderer.
 */
export function extensaoCompativel(tipo: TipoDeAnexo, caminho: string): boolean {
  const ponto = caminho.lastIndexOf('.')
  if (ponto <= 0) return false
  return EXTENSOES_DO_ANEXO[tipo].includes(caminho.slice(ponto).toLowerCase())
}

/** Type guard de fronteira: o IPC recebe `unknown`. */
export function isTipoDeAnexo(valor: unknown): valor is TipoDeAnexo {
  return typeof valor === 'string' && (TIPOS_DE_ANEXO as readonly string[]).includes(valor)
}
