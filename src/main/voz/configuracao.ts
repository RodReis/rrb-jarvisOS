/**
 * Modelo e idioma da transcrição, configuráveis (SPEC-Voz-01, critério 6).
 *
 * ## Por que um arquivo próprio, e não o `UserProfile`
 *
 * As preferências do usuário (tema, idioma da UI, cores) vivem no `UserProfile`, que é uma
 * entidade fechada com migration por campo. Pôr modelo e idioma da voz ali custaria uma
 * migration, a entidade compartilhada, o `PreferencesService`, a CHOICE e os testes dos três —
 * para dois valores que só a voz lê e só a voz escreve.
 *
 * O arquivo próprio no `userData` também é o que faz o critério 6 valer de graça: a leitura é
 * **por chamada**, então trocar em Settings vale na transcrição seguinte sem restart, porque não
 * há estado em memória para invalidar.
 *
 * ## Ausente e inválido são a mesma coisa: o default
 *
 * Primeira execução não tem arquivo; JSON corrompido não tem valor utilizável. Nos dois casos a
 * resposta certa é a mesma — `small` em pt-BR, que é o que a spec cravou — porque recusar
 * transcrever por causa de um arquivo de configuração ilegível puniria o usuário por um estado
 * que ele não criou e não sabe consertar.
 */

import { MODELOS_DA_VOZ, type ConfiguracaoDaVoz, type ModeloDaVoz } from '@shared/domain/voz'

export type { ConfiguracaoDaVoz, ModeloDaVoz }
export { MODELOS_DA_VOZ }

/** O default cravado pela spec: `small`, pt-BR fixo. */
export const CONFIGURACAO_PADRAO: ConfiguracaoDaVoz = { modelo: 'small', idioma: 'pt' }

/** Onde ela mora, relativo ao `userData`. */
export const CAMINHO_DA_CONFIGURACAO = 'voz/configuracao.json'

function ehModelo(valor: unknown): valor is ModeloDaVoz {
  return MODELOS_DA_VOZ.includes(valor as ModeloDaVoz)
}

/**
 * Lê a configuração de um texto JSON, caindo no default a cada campo que não sirva.
 *
 * Campo a campo, e não tudo-ou-nada: um `idioma` inválido não deveria descartar um `modelo`
 * válido que está ao lado dele.
 */
export function lerConfiguracao(texto: string | undefined): ConfiguracaoDaVoz {
  if (texto === undefined) return CONFIGURACAO_PADRAO

  let bruto: unknown
  try {
    bruto = JSON.parse(texto)
  } catch {
    return CONFIGURACAO_PADRAO
  }

  if (typeof bruto !== 'object' || bruto === null) return CONFIGURACAO_PADRAO

  const objeto = bruto as Record<string, unknown>
  const idioma = objeto.idioma

  return {
    modelo: ehModelo(objeto.modelo) ? objeto.modelo : CONFIGURACAO_PADRAO.modelo,
    idioma: typeof idioma === 'string' && idioma.trim() !== '' ? idioma : CONFIGURACAO_PADRAO.idioma
  }
}

/** O texto a gravar. Passa pela mesma normalização da leitura — o disco nunca recebe lixo. */
export function escreverConfiguracao(pedida: Partial<ConfiguracaoDaVoz>): string {
  const normalizada: ConfiguracaoDaVoz = {
    modelo: ehModelo(pedida.modelo) ? pedida.modelo : CONFIGURACAO_PADRAO.modelo,
    idioma:
      typeof pedida.idioma === 'string' && pedida.idioma.trim() !== ''
        ? pedida.idioma
        : CONFIGURACAO_PADRAO.idioma
  }

  return JSON.stringify(normalizada, null, 2)
}
