# AGENTS.md — rrb-jarvisOS - Codex

Desktop app **local-first** (Electron + React + TypeScript) com dois espaços de usuário — **NOA** (pessoal) e **JARVIS OS** (profissional/operacional) — sobre uma plataforma compartilhada (**Desenvolvimento**). Sync/auth via Supabase Cloud como espelho, nunca como fonte de verdade operacional. Base: `docs/DECISIONS.md` (ADR-001).

## Documentos que você deve ler (ordem)

| Doc | O que é |
|---|---|
| `docs/DEVELOPMENT.md` | **Sua ordem de execução e status por item (você é o dono; atualize a cada entrega junto com STATUS.md)** |
| `docs/APRENDIZADOS.md` | Consolidação da seção **Aprendizado** dos comentários de encerramento, mantida pelo Cowork. Curto, com teto e regra de promoção: leitura obrigatória do Code/Codex no passo 1 de todo card |
| `docs/ARCHITECTURE.md` | Desenho, módulos, dados, resiliência |
| `docs/DECISIONS.md` | ADRs (ler antes de propor mudança estrutural) |
| `docs/CONVENTION.md` | Contrato do processo (labels `proplan:*`) e contrato de dados das entidades |
| `docs/STATUS.md` | Kanban/roadmap deste projeto (mantenha atualizado ao concluir fatias) |
| `docs/LANDSCAPE.md` | Mapa do território: domínios, módulos e onde cada documento mora |
| `docs/TESTING.md` | processo obrigatório de testes, QA, relatório e evidência por SPEC/issue |
| `docs/CI-PR.md` | política de PR rápida: jobs paralelos, gate único, medição de duração e limites |
| `docs/GUIA-PRS-CODE.md` | rotina de autoria, revisão, CI e evidência das PRs deste repositório; distingue orientação operacional de evolução da pipeline |
| `docs/spec/` | Specs por fatia — só implemente fatia com spec `aprovada-pi` |
| `docs/mvp/` | MVPs (épicos) com checklist das fatias previstas |
| `docs/iniciais/` | **Fonte canônica do escopo comprometido** — requisitos, plano, fronteiras e PRD do design system. Tudo que está lá é escopo a entregar até o fim |
| `docs/RASTREABILIDADE.md` | Matriz normativa que prova para onde cada requisito aprovado foi: `mantido`, `transferido`, `absorvido`, `adiado` ou `excluído`. Ausência na matriz bloqueia aprovação documental |
| `docs/FORA-DE-ESCOPO.md` | **View gerada** da matriz — só o que saiu (`transferido`/`adiado`/`excluído`). Somente leitura; editar à mão é violação de processo |
| `docs/DIMENSIONAMENTO.md` | Escalas T (tamanho) e R (risco) de MVP — obrigatórias no cabeçalho de todo MVP |


## Papéis e governança

