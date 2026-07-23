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
| **Tela** | Componente + E2E (topo) | UI: componente renderiza/reage certo (Vitest + Testing Library + jsdom) e fluxo crítico funciona no app real (Playwright-Electron) | Vitest — `src/renderer/**/*.test.tsx`; Playwright — `e2e/**/*.spec.ts` | componente rápida / e2e lenta |

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
  Na coluna Cobertura, "Tela" reflete o **Vitest** (componente); Playwright entra só com
  **contagem** (pass/falha). Isso é honesto, não uma lacuna.
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
rodá-lo sem `npm run build` testaria a versão anterior do código. O orquestrador
(`scripts/test-report.mjs`) já faz o build antes de chamar o Playwright.

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
**`--check`**, que faz **três provas independentes** — são três formas distintas de a evidência
mentir:

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

Dispara em **todo pull request** para `main`. Job `test`:

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
  3b. **E2E:** ativo desde a **Fatia 03** (entregue em 2026-07-22). `npm run build` →
     `xvfb-run playwright test` (o Electron abre janela: no Linux do CI precisa de display
     virtual). O reporter JSON e o caminho de saída vivem no `playwright.config.ts`. Ver §3.1
     para as armadilhas de ambiente antes de depurar falha de launch no CI.
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
- **Playwright no CI:** **ativo desde a Fatia 03** (2026-07-22). Roda **sempre** enquanto a suíte
  for pequena (3 testes, ~2s local); com `xvfb-run` (Electron precisa de display). Reavaliar
  (label/condicional) se o tempo de CI incomodar. `workers: 1` é obrigatório, não preferência: o
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
