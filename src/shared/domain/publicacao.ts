/**
 * As decisões puras da publicação no GitHub (SPEC-Entrega-01).
 *
 * Módulo separado de `github-automation.ts` de propósito: aquele descreve **o conector** (o que o
 * GitHub sabe fazer), este descreve **a entrega** (como o projeto se projeta no GitHub). O conector
 * é reusável por qualquer consumidor; a derivação da chave abaixo só faz sentido para quem tem
 * projeto, MVP e fatia — e misturá-los faria o conector depender do vocabulário do MVP-009.
 */

import type { BloqueioExterno } from './pacote-estrutural'

/**
 * O prefixo de toda chave externa deste app.
 *
 * Está no marcador que vai ao corpo da issue, e é o que a regra da spec — *"issue semelhante sem
 * marcador idempotente não é adotada silenciosamente"* — usa para distinguir uma issue nossa de uma
 * issue que alguém escreveu à mão com título parecido.
 */
const PREFIXO = 'jarvis'

/**
 * A chave externa de uma issue de **MVP** (o épico).
 *
 * Determinística e derivada de projeto + número, como a spec exige (§ Regras): o mesmo par sempre
 * produz a mesma chave, e é isso que faz `ensureIssue` reusar em vez de duplicar quando a
 * publicação roda de novo depois de um crash (critério 6).
 *
 * **Legível, não hasheada.** Um SHA-256 seria igualmente determinístico e igualmente único, mas o
 * marcador é lido por gente no corpo da issue tanto quanto pelo código: com a chave legível, quem
 * abre a issue no GitHub sabe de que projeto e de que MVP ela é sem consultar o banco. O custo é
 * que o `project_id` fica visível — e ele já é um UUID sem significado externo.
 */
export function chaveDeMvp(projectId: string, numeroDoMvp: number): string {
  return `${PREFIXO}:${projectId}:mvp-${pad(numeroDoMvp)}`
}

/**
 * A chave externa de uma issue de **fatia**.
 *
 * Carrega o MVP **e** a fatia, não só a fatia: M9-F01 e M8-F01 são fatias distintas, e uma chave
 * derivada apenas do número da fatia faria a segunda reusar a issue da primeira — o backlog do
 * MVP-008 apareceria dentro do MVP-009. O segmento `f-` também separa a chave da fatia da chave do
 * MVP de mesmo número, que sem ele colidiriam.
 */
export function chaveDeFatia(
  projectId: string,
  numeroDoMvp: number,
  numeroDaFatia: number
): string {
  return `${chaveDeMvp(projectId, numeroDoMvp)}:f-${pad(numeroDaFatia)}`
}

/**
 * A chave externa do **projeto** — o que identifica o repositório como sendo deste app.
 *
 * Não depende de MVP nem de fatia: o repositório é um por projeto, e amarrá-lo a um MVP faria o
 * segundo MVP procurar um repositório que não existe.
 */
export function chaveDeProjeto(projectId: string): string {
  return `${PREFIXO}:${projectId}:projeto`
}

/** Dois dígitos, para `mvp-09` ordenar junto de `mvp-10` na leitura humana. */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Um rótulo da Convention do **projeto-alvo** (SPEC-Entrega-01, emenda 4).
 *
 * `cor` sem `#`, como a API do GitHub espera.
 */
export interface RotuloDoProjeto {
  readonly nome: string
  readonly cor: string
  readonly descricao?: string
}

/** Onde publicar. `origem` é a URL do repositório — a mesma que o push recebe. */
export interface AlvoDaPublicacao {
  readonly owner: string
  readonly repo: string
  readonly origem: string
  /**
   * Os rótulos a garantir no repositório, vindos da Convention do projeto-alvo (emenda 4).
   *
   * **Nunca os `proplan:` desta base**: eles são a Convention *deste* repositório, e exportá-los
   * imporia o processo do JARVIS a um projeto que não o adotou. Ausente ou vazio, nenhum rótulo é
   * aplicado e o estado vive só no app — que é o que a emenda determina.
   */
  readonly rotulos?: readonly RotuloDoProjeto[]
}

/**
 * Por que a publicação terminou como terminou. Enum fechado: a tela decide o que mostrar a partir
 * dele, e um desfecho novo é mudança de contrato — nunca uma string que apareceu no caminho.
 */
export const PUBLICACAO_REASONS = [
  'publicado',
  'projeto-inexistente',
  'sem-backlog-aprovado',
  'bloqueado'
] as const

export type PublicacaoReason = (typeof PUBLICACAO_REASONS)[number]

export interface PublicacaoOutcome {
  readonly reason: PublicacaoReason
  /**
   * Quantos recursos foram **criados** nesta execução.
   *
   * É o que torna a idempotência observável de fora, e o que o critério 1 mede: uma segunda
   * publicação percorre o mesmo fluxo — `ensure` é a forma de perguntar "já existe?" — mas cria
   * zero. Contar chamadas não serviria: elas acontecem nas duas vezes, e é justamente isso.
   */
  readonly criados: number
  /** O commit confirmado **na origem**, não o que mandamos (critério 2). */
  readonly commitPublicado?: string
  readonly bloqueio?: BloqueioExterno
}

