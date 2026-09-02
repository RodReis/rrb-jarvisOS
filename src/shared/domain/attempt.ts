/**
 * O domínio de uma tentativa de construção (SPEC-Entrega-04).
 *
 * Duas decisões puras, sem I/O: **por que a validação falhou** (classificação) e **ainda cabe
 * tentar de novo** (limite). Puro de propósito — são exatamente as duas decisões que a spec
 * exige serem determinísticas e testáveis sem container, sem processo, sem banco.
 */

/**
 * Por que uma tentativa falhou.
 *
 * `corrigivel`: teste/lint/type/build, revisão, CI ou conflito solucionável dentro da SPEC —
 * candidato a recuperação. `pi`: mudança de produto, contradição estrutural ou escolha
 * irreversível material — **nunca inferido daqui**, só a camada de orquestração o declara
 * (requisito de produto ausente não é inferido, spec § Regras). `externo`: auth, quota, serviço
 * ou infraestrutura sem alternativa autorizada — não adianta recuperar tentando de novo com o
 * mesmo código. `risco-usuario`: potencial de sobrescrever trabalho existente.
 */
export const CLASSIFICACOES_DE_FALHA = ['corrigivel', 'pi', 'externo', 'risco-usuario'] as const
export type ClassificacaoDeFalha = (typeof CLASSIFICACOES_DE_FALHA)[number]

/** Uma tentativa de construção, dentro do run. `numero` é 1 (inicial), 2 ou 3 (recuperações). */
export interface Tentativa {
  readonly numero: number
  readonly runId: string
  readonly classificacao?: ClassificacaoDeFalha
  readonly diagnostico?: string
}

/**
 * Classifica a falha pela saída da validação. **Default é `corrigivel`, nunca `pi`**: inferir
 * mudança de produto de um stderr seria exatamente o "requisito ausente inferido" que a spec
 * proíbe — `pi` só entra por decisão explícita de quem orquestra, lendo o motivo real da recusa.
 *
 * Padrões de rede/auth/quota são `externo` porque recuperar tentando de novo com o mesmo código
 * não muda o desfecho — o problema não está no código gerado.
 */
export function classificarFalha(saida: {
  readonly stdout: string
  readonly stderr: string
}): ClassificacaoDeFalha {
  const texto = `${saida.stdout}\n${saida.stderr}`.toLowerCase()

  const padroesExternos = [
    'etimedout',
    'econnrefused',
    'econnreset',
    '401 unauthorized',
    '403 forbidden',
    'rate limit',
    'quota exceeded',
    'invalid api key'
  ]

  if (padroesExternos.some((padrao) => texto.includes(padrao))) return 'externo'

  return 'corrigivel'
}

/** Máximo de três tentativas totais: inicial + duas recuperações (critério 2, spec § Regras). */
const MAXIMO_DE_TENTATIVAS = 3

/** Ainda cabe recuperar depois desta tentativa? `false` na terceira — não há quarta. */
export function proximaTentativaPermitida(tentativaAtual: number): boolean {
  return tentativaAtual < MAXIMO_DE_TENTATIVAS
}
