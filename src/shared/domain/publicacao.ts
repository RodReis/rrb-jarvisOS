/**
 * As decisões puras da publicação no GitHub (SPEC-Entrega-01).
 *
 * Módulo separado de `github-automation.ts` de propósito: aquele descreve **o conector** (o que o
 * GitHub sabe fazer), este descreve **a entrega** (como o projeto se projeta no GitHub). O conector
 * é reusável por qualquer consumidor; a derivação da chave abaixo só faz sentido para quem tem
 * projeto, MVP e fatia — e misturá-los faria o conector depender do vocabulário do MVP-009.
 */

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
export function chaveDeFatia(projectId: string, numeroDoMvp: number, numeroDaFatia: number): string {
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
