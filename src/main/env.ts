import { readFileSync } from 'node:fs'

/**
 * Carga do arquivo `.env` para `process.env` (FIX #43).
 *
 * O `.env.example` promete que preencher o arquivo habilita o login (SPEC-Fundacao-03), mas
 * nada no projeto lia o arquivo: `readSupabaseConfig()` consulta `process.env` cru. Com as
 * variáveis só no disco, o app degradava para "credenciais ausentes" — o mesmo estado de quem
 * nunca configurou nada. Quem clonasse o repo e seguisse o `.env.example` batia nisso sem
 * nenhum sinal de que o arquivo fora ignorado.
 *
 * Implementado à mão em vez de instalar `dotenv`: são ~20 linhas para o formato que este
 * projeto usa, contra uma dependência de runtime no processo main. O parser cobre o que o
 * `.env.example` contém — comentários, linhas vazias, aspas opcionais — e nada além. Se o
 * formato crescer (multilinha, interpolação `${}`), a troca por `dotenv` é o caminho; inventar
 * um parser completo aqui seria resolver problema que não temos.
 */

/**
 * Interpreta o conteúdo de um `.env`.
 *
 * Exportado para o teste afirmar sobre o parsing sem tocar disco — e porque separar "ler o
 * arquivo" de "entender o texto" mantém a parte com regra testável sem `fs`.
 */
export function parseEnv(conteudo: string): Record<string, string> {
  const saida: Record<string, string> = {}

  for (const linha of conteudo.split(/\r?\n/)) {
    const texto = linha.trim()
    // Comentário e linha vazia são ruído; `#` só conta no início da linha, porque um `#` no
    // meio de um valor é caractere legítimo (aparece em chave e em cor hex).
    if (texto === '' || texto.startsWith('#')) continue

    const igual = texto.indexOf('=')
    if (igual === -1) continue

    const chave = texto.slice(0, igual).trim()
    if (chave === '') continue

    let valor = texto.slice(igual + 1).trim()
    // Aspas envolventes são delimitador, não conteúdo: `KEY="valor"` vale `valor`. Só quando
    // abrem **e** fecham — uma aspa solta é parte do valor.
    const aspas = valor.startsWith('"') && valor.endsWith('"')
    const apostrofos = valor.startsWith("'") && valor.endsWith("'")
    if (valor.length >= 2 && (aspas || apostrofos)) valor = valor.slice(1, -1)

    saida[chave] = valor
  }

  return saida
}

/**
 * Aplica o `.env` a `process.env`, sem sobrescrever o que já existe.
 *
 * A precedência é deliberada: **ambiente vence arquivo**. É o que permite ao CI injetar
 * valores próprios e a quem desenvolve sobrepor uma variável pontual sem editar o arquivo. O
 * inverso — arquivo vencendo — faria um `.env` esquecido no disco silenciosamente derrubar a
 * configuração do CI, que é exatamente o tipo de surpresa que custa uma tarde.
 *
 * Arquivo ausente ou ilegível **não** é erro: rodar sem `.env` é um caminho suportado (o app
 * sobe com o usuário local e só o login fica indisponível). Derrubar o boot aqui contrariaria
 * a degradação graciosa que o `.env.example` documenta.
 *
 * @returns os nomes das chaves aplicadas — nunca os valores, que são credenciais.
 */
export function carregarEnv(
  caminho: string,
  env: NodeJS.ProcessEnv = process.env
): readonly string[] {
  let conteudo: string
  try {
    conteudo = readFileSync(caminho, 'utf8')
  } catch {
    return []
  }

  const aplicadas: string[] = []
  for (const [chave, valor] of Object.entries(parseEnv(conteudo))) {
    if (env[chave] !== undefined) continue
    env[chave] = valor
    aplicadas.push(chave)
  }

  return aplicadas
}
