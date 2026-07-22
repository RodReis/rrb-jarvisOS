# CLAUDE.md — rrb-jarvisOS

Desktop app **local-first** (Electron + React + TypeScript) com dois espaços de usuário — **NOA** (pessoal) e **JARVIS OS** (profissional/operacional) — sobre uma plataforma compartilhada (**Desenvolvimento**). Sync/auth via Supabase Cloud como espelho, nunca como fonte de verdade operacional. Base: `docs/DECISIONS.md` (ADR-001).

## Documentos que você deve ler (ordem)

| Doc | O que é |
|---|---|
| `docs/DEVELOPMENT.md` | **Sua ordem de execução e status por item (você é o dono; atualize a cada entrega junto com STATUS.md)** |
| `docs/ARCHITECTURE.md` | Desenho, módulos, dados, resiliência |
| `docs/DECISIONS.md` | ADRs (ler antes de propor mudança estrutural) |
| `docs/CONVENTION.md` | Contrato do processo (labels `proplan:*`) e contrato de dados das entidades |
| `docs/STATUS.md` | Kanban/roadmap deste projeto (mantenha atualizado ao concluir fatias) |
| `docs/LANDSCAPE.md` | Mapa do território: domínios, módulos e onde cada documento mora |
| `docs/TESTING.md` | processo de test, QA, relatório |
| `docs/spec/` | Specs por fatia — só implemente fatia com spec `aprovada-pi` |
| `docs/mvp/` | MVPs (épicos) com checklist das fatias previstas |

## Papéis e governança