/**
 * O que uma referência externa aponta.
 *
 * Enum fechado: a M9-F02 e a M9-F05 leem por alvo, e um valor novo é mudança de contrato — não
 * uma string que apareceu porque alguém passou outro nome.
 */
export const ALVOS_DE_REF = ['repositorio', 'issue', 'branch'] as const

export type AlvoDeRef = (typeof ALVOS_DE_REF)[number]

/**
 * Uma referência externa persistida (CONVENTION §4; SPEC-Entrega-01, emenda 6).
 *
 * É a saída desta fatia que as próximas consomem: a M9-F05 precisa do número da issue para
 * escrever `refs #N`, e a reconciliação da M9-F02 precisa dos SHAs. Sem isto, cada fatia
 * redescobriria na origem o que esta acabou de publicar — uma chamada de rede a mais por fatia,
 * e uma resposta que pode ter mudado no intervalo.
 */
export interface ReferenciaExterna {
  readonly alvo: AlvoDeRef
  /** A chave determinística do recurso — a mesma que o corpo da issue carrega. */
  readonly chaveExterna: string
  /** O id na origem: `owner/repo`, o número da issue como texto, o nome da branch. */
  readonly refId: string
  readonly url?: string
  /** O SHA publicado, quando o recurso tem um. Ausente em issue. */
  readonly sha?: string
  /**
   * O que **não** foi possível configurar, e por quê (emenda 2).
   *
   * Proteção de branch recusada pelo plano da conta é limitação registrada, não falha da
   * publicação. Guardá-la junto do recurso é o que permite a M9-F05 saber que a branch não tem
   * proteção sem perguntar de novo à origem — e sem confundir "não protegida" com "não publicada".
   */
  readonly limitacao?: string
}

/**
 * O usuário do Basic Auth que o GitHub aceita para token de App/OAuth em HTTPS.
 *
 * O GitHub ignora o usuário e lê a senha, mas exige que **algum** usuário esteja lá; `x-access-token`
 * é o valor que a documentação da GitHub App usa, e mantê-lo é o que faz o push funcionar com o
 * mesmo token que o conector já usa na API.
 */
const USUARIO_DE_TOKEN = 'x-access-token'

/**
 * Monta a URL de push com a credencial embutida (decisão do PI, SPEC-Entrega-01).
 *
 * **Por que a credencial vai na URL e não no ambiente.** O `ambienteControlado()` do MVP-004 só
 * repassa uma lista fechada de variáveis ao subprocess — nenhum `GITHUB_TOKEN` ou `GIT_ASKPASS`
 * alcança o `git`, e isso é a garantia que a M4-F02 entregou, não um descuido. Abrir uma exceção
 * criaria uma segunda lista de permissão, e a que divergisse seria a que vaza. A URL é o caminho que
 * não mexe nessa barreira.
 *
 * **Por que a URL não é persistida.** O chamador a passa como argumento de `git push <url> <ref>`,
 * nunca `git remote add`: gravada no `.git/config`, a credencial sobreviveria ao run, ao processo e
 * ao backup do diretório. Como argumento, ela vive o tempo do subprocess.
 *
 * **O que isto não resolve:** enquanto o processo vive, o token é visível na linha de comando para
 * quem inspeciona processos na própria máquina do usuário. É o custo aceito da decisão; a alternativa
 * (credential helper do SO) atravessaria a mesma barreira de ambiente por outro caminho.
 */
export function urlDePushComToken(origem: string, token: string): string {
  if (token.length === 0) {
    // Sem isto, a URL sairia como `x-access-token:@github.com/...` e o push tentaria como anônimo:
    // falharia com "repository not found" — a mensagem que manda procurar o erro no lugar errado.
    throw new Error('Token vazio: a URL de push autenticaria como anônimo.')
  }

  if (!origem.startsWith('https://')) {
    // SSH usa chave, não token; `http://` mandaria a credencial em claro pela rede. Recusar é o
    // comportamento correto: montar a URL assim mesmo daria um push que falha ou que vaza.
    throw new Error('A origem precisa ser HTTPS para carregar a credencial na URL.')
  }

  return `https://${USUARIO_DE_TOKEN}:${token}@${origem.slice('https://'.length)}`
}

/**
 * Remove a credencial de qualquer URL de remote presente num texto, antes de ele virar evidência.
 *
 * Aplica-se ao texto inteiro, não à URL isolada: o git **ecoa a URL** nas mensagens de erro
 * (`fatal: unable to access 'https://x-access-token:...@github.com/...'`), e é essa saída que vira
 * log, auditoria e evidência da entrega. Redigir só a URL que montamos deixaria o eco passar.
 *
 * Complementa o `redact` genérico do logging em vez de substituí-lo: aquele casa campos por nome
 * (`token`, `authorization`), e um token dentro de uma URL não está em campo nenhum.
 */
export function redigirUrlDeRemote(texto: string): string {
  return texto.replace(/(https:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@')
}
