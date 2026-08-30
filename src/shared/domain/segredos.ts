/**
 * Detecção de segredo em conteúdo destinado ao contexto (SPEC-Planejamento-02, critério 7).
 *
 * **Isto não é a redaction do log** (`logging-redaction.ts`), e a diferença importa. Aquela
 * limpa um objeto estruturado: sabe que a chave se chama `apiKey` e apaga o valor. Aqui não há
 * chave — há o **texto de um arquivo** que vai ser mandado a um modelo, e ninguém rotulou nada.
 * A pergunta muda de "este campo é sensível?" para "este arquivo carrega credencial?".
 *
 * A postura, por isso, também muda: **recusar, não redigir**. Um `.env` com a chave mascarada
 * continua sendo um `.env` no prompt, e mascarar ensinaria que existe uma forma segura de
 * mandá-lo. O critério 7 diz que segredo *não entra* — então o pack não é montado, e quem
 * escolheu o arquivo é informado de qual foi (§ `ContextPackOutcome.caminhosComSegredo`).
 *
 * **Fail closed, com honestidade sobre o alcance.** Um detector por padrão pega o formato
 * conhecido (chave da Anthropic, token do GitHub, bloco de chave privada) e o arquivo cujo nome
 * já o anuncia. Ele não prova ausência de segredo — nenhum detector prova. O que ele faz é
 * fechar o caminho comum, e é isso que a spec pede que exista.
 *
 * Mora em `src/shared/domain` porque é regra pura, sem I/O — e porque o renderer pode avisar
 * antes de o usuário anexar, sem depender de o main ser o único a checar.
 */

/**
 * Arquivos que **nunca** entram no contexto, pelo nome.
 *
 * A checagem por nome vem antes da checagem por conteúdo porque é a única que funciona para o
 * arquivo cujo segredo não casa nenhum padrão: um `.env` com `SENHA_DO_BANCO=abacaxi` não tem
 * formato reconhecível, e só o nome denuncia o que ele é.
 *
 * Padrões e não lista literal: `.env.local`, `.env.production` e companhia são o caso comum, e
 * enumerá-los daria uma lista sempre desatualizada.
 */
export const NOMES_PROIBIDOS: readonly RegExp[] = [
  /(^|[/\\])\.env(\.|$)/i,
  /(^|[/\\])\.npmrc$/i,
  /(^|[/\\])\.netrc$/i,
  /(^|[/\\])id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|pfx|p12|keystore|jks)$/i,
  /(^|[/\\])credentials?\.(json|ya?ml|ini)$/i,
  /(^|[/\\])secrets?\.(json|ya?ml|ini|env)$/i
]

/**
 * Formatos de segredo reconhecíveis dentro do texto.
 *
 * Cada padrão existe porque o formato é **autoidentificável** — prefixo fixo e comprimento
 * conhecido. Não há regra genérica de "string longa e aleatória" de propósito: ela acusaria
 * todo hash, todo UUID e toda chave pública do repositório, e um detector que grita em tudo é
 * um detector que se aprende a ignorar.
 */
export const PADROES_DE_SEGREDO: readonly RegExp[] = [
  // Chave da Anthropic e da OpenAI — prefixo fixo, corpo longo.
  /\bsk-[A-Za-z0-9_-]{20,}/,
  // Tokens do GitHub (clássico, fine-grained, OAuth, app, refresh).
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  // Chave do Google/Gemini.
  /\bAIza[0-9A-Za-z_-]{30,}/,
  // Access key da AWS.
  /\bAKIA[0-9A-Z]{16}\b/,
  // Bloco de chave privada, de qualquer algoritmo.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Atribuição explícita de segredo com valor não-vazio e não-placeholder.
  //
  // O nome pode vir **prefixado** (`DATABASE_PASSWORD`, `MY_API_KEY`), então a âncora é
  // "início de linha ou separador", não `\b`: o `_` de `DATABASE_PASSWORD` é caractere de
  // palavra, e um `\b` antes de `password` nunca casaria ali — foi o que o teste pegou.
  //
  // O `[^\s'"<>]{8,}` no valor evita acusar `API_KEY=` vazio e `TOKEN="<seu-token-aqui>"`,
  // que são documentação, não credencial.
  /(?:^|[\s,{(["'_-])(?:api[_-]?key|secret|password|senha|token|authorization)\s*[:=]\s*['"]?[^\s'"<>]{8,}/im
]

/** O que a detecção encontrou num item. `limpo` é a ausência de achado, não uma prova. */
export interface AchadoDeSegredo {
  readonly caminho: string
  /** `nome` = o caminho denuncia; `conteudo` = um padrão casou no texto. */
  readonly por: 'nome' | 'conteudo'
}

/** `true` quando o caminho é de um arquivo que nunca entra no contexto. */
export function nomeProibido(caminho: string): boolean {
  return NOMES_PROIBIDOS.some((padrao) => padrao.test(caminho))
}

/** `true` quando o texto carrega um formato de segredo reconhecível. */
export function conteudoTemSegredo(texto: string): boolean {
  return PADROES_DE_SEGREDO.some((padrao) => padrao.test(texto))
}

/**
 * Examina um candidato a item de contexto.
 *
 * Devolve o achado ou `undefined`. **Nunca devolve o trecho casado**: o trecho *é* o segredo, e
 * um detector que o repete para explicar-se acabou de copiá-lo para o lugar seguinte —
 * mensagem de erro, log, tela. O caminho basta para o usuário saber o que remover.
 */
export function detectarSegredo(caminho: string, conteudo: string): AchadoDeSegredo | undefined {
  if (nomeProibido(caminho)) return { caminho, por: 'nome' }
  if (conteudoTemSegredo(conteudo)) return { caminho, por: 'conteudo' }
  return undefined
}
