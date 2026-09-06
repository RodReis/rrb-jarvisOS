# TESTING.md — Estratégia de testes e relatório de evidência

> **Natureza deste documento.** Isto é **processo/infra de desenvolvimento**, não uma fatia
> de produto — logo **não é `SPEC-0XX`** (essa numeração é de produto). É a referência
> canônica de como testamos o repo e de como o **Claude Code** deve montar o CI e o relatório.
> Guia humano (estável, raramente editado) → vive em `docs/`. O **relatório gerado**
> (`reports/TESTS.md`) **não** vive em `docs/` — ver §4.
>
> **Estado (2026-07-21).** A metodologia está definida (governada pelo **ADR-003**). O código
> — gerador, orquestrador, config e CI — é **implementado na Fatia 01 (Bootstrap)**, junto do
> passo "scripts dev/build/lint/test configurados", quando o scaffold (`package.json`, runners)
> existir. Este documento é o blueprint que a Fatia 01 executa; a §10 traz a implementação de
> referência já provada no `rrb-proplan`.

## 1. Princípio inegociável: evidência de máquina, nunca narrada

O jarvisOS aplica ao próprio CI a régua que aplica a tudo: **fechamento frágil** — declarar "está
tudo verde" sem prova real — é proibido (é o mesmo espírito do "declarar terminei sem PR mergeado"
do `CLAUDE.md`). Consequência: **todo número de teste (quantidade, pass, falha, cobertura) vem da
saída `--json` do runner** (Vitest/Playwright). Nenhum número é digitado à mão nem narrado pelo
agente. Um "410 testes verdes" escrito num markdown é uma *afirmação*; o `vitest-results.json` é
*evidência*. Este documento existe para que a segunda coisa seja a única que conta.

Consequência direta: o `reports/TESTS.md` é **gerado por script** e **verificado no CI** contra
uma execução limpa (guarda anti-drift, §5). Se alguém — humano ou agente — editar os números à
mão, o CI falha.

## 2. Metodologia: pirâmide de testes e as 3 categorias

Usamos a **pirâmide de testes**: muita coisa barata e rápida na base, pouca coisa cara e lenta no
topo. As três categorias (**Banco / Regras de Negócio / Tela**) mapeiam nas camadas da pirâmide e
em *o que cada teste prova* — reinterpretadas para um app **Electron** (não há backend HTTP nem
Postgres; o "banco" é a persistência local, ver ADR-001 e a SPEC-Fundacao-04):

| Categoria | Camada | O que prova | Stack | Velocidade |
|---|---|---|---|---|
| **Regras de Negócio** | Unidade (base) | Lógica de domínio pura: uma função/regra/policy faz o que deve, isolada de storage, IPC e rede | Vitest — `src/{shared,main,design,renderer}/**/*.spec.ts` | rápida (ms) |
| **Banco** | Integração (meio) | Storage real, não dublê: **SQLite** (`better-sqlite3`) contra arquivo temporário, round-trip IPC↔runtime↔storage — e, desde a M2-F01, a **RLS do Supabase local** contra a stack Docker | Vitest — `src/main/**/*.int-spec.ts` e `tests/**/*.int-spec.ts` | média (s) |
| **Tela** | Componente + E2E (topo) | UI: componente renderiza/reage certo (Vitest + Testing Library + jsdom) e fluxo crítico funciona no app real (Playwright-Electron) | Vitest — `src/renderer/**/*.test.tsx`; Playwright — `tests/e2e/**/*.e2e.ts` | componente rápida / e2e lenta |

Notas de aprendizado:

- **A categoria é definida pelo que o teste prova, não pela pasta onde ele mora.** A extensão é
  que separa: `*.spec.ts` é unidade pura, `*.int-spec.ts` toca storage, `*.test.tsx` renderiza
  componente. O `include` de **Regras** cobre `src/{shared,main,design,renderer}` — inclusive o
  renderer, porque lógica pura pode morar ao lado da UI que a consome (`workspace/navegacao.ts` é
  estado sem React). Componente React continua fora de Regras pela extensão, não pelo caminho.
  Isto é registro de um bug real: o padrão original omitia `src/renderer`, e
  `workspace/navegacao.spec.ts` **nunca rodou** — 75 linhas cobrindo o isolamento de rota por
  espaço (SPEC-Fundacao-02, critérios 1 e 5) ficaram fora de toda categoria por três MVPs, sem
  nada falhar. Corrigido no card [#47](https://github.com/RodReis/rrb-jarvisOS/issues/47).
  **Um teste que não roda é indistinguível de um teste que não existe** — e é pior, porque a
  tabela do relatório sugere cobertura que não há.
- **Clientes externos são mockados no boundary.** Supabase (auth/sync) e Google OAuth **nunca**
  são chamados de verdade num teste. Casa com a regra de arquitetura "renderer nunca acessa Node,
  segredo ou rede direto" e com o fail-closed do Policy Engine — no teste, mock. Testa-se *o nosso
  código*, não a rede alheia.
- **Cobertura ≠ qualidade.** Cobertura mede *linhas executadas por algum teste*, não se o teste
  *verifica* algo útil. 100% de cobertura em getters triviais é teatro. Por isso o portão é
  **report-only** (§6): olha-se a tendência, não persegue um número.
- **E2E não tem "cobertura de linha" que valha.** Playwright prova *comportamento*, não linhas.
- **O E2E não entra no relatório (card #34).** Desde 2026-07-24, a categoria "Tela" do
  `reports/TESTS.md` conta **só o Vitest-componente** — o E2E Playwright-Electron virou um
  **check de CI à parte** (job `e2e`, condicional por `paths`, ver §6), fora da tabela. O
  motivo: o E2E domina o tempo de CI (build + xvfb + keyring, ~15 min) e prova a fronteira
  preload/IPC/janela, que muda raramente; somá-lo ao relatório acoplava um número que oscilaria
  conforme o E2E rodasse ou não naquele PR, contra a guarda anti-drift (que compara execução
  limpa). O verde do E2E vive no gate do PR, não no relatório. As linhas "Tela" **anteriores** a
  esta data já incluem a contagem do E2E — são imutáveis (append-only); a mudança vale das
  próximas em diante.
- **O campo "Falha" será quase sempre 0** no momento da entrega — verde é o portão. O valor do
  registro está na **tendência de cobertura e no histórico por fatia**, não no pass/falha de um
  instante.

## 3. Organização dos testes (convenção, sem hardcode)

A classificação teste→categoria é **determinística por diretório/sufixo** — o script não adivinha.
Segue a regra "sem hardcode e sem mock" do `CLAUDE.md`: a convenção é dado (mora no config), não
constante embutida no gerador.

**Domínio / main (`src/main`, `src/shared`) — Vitest:**

- `regras` → `src/{shared,main}/**/*.spec.ts` — unidade, sem storage, sem IPC, sem rede.
- `banco`  → `src/main/**/*.int-spec.ts` **+** `tests/**/*.int-spec.ts` — integração com o storage
  local (SQLite) num arquivo temporário, com teardown por teste.

**Renderer (`src/renderer`, `tests/e2e`):**

- Componente → Vitest + Testing Library (jsdom): `src/renderer/**/*.test.tsx`.
- E2E → Playwright-Electron: `tests/e2e/**/*.e2e.ts` (config em `playwright.config.ts`).
  O sufixo é `.e2e.ts` e não `.spec.ts` — este último já pertence à categoria *regras* no
  `include` do Vitest, e a mesma extensão nas duas faria o Vitest tentar rodar o E2E.

O mapeamento categoria→origem mora em **`test-report.config.json`** (raiz), não no código do
gerador — assim o mesmo tooling cai em outro projeto só ajustando o mapa (reutilização, §7).

### 3.1 E2E Electron: armadilhas de ambiente (achados da Fatia 03)

Custaram tempo real de diagnóstico e **não são bugs do app** — são consequências de
comportamentos corretos dele. Quem for escrever ou depurar E2E aqui deve ler antes:

1. **Encerre com `app.exit(0)`, nunca com `close()` ou `quit()`.** Os dois travam o teardown
   e deixam a janela aberta na tela de quem roda a suíte. `close()` espera o processo morrer,
   mas o app **vive no tray** (`window-all-closed` é deliberadamente vazio, SPEC-02); `quit()`
   dispara `will-quit`, que fecha o logger, e os timers de rotação do
   `winston-daily-rotate-file` seguram o event loop. `exit()` ignora handles pendentes e
   encerra em ~200ms. É seguro porque o `userData` do teste é temporário e descartável.
2. **`ELECTRON_RUN_AS_NODE` herdado do shell quebra o launch.** Com a variável setada, o
   Electron sobe como Node puro e o erro aparece como `does not provide an export named
   BrowserWindow` — parece falha de bundle e não é. O `beforeEach` do E2E remove a variável
   do ambiente do processo filho, para o teste não depender de quem o executa.
3. **Processos `electron.exe` remanescentes fazem o launch falhar em silêncio.** O
   `requestSingleInstanceLock()` (SPEC-02) derruba cada nova instância no boot, e o Playwright
   reporta `Target page, context or browser has been closed` — que parece erro de conexão, mas
   é a instância única funcionando. Ao investigar falha de launch, limpe primeiro:
   `taskkill //F //IM electron.exe`.

4. **No CI, baixe o binário do Electron antes dos testes.** O `postinstall` do projeto é
   `electron-rebuild` (compila o `better-sqlite3`) e **não** baixa o binário. Sem um passo
   explícito, o download de ~100 MB acontece dentro do primeiro teste e estoura os 30s do
   `firstWindow()`. O sintoma engana de novo: `Timeout exceeded while waiting for event
   "window"`, sem erro de biblioteca — a única pista é um `Downloading Electron binary...`
   perdido no meio da saída. O `ci.yml` roda `node node_modules/electron/install.js`
   (idempotente) logo após o `npm ci`.

5. **No CI Linux, o `chrome-sandbox` do pacote npm não tem setuid.** O npm não preserva
   permissões: o binário precisa de dono `root` e modo `4755`, senão o processo aborta no
   boot com `FATAL:setuid_sandbox_host.cc` + `SIGTRAP` — que o Playwright reporta como
   timeout de `firstWindow()`, porque o stderr do processo não chega ao reporter. Subir com
   `--no-sandbox` está descartado: o sandbox é critério de aceite da SPEC-Fundacao-03. O
   `ci.yml` faz `chown root:root` + `chmod 4755` antes dos testes.

6. **No CI Linux, `safeStorage` não existe sem keyring.** O runner não tem D-Bus de sessão
   nem secret service; o backend de senha do Chromium cai em `basic_text` e
   `isEncryptionAvailable()` responde false. O boot então falha alto por desenho (ADR-004:
   chave de auditoria nunca em claro no disco) e a janela não nasce — de novo, o E2E só vê
   timeout de `firstWindow()`. O `ci.yml` instala `gnome-keyring` + `dbus-x11`, sobe um
   D-Bus de sessão, destrava o keyring com senha vazia e exporta
   `DBUS_SESSION_BUS_ADDRESS` + `XDG_CURRENT_DESKTOP=GNOME` (sem o desktop declarado o
   Chromium nem tenta o libsecret). Afrouxar o código para o teste passaria exatamente
   onde ele deveria provar a garantia.

**O E2E exige build.** O Playwright sobe o app empacotado (`out/`), não o servidor de dev —
rodá-lo sem `npm run build` testaria a versão anterior do código. Desde o card #34 o E2E **não**
é mais chamado pelo orquestrador do relatório (`scripts/test-report.mjs`); ele roda no job `e2e`
do CI (§6), que faz o `npm run build` antes do `playwright test`. Para rodar o E2E localmente:
`npm run build && npx playwright test`.

> **Onde vivem as armadilhas 4–6 (binário, setuid, keyring).** Elas são exigências do E2E, e só
> dele — desde o card #34 os steps que as tratam moram no **job `e2e`** do `ci.yml`, não no job
> do relatório. O job `test` (relatório) não sobe Electron, então não precisa de nenhuma delas.

**Padrão das armadilhas:** nenhuma se apresenta como o que é. Falha de launch do
Electron no CI quase sempre reporta timeout ou "browser has been closed" — mensagens que
apontam para o Playwright quando a causa está no ambiente. Antes de mexer no teste, confira
binário, display, sandbox, keyring e processos remanescentes — e leia o stderr cru do
processo principal (subindo o app fora do Playwright), porque o reporter o engole.

> **Por que Vitest único, e não Jest+projects como no proplan.** O jarvis é Vite-nativo; Vitest é
> o runner natural (mesma config, mesmo transform). O relatório `--json` do Vitest é
> **Jest-compatível** (expõe `numTotalTests` / `numPassedTests` / `numFailedTests`), então o
> gerador (§10) lê Vitest e Playwright sem uma linha de mudança. As 3 categorias viram 3 execuções
> Vitest com `include` distinto (ou 3 *projects* via `vitest.workspace.ts`), cada uma com seu
> `outputFile` e `coverageDirectory` próprios.

### 3.2 Smoke real contra serviço externo (achado da M6-F04)

Servidor falso responde o que você escreveu que ele responde. **Serviço real responde o que ele
responde** — e a diferença entre as duas coisas é o que o smoke existe para medir.

**Quando escrever um.** Quando a spec pede (a SPEC-Conectores-04 pede), ou quando o adapter depende
de um comportamento do serviço que o dublê não teria como reproduzir sozinho: latência,
consistência eventual, códigos de erro condicionais, campos que mudam de sentido conforme o estado.

**Como.** Script Node solto em `scripts/`, token via variável de ambiente (`source: env` da
SPEC-Providers-01 — **jamais** commitado, jamais gravado no vault), **fora do CI**. Não há segredo
no CI, e não deve haver. Roda localmente, à mão, e a evidência entra na entrega.

**Efeito externo é real: use recurso descartável.** O smoke do GitHub cria issue, branch, PR e faz
merge. Isso vai para um repositório criado para ser apagado (`RodReis/rrb-jarvisos-smoke`), nunca
para o repositório de trabalho — issue não se deleta, e commit de lixo na `main` fica no histórico.
Carimbo de timestamp em tudo que é criado, para rodar duas vezes não colidir.

**O que a M6-F04 achou, e que motiva esta seção.** A listagem de issues do GitHub é
**eventualmente consistente**: uma issue recém-criada leva ~4 s para aparecer em `GET /issues`.
Consequência direta no app: dois `ensureIssue` em sequência **duplicariam** a issue — o oposto do
critério que a fatia existia para cumprir. Nenhum teste de integração mostraria isso, porque o
servidor falso responde instantâneo e consistente; a suíte estava verde e o comportamento, errado.

**Duas lições de método que vêm daí:**

1. **Asserção de smoke não pode medir latência do serviço.** A primeira versão do passo falhava com
   espera fixa de 3 s e chamava isso de defeito nosso. Espera com tentativas, e reporte quanto
   demorou — o número é evidência, não ruído.
2. **Quando o smoke acha um comportamento do serviço, o dublê precisa aprender a imitá-lo.** O fake
   ganhou um atraso de visibilidade configurável, e um contrafactual confirma que sem a correção o
   teste cai. Sem esse passo, o achado do smoke não vira regressão detectável.

### 3.3 Quando o smoke contradiz a si mesmo, sonde antes de concluir (achado da M6-F06)

O smoke da Tavily afirmou que uma extração de 2 URLs custa 0 créditos. Na execução seguinte, **a
mesma chamada custou 1**. A tentação é escolher uma das duas medições e seguir; as duas estavam
certas, e a conclusão a tirar delas era outra.

Sondando o comportamento em vez de repetir o teste — seis chamadas seguidas de **1 URL** — o padrão
apareceu: `0,0,0,0,1,0`. A Tavily **acumula URLs entre chamadas** e cobra 1 crédito a cada 5 no
total. Nenhuma fórmula sobre a contagem de uma chamada isolada reproduz isso.

**As lições:**

1. **Medição que varia entre execuções idênticas é informação, não ruído.** O primeiro impulso —
   "ajustar o teste para aceitar 0 ou 1" — teria escondido o fato. A pergunta certa é *o que muda
   entre as duas execuções*, e responder exige sondar, não reexecutar.
2. **Fórmula local sobre estado remoto acumulado é sempre errada, e erra acumulando.** A conclusão
   de projeto foi remover o cálculo: o adapter usa o número que o serviço informa, e o fallback é
   zero — inventar um valor poluiria o ledger a cada chamada. Quem protege a cota é o gate, com
   estimativa **para cima**, antes de a chamada sair.
3. **O que o smoke afirma tem de ser o que é estável.** O passo final não afirma "custa 0"; afirma
   que uma extração de 2 URLs cabe em `{0, 1}` — nunca 2, que é o que uma cobrança por URL daria.
   Um smoke que afirma o instável falha por motivo errado e ensina a ignorá-lo.

### 3.4 Smoke de **infraestrutura**: o dublê valida a decisão, não a mecânica (achado da M9-F03)

O §3.2 nasceu de smoke contra **serviço externo**. A M9-F03 mostrou que a mesma lição vale para
**infraestrutura local** — Docker, Git, filesystem — e por um motivo diferente: ali o risco é o
serviço se comportar diferente do contrato; aqui é a **plataforma** ter detalhe que nenhum dublê
modela (caminho relativo, fim de linha, permissão de montagem, daemon numa VM).

O smoke rodou com **25 testes verdes** e achou dois defeitos:

1. **Reescrever o `commondir` de um worktree derruba o Git do host.** É um arquivo só, e host e
   container precisam de caminhos diferentes nele. O preflight continuava devolvendo `liberado` —
   nenhuma asserção de unidade tinha como ver.
2. **Checkout com CRLF (padrão do Windows) faz o Git do container (Linux) ler a árvore inteira
   como modificada**, o que faria o gate de escopo acusar fuga em **todo** arquivo do projeto.

Os dois viraram teste de integração que **reprova** quando o defeito volta — smoke que acha
defeito sem virar guarda deixa a correção sem rede.

**A regra prática:** fatia que toca Docker, Git ou rede exercita o **round-trip completo** com a
infra real antes de fechar. Aqui: executor escreve no container → host vê o arquivo → host
commita. Nenhum dos três passos isolados teria achado o defeito 1.

**E leia o stream certo.** A primeira versão do passo "escrita no `.git` é rejeitada" reprovava
com o Docker fazendo a coisa certa: a recusa do `sh` sai no **stderr**, e `execFileSync` com
stdio piped devolve só o stdout — o `2>&1` de dentro do comando não alcança, porque o
redirecionamento é montado antes de o `sh` tentar abrir o arquivo. É o mesmo erro de método do
§3.3: **sonde antes de concluir** que o comportamento está errado.

O script é `scripts/smoke-sandbox.mjs`, e ele **não cria efeito externo** (repositório temporário
e container removido no fim), então pode rodar à vontade — só exige Docker no ar:

```bash
node scripts/smoke-sandbox.mjs
```

O último passo dele afirma um **limite conhecido** em vez de uma garantia: o egress ainda não é
restrito ([#222](https://github.com/RodReis/rrb-jarvisOS/issues/222)). Smoke que registra o que
*ainda não* vale é mais honesto do que smoke que só mede o que já funciona.

### 3.2.1 Smoke do console da geração (M26-F03)

`scripts/smoke-console-geracao.mjs` chama o **Claude Code CLI real** com
`--output-format stream-json --verbose` e passa a saída pelo parser que vai para produção.

```bash
TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/smoke-console-geracao.mjs
```

O `TSX_TSCONFIG_PATH` é obrigatório: o parser importa `@shared/domain/geracao`, e o alias mora no
`tsconfig.node.json` — o `tsconfig.json` da raiz só referencia os dois projetos.

**Por que ele existe, com 29 testes verdes sobre o parser:** as fixtures são gravadas e o CLI é
vivo. O dublê responde no formato que foi *anotado*; o CLI responde no formato que ele tem hoje,
com a versão instalada e a telemetria que a Anthropic acrescentou desde a captura. O prompt força
uma ferramenta de propósito — sem isso o smoke provaria só o caminho de texto, que os adapters
antigos já faziam.

Execução de 2026-09-04: `texto: 1 · ferramenta-inicio: 1 · ferramenta-fim: 1 · uso: 1`, com
`Bash · grep -m1 '"name"' .../package.json → ok · 25 B` e `227690 tokens de entrada · 125 de
saída · 5548 ms`. Os 227.690 são o achado: a aproximação por caracteres do adapter antigo daria
~30, porque media o prompt e não o contexto que o CLI carrega.

## 4. O relatório: `reports/TESTS.md`

**Local:** `reports/` na raiz — **diretório neutro**. Não vai em `docs/` (um arquivo reescrito a
cada entrega por máquina mascararia o sinal de doc humana defasada e poluiria o histórico de
`docs/`). É artefato de máquina, versionado, mas separado da documentação humana.

**Cabeçalho obrigatório do arquivo:**

```
<!-- GERADO AUTOMATICAMENTE por scripts/gen-test-report.ts — NÃO EDITAR À MÃO.
     Fonte dos números: vitest/playwright --json. Divergência é barrada no CI. -->
```

**Formato — tabela-registro (append por entrega).** Cada entrega adiciona **3 linhas** (uma por
categoria) compartilhando Data/Issue/SPEC/PR. A categoria **é** o "tipo de teste realizado":

| Data | Issue | SPEC | Categoria | Testes | Pass | Falha | Cobertura % | PR | Link PR |
|------|-------|------|-----------|-------:|-----:|------:|------------:|----:|--------|
| 2026-08-01 | #12 | SPEC-Fundacao-01 | Regras de Negócio | 128 | 128 | 0 | 91.2 | #45 | link GitHub PR |
| 2026-08-01 | #12 | SPEC-Fundacao-01 | Banco             | 34  | 34  | 0 | 78.0 | #45 | link GitHub PR |
| 2026-08-01 | #12 | SPEC-Fundacao-01 | Tela              | 22  | 22  | 0 | 64.5* | #45 | link GitHub PR |

`*` cobertura de Tela = Vitest (componente); a parte Playwright entra só na contagem.

O histórico é **append-only** (linhas de entregas passadas são imutáveis). Uma seção no topo,
`## Estado atual`, mostra os totais da última execução — regenerada, não acumulada.

## 5. Fluxo de geração (fim de entrega) + guarda anti-drift

**Quem gera:** o **Claude Code**, no fim da fatia (junto do commit de docs da entrega), roda
`npm run test:report`. O script:

1. Executa os runners com `--json` (ou lê os artefatos `*-results.json` + `coverage-summary.json`).
2. Classifica por categoria via `test-report.config.json`.
3. **Acrescenta** as linhas da entrega ao histórico de `reports/TESTS.md` com os números reais.
   Linha commitada **nunca** é reescrita nem removida — reentregar a mesma issue vira uma linha
   nova, datada (duas execuções são dois fatos).
4. Regenera a seção `## Estado atual`.

Duas regras do append-only, ambas nascidas de bugs reais no `rrb-proplan` (o jarvis **herda o
conserto**, não precisa reviver o bug):

- **Sem issue não apaga.** Rodar `npm run test:report` local (sem PR, logo sem `refs #N`) **não pode
  zerar o histórico**. No proplan uma versão que fazia `issue ? keep : []` apagou o registro
  inteiro de uma spec. Hoje o histórico é sempre preservado.
- **Sem issue não acrescenta.** Uma linha `| — | — | — |` não é evidência de entrega (não diz o
  que foi entregue nem por qual PR). Rodar local atualiza só o `Estado atual`, que é regenerado
  por contrato.

> **Como carimbar a entrega (o comando que fecha a fatia).** Os metadados da linha vêm de
> variáveis de ambiente — o CI as extrai do PR, mas numa execução **local** elas não existem, e
> sem elas o gerador (corretamente) só atualiza o `Estado atual`. Para deixar a linha no
> histórico, rode na raiz:
>
> ```bash
> REPORT_ISSUE=#2 REPORT_SPEC=spec-fundacao-01-bootstrap REPORT_PR=#25 npm run test:report
> ```
>
> `REPORT_DATE` e `REPORT_PR_URL` são opcionais. **Esquecer isso não é mais silencioso** — ver a
> prova 3 abaixo.

**Guarda anti-drift (o que torna o arquivo confiável):** no PR, o CI roda o gerador em
**`--check`**, que faz **quatro provas independentes** — são quatro formas distintas de a
evidência mentir:

0. **Execução completa** (desde 2026-09-06, issue #232) — prova que o runner **não perdeu
   arquivo**. Vem antes das outras e vale também fora do `--check`, porque as três seguintes
   auditam o *conteúdo* do relatório e esta audita a *evidência que o alimenta*: uma execução que
   perdeu arquivo grava um total menor que a verdade, e a prova 1 então compara o relatório
   contra a mesma execução incompleta e **concorda consigo mesma**. Compara a contagem de
   arquivos de cada categoria com a da última execução íntegra, guardada em
   `reports/.arquivos-por-categoria.json`; caiu → **falha e não grava**. Subir é rotina (teste
   novo); categoria sem piso é a primeira execução dela. Se um teste foi removido de propósito,
   o piso é ajustado no mesmo commit.
1. **Números** — recomputa os totais numa execução limpa e compara com a seção `## Estado atual`
   commitada. Divergiu → **CI falha**. O número só "cola" se sobreviver a uma reexecução
   independente. Compara só os números, não os rótulos Data/Issue/PR (que variam por PR de
   propósito).
2. **Histórico (append-only)** — prova que **toda linha da baseline continua no arquivo**.
   Append-only é verificável por **continência de conjunto**, não por igualdade: o histórico novo
   pode ter linhas a mais (a entrega atual), nunca a menos.
3. **Carimbo da entrega** (`--require-entry`, desde 2026-07-22) — prova que a entrega **deixou
   linha** no histórico. Só é exigida de PR que **altera arquivo de teste** (PR só de `docs/` não
   é barrado) e cobra pela issue do `refs #N`. Sem linha → **CI falha**, com o comando exato na
   mensagem.

> **Por que a prova 0 é um piso, e não a comparação que parece óbvia.** O modo de falha é o pool
> do Vitest perder um worker: a execução termina com `success: true`, **zero falhas**, e um
> arquivo inteiro fora da contagem — nada fica vermelho, o total apenas cai. A defesa intuitiva
> seria comparar "arquivos coletados" com "arquivos executados", mas **essa comparação não tem
> fonte**: a saída do runner diz quantos arquivos ele *relatou* (`testResults`), nunca quantos
> pretendia rodar, e o campo que parece servir (`numTotalTestSuites`) conta blocos `describe` —
> 379 contra 67 arquivos no projeto `banco`. Uma guarda sobre ele acusaria toda execução
> saudável. O piso é a única fonte confiável que existe.
>
> **Ele não depende de reproduzir o gatilho**, e isso é deliberado: por que o worker morre é
> intermitente e não reproduz sob demanda (o Vitest 4.1 reinicia o worker e se recupera na
> maioria das vezes, que é por que o defeito é raro). O que a guarda mede é o **efeito**, sempre
> o mesmo. Verificado com a perda simulada num JSON real: 66 de 67 arquivos, zero falhas,
> `success: true` — o gerador recusa gravar e sai com código 1.

> **Por que a prova 3 existe — e por que ela já era necessária aqui.** As provas 1 e 2 cobrem
> *número forjado* e *histórico apagado*; nenhuma cobre **histórico que nunca foi escrito**. No
> `rrb-proplan` duas entregas mergearam com CI verde e o histórico mudo, e a tabela passou a
> sugerir que não tiveram teste — havia centenas de testes verdes.
>
> **O mesmo já tinha acontecido neste repo**: a **Fatia 01** (issue #2, PR #25) foi entregue com
> 18 testes passando e o commit `a995be4` diz *"registra entrega da Fatia 01"* — mas o histórico
> estava **vazio**. A linha foi acrescentada retroativamente em 2026-07-22, junto com esta guarda.
> Os números registrados são os da execução do dia, não os do instante do merge: registro
> retroativo não reconstrói contagem passada.
>
> **Por que o CI não commita a linha sozinho** (alternativa rejeitada no repo de origem): o
> `--check` **não reescreve** o arquivo de propósito — se reescrevesse, um número editado à mão
> seria silenciosamente sobrescrito em vez de barrado, e a prova 1 morreria. Guarda que corrige
> não é guarda. O CI **barra**, e quem carimba continua sendo quem entrega.

Três restrições de projeto que a guarda **precisa** respeitar (lições herdadas do proplan, todas
registradas no código de referência da §10):

- **A baseline não pode sair do arquivo auditado.** Comparar o arquivo com a saída do gerador —
  que é construída *a partir* do arquivo — deixa o arquivo corrompido testemunhar a própria
  integridade (histórico apagado ⇒ os dois lados vazios ⇒ "íntegro"). A baseline é o **blob do git
  na base do PR** (`REPORT_BASE_REF`), nunca `HEAD` — no CI de PR, HEAD é o merge commit, cujo
  `TESTS.md` é a versão do próprio PR.
- **A prova de números não pode falhar aberta por CRLF.** Checkout Windows entrega CRLF, o gerador
  emite LF — sem normalizar, o `--check` acusa divergência entre blocos idênticos. Um guard que
  falha sempre é um guard que ninguém lê. Comparação normaliza a quebra de linha.
- **Quem guarda a guarda.** Um bug no gerador pode desligar a guarda em silêncio (foi o que
  aconteceu no proplan: CI verde em 3 PRs enquanto o histórico era zerado). Por isso o gerador tem
  **self-check próprio** (`npm run test:report:selfcheck`), que roda no CI **antes** do `--check`:
  `assert` puro do Node, sem framework, provando append puro, histórico zerado, upsert de linha
  commitada e CRLF.

## 6. Workflow de CI — `.github/workflows/ci.yml`

Dispara em **todo pull request** para `main`. Um bloco `concurrency` (card #66) cancela a execução
anterior quando chega um push novo no mesmo PR — três pushes seguidos não deixam três suítes
inteiras (~7 min cada) rodando em paralelo quando só a última importa. Desde o **card #34**
(2026-07-24) são **três jobs**, não um:

- **`test`** — roda em todo PR. Runners unitários/integração + relatório + guarda anti-drift
  (descrito nesta seção). **Não sobe Electron** e **não roda E2E**.
- **`e2e`** — sobe o app Electron de verdade (build + xvfb + keyring + Playwright). Custa ~15 min
  e prova a fronteira preload/IPC/janela, que muda raramente. **Só executa quando o PR toca essa
  fronteira** — um job leve `changes` faz `git diff` contra a base e casa
  `src/main/preload/**`, `src/main/index.ts`, `src/main/window.ts`, `tests/e2e/**`,
  `playwright.config.ts`; nos demais PRs o `e2e` é pulado (no-op). Filtro por `paths:` no evento
  não serve aqui — cancelaria o workflow inteiro, não um job.
- **`gate`** — o **required check** (branch protection exige `gate`, não `e2e`). Sempre roda,
  agrega `test` e `e2e`: falha se `test` falhou ou se o `e2e` **rodou e** falhou; passa quando o
  `e2e` foi legitimamente pulado. É o que impede o E2E condicional de bloquear o merge em
  "pending eterno" — a armadilha do required check pulado no GitHub.

> **A garantia (card #34):** o E2E completo tem de rodar no caminho para a `main`. O filtro de
> `paths` do job `changes` cobre toda a fronteira que o E2E prova; PR que a toca roda o E2E e é
> barrado se falhar; PR que não a toca não pode introduzir regressão de fronteira. Manter o filtro
> em sincronia com o que o E2E realmente exercita é parte do contrato. Falso verde é pior que
> teste ausente.

O job `test` em detalhe:

- **Services:** **nenhum** no sentido do `services:` do Actions. A maior parte do "Banco" testa o
  storage local (SQLite em arquivo temp), que não é serviço. Desde a **M2-F01** (entregue em
  2026-07-22) há uma exceção: o int-spec de RLS exige o **Supabase local**, que sobe pela CLI
  (`supabase/setup-cli` + `supabase start`) e não por `services:` — não é um container só, e sim a
  stack que a CLI orquestra (Postgres + PostgREST + Auth), com migrations e seed aplicados no start.
  - **Pular, no CI, é falha.** Esses testes se pulam quando a stack não responde, para não punir
    quem clona o repo sem Docker. No CI a stack sobe de propósito, então o `beforeAll` **lança**
    quando `process.env.CI` está setado. Sem isso, uma stack que não subisse deixaria o CI verde
    sobre RLS jamais exercitada — o relatório contaria a categoria como coberta. Falso verde é
    pior que teste ausente: ele *afirma* a garantia que não foi medida.
  - **Localmente, pular envenena o relatório — suba a stack antes de gerá-lo.** O outro lado da
    mesma moeda. Com o Docker parado, `npm run test:report` roda até o fim e escreve um número que
    *parece* válido: os 7 testes de RLS simplesmente somem da contagem (`Banco 110 pass` em vez de
    `117`). Nada falha, nada avisa. Quem pega é a guarda anti-drift, que compara o arquivo
    commitado com uma execução limpa — mas só no CI, depois do push. **Antes de
    `npm run test:report`, confirme a stack no ar** (`npx supabase status`); se estiver parada,
    `npx supabase start`. Vale a mesma regra do ADR-003 vista de perto: número de relatório é
    evidência de execução limpa, não da máquina de quem commitou.

### Gerar o relatório de entrega: reproduza o ambiente do CI

Duas rodadas de CI vermelhas na **M3-F01** (2026-07-23), por duas guardas diferentes, com a mesma
causa de fundo: `npm run test:report` rodado sem as condições que o CI impõe. As guardas fizeram o
trabalho delas — o desperdício foi descobrir no CI o que dava para ver antes do push.

| Guarda | O que cobra | Como falha em silêncio localmente |
|---|---|---|
| anti-drift (`--check`) | números batem com execução limpa | stack parada ⇒ testes pulados somem da contagem |
| `--require-entry` | linha da entrega no **Histórico** | sem as variáveis `REPORT_*`, só o "Estado atual" é escrito |

O carimbo do histórico nasce das variáveis que o CI injeta (`REPORT_ISSUE` extraída do `refs #N` do
PR, `REPORT_SPEC` do corpo, `REPORT_PR`/`REPORT_PR_URL`/`REPORT_DATE`). Sem elas o gerador escreve
um relatório válido — só que **sem a linha de histórico**, e `--require-entry` barra.

Antes de commitar o relatório de uma entrega, rode o equivalente ao CI:

```bash
npx supabase status                      # stack no ar? se não: npx supabase start

REPORT_PR='#<PR>' \
REPORT_PR_URL='https://github.com/RodReis/rrb-jarvisOS/pull/<PR>' \
REPORT_ISSUE='#<issue>' \
REPORT_SPEC='<slug-da-spec>' \
REPORT_DATE='<YYYY-MM-DD>' \
npm run test:report

# e a guarda idêntica à do CI, que é o que realmente prova:
REPORT_ISSUE='#<issue>' REQUIRE_ENTRY=1 npm run test:report:check -- --require-entry
```

O número do PR só existe depois de abri-lo — então a ordem é **abrir o PR, carimbar, empurrar**.
Rodar a guarda local antes do push é o passo que fecha o ciclo: se ela passa aqui, passa lá.
  - **Role não-owner, sempre.** O Postgres pula RLS para superuser e para o dono da tabela. Todo
    teste de isolamento fala pelo PostgREST com JWT de usuário final; usar a conexão do owner
    faria as asserções passarem sem tocar em política nenhuma. A única exceção deliberada é o
    teste do trigger append-only, que **precisa** do owner justamente para provar a camada que
    protege contra quem escapa da RLS.
- **Passos:**
  1. `npm ci`.
  2. **Domínio/main:** `vitest run` das categorias `regras` e `banco` com `--coverage --reporter=json`.
  3. **Renderer (componente):** `vitest run` (jsdom) com `--coverage --reporter=json`.
  3b. **E2E:** ativo desde a **Fatia 03** (entregue em 2026-07-22); desde o **card #34** roda no
     **job `e2e` à parte** (não neste job, e só quando o PR toca a fronteira — ver a abertura da
     §6). Lá dentro: `npm run build` → `xvfb-run playwright test` (o Electron abre janela: no Linux
     do CI precisa de display virtual). O reporter JSON e o caminho de saída vivem no
     `playwright.config.ts`. Ver §3.1 para as armadilhas de ambiente antes de depurar falha de
     launch no CI.
  4. `npm run test:report` → escreve a tabela em **`$GITHUB_STEP_SUMMARY`** (aba do run) **e**
     publica/atualiza um **comentário fixo no PR** (sticky comment).
  5. `npm run test:report:check` → **falha se `reports/TESTS.md` divergir** de uma execução limpa.
- **Metadados da entrega:** `REPORT_ISSUE` sai do `refs #N` do corpo do PR (o elo canônico
  PR→issue — `closes #N` é proibido, ver `CONVENTION.md`); `REPORT_SPEC` do link
  `docs/spec/spec-*.md`; `REPORT_PR`/`REPORT_PR_URL` do evento do PR; `REPORT_DATE` do
  `updated_at`. Ausentes → `—`, e o gerador segue verdadeiro nos números.
- **Cobertura:** **report-only** — publica os números, **não barra o merge**. (Subir para portão
  com limiar fica para depois, quando houver baseline e mais confiança.)

Nada disso usa `closes #N` nem toca em aceite — é comentário informativo. O aceite continua sendo
ato deliberado do PI (`CLAUDE.md`); o CI só torna a *evidência* impossível de falsificar.

## 7. Reutilização em projetos futuros

O objetivo é ter isto "de fábrica" nos próximos projetos. Os artefatos portáveis são:

- `.github/workflows/ci.yml`
- `scripts/gen-test-report.ts` (**repo-agnóstico** — lê tudo do config; portou verbatim do proplan)
- `scripts/gen-test-report.selfcheck.ts` (**repo-agnóstico** — portou verbatim)
- `scripts/test-report.mjs` (orquestrador — **muda por stack**: aqui roda Vitest+Playwright)
- `test-report.config.json` (o mapa categoria→origem; **o único dado que muda por projeto**)
- as convenções de sufixo (`*.spec.ts` / `*.int-spec.ts` / `*.test.tsx` / `e2e/*.spec.ts`)

Cair num projeto novo = copiar o gerador + selfcheck (imutáveis), reescrever o orquestrador para a
stack, ajustar o config, criar `reports/`.

## 8. Critérios de aceite (verificáveis pelo PI)

Para o Code implementar **na Fatia 01** e o PI conferir:

- [ ] CI roda em todo PR e publica a tabela no **job summary** e em **comentário fixo do PR**.
- [ ] Todos os números vêm de `--json` dos runners; **zero** número escrito à mão.
- [ ] `reports/TESTS.md` existe, tem o cabeçalho "GERADO — NÃO EDITAR", e traz 3 linhas
      (Banco/Regras/Tela) por entrega + seção `## Estado atual`.
- [ ] `npm run test:report:check` **falha** o CI quando a seção de números não bate com uma
      execução limpa (anti-forja).
- [ ] `--check` **falha** quando uma linha já registrada some do histórico (append-only), tendo o
      blob da base do PR como baseline — nunca o próprio arquivo.
- [ ] O gerador tem self-check próprio no CI (`npm run test:report:selfcheck`), incluindo o caso CRLF.
- [ ] Cobertura é **reportada**, não barra merge.
- [x] **Fatia 01:** `src/renderer` tem **Vitest + Testing Library**; a categoria "Tela"
      (componente) não fica vazia. **Banco** (SQLite) entrou na F04 e o **Playwright-Electron
      (E2E) na F03** (2026-07-22) — nenhuma das três categorias conta 0 desde então.
- [ ] `reports/TESTS.md` **não** está sob `docs/`.
- [ ] A decisão está registrada como **ADR-003** (`docs/adr/adr-003-relatorio-testes-evidencia.md`).

## 9. Decisões operacionais

- **Gerenciador/comando:** `npm run test:report` (a **SPEC-Fundacao-01 fixou npm**; o `pnpm` do
  proplan não se aplica — o `electron-vite` é single-package, sem monorepo).
- **Runner:** **Vitest** (unidade + componente) e **Playwright-Electron** (E2E). Sem Jest.
- **Playwright no CI:** **ativo desde a Fatia 03** (2026-07-22). Desde o **card #34** (2026-07-24)
  roda **condicional por `paths`** no job `e2e` — só quando o PR toca a fronteira preload/IPC/janela
  (ver §6), porque build + xvfb + keyring dominavam o tempo de CI (~15 min) em todo PR. Com
  `xvfb-run` (Electron precisa de display). `workers: 1` é obrigatório, não preferência: o
  `requestSingleInstanceLock()` (SPEC-02) faz instâncias paralelas se derrubarem entre si.
- **Storage do "Banco":** decidido na **SPEC-Fundacao-04** — **SQLite** (`better-sqlite3`) contra
  arquivo temporário, com as migrations reais e teardown por teste. Desde a **M2-F01** a categoria
  cobre também o **Supabase local** (RLS, ver §6): a régua da categoria é *"integração com storage
  real"*, não *"SQLite"*. `fileParallelism: false` continua obrigatório — integração toca disco e
  singletons de processo (o logger é um), e em paralelo um arquivo derruba o outro.

- **Conflito de merge no `reports/TESTS.md`:** é **esperado** sempre que dois branches entregam em
  paralelo — o bloco "Estado atual" é regenerado por inteiro a cada entrega, então duas fatias
  sempre reescrevem as mesmas linhas. **Não resolva à mão** (o cabeçalho do arquivo diz `NÃO EDITAR
  À MÃO`, e escolher números na marra produziria um relatório que não corresponde a execução
  nenhuma — exatamente o que o `--check` existe para barrar). A resolução é mecânica:
  `git checkout --theirs reports/TESTS.md`, fechar o merge e rodar `npm run test:report` — os
  números saem da suíte combinada, que é o único estado que passa a valer. Visto na **M3-F03b**,
  quando o merge da `main` trouxe o FIX #43 (+15 em Banco).

Governadas pelo **ADR-003** (`docs/DECISIONS.md`).

## 10. Implementação de referência (o "code que faz o relatório")

O código abaixo é **provado em produção no `rrb-proplan`** e é o que a Fatia 01 porta. Divide-se em
peças imutáveis (repo-agnósticas) e peças que mudam por stack.

### 10.1 `scripts/gen-test-report.ts` — o gerador (imutável, porta verbatim)

Não conhece GitHub, git-remote, Vitest nem Electron. Lê **caminhos** do `test-report.config.json` e
produz/verifica o `reports/TESTS.md`. Contrato:

- **Entrada de números** (nunca digitados): para cada categoria do config lê
  - `resultsJson` → runner Jest-compatível: `{ numTotalTests, numPassedTests, numFailedTests }`
    (Vitest emite exatamente isso);
  - `playwrightJson` (opcional) → `{ stats: { expected, unexpected, flaky } }` (pass = `expected`,
    falha = `unexpected + flaky`); soma-se à contagem do runner, **sem** cobertura;
  - `coverageSummary` (opcional) → `total.lines.pct`, ou `—` se ausente (E2E não tem).
  - Arquivo ausente ⇒ zeros; o gerador nunca quebra por falta de artefato.
- **Metadados** (rótulos humanos, via env; ausente → `—`): `REPORT_DATE`, `REPORT_ISSUE`,
  `REPORT_SPEC`, `REPORT_PR`, `REPORT_PR_URL` (ou monta de `repoUrl` do config + o número).
- **`render(rows, existing, meta)`** — funções exportadas `keepHistory` e `droppedHistory` são o
  coração do append-only e são o que o self-check exercita:
  - `keepHistory(doc)` lê **só** a seção após `## Histórico por entrega` (o `## Estado atual` é
    sempre regenerado e nunca realimenta o histórico); ignora cabeçalho/separador; normaliza CRLF.
  - Sem issue (`meta.issue === '—'`): **preserva** o histórico e **não** acrescenta linha.
  - `droppedHistory(before, after)` = linhas de `before` ausentes de `after` (continência de
    conjunto). `before` **tem de vir do git** (base do PR), não do arquivo auditado.
- **`--check`** faz as duas provas independentes da §5 (números via bloco `## Estado atual`
  normalizado; histórico via `droppedHistory` contra `REPORT_BASE_REF`), com exit 1 nomeando o que
  falhou.

### 10.2 `scripts/gen-test-report.selfcheck.ts` — a guarda da guarda (imutável, porta verbatim)

`assert` puro do Node (sem jest/vitest — o import atravessa a fronteira do `rootDir` dos runners).
Prova, entre outros: append puro não perde nada; histórico zerado é detectado (o bug clássico);
upsert de linha commitada conta como perda; sumiço no meio é pego sem falso positivo nos vizinhos;
**CRLF não vira falso positivo nem mascara perda real**. Roda no CI antes do `--check`.

### 10.3 `test-report.config.json` — o único arquivo que muda por projeto (template jarvis)

```json
{
  "$comment": "Mapa categoria→origem para o gerador (ADR-003 §3). Único arquivo que muda por projeto — gen-test-report.ts é repo-agnóstico. Sufixos são convenção, não hardcode.",
  "reportPath": "reports/TESTS.md",
  "repoUrl": "https://github.com/RodReis/rrb-jarvisOS",
  "categories": [
    {
      "name": "Regras de Negócio",
      "runner": "vitest",
      "resultsJson": "reports/.raw/regras.json",
      "coverageSummary": "coverage/regras/coverage-summary.json"
    },
    {
      "name": "Banco",
      "runner": "vitest",
      "resultsJson": "reports/.raw/banco.json",
      "coverageSummary": "coverage/banco/coverage-summary.json"
    },
    {
      "name": "Tela",
      "runner": "vitest+playwright",
      "resultsJson": "reports/.raw/tela-vitest.json",
      "playwrightJson": "reports/.raw/tela-playwright.json",
      "coverageSummary": "coverage/tela/coverage-summary.json"
    }
  ]
}
```

### 10.4 `scripts/test-report.mjs` — o orquestrador (muda por stack: Vitest+Playwright)

Roda os runners nos caminhos que o config espera, depois chama o gerador. Portável (Windows dev +
Linux CI): usa `spawnSync` com `shell:true` no Windows (resolve o `.cmd` do `npx`). **Testes que
falham não abortam o relatório** — a contagem de falhas é o dado; só o `--check` barra o CI, e por
divergência de número, não por falha. Diferença para o proplan: no lugar de `jest --selectProjects`
em `apps/api`, roda **três execuções Vitest** (uma por categoria, via `include`/`--project` +
`coverageDirectory` próprio) e uma execução **Playwright** para a parte E2E de "Tela". Flags:
`--check` (verifica em vez de escrever), `--no-run` (só gera do que já está em `reports/.raw`),
`--selfcheck` (só prova o gerador).

### 10.5 `package.json` (scripts, criados na Fatia 01)

```json
{
  "scripts": {
    "test:report": "node scripts/test-report.mjs",
    "test:report:check": "node scripts/test-report.mjs --check",
    "test:report:selfcheck": "node scripts/test-report.mjs --selfcheck"
  }
}
```

> O código-fonte completo e comentado das peças imutáveis (10.1 e 10.2) está no `rrb-proplan`
> (`scripts/gen-test-report.ts` e `scripts/gen-test-report.selfcheck.ts`) e é copiado sem alteração.
> Só 10.3 e 10.4 são reescritos para a stack do jarvis.

## 11. Pipeline de desenvolvimento governado

Esta seção complementa a metodologia existente para as SPECs dos MVPs 006, 008 e 009. Os testes comuns não gastam GitHub/Tavily/Claude reais; adapters usam contract fixtures. Smoke real é gate de conclusão do MVP ou de mudança material no adapter.

### 11.1 Camadas

- **Unitário:** estados, DAG, hashes, invalidação, orçamento, fingerprint e sanitização.
- **Contrato:** GitHub, Tavily e Claude com sucesso, auth, permissão, rate limit, quota, timeout e resposta incompatível.
- **Integração:** SQLite, Git, filesystem, worktrees, leases, portas e Docker em recursos temporários exclusivos.
- **UI/Playwright:** wizard, autosave, anexos, aprovações, roadmap, bloqueios e painel.
- **E2E real limitado:** Device Flow, Tavily, Claude, repositório, PR, CI e squash merge reais com orçamento e nomes exclusivos.

### 11.2 Falhas obrigatórias

Injetar encerramento entre intenção/efeito/confirmação, token expirado, 429/432/433, provider interrompido, CI falho, stale SHA, rebase, worktree ausente, porta ocupada e merge já existente. Reinício deve convergir sem duplicação.

### 11.3 Relatório por SPEC/issue

- `docs/test-reports/<SPEC-ID>.md`: resumo humano versionado.
- `reports/TESTS.md`: evidência agregada gerada conforme ADR-003.
- SQLite/artefatos: logs extensos; o relatório referencia seus hashes.

O relatório identifica SPEC, issue, revisão aprovada, run, ambiente, verificações, correções, regressões, custos, `head SHA`, checks e `merge SHA`.

### 11.4 Revisão

`docs/REVIEW.md` governa formato e severidade. Baseline P0/P1 bloqueia; P2/P3 é registrado. Relatório anterior entra para deduplicação; somente o delta e descobertas ainda abertas são avaliados como novos.

### 11.5 Release governada — MVP-014

- **Unitário:** estados/transições, leases, idempotência, consolidação de SHAs, redaction e janela de estabilização.
- **Contrato:** Docker, GHCR, Vercel e Railway com sucesso, auth, timeout, quota, estado incompatível, resposta parcial e efeito ambíguo.
- **Integração:** SQLite, Docker Compose, PostgreSQL real, migrations e ownership de portas/containers.
- **Fault injection:** crash entre intenção/efeito/confirmação, migration quebrada, health falho, promoção parcial, retry e compensação incompleta.
- **Playwright:** smoke funcional nas URLs de Preview, Staging, Produção e após rollback.
- **E2E real limitado:** projeto de prova exclusivo, nomes/recursos únicos e orçamento explícito; percorre Preview → Staging → Produção → estabilização → compensação/limpeza.

Provas mínimas: mesmo digest/deployment em Staging e Produção; zero segredo persistido; reinício sem duplicação; Preview removido; banco nunca restaurado automaticamente; tag/GitHub Release somente depois de Produção estabilizada; falha de código devolvida à V2 na mesma SPEC.

Smokes externos não rodam na suíte comum. Sua ausência em ambiente sem credencial é `not_run`, nunca “pass”. O relatório registra provider, ambiente, IDs, SHA/digest, duração, custo/quota observada, gates e hash das evidências extensas.

### 11.6 Observabilidade operacional — MVP-015

- **Unitário:** schemas/versionamento, allowlist de payload, idempotência, deduplicação, severidade, resolução, retenção e rollups.
- **Integração SQLite:** estado + outbox atômicos, crash/replay, migrations, checkpoints e rebuild completo das projeções.
- **Contrato:** GitHub, GHCR, Vercel, Railway, Codex e executores com sucesso, auth, timeout, rate limit, quota parcial/desconhecida e schema incompatível.
- **Fault injection:** evento duplicado, atrasado e fora de ordem; clock skew; disco indisponível; processo encerrado; notificação falha e provedor alternando entre saudável/desconhecido.
- **IPC:** snapshot inicial, deltas versionados, salto de versão, reconexão e paginação por cursor.
- **Playwright/E2E:** run → PR → Preview → Release → alerta → reconhecimento → resolução → evidência, incluindo teclado/foco e `critical` com notificação nativa simulada.
- **Carga de referência:** fixture determinística com 100 mil eventos e 10 mil ocorrências; consulta principal `p95 ≤ 500 ms`, console útil em até 2 s e evento interno visível em até 1 s. Ambiente e warm-up são registrados para evitar número sem contexto.
- **Smoke externo:** opt-in em projetos de prova; nunca Produção e nunca na suíte comum.

Provas mínimas: domínio continua apesar de projetor indisponível; replay não duplica; evento atrasado não regride estado atual; payload proibido é rejeitado antes de persistir; `quota_unknown` não vira percentual; UI e CLI retornam a mesma projeção; compactação preserva marcos, alertas abertos, auditoria e evidência.

### 11.7 Aprendizado operacional — MVP-016

- **Unitário:** fingerprints, aplicabilidade, estados, resolução por escopo, conflitos, guardrails e rollback.
- **Property tests:** idempotência de ingestão, deduplicação, ordem de eventos e snapshots imutáveis.
- **Integração SQLite:** migrations, checkpoints, concorrência de promoção, crash/replay e rebuild.
- **Replay/diferencial:** fixtures históricas com baseline e candidata sobre casos elegíveis equivalentes; resultado `improved | regressed | inconclusive` reproduzível.
- **Contrato:** seleção, compressão e cache opcionais; Graphify/Caveman ausentes ou falhos recuam para estratégia determinística.
- **Fault injection:** evidência ausente/hash divergente, executor indisponível, versão-base obsoleta, canário regressivo e rollback falho.
- **Playwright/E2E:** run → falha → resolução → candidata → replay/shadow/canário → política ativa → regressão/reversão, incluindo `Decide por mim` e teclado/foco.
- **Prova real limitada:** separada das suítes comuns, sem serviço pago obrigatório; registra executor, modelo, ambiente, amostra, consumo, versões e hashes.

Provas mínimas: falha semelhante não esconde causa nova; economia não promove com guardrail violado; run mantém o snapshot inicial; override de projeto vence global; política incompatível fica `stale`; ausência do aprendizado mantém política estável/base e não bloqueia a pipeline.

Detalhamento aprovado da M16-F04 (`spec-aprendizado-04-experimentos-promocao.md`, revisão `1cefc2c`; implementação ainda não iniciada):

- Contratos e seeds fixos provam alocação prévia, coorte completa e teto por contagem sob concorrência; retry/continuação não infla amostra.
- Fixtures cobrem baseline zero, consumo ausente, falhas mais baratas, grupos desbalanceados, pendências, pesos/exclusões/cortes pós-resultado e diferença entre estimativa e medição.
- Relatório diferencia prova de replay/shadow da prova real do canário; nenhum estágio simulado declara qualidade final contrafactual ou significância estatística sem método.
- Relógio injetável prova tempo e amostra simultâneos para estabilizar, prazo inconclusivo e rollback do grupo afetado; não basta esperar o timer.
- Crash entre reserva/alocação/snapshot/confirmação, revogação de controle, prova corrigida, retenção e reconstrução não podem duplicar efeito, alterar snapshot ou reativar decisão antiga.
- Testar núcleo F04 e registro F03 reais com mecanismos/insumos simulados; sem CLI paga ou Git/deploy externo na suíte comum. Isso especifica verificações futuras, não relata testes já executados.

### 11.8 Projeção Graphify — M7-F05

- **Unitário:** estados, schemas, limites, deduplicação, contador idempotente de merges, frescor, orçamento, invalidação e descarte da cauda interativa.
- **Contrato simulado:** baseline `graphifyy==0.9.53`, comandos suportados, stdin fechado, timeout, versão/esquema incompatível, manifesto ausente, remoção e geração parcial.
- **Integração local:** repositório Git temporário com fatia de fundação, `.gitignore`, bootstrap, quatro merges, update incremental, delta, lock, publicação conjunta e retomada.
- **Regressão de contexto:** impede envio do `graph.json`/relatório integral, limita candidatos/fontes/trechos, exige justificativa de expansão e mede tokens estimados.
- **Smoke real opt-in:** runtime fixado e corpus determinístico; sem instalação ou API paga na suíte comum. Ausência é `not_run`, não sucesso.

Provas mínimas: Graphify ausente/incompatível mantém busca básica; pergunta final não recebe resposta nem cria gate; `save-result`/`reflect` não executam; o quarto PR dispara somente update; fonte removida não permanece consultável; falha parcial não publica checkpoint; consulta desatualizada inclui delta do Git; `graphify-out/` não entra no Git ou contexto e fica no `.claudeignore` quando Claude Code participa.

### 11.9 Validação de lições operacionais — M7-F06

- **Unitário:** identidade/revisão, estados derivados, aplicabilidade, deduplicação, compatibilidade de avaliador, cobertura e limites.
- **Contrato:** fixtures determinísticas de `execution_expected_outcome` e `project_delivery_gate`, incluindo schema/critério inválido e versão incompatível.
- **Integração SQLite:** inbox/outbox, atomicidade, crash/replay, paginação, pausa, reprocessamento e estado publicado em conjunto.
- **Integração F02/F03/F04:** fila compartilhada, recuperação filtrada por projeto/estado/dimensões, perda de evidência e barreira contra reativação.
- **Regressão/contrafactual:** candidato, estado desconhecido, cobertura stale, falha técnica, redelivery ou evidência retrospectiva nunca viram validação; remover filtros/atomicidade deve reprovar teste direcionado.

Provas mínimas: todos os critérios obrigatórios sustentados produzem `validated`; insuficiência mantém `candidate`; contradição/perda de prova produz `needs_revalidation`; aceite do PI e merge não viram prova de impacto; reinício não zera tentativas; excesso pagina sem fingir completude; nenhuma chamada de modelo, Graphify ou serviço pago participa da avaliação. SPEC aprovada na revisão `4f47c12`; aprovação não é evidência de execução dos testes.