- **Rodrigo Reis (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas.
- **Claude Cowork (planejamento)** — especifica e mantém `docs/` e as specs em `docs/specs/`. Antes de finalizar qualquer spec, apresenta as perguntas abertas e dúvidas ao PI — spec só vira `aprovada-pi` com todas resolvidas (evitar retrabalho). Quando a spec vira `aprovada-pi`, **cria a issue-fatia no board** (coluna Backlog, assignee PI). **Nunca implementa código** — implementação é exclusiva do Claude Code.
- **Claude Code (você)** — planeja, codifica, testa (código, UX e UI — pode usar as skills do impeccable), atualiza a documentação e **sempre commita todos os documentos de `docs/`** junto da entrega. Implementa a partir deste arquivo + `docs/` + spec da feature em `docs/specs/`. **Não cria a issue** (é do Cowork) — pega o card, move pelo fluxo e entrega com PR. Pode criticar arquitetura, **não escopo**. Sem spec para a tarefa, ou spec ambígua → perguntar ao PI antes de codificar, nunca assumir. Deve apontar problemas técnicos da spec — a correção passa pelo PI.

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

### Fatia exige spec. Correção de bug documentado, não.

A regra *"sem spec `aprovada-pi` → não codificar"* existe para impedir **escopo assumido** — o Code inventando o que fazer. Ela **não se aplica** quando não há escopo a assumir:

| tipo | precisa de spec? | por quê |
|---|---|---|
| **Fatia** (escopo novo, comportamento novo) | **Sim** | há decisões de produto a tomar — são do PI |
| **Correção de bug já documentado** (o comportamento correto está escrito num ADR, no `ARCHITECTURE.md` ou numa spec existente) | **Não** | não há o que decidir: o certo já está definido. Basta o item no `STATUS.md` + a regra escrita |
| **Bug sem comportamento correto definido** | **Sim** — ou pelo menos perguntar ao PI | se o certo ainda não foi decidido, decidir é do PI |

Exemplo vivo: **sync SHA-aware** (elimina o `noop` falso) — não tem spec e **não precisa**. A regra está no `ARCHITECTURE.md` → Resiliência, com os call sites e o que é proibido. Implementar direto.

## Regras de trabalho

- **Idioma**: documentação, specs, commits e comunicação sempre em português (pt-BR); código e identificadores em inglês.
- **Sem hardcode e sem mock** — dado local de desenvolvimento entra via seed (`prisma/seed.ts`), criado na primeira fatia que precisar.
- **Ambiente 100% local até o fim do MVP** (docker-compose; sem deploy em nuvem).
- **Portas**: web `5180` (strictPort — se ocupada, falha em vez de trocar), API `3311` (era 3000; remapeada por colisão com outros stacks locais — configurável via `API_PORT`). Postgres host `5433`, Redis host `6380` (host bindings remapeados; rede interna do compose segue 5432/6379).

### Colunas do board (mapeamento Issues → Kanban)

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

## Regras técnicas invioláveis (resumo — detalhe no ARCHITECTURE.md)

- Renderer **nunca** acessa Node, segredo ou executa comando direto. IPC mínimo e tipado via preload; `contextIsolation` on, `nodeIntegration` off.
- Toda entidade persistida carrega escopo: `user_id`, `workspace_id` (+ `organization_id`, `visibility`, `sensitivity` quando aplicável).
- `Desenvolvimento` não é workspace de usuário. `Agentic OS` é área interna do JARVIS OS, nunca um quarto workspace.
- Policy Engine é **fail closed**: ação não reconhecida = bloqueada. Ação sensível gera `AuditEvent` antes e depois.
- Local é fonte de verdade operacional; Supabase Cloud é espelho de sync/auth/auditoria (ADR-001).

## Diretrizes de implementação (Code)

Priorizam cautela sobre velocidade; em tarefa trivial, bom senso.

- **Pense antes de codificar.** Não presuma: declare suposições, exponha interpretações alternativas, aponte a abordagem mais simples. Em dúvida, pare e pergunte ao PI (já é regra: sem spec → perguntar).
- **Simplicidade primeiro.** Código mínimo que resolve. Sem abstração de uso único, sem flexibilidade não pedida, sem tratar cenário impossível.
- **Alterações cirúrgicas.** Cada linha alterada rastreável ao pedido. Não refatore o que não quebrou; mantenha o estilo existente; código morto não relacionado se aponta, não se apaga. **Exceção:** atualizar `docs/` é escopo obrigatório da entrega, não "melhoria adjacente".
- **Execução verificável.** Traduza tarefa em critério checável ("adicionar validação" → "teste para entrada inválida passa"). `dev`, `test`, `lint` verdes é o piso.

## Grafo de conhecimento (graphify)

O repo tem um grafo de conhecimento persistente em `graphify-out/` (gerado pela skill `/graphify` — https://github.com/Graphify-Labs/graphify). Ele indexa `src/` + `docs/` + `scripts/` (414 nós, 26 comunidades) e responde perguntas sobre o codebase gastando muito menos tokens que ler arquivos. O escopo exclui `.aiox-core/` e as imagens de `docs/design/` — framework de terceiros e mockups não entram no grafo.

- **Antes de explorar o codebase** para entender arquitetura, fluxos ou "quem chama o quê": consulte o grafo primeiro — `/graphify query "<pergunta>"` (ou `graphify query` via CLI). Só leia arquivos direto quando precisar do conteúdo exato.
- **Achar no grafo, afirmar pelo arquivo.** A topologia localiza; ela não prova. Antes de qualquer afirmação quantitativa ou de unicidade ("é a única aresta", "só existe em X", "as cópias divergiram"), conte todas as arestas relevantes e confirme no disco (`md5sum`, `diff`, ler o trecho). Cite a granularidade que o dado tem: se o grafo guarda `source_location: "§Seção"`, não invente número de linha.
- **Por que:** a extração é não-determinística. Dois arquivos byte-idênticos (`docs/design/uploads/prd-design-system-plataforma.md` e `docs/iniciais/prd-design-system-plataforma.md`, mesmo MD5) geraram 10 nós em 2 comunidades versus 17 nós em 6 — e só uma das cópias recebeu a aresta de correção do ADR-001. Qual cópia recebe qual aresta é artefato de qual subagente processou o chunk, não fato sobre os documentos.
- **Ao final de cada entrega** (junto com STATUS.md/DEVELOPMENT.md): rode `/graphify . --update` — incremental, re-extrai só arquivos novos/alterados via manifest. Não recrie o grafo do zero.
- `graphify-out/` é artefato local (cache), não entra em commit.