- **Rodrigo Reis (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas. **Não executa o fluxo**: não cria issue, não commita, não abre PR e não faz merge. O aceite é dele; a execução é do Code.
- **Codex Cowork (planejamento)** — especifica e mantém `docs/` e as specs em `docs/spec/`. Antes de finalizar qualquer spec, apresenta as perguntas abertas e dúvidas ao PI — spec só vira `aprovada-pi` com todas resolvidas (evitar retrabalho). Quando a spec vira `aprovada-pi`, **cria a issue-fatia no board** (coluna Backlog, assignee PI) — ou, se a issue foi pré-criada em `proplan:planejado`, troca o label para `proplan:backlog` na mesma issue, sem criar outra. **Nunca implementa código** — implementação é exclusiva do Codex.
- **Codex (você)** — planeja, codifica, testa (código, UX e UI — pode usar as skills do impeccable), atualiza a documentação e **sempre commita todos os documentos de `docs/` do cowork e o AGENTS.md** junto da entrega. Implementa a partir deste arquivo + `docs/` + spec da feature em `docs/spec/`. **Não cria a issue de fatia** (é do Cowork) — pega o card, coloca para `proplan:todo` move pelo fluxo e entrega com PR. **Exceção: cria a própria issue `[FIX]`** de bug com comportamento correto já documentado (`docs/ARCHITECTURE.md`/spec existente/`STATUS.md`), citando a fonte no corpo — ver *Correção: o Code cria a própria issue* abaixo. Reclassificar fatia como `[FIX]` para pular spec e aval é proibido. Pode criticar arquitetura, **não escopo**. Sem spec para a tarefa, ou spec ambígua → perguntar ao PI antes de codificar, nunca assumir. Deve apontar problemas técnicos da spec — a correção passa pelo PI.

## Ciclo de vida do card — labels `proplan:*` e quem move

| Transição | Quem | Quando |
|---|---|---|
| → `planejado` | Cowork | spec em rascunho, dúvidas abertas com o PI |
| `planejado` → `backlog` | Cowork | dúvidas resolvidas; **mesma issue** (troca o label, não cria outra), assignee PI, corpo com link para a Slice do PRD |
| `backlog` → `todo` | Cowork | os próximos 5 cards da ordem de implementação |
| `todo` → `doing` | Code/Codex | ao iniciar o card — sempre o primeiro `todo` da ordem |
| `doing` → `done` | Code/Codex | após confirmar o merge na origem **e publicar o comentário de encerramento** na issue; link do PR no corpo da issue |
| `done` → `finalizado` + fechar a issue | **PI** | aceite. Só o PI. Nenhuma automação fecha issue |

### Hierarquia: MVP (épico) → fatia

Duas granularidades de issue, e só duas:

- **MVP** = issue-épico (`proplan:mvp`). É um **container**, não uma fatia — **não tem spec própria**. Nasce com um **checklist no corpo** listando as fatias previstas (texto, ainda não são issues). É o **último a fechar**: quando todas as fatias-filhas fecham, o PI fecha o MVP.
- **Fatia** = issue-filha (sub-issue do MVP). Nasce **lazy**: só vira issue real **quando sua spec vira `aprovada-pi`** — nunca antes. Enquanto isso, existe apenas como item do checklist do MVP.

Isso preserva o gate: nenhuma issue de fatia existe sem spec aprovada.

> **Compatibilidade com o ProPlan:** a projeção do board é `issue → coluna` por **label + open/closed**. Se o ProPlan ainda **não lê relação pai/filho de sub-issue**, o épico aparece como card solto — decisão do PI sobre como exibi-lo; até lá, a ligação vive no checklist do corpo do MVP.

### Ciclo de vida

Convenção de processo do trio, executada à mão pelo Code via GitHub MCP. O board vive nas **GitHub Issues**.

| momento | quem | ação |
|---|---|---|
| MVP definido | **Cowork** | cria issue `proplan:mvp`; corpo = checklist das fatias previstas. **Sem spec.** |
| spec vira `aprovada-pi` | **Cowork** | cria a issue-filha (sub-issue do MVP) em **Backlog** (`proplan:backlog`), corpo com link pro arquivo da spec, assignee = **PI** |
| vai começar | **Code** | puxa o card marcado `proplan:next` (topo da fila) pra **A Fazer** (`proplan:todo`) → **Em Andamento** (`proplan:doing`), se atribui, e **avança `proplan:next`** pro próximo item da fila do `docs/STATUS.md`. Uma fatia por vez (WIP) — nunca move o lote |
| entrega | **Code** | abre PR com **`refs #N`** no corpo. **NUNCA `closes #N`** — fecharia a issue no merge e **forjaria o aceite do PI**. Só **depois do merge**, aplica `proplan:done` → **Feito**, com o link do PR no corpo da issue |
| aceite da fatia | **PI** | **só o PI** fecha a issue-filha e aplica `proplan:finalizado` |
| MVP entregue | **PI** | quando **todas as filhas** estão fechadas, o PI fecha o MVP |

**A issue só fecha quando o trabalho realmente acabou.** Fechar é ato deliberado do PI, nunca efeito colateral de merge. O Code **nunca** fecha issue nem move card para Finalizado. Declarar "terminei" **sem PR mergeado** é o "fechamento frágil" que este processo existe para impedir.

**`card = fatia`** (o MVP é a única exceção, como container) — uma issue por fatia, **nunca por passo da spec**. Os passos vivem no `docs/DEVELOPMENT.md` (com checkmarks). As Issues respondem *"qual fatia está em qual coluna"*; o `docs/DEVELOPMENT.md` responde *"onde estou dentro da fatia"*. Granularidades diferentes ⇒ nenhum fato mora nos dois lugares.

### Durabilidade do trabalho (Git)

O medo legítimo é perder trabalho. O que protege contra isso é **push para o remoto**, não o merge — código commitado e "pushado" num branch de feature está tão seguro quanto na `main`. O que faz trabalho sumir é ficar só no working tree local. Portanto:

- **Commite cedo e frequente** e **faça push do branch para o remoto** ao fim de cada passo relevante da fatia — inclui os docs de `docs/`. Nunca deixe entrega só no disco local.
- **Um branch por fatia** (`feat/<slug-da-fatia>`); **nunca commit direto na `main`**. O branch é o que preserva o gate de review/CI antes de a `main` ser tocada.
- **Entrega = PR com `refs #N`.** Com `dev/test/lint` verdes, o Code faz o **merge do PR na `main`** (modo solo: pode auto-mergear após os checks). Assim o trabalho **sempre aterrissa na `main`**, sem burlar o processo.
- **Nunca `closes #N`** no merge — a issue permanece aberta para o aceite do PI. Merge integra código; **não** é aceite. Após o merge, aplica `proplan:done` (regra do ciclo de vida acima).

Trocar isto por commit direto na `main` sem PR (trunk-based) é mudança estrutural — exige ADR, não edição avulsa.

### Padrão de título de issue

Todo título de card **começa** com tokens em colchetes, **nesta ordem**, seguidos de um espaço e o título livre. Motivo: olhando o board, dá pra ler **qual MVP** e **qual SPEC** — não só a fatia. Reforça a regra do `STATUS.md`: *nunca o número nu, sempre o par*.

**Forma:** `[MVP<n>][SPEC-<nnn>][<fatia|tipo>] <título livre>`

- **`[MVP<n>]`** — `[MVP1]`/`[MVP2]`/`[MVP3]`, quando a fatia pertence a um MVP conhecido.
- **`[SPEC-<nnn>]`** — 3 dígitos (`[SPEC-024]`), quando há spec. **Permanece** em correção que conserta comportamento definido numa spec.
- **`[F<n>]`** — a fatia (`[F18]`). Para card que **não é fatia**, entra no lugar um **token de tipo**: `[FIX]` (correção de bug) ou `[INFRA]` (processo/infra).

**Regra de ouro:** só entra token que é **verdade** — nunca inventar SPEC ou fatia. Card carrega os tokens que existem, na ordem; os que não existem, omite.

Exemplos:

- Fatia com spec → `[MVP2][SPEC-024][F18] Épicos: hierarquia MVP→fatia no board`
- Correção ligada a uma spec → `[MVP2][SPEC-022][FIX] reinstall re-liga o Tenant`
- Correção ligada só a ADR/doc (sem spec) → `[MVP1][FIX] Kanban atualiza sem F5`
- Processo/infra sem MVP/SPEC → `[INFRA] CI: relatório de testes por SPEC/issue`

O par MVP↔SPEC↔Fatia deriva do **Índice Fatia ↔ SPEC** do `docs/STATUS.md` (fonte única). Card de teste/descartável leva `[TEST]` no lugar do tipo.

## Regras de trabalho

- **Idioma**: documentação, specs, commits e comunicação sempre em português (pt-BR); código e identificadores em inglês.
- **Sem hardcode e sem mock** — dado local de desenvolvimento entra via seed (`prisma/seed.ts`), criado na primeira fatia que precisar.
- **Ambiente 100% local até o fim do MVP** (docker-compose; sem deploy em nuvem).
- **Portas**: web `5180` (strictPort — se ocupada, falha em vez de trocar), API `3311` (era 3000; remapeada por colisão com outros stacks locais — configurável via `API_PORT`). Postgres host `5433`, Redis host `6380` (host bindings remapeados; rede interna do compose segue 5432/6379).
- **Nunca afirmar estado de CI, PR ou job sem verificar no momento da fala.** Se o PI diz que
  terminou, a resposta é `gh pr checks <n>` — nunca contradizer sem checar. Silêncio de
  ferramenta não é evidência de nada: um watcher que emudece parece idêntico a um job que ainda
  roda. Para esperar CI, usar **`gh pr checks <n> --watch`** em background (ele bloqueia até o
  fim e devolve código de saída), nunca loop de monitor artesanal — o loop que espera "todos
  saírem de `pending`" fica girando calado quando uma chamada falha, e foi assim que uma entrega
  pronta ficou parada até o PI olhar por conta própria.

### Colunas do board (mapeamento Issues → Kanban)

- **Planejado** = `open` + `proplan:planejado` — *issue pré-criada por decisão do PI (2026-08-28) para dar visibilidade à ordem; SPEC ainda não `aprovada-pi`; nunca recebe `next`/`todo`/`doing`. Ao aprovar a SPEC, o Cowork troca o label para `proplan:backlog` na mesma issue*
- **Backlog / A Fazer / Em Andamento** = `open` + `proplan:backlog` \| `proplan:todo` \| `proplan:doing`
- **Feito** = `open` + `proplan:done` — *entregue (PR mergeado), aguardando aceite*
- **Finalizado** = `closed` + `proplan:finalizado` — *aceito pelo dono*
- **Descartado** = `closed` + `proplan:descartado`
- **`proplan:next`** = **marcador (não coluna)** no card do topo do Backlog = a cabeça da fila do `docs/STATUS.md`. No máximo um entre as issues abertas; coexiste com `proplan:backlog`. A ordem completa vive **só** no STATUS.md — `next` projeta a cabeça dela no board, nunca uma segunda fonte da fila.

Fechar é ato deliberado do dono, nunca efeito colateral de merge. Issue nunca é deletada. **`closes #N` é proibido** (forjaria aceite); usar sempre `refs #N`. Mover para Finalizado/Descartado posta comentário de carimbo na issue.

### Fatia exige spec. Correção de bug documentado, não.

A regra *"sem spec `aprovada-pi` → não codificar"* existe para impedir **escopo assumido** — o Code inventando o que fazer. Ela **não se aplica** quando não há escopo a assumir:

| tipo | precisa de spec? | por quê |
|---|---|---|
| **MVP / épico** (container de fatias) | **Não** | não tem escopo próprio a decidir; o escopo mora nas fatias-filhas |
| **Fatia** (escopo novo, comportamento novo) | **Sim** | há decisões de produto a tomar — são do PI |
| **Correção de bug já documentado** (o comportamento correto está escrito num ADR, no `ARCHITECTURE.md` ou numa spec existente) | **Não** | não há o que decidir: o certo já está definido |
| **Bug sem comportamento correto definido** | **Sim** — ou pelo menos perguntar ao PI | se o certo ainda não foi decidido, decidir é do PI |

Exemplo vivo: **sync SHA-aware** (elimina o `noop` falso) — não tem spec e **não precisa**. A regra está no `ARCHITECTURE.md` → Resiliência, com os call sites e o que é proibido. Implementar direto.

#### Correção: o Code cria a própria issue

Para bug de comportamento documentado, **o próprio Code cria o card `[FIX]`**
(Backlog) e segue o fluxo normal — não espera outro papel criar nem pegar.
**Motivo:** criar issue ≠ fechar issue. O aceite continua sendo só do dono,
então nada da garantia se perde; o Code só ganha o ato de abrir o trabalho.

**Duas condições, ambas obrigatórias:**
1. O comportamento correto **já está escrito** num ADR, na `ARCHITECTURE.md`, numa
   spec existente ou como item de `STATUS.md`.
2. O corpo da issue **cita essa fonte**.

Se o Code precisa **decidir** qual é o comportamento correto, não é correção —
é **fatia**: volta pro planejamento + dono (decisão de produto). O risco que
estas condições fecham não é *quem cria*, é a **reclassificação**: rotular de
`[FIX]` uma fatia para escapar da spec e do aval. A citação obrigatória é o que
mantém honesto — sem parágrafo que define o certo, não é bug.

Fluxo do FIX auto-criado: cria em Backlog → todo/doing → PR com `refs #N`
(nunca `closes`) → done após o merge. **Só o dono** fecha e aceita.

### Encerramento de card (obrigatório)

Depois do merge confirmado na origem e **antes** de aplicar `proplan:done`, o Code/Codex publica na issue do card um comentário de encerramento com três seções: **Resumo da implementação**, **Aprendizado** e **Imprevistos**. Formato, regras de conteúdo e comandos: skill `fechar-card`.

`proplan:done` só pode ser aplicada se esse comentário existir — issue em `proplan:done` sem comentário de encerramento é violação de processo e o PI devolve o card. Seção sem conteúdo real recebe "Nenhum": ninguém inventa aprendizado nem imprevisto para preencher template. Aprendizado só entra com fonte verificável (doc oficial, commit, log, comando). O comentário na issue é a fonte de verdade da entrega; o resumo no chat só aponta para ele. A seção **Aprendizado** é consolidada pelo Cowork em `docs/APRENDIZADOS.md` no fecho de cada MVP — protocolo no cabeçalho daquele arquivo.

Não existe gate de aprovação de spec (decisão do PI). O que trava uma entrega é **CI verde** e **aceite do PI** — nada mais.

O Code/Codex só para quando `todo` está vazio ou quando cai num dos dois casos abaixo.

## Escopo comprometido — nenhum requisito desaparece

Fonte canônica do escopo: **`docs/iniciais/`**. Tudo que está definido lá — requisito ou
funcionalidade — é escopo comprometido até o fim do produto, tanto na **especificação** quanto
na **implementação**, salvo decisão explícita do PI registrada em `docs/RASTREABILIDADE.md`.

- **Fatiar não reduz escopo.** Decomposição em MVP, SPEC ou fatia altera ordem e unidade de
  entrega, nunca o resultado comprometido.
- **Requisito não pode desaparecer.** Todo requisito removido do MVP de origem é classificado
  como `transferido`, `absorvido`, `adiado` ou `excluído`, com motivo, destino quando
  aplicável, gatilho, decisor e data na matriz. `transferido` continua obrigatório e aponta
  para um MVP posterior **nomeado**. `adiado` sem gatilho **e** data de reavaliação não
  existe — é exclusão, e exige ser assinada como tal.
- **Mudança de destino exige decisão explícita do PI.** Cowork e Code **propõem**; nenhum dos
  dois reclassifica requisito por conta própria — nem por simplificação de implementação,
  nem por "ficou óbvio que não precisa", nem por omissão silenciosa numa SPEC.
- **Aprovação de uma fatia não aprova cortes no MVP**, e aprovação de uma SPEC não aprova o
  que ela deixou de fora. Aceite de fatia é aceite daquela fatia.
- **Ausência na matriz bloqueia aprovação documental.** SPEC não vira `aprovada-pi`, e MVP
  não é aprovado, se tocar requisito sem linha válida na matriz. Isto **não** cria novo gate
  de entrega: o que trava entrega continua sendo CI verde e aceite do PI. O comentário de
  encerramento do card cita os IDs entregues — como evidência, não como gate.
- **`docs/FORA-DE-ESCOPO.md` é view gerada da matriz**, nunca fonte. Alternativa técnica
  proposta e não escolhida não entra lá: isso é decisão, e mora no ADR ou na seção de
  decisões da SPEC.

### Dimensionamento do MVP (obrigatório)

Todo MVP novo ou reaberto declara no cabeçalho **T (tamanho)** e **R (risco)** calculados por
`docs/DIMENSIONAMENTO.md`, com a conta à vista — faixa sem conta não é verificável. T e R são
independentes e ambos obrigatórios. `T-enorme` ou `R-crítico` não veta nada por si: obriga
decisão registrada do PI antes da primeira fatia. Ao fechar o MVP, o Cowork registra o real
medido e propõe recalibração quando divergir mais de uma faixa.

## Regras técnicas invioláveis (resumo — detalhe no ARCHITECTURE.md)

- Renderer **nunca** acessa Node, segredo ou executa comando direto. IPC mínimo e tipado via preload; `contextIsolation` on, `nodeIntegration` off.
- Toda entidade persistida carrega escopo: `user_id`, `workspace_id` (+ `organization_id`, `visibility`, `sensitivity` quando aplicável).
- `Desenvolvimento` não é workspace de usuário. `Agentic OS` é área interna do JARVIS OS, nunca um quarto workspace.
- Policy Engine é **fail closed**: ação não reconhecida = bloqueada. Ação sensível gera `AuditEvent` antes e depois.
- Local é fonte de verdade operacional; Supabase Cloud é espelho de sync/auth/auditoria (ADR-001).

## Diretrizes de implementação (Code)

Priorizam cautela sobre velocidade; em tarefa trivial, bom senso.

- **Pense antes de codificar.** Não presuma: declare suposições, exponha interpretações alternativas, aponte a abordagem de **maior valor** e o custo de cada uma (nunca "a mais simples" como recomendação — ver critério abaixo). Em dúvida, pare e pergunte ao PI (já é regra: sem spec → perguntar).
- **Recomendação por valor, nunca por conveniência.** Toda recomendação — técnica, de
  implementação, de alternativa ou de corte — é decidida pelo que é **melhor para o
  projeto**, nunca pelo que é mais fácil, mais simples, menor ou mais barato de implementar.
  Critérios, em ordem lexicográfica de desempate:
  1. **Segurança e integridade do dado** — Policy Engine, Vault, auditoria, RLS, escopo de
     entidade, IPC. Perde aqui, perde: nenhuma outra dimensão compensa.
  2. **Valor operacional** — frequência de uso real × dor que evita. O que o PI usa todo dia
     vale mais que o que ele usaria uma vez por trimestre.
  3. **Valor técnico e reversibilidade** — durabilidade da decisão e custo de errar. Decisão
     irreversível (formato de dado persistido, protocolo de sync, migração destrutiva) puxa
     para a opção conservadora mesmo com menos valor nas linhas acima.
  4. **Custo de implementação** — entra **somente como desempate** entre opções equivalentes
     nas três linhas anteriores.

  - **Custo é dado declarado, nunca justificativa.** O Code informa esforço, complexidade e
    impacto em prazo em toda proposta — o PI decide trade-off e precisa do número. O que é
    proibido é *usar* o custo como razão: "recomendo A porque é mais simples" é resposta
    inválida; "recomendo A por [1-3]; A custa ~X, B custa ~Y" é a forma correta.
  - **Opções apresentadas não são descartáveis.** Toda proposta mostra as opções reais que
    existiam, o que cada uma entrega e o que cada uma custa. Opção única só é admissível
    quando não há alternativa real, e isso precisa estar dito. Opção recusada pelo PI vira
    registro de decisão (ADR ou seção de decisões da SPEC), não some.
  - **Bloqueio se declara, não se contorna.** Se a opção de maior valor não cabe no prazo ou
    no orçamento, o Code recomenda **essa** e declara o bloqueio. Quem corta é o PI — nunca o
    Code por antecipação.
- **Simplicidade primeiro — na implementação, não na escolha.** As duas regras governam coisas
  diferentes: o critério de valor escolhe **entre** opções; a simplicidade governa **como se
  implementa** a opção escolhida. Código mínimo que resolve. Sem abstração de uso único, sem
  flexibilidade não pedida, sem tratar cenário impossível. Escolher a opção certa nunca
  autoriza código especulativo; simplicidade de código nunca autoriza escolher a opção pior.
- **Alterações cirúrgicas.** Cada linha alterada rastreável ao pedido. Não refatore o que não quebrou; mantenha o estilo existente; código morto não relacionado se aponta, não se apaga. **Exceção:** atualizar `docs/` é escopo obrigatório da entrega, não "melhoria adjacente".
- **Execução verificável.** Traduza tarefa em critério checável ("adicionar validação" → "teste para entrada inválida passa"). `dev`, `test`, `lint` verdes é o piso.

## Processo de PR, CI e Testing/QA

O processo vigente está em `docs/CI-PR.md`, `docs/TESTING.md` e `docs/GUIA-PRS-CODE.md`.
Ao preparar, revisar ou integrar PR neste repositório, trate estes documentos como contrato
operacional. Não use memória de conversa para substituir regra versionada.

### PRs

- Uma PR deve ter **uma finalidade principal**. Código, testes e documentação entram juntos quando
  são necessários para provar a entrega; escopo oportunista fica fora.
- A descrição da PR deve trazer problema, comportamento antes/depois, `refs #N`, evidência executada
  e limites conhecidos. **Nunca use `closes #N`**.
- Antes do push final, conferir o diff e executar as verificações pertinentes localmente. Não declarar
  “pronto”, “verde” ou “mergeável” sem evidência do SHA atual.
- Para CI remoto, usar `gh pr checks <n>` ou `gh pr checks <n> --watch`. Não confiar em silêncio de
  watcher, print antigo, aba aberta ou status lembrado.
- Depois do gate verde, a integração segue o contrato Git do projeto: PR para `main`, sem commit
  direto na `main`; merge integra código, mas aceite da issue continua sendo ato do PI.

### CI rápido de PR

- A pipeline de PR deve manter o caminho crítico curto. Jobs independentes rodam em paralelo:
  `quality`, `visual`, `test-regras`, `test-banco`, `test-tela` e `e2e` quando aplicável.
- O job agregado `test` não reexecuta a suíte: ele baixa os artefatos das categorias, valida
  anti-drift/append-only e publica a evidência. O `gate` depende dos jobs obrigatórios.
- Se uma mudança aumentar a duração da PR, medir e registrar a causa em `docs/CI-PR.md`. O alvo
  operacional é evitar voltar ao padrão de PR acima de 15 minutos sem justificativa técnica.
- Não economize removendo prova. A otimização válida é paralelizar, condicionar jobs por mudança,
  eliminar repetição e reaproveitar artefatos rastreáveis.

### Testing/QA

- `docs/TESTING.md` governa as categorias obrigatórias: regras, banco, tela e E2E. A ausência de
  credencial, serviço externo ou ambiente real deve ser registrada como `not_run`, nunca como `pass`.
- Testes devem produzir evidência rastreável por SPEC/issue: arquivos brutos em `reports/.raw`,
  cobertura por categoria e relatório agregado conforme ADR-003.
- Mudança em teste, workflow ou gerador de relatório exige self-check e verificação do relatório.
  Se tocar UI, IPC, janela, preload ou fluxo crítico, incluir prova visual/E2E pertinente.
- Correção de bug precisa de teste de regressão quando houver comportamento verificável. Se não houver
  teste viável, registrar o motivo e a prova alternativa na PR.

### Runtime local e CI

- O projeto usa **Node 24** no desenvolvimento local e no GitHub Actions. No Windows, valide com
  `node -v`; a versão esperada é Node 24.x.
- Ao escrever scripts portáveis, considerar Windows primeiro: resolver `.cmd` quando necessário,
  evitar suposições Linux-only e não depender de shell específico para lógica essencial.
- Se uma dependência ainda não suportar Node 24, trate como bloqueio explícito: documente o erro,
  ajuste a matriz apenas com justificativa e não esconda quebra degradando silenciosamente para Node 22.

## Grafo de conhecimento (graphify)

O repo tem um grafo de conhecimento persistente em `graphify-out/` (gerado pela skill `/graphify` — https://github.com/Graphify-Labs/graphify). Ele indexa `src/` + `docs/` + `scripts/` (1748 nós, 154 comunidades — atualizado em 2026-07-23, ao fechar o MVP-003) e responde perguntas sobre o codebase gastando muito menos tokens que ler arquivos. O escopo exclui `.aiox-core/` e as imagens de `docs/design/` — framework de terceiros e mockups não entram no grafo.

- **Antes de explorar o codebase** para entender arquitetura, fluxos ou "quem chama o quê": consulte o grafo primeiro — `/graphify query "<pergunta>"` (ou `graphify query` via CLI). Só leia arquivos direto quando precisar do conteúdo exato.
- **Achar no grafo, afirmar pelo arquivo.** A topologia localiza; ela não prova. Antes de qualquer afirmação quantitativa ou de unicidade ("é a única aresta", "só existe em X", "as cópias divergiram"), conte todas as arestas relevantes e confirme no disco (`md5sum`, `diff`, ler o trecho). Cite a granularidade que o dado tem: se o grafo guarda `source_location: "§Seção"`, não invente número de linha.
- **Por que:** a extração é não-determinística. Dois arquivos byte-idênticos (`docs/design/uploads/prd-design-system-plataforma.md` e `docs/iniciais/prd-design-system-plataforma.md`, mesmo MD5) geraram 10 nós em 2 comunidades versus 17 nós em 6 — e só uma das cópias recebeu a aresta de correção do ADR-001. Qual cópia recebe qual aresta é artefato de qual subagente processou o chunk, não fato sobre os documentos.
- **Ao final de cada entrega** (junto com STATUS.md/DEVELOPMENT.md): Sempre me pergunta se pode ou não fazer o comando `/graphify . --update` — incremental, re-extrai só arquivos novos/alterados via manifest. Não recrie o grafo do zero.
- `graphify-out/` é artefato local (cache), não entra em commit.

## Skills relevantes a usar (Code/Codex)

`gstack:*`, `fechar-card` e `impeccable` estão instalados globalmente na máquina do PI (Windows) — o Code/Codex os usa normalmente lá. Em qualquer ambiente onde uma dessas skills não exista, isso não é desculpa para pular a disciplina que ela representa: aplicar o equivalente manual (revisão de design, acabamento visual, **comentário de encerramento com as três seções**) e registrar na PR.

- `superpowers:brainstorming` — antes de implementar feature não-trivial
- `superpowers:writing-plans` — pra task com mais de 1 etapa de DB/API
- `superpowers:test-driven-development` — feature crítica (LGPD, RLS, anti-banimento)
- `superpowers:systematic-debugging` — bugs reportados
- `superpowers:verification-before-completion` — antes de declarar "pronto"
- `frontend-design` — UI distinta (não cair em shadcn-default genérico)
-`context7-mcp` - pesquisa na internet
-`playwright` - smoke ao vivo
-`security-review` - segurança do sistema
-`design-review` - padrões do frontend.
-`code-review` - padrões do código criado.
-`impeccable` - critique craft layout delight clarify polish optimize 
