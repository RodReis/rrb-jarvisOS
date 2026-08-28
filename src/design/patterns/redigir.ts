/**
 * Redaction de **texto** para exibição (SPEC-DesignSystem-04b, critério 3; PRD §15).
 *
 * **Por que não reusar o `redact()` de `src/shared/contracts/logging-redaction.ts`:** aquele
 * opera sobre objeto estruturado — apaga o *valor* de chaves sensíveis (`token`, `apiKey`) em
 * qualquer profundidade. Ele resolve o problema de *"não gravar o campo secreto"*.
 *
 * Aqui o problema é outro: o `LogViewer` recebe **linha de log já formatada**, e um
 * `Authorization: Bearer sk-abc…` no meio de uma mensagem de erro é uma string, não uma chave de
 * objeto — passa intacto por aquela função. São camadas complementares, não duplicação.
 *
 * E há a fronteira: o DS não importa `@shared` (regra da F01). Isso não é obstáculo burocrático
 * a contornar — é o motivo de esta função ser **pura e sem contexto de domínio**: ela não sabe o
 * que é um workflow nem um provider, só reconhece formas de segredo em texto.
 *
 * **Limite honesto:** isto é uma rede de segurança de *exibição*, não a garantia primária. O que
 * impede segredo de existir no log é o `redact()` do main, na escrita. Uma regex nunca cobre todo
 * formato possível de credencial — por isso a UI redige o que reconhece **e** o runtime nunca
 * escreve o que não deveria. Duas camadas porque uma sozinha falha em silêncio.
 */

/** Marcador visível — igual ao do logging, para que os dois lados leiam o mesmo. */
export const REDIGIDO = '[redigido]'

/**
 * Padrões reconhecidos, do mais específico para o mais genérico.
 *
 * A ordem importa: `Authorization: Bearer xyz` casa com a regra de cabeçalho **antes** de a regra
 * de token solto ver o `xyz`. Invertida, o cabeçalho ficaria meio-redigido, o que é pior que não
 * redigir — sugere que a limpeza aconteceu.
 */
const PADROES: readonly { readonly nome: string; readonly regex: RegExp }[] = [
  // `Authorization: Bearer <algo>` e variantes com aspas — o cabeçalho inteiro perde o valor.
  //
  // O esquema (`Bearer`, `Basic`, `Token`) entra **dentro** do trecho consumido: sem isso a
  // regra parava em `Bearer` e deixava o token logo depois, produzindo
  // `Authorization: [redigido] xyz98765` — pior que não redigir, porque parece limpo. Foi o
  // teste "mais de um segredo na mesma linha" que pegou.
  {
    nome: 'authorization',
    regex:
      /\b(authorization|proxy-authorization)\b(\s*[:=]\s*)(["']?)(?:(?:bearer|basic|token|digest)\s+)?[^\s"',;}]+\3/gi
  },
  // `Bearer <token>` solto, sem o nome do cabeçalho.
  { nome: 'bearer', regex: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi },
  // Chaves com prefixo conhecido: OpenAI (`sk-`), Anthropic (`sk-ant-`), Supabase publicável e
  // secreta, GitHub (`ghp_`/`gho_`), Google (`AIza`). São formatos públicos e estáveis.
  {
    nome: 'prefixo-conhecido',
    regex:
      /\b(sk-[A-Za-z0-9_-]{8,}|sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,})/g
  },
  // Campo nomeado em JSON, query string ou log: `"apiKey":"x"`, `token=x`, `password: x`.
  {
    nome: 'campo-sensivel',
    regex:
      /\b(api[_-]?key|secret|password|passwd|senha|token|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b(["']?\s*[:=]\s*)(["']?)[^\s"',;}&]+\3/gi
  },
  // JWT — três blocos base64url separados por ponto. Reconhecível pela forma, sem nome de campo.
  { nome: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g }
]

/**
 * Redige segredos reconhecíveis numa linha de texto.
 *
 * Preserva o **nome** do campo e apaga só o valor: `apiKey=[redigido]` diz ao operador *o que*
 * foi removido, e é o que torna o log ainda útil para diagnóstico. Apagar a linha inteira seria
 * mais seguro no papel e inútil na prática — quem depura precisa saber que houve uma apiKey ali.
 */
export function redigirTexto(texto: string): string {
  let saida = texto

  for (const { nome, regex } of PADROES) {
    saida = saida.replace(regex, (_casado: string, ...grupos: unknown[]) => {
      if (nome === 'authorization' || nome === 'campo-sensivel') {
        // Grupos 1 e 2 são o nome do campo e o separador; o valor é o que se perde.
        const campo = String(grupos[0])
        const separador = String(grupos[1])
        return `${campo}${separador}${REDIGIDO}`
      }
      // Token solto, prefixo conhecido ou JWT: não há nome a preservar.
      return REDIGIDO
    })
  }

  return saida
}

/** Aplica a redaction a uma lista de linhas — o formato que o `LogViewer` consome. */
export function redigirLinhas(linhas: readonly string[]): string[] {
  return linhas.map(redigirTexto)
}
